/**
 * A directory mapping an issuer's identity key to a human-readable organisation
 * name. There is no org name on-chain, so issuers record theirs when they
 * onboard (their legal entity name), and everyone browsing in the same origin
 * then sees a real name instead of a raw key. Persisted under
 * `underwrite.orgDirectory.v1`.
 *
 * In a production deployment this directory would be served by the overlay (or
 * a registry) so names resolve across devices; here it is browser-local, with a
 * short-key fallback when a name is not known.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.orgDirectory.v1'
const listeners = new Set<() => void>()

type Directory = Record<string, string>

function read(): Directory {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(KEY)
    if (raw == null) return {}
    const p = JSON.parse(raw)
    return (p != null && typeof p === 'object') ? p as Directory : {}
  } catch {
    return {}
  }
}

let current = read()

function persist(next: Directory): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

/** Record (or update) an issuer's organisation name. No-op for blanks. */
export function recordOrgName(identityKey: string | null, name: string): void {
  const n = name.trim()
  if (identityKey == null || identityKey === '' || n === '') return
  if (current[identityKey] === n) return
  persist({ ...current, [identityKey]: n })
}

const shortKey = (k: string) => (k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k)

/** Non-reactive best-effort name for an issuer key. */
export function orgNameFor(issuerKey: string): string {
  if (issuerKey === '' || issuerKey === 'unknown') return 'Unknown issuer'
  return current[issuerKey] ?? `Issuer ${shortKey(issuerKey)}`
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive org name for an issuer key (re-renders when the directory changes). */
export function useOrgName(issuerKey: string): string {
  const dir = useSyncExternalStore(subscribe, () => current, () => current)
  if (issuerKey === '' || issuerKey === 'unknown') return 'Unknown issuer'
  return dir[issuerKey] ?? `Issuer ${shortKey(issuerKey)}`
}
