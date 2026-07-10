import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  withAdminAuthGate,
  beginAdminAuth,
  endAdminAuth,
  clearAdminAuthGates,
  isAdminAuthInFlight,
  adminAuthInFlightPrior,
  assertSpendablePrior,
  StaleAdminAuthError
} from './adminAuthGate'
import { BusyError } from './singleFlight'

beforeEach(() => clearAdminAuthGates())

describe('adminAuthGate', () => {
  it('serializes two overlapping same-asset actions — second fails cleanly', async () => {
    let releaseFirst!: () => void
    const firstHold = new Promise<void>(r => {
      releaseFirst = r
    })

    const first = withAdminAuthGate('asset.0', 'prior.0', async () => {
      await firstHold
      return 'first'
    })

    // Second starts while first still holds the same prior.
    await expect(
      withAdminAuthGate('asset.0', 'prior.0', async () => 'second')
    ).rejects.toBeInstanceOf(BusyError)

    expect(isAdminAuthInFlight('asset.0')).toBe(true)
    expect(adminAuthInFlightPrior('asset.0')).toBe('prior.0')

    releaseFirst()
    expect(await first).toBe('first')
    expect(isAdminAuthInFlight('asset.0')).toBe(false)
  })

  it('allows a second action only after the first settles', async () => {
    const order: string[] = []
    await withAdminAuthGate('a.0', 'p.0', async () => {
      order.push('a')
    })
    await withAdminAuthGate('a.0', 'p.1', async () => {
      order.push('b')
    })
    expect(order).toEqual(['a', 'b'])
  })

  it('allows concurrent admin actions on different assets', async () => {
    let releaseA!: () => void
    const holdA = new Promise<void>(r => {
      releaseA = r
    })
    const a = withAdminAuthGate('assetA.0', 'pa.0', async () => {
      await holdA
      return 'A'
    })
    const b = withAdminAuthGate('assetB.0', 'pb.0', async () => 'B')
    expect(await b).toBe('B')
    releaseA()
    expect(await a).toBe('A')
  })

  it('releases the gate when the pipeline throws so recovery can retry', async () => {
    await expect(
      withAdminAuthGate('x.0', 'p.0', async () => {
        throw new Error('overlay rejected')
      })
    ).rejects.toThrow('overlay rejected')
    expect(isAdminAuthInFlight('x.0')).toBe(false)
    // A retry (e.g. after journal reconcile) must be able to re-acquire.
    await expect(withAdminAuthGate('x.0', 'p.0', async () => 'ok')).resolves.toBe('ok')
  })

  it('begin/end refuse empty ids', () => {
    expect(() => beginAdminAuth('', 'p.0')).toThrow(/requires/)
    expect(() => beginAdminAuth('a.0', '')).toThrow(/requires/)
    beginAdminAuth('a.0', 'p.0')
    endAdminAuth('a.0')
    expect(isAdminAuthInFlight('a.0')).toBe(false)
  })
})

describe('assertSpendablePrior', () => {
  it('accepts a prior present in the spendable list', () => {
    expect(() => assertSpendablePrior('aa.0', ['bb.0', 'aa.0'])).not.toThrow()
  })

  it('throws StaleAdminAuthError when prior is missing (stale cache / double-spend)', () => {
    expect(() => assertSpendablePrior('gone.0', ['live.0'])).toThrow(StaleAdminAuthError)
    expect(() => assertSpendablePrior('gone.0', [])).toThrow(/no longer spendable/)
  })
})

describe('double-submit race simulation (shipped gate)', () => {
  it('only one of two parallel same-prior pipelines runs createAction-equivalent work', async () => {
    const createAction = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 15))
      return { txid: 't1' }
    })

    const pipeline = (label: string) =>
      withAdminAuthGate('shared.0', 'auth.0', async () => {
        // Await so the gate is held for the full critical section — otherwise
        // it releases while the simulated wallet work is still in flight.
        await createAction()
        return label
      })

    const results = await Promise.allSettled([pipeline('one'), pipeline('two')])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BusyError)
    expect(createAction).toHaveBeenCalledTimes(1)
  })
})
