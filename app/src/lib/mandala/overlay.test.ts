import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitToOverlay, submitAndBroadcast } from './overlay'
import { journalList, journalClear } from './txJournal'
import { OVERLAY_URL } from './constants'

beforeEach(() => journalClear())

describe('submitToOverlay', () => {
  it('returns admitted indices on success', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0, 1], coinsToRetain: [] } }) }
    const res = await submitToOverlay([1, 2, 3], [4, 5], facilitator as any)
    expect(res).toEqual([0, 1])
    expect(facilitator.send).toHaveBeenCalledWith(OVERLAY_URL, { beef: [1, 2, 3], topics: ['tm_mandala'], offChainValues: [4, 5] })
  })
  it('throws when nothing is admitted', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [], coinsToRetain: [] } }) }
    await expect(submitToOverlay([1], undefined, facilitator as any)).rejects.toThrow('overlay rejected')
  })
})

describe('submitAndBroadcast (overlay-gated finalize)', () => {
  const signed = { tx: [1, 2, 3], txid: 'abc' }

  it('broadcasts via sendWith only after the overlay accepts', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0] } }) }
    const wallet = { createAction: vi.fn().mockResolvedValue({}), abortAction: vi.fn() }
    const res = await submitAndBroadcast(wallet as any, signed, [9], 'ref-1', facilitator as any)
    expect(res).toEqual([0])
    expect(wallet.createAction).toHaveBeenCalledWith({
      description: 'broadcast overlay-accepted tx',
      options: { sendWith: ['abc'], acceptDelayedBroadcast: false }
    })
    expect(wallet.abortAction).not.toHaveBeenCalled()
  })

  it('never broadcasts and aborts (releasing inputs) when the overlay rejects', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [] } }) }
    const wallet = { createAction: vi.fn(), abortAction: vi.fn().mockResolvedValue({}) }
    await expect(submitAndBroadcast(wallet as any, signed, undefined, 'ref-1', facilitator as any))
      .rejects.toThrow('overlay rejected')
    expect(wallet.createAction).not.toHaveBeenCalled() // tx never hit the network
    expect(wallet.abortAction).toHaveBeenCalledWith({ reference: 'ref-1' })
  })

  it('skips abort with no reference (genesis) and still never broadcasts on reject', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [] } }) }
    const wallet = { createAction: vi.fn(), abortAction: vi.fn() }
    await expect(submitAndBroadcast(wallet as any, signed, undefined, undefined, facilitator as any))
      .rejects.toThrow('overlay rejected')
    expect(wallet.createAction).not.toHaveBeenCalled()
    expect(wallet.abortAction).not.toHaveBeenCalled()
  })

  it('resolves at accept and keeps the journal entry when the background broadcast fails', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0] } }) }
    const wallet = { createAction: vi.fn().mockRejectedValue(new Error('net down')), abortAction: vi.fn() }
    // Resolves at the overlay-accept commit point despite the doomed broadcast.
    await expect(submitAndBroadcast(wallet as any, signed, undefined, 'ref-1', facilitator as any))
      .resolves.toEqual([0])
    await new Promise(r => setTimeout(r, 0)) // let the background broadcast settle
    // Accepted by the overlay → must NOT be aborted, must stay journaled for retry.
    expect(wallet.abortAction).not.toHaveBeenCalled()
    expect(journalList()).toMatchObject([{ txid: 'abc', stage: 'accepted' }])
  })

  it('journals a pending abort when the overlay rejects and abortAction fails', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [] } }) }
    const wallet = { createAction: vi.fn(), abortAction: vi.fn().mockRejectedValue(new Error('offline')) }
    await expect(submitAndBroadcast(wallet as any, signed, undefined, 'ref-1', facilitator as any))
      .rejects.toThrow('overlay rejected')
    expect(journalList()).toMatchObject([{ txid: 'abc', stage: 'abort', reference: 'ref-1' }])
  })

  it('clears the journal after a successful accept + broadcast', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0] } }) }
    const wallet = { createAction: vi.fn().mockResolvedValue({}), abortAction: vi.fn() }
    await submitAndBroadcast(wallet as any, signed, undefined, 'ref-1', facilitator as any)
    await new Promise(r => setTimeout(r, 0)) // background broadcast
    expect(journalList()).toEqual([])
  })

  it('journals accepted BEFORE background broadcast starts (crash window is recoverable)', async () => {
    let resolveBroadcast!: () => void
    const broadcastGate = new Promise<void>(r => {
      resolveBroadcast = r
    })
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0] } }) }
    const wallet = {
      createAction: vi.fn().mockImplementation(async () => {
        await broadcastGate
        return {}
      }),
      abortAction: vi.fn()
    }
    const done = submitAndBroadcast(wallet as any, signed, undefined, 'ref-1', facilitator as any)
    // Commit point resolves with journal already written; broadcast still pending.
    await expect(done).resolves.toEqual([0])
    expect(journalList()).toMatchObject([{ txid: 'abc', stage: 'accepted' }])
    resolveBroadcast()
    await new Promise(r => setTimeout(r, 0))
    expect(journalList()).toEqual([])
  })
})
