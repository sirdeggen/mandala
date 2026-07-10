import { QueryClient } from '@tanstack/react-query'

/**
 * One client for the whole app. Cached data renders instantly on navigation;
 * refetches happen in the background (stale-while-revalidate). Chain/overlay
 * reads are expensive, so no refetch-on-focus - refresh is explicit or
 * mutation-driven (invalidation).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: 0
    }
  }
})
