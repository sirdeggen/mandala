import { OVERLAY_URL } from './constants'

export interface AssetAdminStateView {
  assetId: string
  issuerIdentityKey: string
  isPaused: boolean
  accessMode: 'denylist' | 'allowlist'
  blockedIdentities: string[]
  allowedIdentities: string[]
  frozenOutpoints: Array<{ outpoint: string, amount: number, owner: string }>
  evictedOutpoints: string[]
}

const cache = new Map<string, { at: number, val: AssetAdminStateView | null }>()
const TTL = 10_000

export async function resolveAssetState (assetId: string): Promise<AssetAdminStateView | null> {
  const hit = cache.get(assetId)
  if (hit != null && Date.now() - hit.at < TTL) return hit.val
  let val: AssetAdminStateView | null = null
  try {
    const res = await fetch(`${OVERLAY_URL}/admin/asset-state/${encodeURIComponent(assetId)}`)
    if (res.ok) val = await res.json() as AssetAdminStateView
  } catch { val = null }
  cache.set(assetId, { at: Date.now(), val })
  return val
}
