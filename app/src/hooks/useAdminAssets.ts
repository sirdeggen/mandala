import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '../context/WalletContext'
import { listAdminAssets, AdminAsset } from '../lib/mandala/assets'

export const adminAssetsKey = (identityKey: string | null) =>
  ['admin-assets', identityKey] as const

/** Issuer console's admin-asset list — shared cache across every section. */
export function useAdminAssets() {
  const { wallet, identityKey } = useWallet()
  return useQuery({
    queryKey: adminAssetsKey(identityKey),
    enabled: wallet != null,
    queryFn: async (): Promise<AdminAsset[]> => listAdminAssets(wallet as any)
  })
}

export function useInvalidateAdminAssets() {
  const qc = useQueryClient()
  const { identityKey } = useWallet()
  return () => qc.invalidateQueries({ queryKey: adminAssetsKey(identityKey) })
}
