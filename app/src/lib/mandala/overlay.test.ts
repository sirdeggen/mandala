import { describe, it, expect, vi } from 'vitest'
import { submitToOverlay } from './overlay'

describe('submitToOverlay', () => {
  it('returns admitted indices on success', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0, 1], coinsToRetain: [] } }) }
    const res = await submitToOverlay([1, 2, 3], [4, 5], facilitator as any)
    expect(res).toEqual([0, 1])
    expect(facilitator.send).toHaveBeenCalledWith(undefined, { beef: [1, 2, 3], topics: ['tm_mandala'], offChainValues: [4, 5] })
  })
  it('throws when nothing is admitted', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [], coinsToRetain: [] } }) }
    await expect(submitToOverlay([1], undefined, facilitator as any)).rejects.toThrow('overlay rejected')
  })
})
