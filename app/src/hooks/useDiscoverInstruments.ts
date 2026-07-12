import { useQuery } from '@tanstack/react-query'
import { fetchOverlayActivity, type ActivityEntry } from '@bsv/mandala/overlayActivity'

/**
 * Discover instruments across every issuer from the overlay's public global
 * activity feed (no wallet needed, so it works for any identity). Distinct
 * assetIds are grouped by their issuer: the minter identity proven on the
 * instrument's `issue` entry. Metadata (ticker/label) is resolved separately,
 * per-instrument, so this stays a cheap single request.
 */
export interface DiscoveredInstrument {
  assetId: string
  issuerKey: string
  lastActivity: string
}

export interface DiscoveredEntity {
  issuerKey: string
  instruments: DiscoveredInstrument[]
}

export interface Discovery {
  instruments: DiscoveredInstrument[]
  entities: DiscoveredEntity[]
}

/** Best-effort issuer identity for an activity entry (minter of an issue). */
function issuerOf(e: ActivityEntry): string | null {
  if (e.kind === 'issue') {
    // The minter signs the issue; its proof carries the admin identity. The
    // recipient (`to`) is the same key for a self-mint, a good fallback.
    return e.proofs[0]?.identityKey ?? e.to ?? null
  }
  return null
}

function derive(entries: ActivityEntry[]): Discovery {
  const byAsset = new Map<string, DiscoveredInstrument>()
  // Newest-first feed: first sighting of an asset is its latest activity.
  for (const e of entries) {
    const existing = byAsset.get(e.assetId)
    const issuer = issuerOf(e)
    if (existing == null) {
      byAsset.set(e.assetId, { assetId: e.assetId, issuerKey: issuer ?? '', lastActivity: e.when })
    } else if (existing.issuerKey === '' && issuer != null) {
      existing.issuerKey = issuer
    }
  }
  const instruments = [...byAsset.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))

  const byIssuer = new Map<string, DiscoveredInstrument[]>()
  for (const inst of instruments) {
    const key = inst.issuerKey || 'unknown'
    const list = byIssuer.get(key) ?? []
    list.push(inst)
    byIssuer.set(key, list)
  }
  const entities = [...byIssuer.entries()].map(([issuerKey, list]) => ({ issuerKey, instruments: list }))

  return { instruments, entities }
}

export function useDiscoverInstruments() {
  return useQuery({
    queryKey: ['discover-instruments'] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<Discovery> => {
      const page = await fetchOverlayActivity(undefined, { limit: 200 })
      return derive(page.entries)
    },
  })
}
