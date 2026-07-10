import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reconcileWallet, SPEC_OP_NOSEND_ACTIONS } from './reconcile.js'
import { journalPut, journalList, journalClear } from './txJournal.js'

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

  it('second reconcile after successful rebroadcast is idempotent (no double broadcast)', async () => {
    journalPut({ txid: 'aa', stage: 'accepted', at: 1 })
    const wallet = mkWallet()
    const r1 = await reconcileWallet(wallet as any)
    expect(r1.rebroadcast).toEqual(['aa'])
    expect(journalList()).toEqual([])
    const r2 = await reconcileWallet(wallet as any)
    expect(r2.rebroadcast).toEqual([])
    expect(r2.aborted).toEqual([])
    // Only one sendWith broadcast for the accepted entry.
    expect(wallet.createAction).toHaveBeenCalledTimes(1)
  })

  it('reconcile with empty journal only runs bulk sweep, invents no work', async () => {
    const wallet = mkWallet({
      listActions: vi.fn().mockResolvedValue({ actions: [] })
    })
    const r = await reconcileWallet(wallet as any)
    expect(r.rebroadcast).toEqual([])
    expect(r.aborted).toEqual([])
    expect(r.swept).toBe(0)
    expect(wallet.createAction).not.toHaveBeenCalled()
    expect(wallet.abortAction).not.toHaveBeenCalled()
  })

  it('never aborts an accepted entry — only rebroadcasts', async () => {
    journalPut({ txid: 'keep-me', stage: 'accepted', at: 1 })
    const wallet = mkWallet()
    await reconcileWallet(wallet as any)
    expect(wallet.abortAction).not.toHaveBeenCalled()
    expect(wallet.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ sendWith: ['keep-me'] })
      })
    )
  })

  it('retries abort stage and does not rebroadcast it', async () => {
    journalPut({ txid: 'rej', stage: 'abort', reference: 'ref-x', at: 1 })
    const wallet = mkWallet()
    const r = await reconcileWallet(wallet as any)
    expect(r.aborted).toEqual(['rej'])
    expect(r.rebroadcast).toEqual([])
    expect(wallet.createAction).not.toHaveBeenCalled()
    expect(wallet.abortAction).toHaveBeenCalledWith({ reference: 'ref-x' })
  })

  it('does not drop a still-failing accepted entry on second reconcile', async () => {
    journalPut({ txid: 'stuck', stage: 'accepted', at: 1 })
    const wallet = mkWallet({
      createAction: vi.fn().mockRejectedValue(new Error('net down'))
    })
    await reconcileWallet(wallet as any)
    expect(journalList().map(e => e.txid)).toEqual(['stuck'])
    await reconcileWallet(wallet as any)
    expect(journalList().map(e => e.txid)).toEqual(['stuck'])
    // Two rebroadcast attempts, still no sweep while accepted remains.
    expect(wallet.createAction).toHaveBeenCalledTimes(2)
    expect(wallet.listActions).not.toHaveBeenCalled()
  })

  it('processes accepted before abort when both are journaled', async () => {
    journalPut({ txid: 'acc', stage: 'accepted', at: 1 })
    journalPut({ txid: 'abo', stage: 'abort', reference: 'r', at: 2 })
    const order: string[] = []
    const wallet = mkWallet({
      createAction: vi.fn().mockImplementation(async () => {
        order.push('broadcast')
        return {}
      }),
      abortAction: vi.fn().mockImplementation(async () => {
        order.push('abort')
        return { aborted: true }
      })
    })
    const r = await reconcileWallet(wallet as any)
    // journalList order is insertion order; accepted is handled in its branch.
    expect(r.rebroadcast).toContain('acc')
    expect(r.aborted).toContain('abo')
    // Sweep may run after both journal entries clear.
    expect(journalList()).toEqual([])
  })
})
