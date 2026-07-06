/**
 * Shared store of the demo incoming-deposit feed (see banking.ts). A
 * module-level store rather than component state so the Banking page (which
 * adds deposits) and the Overview reserve-ratio KPI (which reads them) stay
 * honestly in sync — the KPI must reflect real added deposits, not a second,
 * disconnected copy of mock data. Same useSyncExternalStore idiom as devMode.ts.
 *
 * Demo-only persistence in localStorage so the feed survives a reload; the
 * Banking page offers an explicit "clear all". Starts empty and is never
 * pre-seeded: this is a sandbox feed standing in for a real bank connection,
 * not a source of fabricated reserve numbers.
 */
import { useSyncExternalStore } from 'react'
import { MockDeposit } from './banking'

const KEY = 'mandala.mockDeposits'

function load(): MockDeposit[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
      if (Array.isArray(raw)) return raw as MockDeposit[]
    }
  } catch { /* corrupted — start fresh */ }
  return []
}

let deposits: MockDeposit[] = load()
const listeners = new Set<() => void>()

function write(next: MockDeposit[]): void {
  deposits = next
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* quota/unavailable — in-memory copy still holds */ }
  listeners.forEach(l => l())
}

export function addMockDeposit(dep: MockDeposit): void {
  write([dep, ...deposits])
}

/** Wipe the demo feed (manual "clear all" on the Banking page). */
export function clearMockDeposits(): void {
  write([])
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): MockDeposit[] {
  return deposits
}

/** Reactive read of the shared demo deposit feed. */
export function useMockDeposits(): MockDeposit[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
