/**
 * Shared store of the demo bank transfer feed (see banking.ts), scoped per
 * asset - switching assets must switch the bank balance, transaction
 * history, and reconciliation with it. A module-level store rather than
 * component state so the Banking page (which adds transfers) and the
 * Overview reserve-ratio KPI (which reads them) stay honestly in sync - the
 * KPI must reflect real added transfers, not a second, disconnected copy of
 * mock data. Same useSyncExternalStore idiom as devMode.ts.
 *
 * Demo-only persistence in localStorage so the feed survives a reload; the
 * Banking page offers per-row delete and an explicit "clear all" (scoped to
 * the active asset only). Starts empty and is never pre-seeded: this is a
 * sandbox feed standing in for a real bank connection, not a source of
 * fabricated reserve numbers.
 */
import { useSyncExternalStore } from 'react'
import { MockTransfer } from '@bsv/mandala/banking'

const KEY = 'mandala.mockDeposits'

function load(): MockTransfer[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
      // Older entries predate the direction/assetId fields - treat them as
      // incoming and unassigned (they won't match any real asset, so they
      // simply drop out of every per-asset view rather than crashing).
      if (Array.isArray(raw)) {
        return (raw as Array<Partial<MockTransfer>>).map(t => ({ direction: 'in', assetId: '', ...t } as MockTransfer))
      }
    }
  } catch { /* corrupted - start fresh */ }
  return []
}

let transfers: MockTransfer[] = load()
const listeners = new Set<() => void>()

function write(next: MockTransfer[]): void {
  transfers = next
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* quota/unavailable - in-memory copy still holds */ }
  listeners.forEach(l => l())
}

export function addMockTransfer(t: MockTransfer): void {
  write([t, ...transfers])
}

/** Remove a single transfer (per-row delete on the Banking page). */
export function removeMockTransfer(id: string): void {
  write(transfers.filter(t => t.id !== id))
}

/** Wipe the demo feed for one asset only (manual "clear all" on the Banking page). */
export function clearMockTransfers(assetId: string): void {
  write(transfers.filter(t => t.assetId !== assetId))
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): MockTransfer[] {
  return transfers
}

const EMPTY: MockTransfer[] = []

/** Reactive read of the demo transfer feed for one asset. */
export function useMockTransfers(assetId: string): MockTransfer[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return assetId === '' ? EMPTY : all.filter(t => t.assetId === assetId)
}
