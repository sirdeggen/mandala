import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconcileWallet, SPEC_OP_NOSEND_ACTIONS } from './reconcile'
import { journalPut, journalList, journalClear } from './txJournal'

const mkWallet = (over: Partial<Record<'createAction' | 'abortAction' | 'listActions', any>> = {}) => ({
  createAction: vi.fn().mockResolvedValue({}),
  abortAction: vi.fn().mockResolvedValue({ aborted: true }),
  listActions: vi.fn().mockResolvedValue({ actions: [] }),
  ...over
})

beforeEach(() => journalClear())

describe('reconcileWallet', () => {
  it('re-broadcasts overlay-accepted txs and clears their entries', async () => {
    journalPut({ txid: 'aa', stage: 'accepted', at: 1 })
    const wallet = mkWallet()
    const r = await reconcileWallet(wallet as any)
    expect(wallet.createAction).toHaveBeenCalledWith({
      description: 'broadcast overlay-accepted tx',
      options: { sendWith: ['aa'], acceptDelayedBroadcast: false }
    })
    expect(r.rebroadcast).toEqual(['aa'])
    expect(journalList()).toEqual([])
  })

  it('keeps an accepted entry when re-broadcast fails and SKIPS the bulk sweep', async () => {
    journalPut({ txid: 'aa', stage: 'accepted', at: 1 })
    const wallet = mkWallet({ createAction: vi.fn().mockRejectedValue(new Error('net down')) })
    const r = await reconcileWallet(wallet as any)
    expect(r.rebroadcast).toEqual([])
    expect(journalList().map(e => e.txid)).toEqual(['aa'])
    // Sweep would abort the accepted-but-unbroadcast tx — must not run.
    expect(wallet.listActions).not.toHaveBeenCalled()
    expect(r.swept).toBe(0)
  })

  it('retries pending aborts by reference and clears their entries', async () => {
    journalPut({ txid: 'bb', stage: 'abort', reference: 'ref-b', at: 1 })
    const wallet = mkWallet()
    const r = await reconcileWallet(wallet as any)
    expect(wallet.abortAction).toHaveBeenCalledWith({ reference: 'ref-b' })
    expect(r.aborted).toEqual(['bb'])
    expect(journalList()).toEqual([])
  })

  it('sweeps stuck nosend mandala actions via the wallet-toolbox spec-op', async () => {
    const wallet = mkWallet({ listActions: vi.fn().mockResolvedValue({ actions: [{ txid: 'x' }, { txid: 'y' }] }) })
    const r = await reconcileWallet(wallet as any)
    expect(wallet.listActions).toHaveBeenCalledWith({
      labels: [SPEC_OP_NOSEND_ACTIONS, 'mandala', 'abort'],
      limit: 100
    })
    expect(r.swept).toBe(2)
  })

  it('treats a wallet without spec-op support as nothing to sweep', async () => {
    const wallet = mkWallet({ listActions: vi.fn().mockRejectedValue(new Error('unknown label')) })
    const r = await reconcileWallet(wallet as any)
    expect(r.swept).toBe(0)
  })
})
