/**
 * Recovery-machinery regression tests for the robustness audit fixes:
 * per-entry journal atomicity, intent markers, abort retention,
 * already-broadcast detection, notification retry, receive verification,
 * and cross-tab lock semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrivateKey, Hash } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import {
  journalPut,
  journalList,
  journalClear,
  journalIntentBegin,
  journalIntentEnd,
  withIntent,
  hasFreshIntent,
  INTENT_TTL_MS
} from './txJournal'
import { reconcileWallet, ABORT_RETRY_CAP } from './reconcile'
import {
  notifyPut,
  notifyList,
  notifyClear,
  reconcileNotifications
} from './notifyJournal'
import { receiveTokens, InvalidTransferError } from './receive'
import { tryWithLock } from './webLocks'
import { isAlreadyBroadcast } from './overlay'

const mkWallet = (over: Partial<Record<'createAction' | 'abortAction' | 'listActions' | 'internalizeAction', any>> = {}) => ({
  createAction: vi.fn().mockResolvedValue({}),
  abortAction: vi.fn().mockResolvedValue({ aborted: true }),
  listActions: vi.fn().mockResolvedValue({ actions: [] }),
  internalizeAction: vi.fn().mockResolvedValue({ accepted: true }),
  ...over
})

beforeEach(() => {
  journalClear()
  notifyClear()
})

describe('txJournal intents', () => {
  it('withIntent marks a pipeline in flight and always clears', async () => {
    await withIntent(async () => {
      expect(hasFreshIntent()).toBe(true)
    })
    expect(hasFreshIntent()).toBe(false)
    await expect(withIntent(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(hasFreshIntent()).toBe(false)
  })

  it('a fresh intent blocks the bulk sweep; a stale one is expired and unblocks it', async () => {
    const id = journalIntentBegin()
    const wallet = mkWallet({ listActions: vi.fn().mockResolvedValue({ actions: [{ txid: 'x' }] }) })
    const r1 = await reconcileWallet(wallet as any)
    expect(r1.swept).toBe(0)
    expect(wallet.listActions).not.toHaveBeenCalled()
    journalIntentEnd(id)

    // Stale intent (crashed pipeline): expired on the next pass, sweep runs.
    journalPut({ txid: 'intent:crashed', stage: 'intent', at: Date.now() - INTENT_TTL_MS - 1 })
    const r2 = await reconcileWallet(wallet as any)
    expect(r2.swept).toBe(1)
    expect(journalList().filter(e => e.stage === 'intent')).toEqual([])
  })
})

describe('reconcile abort retention', () => {
  it('keeps a failing abort entry with attempts++ instead of dropping it', async () => {
    journalPut({ txid: 'rej', stage: 'abort', reference: 'ref-x', at: 1 })
    const wallet = mkWallet({ abortAction: vi.fn().mockRejectedValue(new Error('wallet offline')) })
    await reconcileWallet(wallet as any)
    const entry = journalList().find(e => e.txid === 'rej')
    expect(entry).toBeDefined()
    expect(entry?.attempts).toBe(1)
  })

  it('hands a persistently-failing abort to the sweep only after the cap', async () => {
    journalPut({ txid: 'rej', stage: 'abort', reference: 'ref-x', at: 1, attempts: ABORT_RETRY_CAP - 1 })
    const wallet = mkWallet({ abortAction: vi.fn().mockRejectedValue(new Error('still failing')) })
    await reconcileWallet(wallet as any)
    expect(journalList()).toEqual([])
  })

  it('clears an accepted entry when the broadcast error means already-known', async () => {
    journalPut({ txid: 'dup', stage: 'accepted', at: 1 })
    const wallet = mkWallet({
      createAction: vi.fn().mockRejectedValue(new Error('txn-already-known'))
    })
    const r = await reconcileWallet(wallet as any)
    expect(r.rebroadcast).toEqual(['dup'])
    expect(journalList()).toEqual([])
  })

  it('isAlreadyBroadcast matches known duplicates, not transient failures', () => {
    expect(isAlreadyBroadcast(new Error('txn-already-known'))).toBe(true)
    expect(isAlreadyBroadcast(new Error('Transaction already exists in mempool'))).toBe(true)
    expect(isAlreadyBroadcast(new Error('network unreachable'))).toBe(false)
  })
})

describe('notification journal', () => {
  it('retries pending notifications and clears on delivery', async () => {
    notifyPut({ txid: 't1', recipient: '02ab', messageBox: 'mandala-payments', body: { assetId: 'a.0' }, at: 1 })
    const mbc = { sendMessage: vi.fn().mockResolvedValue({}) }
    const delivered = await reconcileNotifications(mbc)
    expect(delivered).toEqual(['t1'])
    expect(notifyList()).toEqual([])
    expect(mbc.sendMessage).toHaveBeenCalledWith({
      recipient: '02ab',
      messageBox: 'mandala-payments',
      body: { assetId: 'a.0' }
    })
  })

  it('keeps a failed notification (attempts++) for the next pass', async () => {
    notifyPut({ txid: 't1', recipient: '02ab', messageBox: 'mb', body: {}, at: 1 })
    const mbc = { sendMessage: vi.fn().mockRejectedValue(new Error('box down')) }
    const delivered = await reconcileNotifications(mbc)
    expect(delivered).toEqual([])
    expect(notifyList()[0]?.attempts).toBe(1)
  })
})

describe('receive verification', () => {
  const pkh = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
  const assetId = `${'a'.repeat(64)}.0`

  const mkMbc = (messages: Array<{ messageId: string, body: any }>) => ({
    listMessages: vi.fn().mockResolvedValue(messages),
    acknowledgeMessage: vi.fn().mockResolvedValue({})
  })

  it('acks and drops a message whose transaction does not parse (poisoned)', async () => {
    const mbc = mkMbc([{
      messageId: 'm1',
      body: { assetId, amount: '25', sender: '02ab', keyID: 'k', protocolID: [2, 'mandala token'], transaction: [1, 2, 3], outputIndex: 0 }
    }])
    const wallet = mkWallet()
    const { accepted, failed } = await receiveTokens({ wallet: wallet as any, messageBoxClient: mbc })
    expect(accepted).toEqual([])
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toBeInstanceOf(InvalidTransferError)
    // Poisoned message is acknowledged so it never replays.
    expect(mbc.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['m1'] })
    // And the wallet was never touched.
    expect(wallet.internalizeAction).not.toHaveBeenCalled()
  })

  it('treats an already-internalized output as success and acknowledges', async () => {
    const { Transaction: Tx, P2PKH, UnlockingScript } = await import('@bsv/sdk')
    const src = new Tx()
    src.addOutput({ satoshis: 2, lockingScript: new P2PKH().lock(pkh) })
    const tx = new Tx()
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]), sequence: 0xffffffff })
    tx.addOutput({ satoshis: 1, lockingScript: new MandalaToken().lock(assetId, 25, pkh) })
    const atomic = tx.toAtomicBEEF(true)

    const mbc = mkMbc([{
      messageId: 'm2',
      body: { assetId, amount: '25', sender: '02ab', keyID: 'k', protocolID: [2, 'mandala token'], transaction: atomic, outputIndex: 0 }
    }])
    const wallet = mkWallet({
      internalizeAction: vi.fn().mockRejectedValue(new Error('output already exists in basket'))
    })
    const { accepted, failed } = await receiveTokens({ wallet: wallet as any, messageBoxClient: mbc })
    expect(failed).toEqual([])
    expect(accepted).toHaveLength(1)
    expect(mbc.acknowledgeMessage).toHaveBeenCalledWith({ messageIds: ['m2'] })
  })

  it('rejects a body/output mismatch (wrong amount) without wallet work', async () => {
    const { Transaction: Tx, P2PKH, UnlockingScript } = await import('@bsv/sdk')
    const src = new Tx()
    src.addOutput({ satoshis: 2, lockingScript: new P2PKH().lock(pkh) })
    const tx = new Tx()
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0, unlockingScript: new UnlockingScript([]), sequence: 0xffffffff })
    tx.addOutput({ satoshis: 1, lockingScript: new MandalaToken().lock(assetId, 25, pkh) })
    const atomic = tx.toAtomicBEEF(true)

    const mbc = mkMbc([{
      messageId: 'm3',
      body: { assetId, amount: '1000000', sender: '02ab', keyID: 'k', protocolID: [2, 'mandala token'], transaction: atomic, outputIndex: 0 }
    }])
    const wallet = mkWallet()
    const { accepted, failed } = await receiveTokens({ wallet: wallet as any, messageBoxClient: mbc })
    expect(accepted).toEqual([])
    expect(failed[0].error).toBeInstanceOf(InvalidTransferError)
    expect(String(failed[0].error)).toMatch(/amount mismatch/)
    expect(wallet.internalizeAction).not.toHaveBeenCalled()
  })
})

describe('webLocks', () => {
  it('second concurrent holder is refused, lock releases after settle', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const first = tryWithLock('t.lock', async () => {
      await gate
      return 1
    })
    const second = await tryWithLock('t.lock', async () => 2)
    expect(second.acquired).toBe(false)
    release()
    expect((await first)).toEqual({ acquired: true, result: 1 })
    const third = await tryWithLock('t.lock', async () => 3)
    expect(third).toEqual({ acquired: true, result: 3 })
  })
})
