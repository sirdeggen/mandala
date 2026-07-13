/**
 * Reserve snapshot for an instrument, used for backing figures across the app.
 * Reserves come from real inputs, in priority order:
 *   1. the issuer's entered reserve composition (compliance store), if any;
 *   2. otherwise the bank reserve feed balance (deposits − withdrawals);
 *   3. otherwise nothing (0) — the instrument is unbacked until reserves exist.
 * There is no "assume fully backed" fallback, so backing reflects reality (an
 * instrument with reserves below circulation reads as under-reserved).
 *
 * The bank feed and composition are browser-local demo stores, so a public
 * cross-device viewer sees only what those hold; a production build would read
 * a custodian/reserve API keyed by assetId.
 */
import { useReserveBucket, reservesTotalOf, type ReserveBucket, type ReserveLine } from './compliance'
import { useMockTransfers } from './mandala/mockBankStore'

export interface PublicReserveLine { label: string; amount: number }
export interface PublicReserve {
  total: number
  lines: PublicReserveLine[]
  /** Where the reserve figure came from. */
  source: 'issuer' | 'feed' | 'none'
}

const RESERVE_CLASS_LABEL: Record<string, string> = {
  cash: 'Cash at custodian bank',
  govt: 'Short-term government securities',
  tbill: 'Treasury bills',
  mmf: 'Money-market fund units',
  repo: 'Reverse repurchase agreements',
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Deterministic cash/govt split of a reserve total, for a plausible breakdown
 *  when the issuer hasn't itemised one. */
function splitTotal(assetId: string, total: number, source: 'feed' | 'none'): PublicReserve {
  if (total <= 0) return { total: 0, lines: [], source }
  const cashPct = 62 + (hash(assetId) % 21) // 62–82%
  const cash = Math.round((total * cashPct) / 100)
  const govt = total - cash
  const lines: PublicReserveLine[] = [{ label: RESERVE_CLASS_LABEL.cash, amount: cash }]
  if (govt > 0) lines.push({ label: RESERVE_CLASS_LABEL.govt, amount: govt })
  return { total, lines, source }
}

function fromIssuerLines(lines: ReserveLine[]): PublicReserveLine[] {
  const byLabel = new Map<string, number>()
  for (const l of lines) {
    const label = RESERVE_CLASS_LABEL[l.assetClass] ?? l.assetClass
    byLabel.set(label, (byLabel.get(label) ?? 0) + (Number.isFinite(l.amount) ? l.amount : 0))
  }
  return [...byLabel.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount)
}

/**
 * Pure reserve snapshot. `bankReserve` is the bank-feed balance in display
 * units; pass 0 if unknown. Issuer composition wins, then the bank feed.
 */
export function computePublicReserve(assetId: string, _circulation: number, bucket?: ReserveBucket, bankReserve = 0): PublicReserve {
  if (bucket != null && bucket.composition.length > 0) {
    return { total: reservesTotalOf(bucket), lines: fromIssuerLines(bucket.composition), source: 'issuer' }
  }
  if (bankReserve > 0) return splitTotal(assetId, bankReserve, 'feed')
  return { total: 0, lines: [], source: 'none' }
}

/** Reactive reserve snapshot for an instrument (reads the compliance
 *  composition and the bank reserve feed). */
export function usePublicReserve(assetId: string, circulation: number, decimals: number): PublicReserve {
  const bucket = useReserveBucket(assetId)
  const transfers = useMockTransfers(assetId)
  const bankBase = transfers.reduce((s, t) => s + (t.direction === 'in' ? t.amount : -t.amount), 0)
  const bankReserve = decimals >= 0 ? bankBase / 10 ** decimals : bankBase
  return computePublicReserve(assetId, circulation, bucket, bankReserve)
}
