import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  resolveAdminHistory,
  resolveAdminHistoryPage,
  resolveAdminSummary,
  AdminHistoryRow,
  AdminSummary
} from '@bsv/mandala/adminHistory'

export const adminHistoryKey = (assetId: string) =>
  ['admin-history', assetId] as const
export const adminHistoryPagesKey = (assetId: string) =>
  ['admin-history-pages', assetId] as const
export const adminSummaryKey = (assetId: string) =>
  ['admin-summary', assetId] as const

const HISTORY_PAGE_SIZE = 100

/** Overlay-resolved admin action history for one asset (full - for exports). */
export function useAdminHistory(assetId: string) {
  return useQuery({
    queryKey: adminHistoryKey(assetId),
    enabled: assetId !== '',
    queryFn: async (): Promise<AdminHistoryRow[]> => resolveAdminHistory(assetId)
  })
}

/** Infinite newest-first pages of admin history - the audit log's feed. */
export function useAdminHistoryPages(assetId: string) {
  const query = useInfiniteQuery({
    queryKey: adminHistoryPagesKey(assetId),
    enabled: assetId !== '',
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<AdminHistoryRow[]> =>
      resolveAdminHistoryPage(assetId, { limit: HISTORY_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, all) =>
      last.length < HISTORY_PAGE_SIZE ? undefined : all.length * HISTORY_PAGE_SIZE
  })
  const rows: AdminHistoryRow[] = query.data == null ? [] : query.data.pages.flat()
  return { ...query, rows }
}

/** Whole-history issue/redeem totals, aggregated server-side. */
export function useAdminSummary(assetId: string) {
  return useQuery({
    queryKey: adminSummaryKey(assetId),
    enabled: assetId !== '',
    queryFn: async (): Promise<AdminSummary | null> => resolveAdminSummary(assetId)
  })
}

/** Invalidate one asset's admin history views from anywhere (post-admin-action). */
export function useInvalidateAdminHistory() {
  const qc = useQueryClient()
  return (assetId: string) => Promise.all([
    qc.invalidateQueries({ queryKey: adminHistoryKey(assetId) }),
    qc.invalidateQueries({ queryKey: adminHistoryPagesKey(assetId) }),
    qc.invalidateQueries({ queryKey: adminSummaryKey(assetId) })
  ])
}
