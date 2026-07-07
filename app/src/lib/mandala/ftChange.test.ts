import { it, expect, describe } from 'vitest'
import { generateFtChange, DESIRED_FT_UTXOS, MAX_FT_CHANGE_OUTPUTS } from './ftChange'

// Constant-rand injector: fraction randInt(2500,5000) → 3750 (37.5% slices),
// index randInt(0,n-1) → floor(0.5*n) (always the same output).
const half = (): number => 0.5

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

describe('generateFtChange', () => {
  it('returns no outputs for zero or negative change', () => {
    expect(generateFtChange({ change: 0, poolCount: 5, inputCount: 1 })).toEqual([])
    expect(generateFtChange({ change: -3, poolCount: 5, inputCount: 1 })).toEqual([])
  })

  it('consolidates to a single full-change output when the pool is over target', () => {
    // pool 40 ≥ desired 32 → targetNet ≤ 0 → one output carrying all change.
    const r = generateFtChange({ change: 100, poolCount: 40, inputCount: 2, rand: half })
    expect(r).toEqual([100])
  })

  it('grows a small pool toward the desired count, capped per tx', () => {
    // pool 1, desired default 32 → targetNet 31 → outputs capped at MAX per tx.
    const r = generateFtChange({ change: 1000, poolCount: 1, inputCount: 1, rand: half })
    expect(r.length).toBe(MAX_FT_CHANGE_OUTPUTS)
    expect(sum(r)).toBe(1000)
  })

  it('nets output count against inputs consumed (net growth semantics)', () => {
    // pool 31, desired 32 → targetNet 1; 1 input consumed → 2 outputs restores net +1.
    const r = generateFtChange({ change: 100, poolCount: 31, inputCount: 1, rand: half })
    expect(r.length).toBe(2)
    expect(sum(r)).toBe(100)
  })

  it('never creates more outputs than change units (1-unit floor)', () => {
    const r = generateFtChange({ change: 3, poolCount: 1, inputCount: 1, rand: half })
    expect(r).toEqual([1, 1, 1])
  })

  it('scatters the surplus in 25-50% slices onto rand-chosen outputs (toolbox spread)', () => {
    // n=2, change=100: seeds [1,1], surplus 98 poured in 37.5% slices onto index 1.
    const r = generateFtChange({ change: 100, poolCount: 31, inputCount: 1, rand: half })
    expect(r).toEqual([1, 99])
  })

  it('conserves the change total exactly across many configurations', () => {
    // LCG for reproducible pseudo-random sequences.
    let seed = 42
    const lcg = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (const change of [1, 2, 7, 50, 999, 123456]) {
      for (const poolCount of [0, 1, 10, 31, 32, 100]) {
        const r = generateFtChange({ change, poolCount, inputCount: 1, rand: lcg })
        expect(sum(r)).toBe(change)
        expect(r.every(a => Number.isInteger(a) && a >= 1)).toBe(true)
        expect(r.length).toBeLessThanOrEqual(MAX_FT_CHANGE_OUTPUTS)
        expect(r.length).toBeLessThanOrEqual(change)
      }
    }
  })

  it('respects explicit desiredPoolCount and maxOutputs overrides', () => {
    // desired 4, pool 0, 1 input → targetNet 4 → 5 outputs, capped at 3 by maxOutputs.
    const r = generateFtChange({
      change: 60, poolCount: 0, inputCount: 1, desiredPoolCount: 4, maxOutputs: 3, rand: half
    })
    expect(r.length).toBe(3)
    expect(sum(r)).toBe(60)
  })

  it('works without an injected rand (Math.random default)', () => {
    const r = generateFtChange({ change: 500, poolCount: 1, inputCount: 1 })
    expect(sum(r)).toBe(500)
    expect(r.every(a => Number.isInteger(a) && a >= 1)).toBe(true)
  })

  it('exports toolbox-mirroring defaults', () => {
    expect(DESIRED_FT_UTXOS).toBeGreaterThan(1)
    expect(MAX_FT_CHANGE_OUTPUTS).toBe(8)
  })
})
