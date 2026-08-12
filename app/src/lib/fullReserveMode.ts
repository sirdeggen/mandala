/**
 * Full-reserve enforcement - a global, persisted flag that caps issuance at the
 * available reserve balance. On by default (a fully-reserved issuer always
 * enforces it); it can be turned off via the Developer panel to demonstrate
 * pre-issuing against incoming settlement. This is a demo control and would not
 * be user-toggleable in the final product.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'mandala.fullReserve'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(KEY)
      if (v === '0') return false
      if (v === '1') return true
    }
  } catch { /* ignore */ }
  return true // enforced by default
}

let current = read()

export function setFullReserve(on: boolean): void {
  current = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function toggleFullReserve(): void {
  setFullReserve(!current)
}

export function useFullReserve(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
