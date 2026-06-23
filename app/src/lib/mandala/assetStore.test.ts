import { describe, it, expect, beforeEach } from 'vitest'
import { saveAsset, listAssets, updateAuthOutpoint, getAsset } from './assetStore'

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
    saveAsset('id1', { assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0' }, s)
    expect(listAssets('id1', s)).toEqual([{ assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0' }])
    expect(getAsset('id1', 'a.0', s)?.label).toBe('Gold')
    updateAuthOutpoint('id1', 'a.0', 'issue.1', s)
    expect(getAsset('id1', 'a.0', s)?.authOutpoint).toBe('issue.1')
    expect(listAssets('id2', s)).toEqual([])
  })
})
