/**
 * Journal of in-flight transactions, persisted in localStorage so a crash or
 * network failure mid-flow can be reconciled on the next load (see reconcile.ts).
 *
 * Stages:
 *   'accepted' — the overlay admitted the tx but the network broadcast hasn't
 *                succeeded yet. MUST NOT be aborted (the overlay already folded
 *                its state); recovery = retry the sendWith broadcast.
 *   'abort'    — the overlay rejected the tx and the abortAction that releases
 *                its inputs failed. Recovery = retry the abort.
 *
 * Falls back to an in-memory store when localStorage is unavailable (tests/SSR).
 */

export interface JournalEntry {
  txid: string
  stage: 'accepted' | 'abort'
  /** createAction signableTransaction.reference — needed to retry an abort. */
  reference?: string
  at: number
}

const KEY = 'mandala.txJournal'
let memory: JournalEntry[] = []

function read(): JournalEntry[] {
  try {
    if (typeof localStorage !== 'undefined') {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as JournalEntry[]
    }
  } catch { /* corrupted — start fresh */ }
  return memory
}

function write(entries: JournalEntry[]): void {
  memory = entries
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(entries))
  } catch { /* quota/unavailable — memory copy still holds */ }
}

export function journalList(): JournalEntry[] {
  return read()
}

/** Insert or replace the entry for a txid. */
export function journalPut(entry: JournalEntry): void {
  write([...read().filter(e => e.txid !== entry.txid), entry])
}

export function journalRemove(txid: string): void {
  write(read().filter(e => e.txid !== txid))
}

/** Test helper. */
export function journalClear(): void {
  write([])
}
