/**
 * Reserve-to-token orchestration (demo). A reserve deposit detected on the
 * (simulated) bank feed raises a mint request that a second approver must settle
 * before units are issued on-chain, giving deposit-to-mint a maker-checker
 * control. The mint itself is a real on-chain issuance; only the bank side is
 * simulated. Persisted per browser via the module-store idiom.
 */
import { useSyncExternalStore } from 'react'

export type MintStatus = 'pending' | 'settled' | 'rejected'

export interface MintRequest {
  id: string
  assetId: string
  amount: number          // base units, matches the deposit
  originator: string      // reserve counterparty that funded the deposit
  reference: string       // bank / statement reference
  requestedAt: string     // ISO
  requestedBy: string     // maker (the reserve deposit / treasury)
  status: MintStatus
  approvedBy?: string     // checker who settled or rejected
  settledAt?: string      // ISO
  txid?: string           // on-chain issuance txid
  note?: string           // rejection reason
}

const KEY = 'underwrite.mintQueue.v1'
const listeners = new Set<() => void>()

function read(): MintRequest[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    const parsed = raw != null ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed as MintRequest[] : []
  } catch {
    return []
  }
}

let current = read()
let seq = 0

function persist(next: MintRequest[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function createMintRequest(input: { assetId: string; amount: number; originator: string; reference: string; requestedBy?: string }): MintRequest {
  seq += 1
  const req: MintRequest = {
    id: `mint-${current.length}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
    assetId: input.assetId,
    amount: input.amount,
    originator: input.originator,
    reference: input.reference,
    requestedAt: new Date().toISOString(),
    requestedBy: input.requestedBy ?? 'Reserve deposit',
    status: 'pending',
  }
  persist([req, ...current])
  return req
}

export function settleMintRequest(id: string, opts: { txid: string; approvedBy: string }): void {
  persist(current.map(r => (r.id === id ? { ...r, status: 'settled', txid: opts.txid, approvedBy: opts.approvedBy, settledAt: new Date().toISOString() } : r)))
}

export function rejectMintRequest(id: string, opts: { approvedBy: string; note?: string }): void {
  persist(current.map(r => (r.id === id ? { ...r, status: 'rejected', approvedBy: opts.approvedBy, note: opts.note, settledAt: new Date().toISOString() } : r)))
}

export function removeMintRequest(id: string): void {
  persist(current.filter(r => r.id !== id))
}

export function useMintRequests(assetId: string): MintRequest[] {
  const all = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
  return assetId === '' ? [] : all.filter(r => r.assetId === assetId)
}
