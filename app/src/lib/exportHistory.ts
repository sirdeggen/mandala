/**
 * A lightweight log of exports run per instrument, so the Exports tab can show a
 * recent-exports table (re-download / delete). Only metadata is stored - the
 * actual file is regenerated from live data on re-download. Persisted per
 * browser via the module-store + useSyncExternalStore idiom.
 */
import { useSyncExternalStore } from 'react'
import type { ExportFormat } from './exports'

export interface ExportRecord {
  id: string
  assetId: string
  reportKey: string
  reportName: string
  formats: ExportFormat[]
  rowCount: number
  createdAt: string   // ISO
  /** True when this record is a bundle of every report, not a single one. */
  bundle?: boolean
  /** Wallet-signed, on-chain-anchored authorisations each time it was downloaded. */
  downloads?: { txid: string; at: string }[]
}

const KEY = 'underwrite.exportHistory.v2'
const listeners = new Set<() => void>()

function read(): ExportRecord[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (raw == null) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Tolerate older single-format entries.
    return (parsed as Array<ExportRecord & { format?: ExportFormat }>).map(e => ({
      ...e,
      formats: Array.isArray(e.formats) ? e.formats : (e.format != null ? [e.format] : []),
    }))
  } catch {
    return []
  }
}

let current = read()
let seq = 0

function persist(next: ExportRecord[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function logExport(rec: Omit<ExportRecord, 'id' | 'createdAt'>): void {
  seq += 1
  const entry: ExportRecord = { ...rec, id: `ex-${current.length}-${seq}`, createdAt: new Date().toISOString() }
  persist([entry, ...current].slice(0, 100))
}

export function removeExport(id: string): void {
  persist(current.filter(e => e.id !== id))
}

/** Record a wallet-signed, on-chain-anchored download authorisation. */
export function recordDownloadAuth(id: string, txid: string): void {
  persist(current.map(e => e.id === id
    ? { ...e, downloads: [{ txid, at: new Date().toISOString() }, ...(e.downloads ?? [])] }
    : e))
}

export function useExportHistory(assetId: string): ExportRecord[] {
  const all = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
  return all.filter(e => e.assetId === assetId)
}
