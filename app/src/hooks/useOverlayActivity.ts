import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOverlayActivity, flattenActivityPages, ActivityEntry, ActivityPage } from '@bsv/mandala/overlayActivity'

export const overlayActivityKey = (assetId: string) =>
  ['overlay-activity', assetId] as const

/**
 * Overlay-wide transaction feed (linkage-proven counterparties) for one
 * asset — infinite cursor pagination so thousands of transactions stream in
 * pages instead of one unbounded response.
 */
export function useOverlayActivity (assetId: string) {
  const query = useInfiniteQuery({
    queryKey: overlayActivityKey(assetId),
    enabled: assetId !== '',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<ActivityPage> =>
      fetchOverlayActivity(assetId, { before: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined
  })
  const entries: ActivityEntry[] = query.data == null ? [] : flattenActivityPages(query.data.pages)
  return { ...query, entries }
}

/** Invalidate the overlay activity feed (e.g. after issuing or sending). */
export function useInvalidateOverlayActivity () {
  const qc = useQueryClient()
  return (assetId: string) => qc.invalidateQueries({ queryKey: overlayActivityKey(assetId) })
}
