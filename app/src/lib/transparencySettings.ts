/**
 * Per-instrument transparency-page publishing. An issuer decides whether an
 * instrument has a public proof-of-reserves sub-page, and can preview it before
 * turning it on. Persisted per browser under `underwrite.transparency.v1`.
 *
 * On-chain supply/state are always public; this flag only governs whether we
 * surface a curated public page for the instrument. In a production deployment
 * the flag would live on the overlay so it propagates across devices; here it
 * is browser-local (the public page still renders by assetId when linked).
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.transparency.v1'

interface State { published: Record<string, boolean> }

const listeners = new Set<() => void>()

function read(): State {
  try {
    if (typeof localStorage === 'undefined') return { published: {} }
    const raw = localStorage.getItem(KEY)
    if (raw == null) return { published: {} }
    const p = JSON.parse(raw) as Partial<State>
    return { published: (p.published != null && typeof p.published === 'object') ? p.published as Record<string, boolean> : {} }
  } catch {
    return { published: {} }
  }
}

let current = read()

function persist(next: State): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setTransparencyPublished(assetId: string, published: boolean): void {
  persist({ published: { ...current.published, [assetId]: published } })
}

function snapshot(): State { return current }

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Whether an instrument's public transparency page is published. */
export function useTransparencyPublished(assetId: string): boolean {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  return state.published[assetId] === true
}

/** Reactive access to the whole publish map (for the org overview). */
export function usePublishedMap(): Record<string, boolean> {
  return useSyncExternalStore(subscribe, snapshot, snapshot).published
}

/** Non-reactive read (e.g. inside a route loader). */
export function isTransparencyPublished(assetId: string): boolean {
  return current.published[assetId] === true
}
