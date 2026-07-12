/**
 * A log of every wallet-signed, on-chain-anchored action taken in the app:
 * attestation sign-offs, control-action approvals, report downloads, and
 * transparency publish/unpublish. Recorded at each signing site so the
 * organisation has one auditable event trail of who signed what and when.
 * Persisted under `underwrite.signedEvents.v1`.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.signedEvents.v1'
const listeners = new Set<() => void>()

export type SignedEventKind =
  | 'attestation'
  | 'control'
  | 'download'
  | 'transparency-instrument'
  | 'transparency-entity'

export interface SignedEvent {
  id: string
  kind: SignedEventKind
  label: string
  signerKey: string
  signerName?: string
  at: string
  txid?: string
  assetId?: string
}

function read(): SignedEvent[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (raw == null) return []
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p as SignedEvent[] : []
  } catch {
    return []
  }
}

let current = read()

function persist(next: SignedEvent[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function recordSignedEvent(e: Omit<SignedEvent, 'id'>): void {
  const id = `se-${e.at}-${current.length}`
  persist([{ id, ...e }, ...current])
}

export function useSignedEvents(): SignedEvent[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
