/**
 * Journal of recipient notifications that must survive a crash.
 *
 * A transfer's tx is committed at overlay-accept, but the recipient only
 * learns about it via a MessageBox message. If the app dies (or the send
 * fails) between commit and sendMessage, the recipient owns an on-chain
 * output they will never internalize. So: journal the notification BEFORE
 * attempting it, clear on success, and retry pending ones from
 * reconcileNotifications. Duplicate delivery is safe — the receive pipeline
 * acknowledges by messageId and treats an already-internalized output as
 * success.
 *
 * Same per-entry localStorage layout as txJournal (atomic per key, memory
 * fallback merged on read).
 */

export interface PendingNotification {
  /** The committed txid — one notification per transfer. */
  txid: string
  recipient: string
  messageBox: string
  body: object
  attempts?: number
  at: number
}

const PREFIX = 'mandala.notifyJournal.'
const memory = new Map<string, PendingNotification>()

function storage (): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function notifyList (): PendingNotification[] {
  const byId = new Map<string, PendingNotification>(memory)
  const ls = storage()
  if (ls != null) {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (key == null || !key.startsWith(PREFIX)) continue
      try {
        const entry = JSON.parse(ls.getItem(key) ?? '') as PendingNotification
        if (typeof entry?.txid === 'string') byId.set(entry.txid, entry)
      } catch { /* one corrupted entry — skip it, keep the rest */ }
    }
  }
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

export function notifyPut (entry: PendingNotification): void {
  memory.set(entry.txid, entry)
  try {
    storage()?.setItem(PREFIX + entry.txid, JSON.stringify(entry))
  } catch { /* quota/unavailable — memory copy still holds for this tab */ }
}

export function notifyRemove (txid: string): void {
  memory.delete(txid)
  try {
    storage()?.removeItem(PREFIX + txid)
  } catch { /* unavailable — memory removal still applied */ }
}

/** Test helper. */
export function notifyClear (): void {
  memory.clear()
  const ls = storage()
  if (ls == null) return
  const doomed: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key != null && key.startsWith(PREFIX)) doomed.push(key)
  }
  doomed.forEach(k => ls.removeItem(k))
}

interface Sender {
  sendMessage: (args: { recipient: string, messageBox: string, body: object }) => Promise<unknown>
}

/**
 * Retry every pending recipient notification. Success clears the entry;
 * failure keeps it (attempts++) for the next pass. Returns delivered txids.
 */
export async function reconcileNotifications (messageBoxClient: Sender): Promise<string[]> {
  const delivered: string[] = []
  for (const entry of notifyList()) {
    try {
      await messageBoxClient.sendMessage({
        recipient: entry.recipient,
        messageBox: entry.messageBox,
        body: entry.body
      })
      notifyRemove(entry.txid)
      delivered.push(entry.txid)
    } catch {
      notifyPut({ ...entry, attempts: (entry.attempts ?? 0) + 1 })
    }
  }
  return delivered
}
