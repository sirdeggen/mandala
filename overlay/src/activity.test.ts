import { describe, it, expect } from 'vitest'
import { summarizeTx, ActivityProof } from './activity.js'

const NO_PROOFS: ActivityProof[] = []
const base = { txid: 't1', when: '2026-07-07T00:00:00.000Z', proofs: NO_PROOFS }

const inp = (identityKey: string, amount: number) => ({ identityKey, amount, assetId: 'a.0' })
const out = (outputIndex: number, identityKey: string, amount: number) => ({ outputIndex, identityKey, amount, assetId: 'a.0' })

describe('summarizeTx', () => {
  it('classifies a mint (no FT inputs) as issue to the largest output', () => {
    const e = summarizeTx({ ...base, ftInputs: [], ftOutputs: [out(0, 'alice', 100)] })
    expect(e).toMatchObject({ kind: 'issue', from: null, to: 'alice', amount: 100, assetId: 'a.0' })
  })

  it('classifies alice→bob with change back to alice as a transfer of the external amount', () => {
    const e = summarizeTx({
      ...base,
      ftInputs: [inp('alice', 100)],
      ftOutputs: [out(0, 'bob', 30), out(1, 'alice', 70)]
    })
    expect(e).toMatchObject({ kind: 'transfer', from: 'alice', to: 'bob', amount: 30 })
  })

  it('classifies alice→alice (all outputs self, conserved) as a 0-unit self transfer', () => {
    const e = summarizeTx({
      ...base,
      ftInputs: [inp('alice', 100)],
      ftOutputs: [out(0, 'alice', 40), out(1, 'alice', 60)]
    })
    expect(e).toMatchObject({ kind: 'self', from: 'alice', to: 'alice', amount: 0 })
  })

  it('classifies a burn (in > out, all change to self) as redeem of the difference', () => {
    const e = summarizeTx({
      ...base,
      ftInputs: [inp('alice', 100)],
      ftOutputs: [out(0, 'alice', 25)]
    })
    expect(e).toMatchObject({ kind: 'redeem', from: 'alice', to: null, amount: 75 })
  })

  it('classifies a full burn (no outputs) as redeem of the whole input', () => {
    const e = summarizeTx({ ...base, ftInputs: [inp('alice', 100)], ftOutputs: [] })
    expect(e).toMatchObject({ kind: 'redeem', from: 'alice', to: null, amount: 100 })
  })

  it('returns null for a tx with no FT movement at all', () => {
    expect(summarizeTx({ ...base, ftInputs: [], ftOutputs: [] })).toBeNull()
  })

  it('sums multiple external outputs and picks the largest as the recipient', () => {
    const e = summarizeTx({
      ...base,
      ftInputs: [inp('alice', 100)],
      ftOutputs: [out(0, 'bob', 10), out(1, 'carol', 50), out(2, 'alice', 40)]
    })
    expect(e).toMatchObject({ kind: 'transfer', to: 'carol', amount: 60 })
  })

  it('ignores unknown-owner outputs when deciding transfer vs self', () => {
    // Output with no verified linkage ('' identity) is not treated as an
    // external recipient — in=out and every known output is the sender's.
    const e = summarizeTx({
      ...base,
      ftInputs: [inp('alice', 100)],
      ftOutputs: [out(0, '', 30), out(1, 'alice', 70)]
    })
    expect(e).toMatchObject({ kind: 'self', amount: 0 })
  })
})

// ---------------------------------------------------------------------------
// buildActivity pagination — complete-group guarantee at page boundaries
// ---------------------------------------------------------------------------
import { buildActivity, LinkageRowLite, ActivityDeps } from './activity.js'

const link = (txid: string, outputIndex: number, identityKey: string, createdAt: string): LinkageRowLite => ({
  txid,
  outputIndex,
  identityKey,
  linkage: { prover: identityKey, verifier: 'v', counterparty: identityKey, keyID: `k-${txid}-${outputIndex}`, proofType: 1 },
  createdAt
})

/** Deps with no raw txs — groups become entries only if raw exists; here we
 *  only exercise the paging/grouping layer, so raw txs are irrelevant and
 *  every group is skipped, but the cursor math still runs. */
function pagingDeps (rows: LinkageRowLite[]): ActivityDeps {
  return {
    listLinkage: async (limit, before) => {
      let r = rows
      if (before != null) r = r.filter(x => new Date(x.createdAt).getTime() <= new Date(before).getTime())
      return r.slice(0, limit)
    },
    findLinkageByOutpoints: async () => [],
    findRawTxs: async () => new Map()
  }
}

describe('buildActivity pagination', () => {
  it('returns a null cursor when everything fits in one page', async () => {
    const rows = [link('t1', 0, 'a', '2026-07-07T10:00:00.000Z'), link('t2', 0, 'a', '2026-07-07T09:00:00.000Z')]
    const page = await buildActivity(pagingDeps(rows), { limit: 100 })
    expect(page.nextCursor).toBeNull()
  })

  it('drops the boundary-straddling group and points the cursor at it (inclusive)', async () => {
    // 10 single-output txs, newest first; page limit 2 → fetches 2+overlap rows,
    // sees more exist, drops the oldest fetched group and cursors to it.
    const rows = Array.from({ length: 20 }, (_, i) =>
      link(`t${i}`, 0, 'a', new Date(Date.UTC(2026, 6, 7, 10, 0, 59 - i)).toISOString()))
    const page = await buildActivity(pagingDeps(rows), { limit: 2 })
    expect(page.nextCursor).not.toBeNull()
    // Cursor is the createdAt of a fetched row — inclusive re-fetch re-serves
    // that row's whole tx group on the next page.
    expect(rows.some(r => new Date(r.createdAt).toISOString() === page.nextCursor)).toBe(true)
  })

  it('clamps limit into [1, 500]', async () => {
    let requested = 0
    const deps: ActivityDeps = {
      listLinkage: async (limit) => { requested = limit; return [] },
      findLinkageByOutpoints: async () => [],
      findRawTxs: async () => new Map()
    }
    await buildActivity(deps, { limit: 99999 })
    expect(requested).toBeLessThanOrEqual(508) // 500 + overlap
    await buildActivity(deps, { limit: 0 })
    expect(requested).toBeGreaterThanOrEqual(9) // 1 + overlap
  })
})
