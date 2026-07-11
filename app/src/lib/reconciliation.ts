/**
 * Reconciliation links between ledger statements (on-chain issuance/redemption/
 * transfer entries, keyed by txid) and bank statements (demo bank transfers,
 * keyed by transfer id). A link can instead be a manual adjustment - used when a
 * ledger entry has no matching bank statement - which requires an auditor
 * sign-off before it counts as reconciled.
 *
 * Persisted per browser in localStorage via the module-store +
 * useSyncExternalStore idiom (same pattern as lib/instrumentIcons.tsx).
 */
import { useSyncExternalStore } from 'react'

export interface ReconLink {
  id: string
  assetId: string
  /** The ledger statement this link reconciles (on-chain txid). */
  ledgerTxid: string
  /** Amount at link time (base units) - for display and matching. */
  amount: number
  createdAt: string
  /** A bank-statement link. */
  bankTransferId?: string
  /** A manual adjustment (no matching bank statement), needing auditor sign-off. */
  adjustment?: {
    reason: string
    status: 'pending' | 'signed'
    auditorName?: string
    reviewedAt?: string
  }
}

const KEY = 'underwrite.reconciliation.v1'
const listeners = new Set<() => void>()

function read(): ReconLink[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (raw == null) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ReconLink[] : []
  } catch {
    return []
  }
}

let current = read()

function persist(next: ReconLink[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

let seq = 0
function uid(): string {
  seq += 1
  return `rl-${current.length}-${seq}-${(seq * 2654435761 % 1e9).toString(36)}`
}

/** Link a ledger statement to a bank statement (idempotent per pair). */
export function addBankLink(assetId: string, ledgerTxid: string, bankTransferId: string, amount: number): void {
  const exists = current.some(l => l.assetId === assetId && l.ledgerTxid === ledgerTxid && l.bankTransferId === bankTransferId)
  if (exists) return
  persist([
    { id: uid(), assetId, ledgerTxid, bankTransferId, amount, createdAt: new Date().toISOString() },
    ...current,
  ])
}

/** Record a manual adjustment against a ledger statement (needs auditor sign-off). */
export function addAdjustment(assetId: string, ledgerTxid: string, reason: string, amount: number): void {
  persist([
    { id: uid(), assetId, ledgerTxid, amount, createdAt: new Date().toISOString(), adjustment: { reason, status: 'pending' } },
    ...current,
  ])
}

/** Auditor sign-off on a manual adjustment. */
export function signoffAdjustment(id: string, auditorName: string): void {
  persist(current.map(l => l.id === id && l.adjustment != null
    ? { ...l, adjustment: { ...l.adjustment, status: 'signed', auditorName, reviewedAt: new Date().toISOString() } }
    : l))
}

/** Remove a link / adjustment. */
export function removeLink(id: string): void {
  persist(current.filter(l => l.id !== id))
}

// ── Reactive reads ────────────────────────────────────────────────────────────

export function useReconLinks(assetId: string): ReconLink[] {
  const all = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
  return all.filter(l => l.assetId === assetId)
}

/** Links reconciling a given ledger statement. */
export function linksForLedger(links: ReconLink[], ledgerTxid: string): ReconLink[] {
  return links.filter(l => l.ledgerTxid === ledgerTxid)
}

/** Links referencing a given bank statement. */
export function linksForBank(links: ReconLink[], bankTransferId: string): ReconLink[] {
  return links.filter(l => l.bankTransferId === bankTransferId)
}
