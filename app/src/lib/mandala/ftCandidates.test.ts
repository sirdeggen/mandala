import { describe, it, expect } from 'vitest'
import { excludeFrozen } from './ftCandidates'
import type { FtCandidate } from './ftSelect'

const c = (outpoint: string): FtCandidate => ({
  outpoint, amount: 1, keyID: 'k', counterparty: '', confirmed: true, order: 0
})

describe('excludeFrozen', () => {
  it('drops candidates whose outpoint is frozen', () => {
    const out = excludeFrozen([c('a.0'), c('b.1'), c('c.2')], new Set(['b.1']))
    expect(out.map(o => o.outpoint)).toEqual(['a.0', 'c.2'])
  })

  it('drops candidates whose outpoint is in the excluded set (frozen + evicted)', () => {
    // The excluded set may contain both frozen and evicted outpoints
    const excluded = new Set(['b.1', 'c.2']) // e.g., b.1 frozen, c.2 evicted
    const out = excludeFrozen([c('a.0'), c('b.1'), c('c.2'), c('d.3')], excluded)
    expect(out.map(o => o.outpoint)).toEqual(['a.0', 'd.3'])
  })

  it('returns all candidates when the excluded set is empty (fail-open shape)', () => {
    const all = [c('a.0'), c('b.1')]
    expect(excludeFrozen(all, new Set())).toEqual(all)
  })
})
