import { HistoryRow } from './history'

export interface Contact {
  identityKey: string
  /** Wall-clock of the most recent interaction. 0 when the SDK exposes none. */
  lastSeen: number
  count: number
  /** Index of the most recent interaction in the (oldest-first) history array. */
  order: number
}

/**
 * Collapse transaction history into per-counterparty contacts, ordered most
 * recently transacted-with first.
 *
 * The @bsv/sdk exposes no wall-clock timestamp (HistoryRow.when is always 0), so
 * recency is derived from position in the history array — which loadHistory
 * returns oldest-first — via the index of the last interaction. `lastSeen` still
 * takes precedence so ordering upgrades automatically if real timestamps arrive.
 */
export function deriveContacts (history: HistoryRow[]): Contact[] {
  const map = new Map<string, Contact>()
  history.forEach((r, i) => {
    if (r.counterparty === '') return
    const c = map.get(r.counterparty) ?? { identityKey: r.counterparty, lastSeen: 0, count: 0, order: -1 }
    c.count += 1
    if (r.when > c.lastSeen) c.lastSeen = r.when
    if (i > c.order) c.order = i
    map.set(r.counterparty, c)
  })
  return [...map.values()].sort(
    (a, b) => b.lastSeen - a.lastSeen || b.order - a.order || b.count - a.count
  )
}
