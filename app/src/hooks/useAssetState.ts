import { useQuery, useQueryClient } from '@tanstack/react-query'
import { resolveAssetState, AssetAdminStateView } from '@bsv/mandala/adminState'

export const assetStateKey = (assetId: string) => ['asset-state', assetId] as const

/** Overlay-resolved admin state (pause, access mode …) for one asset. */
export function useAssetState(assetId: string) {
  return useQuery({
    queryKey: assetStateKey(assetId),
    enabled: assetId !== '',
    queryFn: async (): Promise<AssetAdminStateView | null> => resolveAssetState(assetId)
  })
}

/** Invalidate one asset's admin state from anywhere (post-admin-action). */
export function useInvalidateAssetState() {
  const qc = useQueryClient()
  return (assetId: string) => qc.invalidateQueries({ queryKey: assetStateKey(assetId) })
}
