/**
 * Entity-level transparency settings, keyed by an issuer's identity key:
 *   published — the entity has a public transparency page (/transparency/:key)
 *   listed    — the entity has opted into the public directory (/transparency)
 * Both are switches on the Organisation settings page. Persisted per browser
 * under `underwrite.orgTransparency.v1`; in production these would live on the
 * overlay so the directory resolves across devices.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.orgTransparency.v1'
const listeners = new Set<() => void>()

interface State {
  published: Record<string, boolean>
  listed: Record<string, boolean>
}

function read(): State {
  try {
    if (typeof localStorage === 'undefined') return { published: {}, listed: {} }
    const raw = localStorage.getItem(KEY)
    if (raw == null) return { published: {}, listed: {} }
    const p = JSON.parse(raw) as Partial<State>
    return {
      published: (p.published != null && typeof p.published === 'object') ? p.published as Record<string, boolean> : {},
      listed: (p.listed != null && typeof p.listed === 'object') ? p.listed as Record<string, boolean> : {},
    }
  } catch {
    return { published: {}, listed: {} }
  }
}

let current = read()

function persist(next: State): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setEntityPublished(identityKey: string | null, published: boolean): void {
  if (identityKey == null || identityKey === '') return
  persist({ ...current, published: { ...current.published, [identityKey]: published } })
}

export function setEntityListed(identityKey: string | null, listed: boolean): void {
  if (identityKey == null || identityKey === '') return
  persist({ ...current, listed: { ...current.listed, [identityKey]: listed } })
}

function snapshot(): State { return current }
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }

export interface EntityTransparency { published: boolean; listed: boolean }

/** Reactive entity transparency flags for one issuer key. */
export function useEntityTransparency(identityKey: string): EntityTransparency {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { published: s.published[identityKey] === true, listed: s.listed[identityKey] === true }
}

/** Reactive list of issuer keys that have opted into the public directory
 *  (and published their page). */
export function useListedEntityKeys(): string[] {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot)
  return Object.keys(s.listed).filter(k => s.listed[k] === true && s.published[k] === true)
}

/** Non-reactive read of an entity's published flag. */
export function isEntityPublished(identityKey: string): boolean {
  return current.published[identityKey] === true
}
