/**
 * Journal of in-flight transactions, persisted in localStorage so a crash or
 * network failure mid-flow can be reconciled on the next load (see reconcile.ts).
 *
 * Stages:
 *   'intent'   — a pipeline is about to (or did) createAction but the overlay
 *                outcome is not yet journaled. Written BEFORE createAction and
 *                cleared on settle; while a fresh intent exists the reconcile
 *                bulk sweep must not run (it would abort the live action).
 *                A crashed pipeline leaves a stale intent, which expires after
 *                INTENT_TTL_MS so recovery is never blocked forever.
 *   'accepted' — the overlay admitted the tx but the network broadcast hasn't
 *                succeeded yet. MUST NOT be aborted (the overlay already folded
 *                its state); recovery = retry the sendWith broadcast.
 *   'abort'    — the overlay rejected the tx and the abortAction that releases
 *                its inputs failed. Recovery = retry the abort.
 *
 * Storage layout: ONE localStorage key PER ENTRY (`mandala.txJournal.<id>`).
 * setItem/removeItem are atomic per key, so concurrent tabs can add/remove
 * different entries without the lost-update races a single-array
 * read-modify-write suffers. A corrupted entry is skipped (and cleaned up)
 * individually instead of wiping the whole journal.
 *
 * Falls back to an in-memory store when localStorage is unavailable
 * (tests/SSR); reads merge both so a quota failure never hides an entry
 * from the tab that wrote it.
 */

export interface JournalEntry {
  txid: string
  stage: 'intent' | 'accepted' | 'abort'
  /** createAction signableTransaction.reference — needed to retry an abort. */
  reference?: string
  /** Failed recovery attempts so far (reconcile increments; see caps there). */
  attempts?: number
  at: number
}

const PREFIX = 'mandala.txJournal.'
const LEGACY_KEY = 'mandala.txJournal'

/** Stale-intent expiry — after this a crashed pipeline no longer blocks the sweep. */
export const INTENT_TTL_MS = 5 * 60 * 1000

const memory = new Map<string, JournalEntry>()

function storage (): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** One-time migration of the legacy single-array key into per-entry keys. */
function migrateLegacy (ls: Storage): void {
  const raw = ls.getItem(LEGACY_KEY)
  if (raw == null) return
  try {
    for (const e of JSON.parse(raw) as JournalEntry[]) {
      if (ls.getItem(PREFIX + e.txid) == null) {
        ls.setItem(PREFIX + e.txid, JSON.stringify(e))
      }
    }
  } catch { /* corrupted legacy blob — nothing recoverable */ }
  ls.removeItem(LEGACY_KEY)
}

export function journalList (): JournalEntry[] {
  const byId = new Map<string, JournalEntry>(memory)
  const ls = storage()
  if (ls != null) {
    migrateLegacy(ls)
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (key == null || !key.startsWith(PREFIX)) continue
      try {
        const entry = JSON.parse(ls.getItem(key) ?? '') as JournalEntry
        if (typeof entry?.txid === 'string' && typeof entry.stage === 'string') {
          byId.set(entry.txid, entry)
        }
      } catch { /* one corrupted entry — skip it, keep the rest */ }
    }
  }
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

/** Insert or replace the entry for a txid. Atomic per entry. */
export function journalPut (entry: JournalEntry): void {
  memory.set(entry.txid, entry)
  try {
    storage()?.setItem(PREFIX + entry.txid, JSON.stringify(entry))
  } catch { /* quota/unavailable — memory copy still holds for this tab */ }
}

export function journalRemove (txid: string): void {
  memory.delete(txid)
  try {
    storage()?.removeItem(PREFIX + txid)
  } catch { /* unavailable — memory removal still applied */ }
}

/**
 * Mark a pipeline as in flight BEFORE createAction. The returned id keys the
 * entry (the real txid is unknown until signAction); clear it with
 * journalIntentEnd once the outcome is journaled ('accepted'/'abort') or the
 * pipeline settled cleanly.
 */
export function journalIntentBegin (): string {
  const id = 'intent:' + (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  journalPut({ txid: id, stage: 'intent', at: Date.now() })
  return id
}

export function journalIntentEnd (id: string): void {
  journalRemove(id)
}

/**
 * Run a wallet pipeline under an intent marker: while it runs (and until its
 * overlay outcome is journaled), the reconcile bulk sweep stays away from the
 * live noSend action — including sweeps from other tabs.
 */
export async function withIntent<T> (fn: () => Promise<T>): Promise<T> {
  const id = journalIntentBegin()
  try {
    return await fn()
  } finally {
    journalIntentEnd(id)
  }
}

/** True while any pipeline's intent entry is younger than INTENT_TTL_MS. */
export function hasFreshIntent (now: number = Date.now()): boolean {
  return journalList().some(e => e.stage === 'intent' && now - e.at < INTENT_TTL_MS)
}

/** Test helper. */
export function journalClear (): void {
  memory.clear()
  const ls = storage()
  if (ls == null) return
  const doomed: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key != null && (key.startsWith(PREFIX) || key === LEGACY_KEY)) doomed.push(key)
  }
  doomed.forEach(k => ls.removeItem(k))
}
