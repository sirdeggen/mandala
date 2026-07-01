/**
 * Developer mode — a global, persisted flag used to exercise flows the UI
 * normally guards against, so we can verify the OVERLAY (not just the frontend)
 * enforces a rule.
 *
 * Primary use: the send flow guards against transferring a paused asset. With
 * dev mode on, that frontend guard is bypassed so the transfer actually reaches
 * the overlay — which rejects it server-side (MandalaTopicManager Gate 2 admits
 * zero outputs → submitToOverlay throws). That proves the pause is enforced by
 * the overlay, not merely hidden by the client.
 *
 * State lives in localStorage (key `mandala.devMode`) and can be turned on for a
 * session via `?dev=1`. A module-level store + useSyncExternalStore keeps every
 * subscriber in sync without a context provider.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'mandala.devMode'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1') return true
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search)
      if (p.get('dev') === '1') {
        try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
        return true
      }
    }
  } catch { /* localStorage/window unavailable — treat as off */ }
  return false
}

let current = read()

export function setDevMode(on: boolean): void {
  current = on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function toggleDevMode(): void {
  setDevMode(!current)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): boolean {
  return current
}

/** Reactive read of the developer-mode flag. */
export function useDevMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
