/**
 * A public, cross-device reserve snapshot for any instrument, keyed only by its
 * assetId and public on-chain circulation. If the issuer has entered a real
 * reserve composition in this browser (compliance store) we surface that;
 * otherwise we derive a deterministic, fully-backed composition from the
 * circulation so the proof-of-reserves page renders consistently on any device
 * (the derivation is a pure function of public inputs). This stands in for a
 * real custodian/reserve feed in the demo.
 */
import { useReserveBucket, reservesTotalOf, type ReserveBucket, type ReserveLine } from './compliance'

export interface PublicReserveLine { label: string; amount: number }
export interface PublicReserve {
  total: number
  lines: PublicReserveLine[]
  /** 'issuer' when taken from the issuer's entered composition, else 'derived'. */
  source: 'issuer' | 'derived'
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

/** Deterministic fully-backed split from public circulation (no issuer input). */
function derive(assetId: string, circulation: number): PublicReserve {
  if (circulation <= 0) return { total: 0, lines: [], source: 'derived' }
  // Cash share 62–82%, deterministic per instrument; remainder in govt securities.
  const cashPct = 62 + (hash(assetId) % 21)
  const cash = Math.round((circulation * cashPct) / 100)
  const govt = circulation - cash
  const lines: PublicReserveLine[] = [{ label: RESERVE_CLASS_LABEL.cash, amount: cash }]
  if (govt > 0) lines.push({ label: RESERVE_CLASS_LABEL.govt, amount: govt })
  return { total: circulation, lines, source: 'derived' }
}

function fromIssuerLines(lines: ReserveLine[]): PublicReserveLine[] {
  // Collapse the issuer's composition to label + amount for public display.
  const byLabel = new Map<string, number>()
  for (const l of lines) {
    const label = RESERVE_CLASS_LABEL[l.assetClass] ?? l.assetClass
    byLabel.set(label, (byLabel.get(label) ?? 0) + (Number.isFinite(l.amount) ? l.amount : 0))
  }
  return [...byLabel.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount)
}

/** Pure public reserve snapshot: issuer composition when present, else derived. */
export function computePublicReserve(assetId: string, circulation: number, bucket?: ReserveBucket): PublicReserve {
  if (bucket != null && bucket.composition.length > 0) {
    return { total: reservesTotalOf(bucket), lines: fromIssuerLines(bucket.composition), source: 'issuer' }
  }
  return derive(assetId, circulation)
}

/** Reactive public reserve snapshot for an instrument. */
export function usePublicReserve(assetId: string, circulation: number): PublicReserve {
  const bucket = useReserveBucket(assetId)
  return computePublicReserve(assetId, circulation, bucket)
}
