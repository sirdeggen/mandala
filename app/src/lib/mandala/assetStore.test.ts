import { describe, it, expect, beforeEach } from 'vitest'
import { saveAsset, listAssets, updateAuthOutpoint, updateAuth, getAsset } from './assetStore'
import type { MandalaActionDetails } from './encoding'

const mem = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) }
  } as unknown as Storage
}

describe('assetStore', () => {
  let s: Storage
  beforeEach(() => { s = mem() })

  it('saves, lists, fetches, and updates auth outpoint', () => {
    const regDetails: MandalaActionDetails = { kind: 'register', assetId: 'a.0' }
    saveAsset('id1', { assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0', authDetails: regDetails }, s)
    expect(listAssets('id1', s)).toEqual([{ assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0', authDetails: regDetails }])
    expect(getAsset('id1', 'a.0', s)?.label).toBe('Gold')
    expect(getAsset('id1', 'a.0', s)?.authDetails).toEqual(regDetails)
    updateAuthOutpoint('id1', 'a.0', 'issue.1', s)
    expect(getAsset('id1', 'a.0', s)?.authOutpoint).toBe('issue.1')
    // authDetails preserved after updateAuthOutpoint
    expect(getAsset('id1', 'a.0', s)?.authDetails).toEqual(regDetails)
    expect(listAssets('id2', s)).toEqual([])
  })

  it('updateAuth sets both authOutpoint and authDetails', () => {
    const regDetails: MandalaActionDetails = { kind: 'register', assetId: 'b.0' }
    saveAsset('id1', { assetId: 'b.0', label: 'Silver', authOutpoint: 'reg.0', authDetails: regDetails }, s)

    const issueDetails: MandalaActionDetails = { kind: 'issue', assetId: 'b.0', amount: 100, priorOutpoint: 'reg.0' }
    updateAuth('id1', 'b.0', 'issue.1', issueDetails, s)

    const asset = getAsset('id1', 'b.0', s)
    expect(asset?.authOutpoint).toBe('issue.1')
    expect(asset?.authDetails).toEqual(issueDetails)
    expect(asset?.label).toBe('Silver')
  })

  it('round-trips authDetails through JSON serialization', () => {
    const details: MandalaActionDetails = { kind: 'issue', assetId: 'c.0', amount: 50, priorOutpoint: 'reg.0' }
    saveAsset('id1', { assetId: 'c.0', label: 'Bronze', authOutpoint: 'issue.0', authDetails: details }, s)
    const loaded = getAsset('id1', 'c.0', s)
    expect(loaded?.authDetails.kind).toBe('issue')
    expect(loaded?.authDetails.amount).toBe(50)
    expect(loaded?.authDetails.priorOutpoint).toBe('reg.0')
  })
})
