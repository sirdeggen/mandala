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

  it('returns all candidates when the frozen set is empty (fail-open shape)', () => {
    const all = [c('a.0'), c('b.1')]
    expect(excludeFrozen(all, new Set())).toEqual(all)
  })
})
