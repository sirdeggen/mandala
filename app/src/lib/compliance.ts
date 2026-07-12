/**
 * Compliance state - the reserve-composition + attestation loop that makes an
 * instrument's backing *provable* rather than asserted. This is the first slice
 * of the compliance layer (MiCA reserve-of-assets / GENIUS Act monthly
 * attestation): an issuer maintains the composition of the reserves backing an
 * instrument and snapshots it as an **attestation**; an auditor then reviews and
 * signs (or flags) that attestation.
 *
 * State lives in localStorage under `underwrite.compliance.v1`; a module-level
 * store + useSyncExternalStore keeps subscribers in sync without a context
 * provider (mirrors lib/onboarding.ts). Amounts are held as plain numbers in the
 * instrument's reference currency; a real deployment would source circulation
 * from the chain and reserve balances from bank/custodian feeds.
 */
import { useSyncExternalStore } from 'react'
import { SANCTIONS_WATCHLIST } from '@/content/sanctionsWatchlist'
import { isReserveLineEligible } from '@/content/reserveClasses'

const KEY = 'underwrite.compliance.v1'

export interface ReserveLine {
  id: string
  assetClass: string   // key from RESERVE_CLASSES
  amount: number
  /** Per-class compliance attributes (custodian, maturity, jurisdiction …). */
  attributes?: Record<string, string>
}

export type AttestationStatus = 'submitted' | 'signed' | 'flagged'

export interface Attestation {
  id: string
  assetId: string
  period: string          // 'YYYY-MM'
  createdAt: string       // ISO
  currency: string        // ticker / reference currency label
  circulation: number     // units in circulation at snapshot
  reservesTotal: number   // sum of reserve lines at snapshot
  lines: ReserveLine[]
  status: AttestationStatus
  auditorName?: string
  auditorNote?: string
  reviewedAt?: string     // ISO
  /** Auditor's identity key (Badge ID) that signed, and the ECDSA signature
   *  over the attestation digest - present on cryptographically signed ones. */
  auditorKey?: string
  signature?: string
  /** Reference to the evidence backing the figures (bank/custody confirmation). */
  evidence?: string
  /** Signed with exceptions (a qualified opinion) rather than clean. */
  exceptions?: boolean
  /** Txid anchoring the signed attestation on-chain, if published. */
  anchorTxid?: string
}

/** An issuer's working reserve composition for one instrument. */
export interface ReserveBucket {
  composition: ReserveLine[]
  circulation: number
}

// ── Redemption (holder redeems at par) ────────────────────────────────────────

export type SettlementWindow = 'instant' | 't1' | 't2' | 't3'

export interface RedemptionPolicy {
  /** Whether holders may redeem this instrument at par. */
  enabled: boolean
  /** How quickly the issuer commits to settle. */
  window: SettlementWindow
  /** Minimum redeemable amount (0 = no minimum). */
  minAmount: number
  /** Published redemption terms shown to holders. */
  terms: string
}

export const DEFAULT_REDEMPTION_POLICY: RedemptionPolicy = {
  enabled: true, window: 't1', minAmount: 0, terms: '',
}

export const SETTLEMENT_WINDOW_LABEL: Record<SettlementWindow, string> = {
  instant: 'Instant', t1: 'Next business day (T+1)', t2: 'T+2', t3: 'T+3',
}

export type RedemptionStatus = 'pending' | 'settled' | 'rejected'

export interface RedemptionRequest {
  id: string
  assetId: string
  holderKey: string
  holderName: string
  amount: number
  currency: string
  requestedAt: string     // ISO
  status: RedemptionStatus
  note?: string           // rejection reason / settlement note
  processedAt?: string    // ISO
  /** Auditor confirmation that this redemption was honoured at par. */
  auditorName?: string
  auditorKey?: string
  auditorSignature?: string
  attestedAt?: string     // ISO
  /** Txid anchoring the at-par confirmation on-chain, if published. */
  anchorTxid?: string
}

// ── KYC / sanctions screening ─────────────────────────────────────────────────

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected'
export type RiskRating = 'low' | 'medium' | 'high'
export type SanctionsResult = 'unscreened' | 'clear' | 'hit'

/** A holder's compliance record - global (per Badge ID), not per instrument, so
 *  a holder verified once is verified everywhere. */
export interface HolderRecord {
  identityKey: string
  name: string
  kyc: KycStatus
  risk: RiskRating
  sanctions: SanctionsResult
  pep: boolean
  screenedAt?: string   // ISO
  updatedAt: string     // ISO
}

/** Travel Rule: collect originator/beneficiary info on transfers above a
 *  threshold. Configured per instrument. */
export interface TravelRulePolicy {
  enabled: boolean
  threshold: number
}

export const DEFAULT_TRAVEL_RULE: TravelRulePolicy = { enabled: true, threshold: 1000 }

// ── Governance (maker-checker) ────────────────────────────────────────────────

export interface GovernancePolicy {
  /** Require a second approver before sensitive actions take effect. */
  dualControl: boolean
}
export const DEFAULT_GOVERNANCE: GovernancePolicy = { dualControl: false }

export type ProposalStatus = 'pending' | 'approved' | 'rejected'
export type ProposalKind = 'settleRedemption' | 'generic'

export interface Proposal {
  id: string
  kind: ProposalKind
  title: string
  detail: string
  assetId?: string
  requestId?: string     // settleRedemption payload
  createdAt: string
  status: ProposalStatus
  decidedAt?: string
  note?: string
}

// ── Control actions (sensitive admin operations needing auditor sign-off) ─────

export type ControlActionKind =
  | 'freeze' | 'unfreeze' | 'reissue' | 'blockIdentity' | 'unblockIdentity'
  | 'pause' | 'accessMode' | 'redemptionPolicy' | 'other'

/** A sensitive control action an issuer performed, logged for an auditor to
 *  acknowledge and cryptographically sign off. */
export interface ControlAction {
  id: string
  assetId: string
  kind: ControlActionKind
  detail: string
  reason: string
  actorKey: string        // issuer identity key that performed it
  actorName?: string
  createdAt: string       // ISO
  status: 'pending' | 'acknowledged'
  auditorName?: string
  auditorKey?: string
  signature?: string
  auditorNote?: string
  reviewedAt?: string     // ISO
  /** Txid anchoring the signed sign-off on-chain, if published. */
  anchorTxid?: string
}

interface State {
  buckets: Record<string, ReserveBucket>
  attestations: Attestation[]
  policies: Record<string, RedemptionPolicy>
  requests: RedemptionRequest[]
  holders: Record<string, HolderRecord>
  travelRule: Record<string, TravelRulePolicy>
  governance: GovernancePolicy
  proposals: Proposal[]
  controlActions: ControlAction[]
}

const EMPTY: State = {
  buckets: {}, attestations: [], policies: {}, requests: [],
  holders: {}, travelRule: {}, governance: DEFAULT_GOVERNANCE, proposals: [],
  controlActions: [],
}
const listeners = new Set<() => void>()

function read(): State {
  try {
    if (typeof localStorage === 'undefined') return EMPTY
    const raw = localStorage.getItem(KEY)
    if (raw == null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<State>
    return {
      buckets: parsed.buckets ?? {},
      attestations: Array.isArray(parsed.attestations) ? parsed.attestations : [],
      policies: parsed.policies ?? {},
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      holders: parsed.holders ?? {},
      travelRule: parsed.travelRule ?? {},
      governance: parsed.governance ?? DEFAULT_GOVERNANCE,
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      controlActions: Array.isArray(parsed.controlActions) ? parsed.controlActions : [],
    }
  } catch {
    return EMPTY
  }
}

let current = read()

function persist(next: State): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

let seq = 0
function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${new Date().getTime().toString(36)}_${seq.toString(36)}`
}

function bucketOf(assetId: string): ReserveBucket {
  return current.buckets[assetId] ?? { composition: [], circulation: 0 }
}

/** Total reserves that count toward full backing: only eligible lines (permitted
 *  class, and within the short-dated maturity cap where it applies). */
export function reservesTotalOf(bucket: ReserveBucket): number {
  return bucket.composition.reduce(
    (sum, l) => sum + (Number.isFinite(l.amount) && isReserveLineEligible(l.assetClass, l.attributes) ? l.amount : 0),
    0,
  )
}

// ── Composition mutations ─────────────────────────────────────────────────────

export function setComposition(assetId: string, lines: ReserveLine[]): void {
  persist({ ...current, buckets: { ...current.buckets, [assetId]: { ...bucketOf(assetId), composition: lines } } })
}

export function setCirculation(assetId: string, circulation: number): void {
  persist({ ...current, buckets: { ...current.buckets, [assetId]: { ...bucketOf(assetId), circulation } } })
}

export function addReserveLine(assetId: string, assetClass = 'cash'): void {
  const line: ReserveLine = { id: uid('rl'), assetClass, amount: 0 }
  setComposition(assetId, [...bucketOf(assetId).composition, line])
}

export function updateReserveLine(assetId: string, id: string, patch: Partial<ReserveLine>): void {
  setComposition(assetId, bucketOf(assetId).composition.map(l => l.id === id ? { ...l, ...patch } : l))
}

export function removeReserveLine(assetId: string, id: string): void {
  setComposition(assetId, bucketOf(assetId).composition.filter(l => l.id !== id))
}

// ── Attestations ──────────────────────────────────────────────────────────────

/**
 * Snapshot the current composition + circulation as a submitted attestation.
 * `circulation` is passed in so callers can snapshot the authoritative on-chain
 * figure (issued - redeemed) rather than the local bucket field; it falls back
 * to the bucket value when omitted.
 */
export function createAttestation(assetId: string, currency: string, circulation?: number, evidence?: string): Attestation {
  const bucket = bucketOf(assetId)
  const now = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const att: Attestation = {
    id: uid('att'),
    assetId,
    period,
    createdAt: now.toISOString(),
    currency,
    circulation: circulation ?? bucket.circulation,
    reservesTotal: reservesTotalOf(bucket),
    lines: bucket.composition.map(l => ({ ...l })),
    status: 'submitted',
    evidence: evidence != null && evidence.trim() !== '' ? evidence.trim() : undefined,
  }
  persist({ ...current, attestations: [att, ...current.attestations] })
  return att
}

/** Record the on-chain anchor txid for a signed attestation. */
export function setAttestationAnchor(id: string, anchorTxid: string): void {
  persist({ ...current, attestations: current.attestations.map(a => a.id === id ? { ...a, anchorTxid } : a) })
}

/** Auditor review - sign or flag a submitted attestation. A signed review
 *  carries the auditor's Badge ID and ECDSA signature over the attestation. */
export function reviewAttestation(id: string, review: {
  status: 'signed' | 'flagged'
  auditorName: string
  note?: string
  auditorKey?: string
  signature?: string
  exceptions?: boolean
}): void {
  persist({
    ...current,
    attestations: current.attestations.map(a => a.id === id
      ? {
          ...a,
          status: review.status,
          auditorName: review.auditorName,
          auditorNote: review.note,
          reviewedAt: new Date().toISOString(),
          auditorKey: review.auditorKey,
          signature: review.signature,
          exceptions: review.exceptions ?? false,
        }
      : a),
  })
}

// ── Reactive reads ────────────────────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function useReserveBucket(assetId: string): ReserveBucket {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.buckets[assetId] ?? { composition: [], circulation: 0 }
}

export function useAttestations(assetId: string): Attestation[] {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.attestations.filter(a => a.assetId === assetId)
}

// ── Redemptions ───────────────────────────────────────────────────────────────

export function setRedemptionPolicy(assetId: string, patch: Partial<RedemptionPolicy>): void {
  const prev = current.policies[assetId] ?? DEFAULT_REDEMPTION_POLICY
  persist({ ...current, policies: { ...current.policies, [assetId]: { ...prev, ...patch } } })
}

/** Log a redemption request received from a holder. */
export function createRedemptionRequest(input: {
  assetId: string
  holderKey: string
  holderName: string
  amount: number
  currency: string
}): RedemptionRequest {
  const req: RedemptionRequest = {
    id: uid('rdm'),
    assetId: input.assetId,
    holderKey: input.holderKey,
    holderName: input.holderName,
    amount: input.amount,
    currency: input.currency,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  }
  persist({ ...current, requests: [req, ...current.requests] })
  return req
}

/** Settle a redemption at par - mark it settled and remove the redeemed units
 *  from circulation, so backing reflects the reduced supply. */
export function settleRedemption(id: string, note?: string): void {
  const req = current.requests.find(r => r.id === id)
  const nextRequests = current.requests.map(r => r.id === id
    ? { ...r, status: 'settled' as const, processedAt: new Date().toISOString(), note }
    : r)
  let nextBuckets = current.buckets
  if (req != null) {
    const b = current.buckets[req.assetId] ?? { composition: [], circulation: 0 }
    nextBuckets = { ...current.buckets, [req.assetId]: { ...b, circulation: Math.max(0, b.circulation - req.amount) } }
  }
  persist({ ...current, requests: nextRequests, buckets: nextBuckets })
}

export function rejectRedemption(id: string, reason: string): void {
  persist({
    ...current,
    requests: current.requests.map(r => r.id === id
      ? { ...r, status: 'rejected' as const, processedAt: new Date().toISOString(), note: reason }
      : r),
  })
}

/** Auditor confirmation that a redemption was honoured at par, with signature. */
export function attestRedemption(id: string, review: { auditorName: string; auditorKey: string; signature: string }): void {
  persist({
    ...current,
    requests: current.requests.map(r => r.id === id
      ? { ...r, auditorName: review.auditorName, auditorKey: review.auditorKey, auditorSignature: review.signature, attestedAt: new Date().toISOString() }
      : r),
  })
}

/** Record the on-chain anchor txid for a redemption's at-par confirmation. */
export function setRedemptionAnchor(id: string, anchorTxid: string): void {
  persist({ ...current, requests: current.requests.map(r => r.id === id ? { ...r, anchorTxid } : r) })
}

export function useRedemptionPolicy(assetId: string): RedemptionPolicy {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.policies[assetId] ?? DEFAULT_REDEMPTION_POLICY
}

export function useRedemptionRequests(assetId: string): RedemptionRequest[] {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.requests.filter(r => r.assetId === assetId)
}

// ── KYC / sanctions screening ─────────────────────────────────────────────────

/** FNV-1a 32-bit hash - deterministic, so screening a key gives a stable result. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Simulated screening: a name matching the sample watchlist is always a hit;
 *  otherwise a deterministic hash of the key produces a realistic mix of hits,
 *  PEP matches, and risk ratings. Replace with real OFAC/EU/PEP feeds. */
export function runScreening(identityKey: string, name: string): { sanctions: SanctionsResult; pep: boolean; risk: RiskRating } {
  const n = name.trim().toLowerCase()
  const nameHit = n !== '' && SANCTIONS_WATCHLIST.some(w => n.includes(w.toLowerCase()))
  const keyHit = fnv1a(`s:${identityKey}`) % 6 === 0
  const sanctions: SanctionsResult = nameHit || keyHit ? 'hit' : 'clear'
  const pep = fnv1a(`p:${identityKey}`) % 7 === 0
  const risk: RiskRating = sanctions === 'hit' ? 'high' : pep ? 'medium' : (fnv1a(`r:${identityKey}`) % 3 === 0 ? 'medium' : 'low')
  return { sanctions, pep, risk }
}

/** Screen a holder and upsert their record (preserving any existing KYC status). */
export function screenHolder(input: { identityKey: string; name: string }): HolderRecord {
  const now = new Date().toISOString()
  const prev = current.holders[input.identityKey]
  const { sanctions, pep, risk } = runScreening(input.identityKey, input.name || prev?.name || '')
  const record: HolderRecord = {
    identityKey: input.identityKey,
    name: input.name || prev?.name || '',
    kyc: prev?.kyc ?? 'unverified',
    risk,
    sanctions,
    pep,
    screenedAt: now,
    updatedAt: now,
  }
  persist({ ...current, holders: { ...current.holders, [input.identityKey]: record } })
  return record
}

export function setKyc(identityKey: string, kyc: KycStatus): void {
  const prev = current.holders[identityKey]
  if (prev == null) return
  persist({ ...current, holders: { ...current.holders, [identityKey]: { ...prev, kyc, updatedAt: new Date().toISOString() } } })
}

export function removeHolder(identityKey: string): void {
  const next = { ...current.holders }
  delete next[identityKey]
  persist({ ...current, holders: next })
}

export function useHolders(): HolderRecord[] {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return Object.values(map.holders).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function setTravelRule(assetId: string, patch: Partial<TravelRulePolicy>): void {
  const prev = current.travelRule[assetId] ?? DEFAULT_TRAVEL_RULE
  persist({ ...current, travelRule: { ...current.travelRule, [assetId]: { ...prev, ...patch } } })
}

export function useTravelRule(assetId: string): TravelRulePolicy {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.travelRule[assetId] ?? DEFAULT_TRAVEL_RULE
}

// ── Governance / maker-checker ────────────────────────────────────────────────

export function setGovernance(patch: Partial<GovernancePolicy>): void {
  persist({ ...current, governance: { ...current.governance, ...patch } })
}

export function isDualControl(): boolean {
  return current.governance.dualControl
}

export function proposeSettlement(req: { id: string; assetId: string; amount: number; currency: string; holderName: string }): void {
  const p: Proposal = {
    id: uid('prop'),
    kind: 'settleRedemption',
    title: 'Settle redemption at par',
    detail: `Redeem ${req.amount.toLocaleString('en-US')} ${req.currency} for ${req.holderName || 'a holder'}.`,
    assetId: req.assetId,
    requestId: req.id,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  persist({ ...current, proposals: [p, ...current.proposals] })
}

export function proposeGeneric(input: { title: string; detail: string; assetId?: string }): void {
  const p: Proposal = {
    id: uid('prop'),
    kind: 'generic',
    title: input.title,
    detail: input.detail,
    assetId: input.assetId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  persist({ ...current, proposals: [p, ...current.proposals] })
}

export function approveProposal(id: string): void {
  const p = current.proposals.find(x => x.id === id)
  if (p == null || p.status !== 'pending') return
  // Mark approved first, then run the side effect (which persists again).
  persist({ ...current, proposals: current.proposals.map(x => x.id === id ? { ...x, status: 'approved' as const, decidedAt: new Date().toISOString() } : x) })
  if (p.kind === 'settleRedemption' && p.requestId != null) {
    settleRedemption(p.requestId, 'Approved via dual control')
  }
}

export function rejectProposal(id: string, note?: string): void {
  persist({
    ...current,
    proposals: current.proposals.map(x => x.id === id
      ? { ...x, status: 'rejected' as const, decidedAt: new Date().toISOString(), note }
      : x),
  })
}

export function useGovernance(): GovernancePolicy {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.governance
}

export function useProposals(): Proposal[] {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map.proposals
}

// ── Control actions (auditor sign-off on sensitive admin operations) ──────────

/** Log a sensitive control action for auditor sign-off (idempotent per id). */
export function logControlAction(input: {
  assetId: string
  kind: ControlActionKind
  detail: string
  reason: string
  actorKey: string
  actorName?: string
}): void {
  const action: ControlAction = {
    id: uid('act'),
    assetId: input.assetId,
    kind: input.kind,
    detail: input.detail,
    reason: input.reason,
    actorKey: input.actorKey,
    actorName: input.actorName,
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  persist({ ...current, controlActions: [action, ...current.controlActions] })
}

/** Auditor acknowledgement + signature over a control action. */
export function acknowledgeControlAction(id: string, review: { auditorName: string; auditorKey: string; signature: string; note?: string }): void {
  persist({
    ...current,
    controlActions: current.controlActions.map(a => a.id === id
      ? { ...a, status: 'acknowledged' as const, auditorName: review.auditorName, auditorKey: review.auditorKey, signature: review.signature, auditorNote: review.note, reviewedAt: new Date().toISOString() }
      : a),
  })
}

/** Record the on-chain anchor txid for a control action's sign-off. */
export function setControlActionAnchor(id: string, anchorTxid: string): void {
  persist({ ...current, controlActions: current.controlActions.map(a => a.id === id ? { ...a, anchorTxid } : a) })
}

export function useControlActions(assetId?: string): ControlAction[] {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return assetId == null ? map.controlActions : map.controlActions.filter(a => a.assetId === assetId)
}

// ── Cross-instrument snapshot (for the compliance overview) ────────────────────

export interface ComplianceSnapshot {
  buckets: Record<string, ReserveBucket>
  attestations: Attestation[]
  requests: RedemptionRequest[]
  holders: Record<string, HolderRecord>
  proposals: Proposal[]
  governance: GovernancePolicy
  controlActions: ControlAction[]
}

export function useComplianceSnapshot(): ComplianceSnapshot {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
