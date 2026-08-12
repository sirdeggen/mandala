/**
 * The issuing company's uploaded logo (demo). Stored as a data URL in
 * localStorage and shown on the Company settings page and wherever your own
 * organisation's tile appears; falls back to a monogram/icon when unset.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.companyLogo.v1'
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

export function setCompanyLogo(dataUrl: string | null): void {
  persist(dataUrl)
}

export function useCompanyLogo(): string | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
