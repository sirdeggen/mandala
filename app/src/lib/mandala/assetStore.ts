import { MandalaActionDetails } from './encoding'

export interface RegisteredAsset {
  assetId: string
  label: string
  authOutpoint: string
  authDetails: MandalaActionDetails
}

const key = (identityKey: string) => `mandala:assets:${identityKey}`
const store = (s?: Storage): Storage => s ?? globalThis.localStorage

export function listAssets (identityKey: string, s?: Storage): RegisteredAsset[] {
  const raw = store(s).getItem(key(identityKey))
  return raw == null ? [] : JSON.parse(raw) as RegisteredAsset[]
}

export function saveAsset (identityKey: string, asset: RegisteredAsset, s?: Storage): void {
  const all = listAssets(identityKey, s).filter(a => a.assetId !== asset.assetId)
  all.push(asset)
  store(s).setItem(key(identityKey), JSON.stringify(all))
}

export function getAsset (identityKey: string, assetId: string, s?: Storage): RegisteredAsset | undefined {
  return listAssets(identityKey, s).find(a => a.assetId === assetId)
}

export function updateAuthOutpoint (identityKey: string, assetId: string, authOutpoint: string, s?: Storage): void {
  const asset = getAsset(identityKey, assetId, s)
  if (asset == null) throw new Error(`unknown asset ${assetId}`)
  saveAsset(identityKey, { ...asset, authOutpoint }, s)
}

export function updateAuth (
  identityKey: string,
  assetId: string,
  authOutpoint: string,
  authDetails: MandalaActionDetails,
  s?: Storage
): void {
  const asset = getAsset(identityKey, assetId, s)
  if (asset == null) throw new Error(`unknown asset ${assetId}`)
  saveAsset(identityKey, { ...asset, authOutpoint, authDetails }, s)
}
