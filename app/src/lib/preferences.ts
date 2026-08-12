/**
 * User preferences (browser-local). Currently just whether on-chain signing
 * actions show a confirmation popover before requesting the wallet signature.
 * Persisted under `underwrite.preferences.v1`.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.preferences.v1'
const listeners = new Set<() => void>()

interface Preferences {
  confirmBeforeSigning: boolean
}

const DEFAULTS: Preferences = { confirmBeforeSigning: true }

function read(): Preferences {
  try {
    if (typeof localStorage === 'undefined') return DEFAULTS
    const raw = localStorage.getItem(KEY)
    if (raw == null) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Preferences>
    return { confirmBeforeSigning: p.confirmBeforeSigning !== false }
  } catch {
    return DEFAULTS
  }
}

let current = read()

function persist(next: Preferences): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setConfirmBeforeSigning(on: boolean): void {
  persist({ ...current, confirmBeforeSigning: on })
}

/** Non-reactive read for use inside event handlers. */
export function confirmBeforeSigningNow(): boolean {
  return current.confirmBeforeSigning
}

export function useConfirmBeforeSigning(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current.confirmBeforeSigning,
    () => current.confirmBeforeSigning,
  )
}
