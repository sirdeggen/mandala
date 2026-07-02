/**
 * Shared, in-memory store of the demo incoming-deposit feed (see banking.ts).
 * A module-level store rather than component state so the Banking page (which
 * adds deposits) and the Overview reserve-ratio KPI (which reads them) stay
 * honestly in sync — the KPI must reflect real added deposits, not a second,
 * disconnected copy of mock data. Same useSyncExternalStore idiom as devMode.ts.
 *
 * Starts empty and is never pre-seeded: this is a sandbox feed standing in for
 * a real bank connection, not a source of fabricated reserve numbers.
 */
import { useSyncExternalStore } from 'react'
import { MockDeposit } from './banking'

let deposits: MockDeposit[] = []
const listeners = new Set<() => void>()

export function addMockDeposit(dep: MockDeposit): void {
  deposits = [dep, ...deposits]
  listeners.forEach(l => l())
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
