/**
 * The current user's uploaded profile photo (demo). Stored as a data URL in
 * localStorage and surfaced anywhere the current user's avatar is shown; the
 * generated identity sigil is the fallback when none is set.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.userAvatar.v1'
const listeners = new Set<() => void>()

function read(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(KEY)
    return raw != null && raw !== '' ? raw : null
  } catch {
    return null
  }
}

let current = read()

function persist(next: string | null): void {
  current = next
  try {
    if (next == null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setUserAvatar(dataUrl: string | null): void {
  persist(dataUrl)
}

export function useUserAvatar(): string | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
