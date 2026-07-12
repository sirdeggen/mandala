import { useQuery } from '@tanstack/react-query'
import { resolveAssetMetadata } from '@bsv/mandala/metadata'
import type { AssetMetadata } from '@bsv/templates'

/**
 * Public, wallet-free lookup of an instrument's on-chain metadata (label,
 * ticker, decimals) by assetId. Works for any identity, including anonymous
 * visitors to the transparency page. Cached aggressively; metadata is genesis-
 * time and immutable.
 */
export function useAssetMetadata(assetId: string) {
  return useQuery({
    queryKey: ['asset-metadata', assetId] as const,
    enabled: assetId !== '',
    staleTime: Infinity,
    queryFn: async (): Promise<AssetMetadata | null> => resolveAssetMetadata(assetId),
  })
}
