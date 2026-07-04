import { useQuery, useQueryClient } from '@tanstack/react-query'
import { resolveAdminHistory, AdminHistoryRow } from '../lib/mandala/adminHistory'

export const adminHistoryKey = (assetId: string) =>
  ['admin-history', assetId] as const

/** Overlay-resolved admin action history for one asset. */
export function useAdminHistory(assetId: string) {
  return useQuery({
    queryKey: adminHistoryKey(assetId),
    enabled: assetId !== '',
    queryFn: async (): Promise<AdminHistoryRow[]> => resolveAdminHistory(assetId)
  })
}

/** Invalidate one asset's admin history from anywhere (post-admin-action). */
export function useInvalidateAdminHistory() {
  const qc = useQueryClient()
  return (assetId: string) => qc.invalidateQueries({ queryKey: adminHistoryKey(assetId) })
}
