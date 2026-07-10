import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('./constants', () => ({
  OVERLAY_URL: 'http://test-overlay'
}))

import { fetchOverlayActivity, flattenActivityPages, describeActivity, ActivityEntry } from './overlayActivity.js'

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  txid: 't1',
  when: '2026-07-07T00:00:00.000Z',
  assetId: 'a.0',
  kind: 'transfer',
  from: 'alice',
  to: 'bob',
  amount: 30,
  proofs: [],
  ...over
})

describe('fetchOverlayActivity', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('requests a bounded page and no assetId filter when none given', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [], nextCursor: null }) })
    await fetchOverlayActivity()
    expect(mockFetch).toHaveBeenCalledWith('http://test-overlay/admin/activity?limit=100')
  })

  it('encodes assetId, limit, and the cursor into the query string', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [], nextCursor: null }) })
    await fetchOverlayActivity('tx id.0', { limit: 50, before: '2026-07-07T00:00:00.000Z' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-overlay/admin/activity?assetId=tx+id.0&limit=50&before=2026-07-07T00%3A00%3A00.000Z'
    )
  })

  it('returns parsed page with cursor', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [entry({})], nextCursor: 'c1' }) })
    const page = await fetchOverlayActivity('a.0')
    expect(page.entries).toHaveLength(1)
    expect(page.nextCursor).toBe('c1')
  })

  it('throws on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(fetchOverlayActivity('a.0')).rejects.toThrow('500')
  })

  it('returns an empty page for a malformed body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ nope: true }) })
    expect(await fetchOverlayActivity('a.0')).toEqual({ entries: [], nextCursor: null })
  })
})

describe('flattenActivityPages', () => {
  it('concatenates pages preserving order', () => {
    const out = flattenActivityPages([
      { entries: [entry({ txid: 'a' }), entry({ txid: 'b' })], nextCursor: 'c' },
      { entries: [entry({ txid: 'c' })], nextCursor: null }
    ])
    expect(out.map(e => e.txid)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes a boundary tx re-served by the inclusive cursor (first occurrence wins)', () => {
    const newer = entry({ txid: 'dup', amount: 99 })
    const older = entry({ txid: 'dup', amount: 1 })
    const out = flattenActivityPages([
      { entries: [entry({ txid: 'a' }), newer], nextCursor: 'c' },
      { entries: [older, entry({ txid: 'b' })], nextCursor: null }
    ])
    expect(out.map(e => e.txid)).toEqual(['a', 'dup', 'b'])
    expect(out.find(e => e.txid === 'dup')?.amount).toBe(99)
  })
})

describe('describeActivity', () => {
  it('describes each kind', () => {
    expect(describeActivity(entry({ kind: 'issue', amount: 100 }))).toBe('Issued 100 units')
    expect(describeActivity(entry({ kind: 'transfer', amount: 30 }))).toBe('Transferred 30 units')
    expect(describeActivity(entry({ kind: 'self', amount: 0 }))).toBe('Transferred 0 units to self')
    expect(describeActivity(entry({ kind: 'redeem', amount: 25 }))).toBe('Redeemed (burned) 25 units')
  })
})
