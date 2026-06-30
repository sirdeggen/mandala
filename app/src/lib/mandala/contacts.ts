import { HistoryRow } from './history'

export interface Contact { identityKey: string, lastSeen: number, count: number }

export function deriveContacts (history: HistoryRow[]): Contact[] {
  const map = new Map<string, Contact>()
  for (const r of history) {
    if (r.counterparty === '') continue
    const c = map.get(r.counterparty) ?? { identityKey: r.counterparty, lastSeen: 0, count: 0 }
    c.count += 1
    if (r.when > c.lastSeen) c.lastSeen = r.when
    map.set(r.counterparty, c)
  }
  return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen || b.count - a.count)
}
