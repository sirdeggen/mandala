import { it, expect, describe } from 'vitest'
import { selectFtInputs, FtCandidate } from './ftSelect'

// Terse builder: amount, confirmed (default true), order (default = amount rank).
let seq = 0
const c = (amount: number, confirmed = true, order = seq++): FtCandidate => ({
  outpoint: `tx${amount}_${order}.0`, amount, keyID: 'k', counterparty: 'cp', confirmed, order
})

const amounts = (s: { selected: FtCandidate[] }): number[] => s.selected.map(x => x.amount)

describe('selectFtInputs', () => {
  it('prefers an exact match in a single UTXO', () => {
    const r = selectFtInputs([c(30), c(50), c(100)], 50)
    expect(amounts(r)).toEqual([50])
    expect(r.total).toBe(50)
  })

  it('overfunds by the least (smallest covering output), one UTXO', () => {
    // target 40: no exact; smallest >= 40 is 50 (not 100).
    const r = selectFtInputs([c(20), c(50), c(100)], 40)
    expect(amounts(r)).toEqual([50])
  })

  it('falls to largest-below and loops when nothing covers the remainder', () => {
    // target 120: no single output >= 120 → take 100 (largest below), remainder 20,
    // then smallest >= 20 is 30.
    const r = selectFtInputs([c(30), c(100), c(15)], 120)
    expect(r.total).toBeGreaterThanOrEqual(120)
    expect(amounts(r)).toEqual([100, 30])
  })

  it('exact match ties break to the oldest (lowest order)', () => {
    const older = { ...c(50, true, 1) }
    const newer = { ...c(50, true, 9) }
    const r = selectFtInputs([newer, older], 50)
    expect(r.selected[0].order).toBe(1)
  })

  it('spends confirmed outputs before any unconfirmed one', () => {
    // Confirmed 50 covers the target; the unconfirmed 60 must be ignored.
    const r = selectFtInputs([c(60, false), c(50, true)], 40)
    expect(amounts(r)).toEqual([50])
    expect(r.selected[0].confirmed).toBe(true)
  })

  it('dips into unconfirmed only when confirmed cannot cover', () => {
    // Confirmed total 30 < target 70 → take confirmed 30, then unconfirmed for the rest.
    const r = selectFtInputs([c(30, true), c(50, false), c(100, false)], 70)
    expect(r.total).toBeGreaterThanOrEqual(70)
    expect(r.selected.some(x => x.confirmed && x.amount === 30)).toBe(true)
    expect(r.selected.some(x => !x.confirmed)).toBe(true)
  })

  it('throws when the combined balance is insufficient', () => {
    expect(() => selectFtInputs([c(10), c(20, false)], 100)).toThrow(/insufficient/i)
  })

  it('returns nothing for a non-positive target', () => {
    expect(selectFtInputs([c(10)], 0)).toEqual({ selected: [], total: 0 })
  })
})
