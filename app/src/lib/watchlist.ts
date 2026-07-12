/**
 * A reviewer's watched instruments: a list of assetIds an auditor or individual
 * follows. Identity-agnostic (keyed only by assetId), persisted per browser
 * under `underwrite.watchlist.v1`. Public instrument data is then fetched by
 * assetId, so this works regardless of which wallet identity is connected.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.watchlist.v1'
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (raw == null) return []
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let current = read()

function persist(next: string[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function watchInstrument(assetId: string): void {
  if (current.includes(assetId)) return
  persist([...current, assetId])
}

export function unwatchInstrument(assetId: string): void {
  if (!current.includes(assetId)) return
  persist(current.filter(id => id !== assetId))
}

export function toggleWatch(assetId: string): void {
  current.includes(assetId) ? unwatchInstrument(assetId) : watchInstrument(assetId)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive list of watched assetIds. */
export function useWatchlist(): string[] {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
