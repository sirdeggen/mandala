/**
 * Wallet/overlay reconciliation for half-failed flows.
 *
 * Failure being fixed: an admin action spends the current admin-auth UTXO but
 * something breaks mid-flight (overlay reject with a failed abort, broadcast
 * failure, crash). The old auth output sits held by a stuck 'nosend' action, no
 * spendable admin output remains, and the asset vanishes from the issuer view
 * (listAdminAssets is "spendable basket outputs with mandala-admin CI").
 *
 * Recovery, in order:
 *   1. Journal 'accepted' entries — overlay admitted, broadcast pending: retry
 *      the sendWith broadcast. Never aborted (the overlay already folded state).
 *      A broadcast error meaning "already known" clears the entry as success.
 *   2. Journal 'abort' entries — overlay rejected, abort pending: retry the
 *      abortAction that releases the held inputs. Kept (attempts++) on failure
 *      so a transient error never orphans the only durable record; handed to
 *      the bulk sweep only after ABORT_RETRY_CAP failures.
 *   3. Bulk sweep — wallet-toolbox specOpNoSendActions with the 'abort' label
 *      aborts every remaining stuck nosend mandala action server-side (it
 *      chain-checks first and refuses to abort anything already broadcast).
 *      Skipped while an 'accepted' entry is pending (an overlay-admitted tx
 *      must not be swept before its broadcast retry) and while any pipeline's
 *      fresh 'intent' entry exists (the sweep cannot tell a live noSend action
 *      from an abandoned one — the intent journal can).
 *
 * Whole pass runs under a cross-tab web lock: concurrent reconciles (two tabs,
 * init + settle overlap) skip instead of double-broadcasting / double-aborting.
 *
 * Aborting a stuck action releases the old auth output → the asset reappears.
 */
import { WalletInterface } from '@bsv/sdk'
import { broadcastAcceptedTx, isAlreadyBroadcast } from './overlay.js'
import { journalList, journalPut, journalRemove, INTENT_TTL_MS } from './txJournal.js'
import { tryWithLock } from './webLocks.js'

/**
 * wallet-toolbox listActions spec-op: intercepts this "label" to list actions
 * with status 'nosend'; adding the 'abort' label bulk-aborts them (skipping any
 * the chain already knows). Values are defined in @bsv/wallet-toolbox sdk/types.
 */
export const SPEC_OP_NOSEND_ACTIONS = 'ac6b20a3bb320adafecd637b25c84b792ad828d3aa510d05dc841481f664277d'

/** After this many failed abort retries the bulk sweep owns the cleanup. */
export const ABORT_RETRY_CAP = 5

export interface ReconcileResult {
  /** Overlay-accepted txids whose broadcast was successfully retried. */
  rebroadcast: string[]
  /** Rejected txids whose pending abort was successfully retried. */
  aborted: string[]
  /** Stuck nosend mandala actions released by the bulk sweep. */
  swept: number
  /** True when another reconcile (this tab or another) held the lock. */
  skipped?: boolean
}

export async function reconcileWallet (wallet: WalletInterface): Promise<ReconcileResult> {
  const { acquired, result } = await tryWithLock('mandala.reconcile', async () =>
    await reconcilePass(wallet)
  )
  if (!acquired || result == null) {
    return { rebroadcast: [], aborted: [], swept: 0, skipped: true }
  }
  return result
}

async function reconcilePass (wallet: WalletInterface): Promise<ReconcileResult> {
  const rebroadcast: string[] = []
  const aborted: string[] = []
  const now = Date.now()

  for (const entry of journalList()) {
    if (entry.stage === 'intent') {
      // A live pipeline's marker — leave fresh ones alone; expire stale ones
      // (crashed pipeline) so the sweep below can reclaim its inputs.
      if (now - entry.at >= INTENT_TTL_MS) journalRemove(entry.txid)
      continue
    }
    if (entry.stage === 'accepted') {
      try {
        await broadcastAcceptedTx(wallet, entry.txid)
        journalRemove(entry.txid)
        rebroadcast.push(entry.txid)
      } catch (e) {
        if (isAlreadyBroadcast(e)) {
          // The network already has it (e.g. the background broadcast won a
          // race with a crash) — recovery is complete, clear the entry.
          journalRemove(entry.txid)
          rebroadcast.push(entry.txid)
        } else {
          // Still unreachable — keep the entry for the next reconcile.
          journalPut({ ...entry, attempts: (entry.attempts ?? 0) + 1 })
        }
      }
    } else {
      try {
        if (entry.reference != null) await wallet.abortAction({ reference: entry.reference })
        journalRemove(entry.txid)
        aborted.push(entry.txid)
      } catch {
        // Abort still failing (wallet offline / transient) — KEEP the durable
        // record and retry next pass; only after the cap does the bulk sweep
        // own it. Deleting on first failure orphaned held inputs.
        const attempts = (entry.attempts ?? 0) + 1
        if (attempts >= ABORT_RETRY_CAP || entry.reference == null) {
          journalRemove(entry.txid)
        } else {
          journalPut({ ...entry, attempts })
        }
      }
    }
  }

  // Bulk sweep of any remaining stuck nosend mandala actions (crashed flows
  // that never journaled). Unsafe while an overlay-accepted tx still awaits
  // broadcast (the sweep can't tell it apart) or while a live pipeline's
  // fresh intent entry exists (its noSend action would be aborted mid-flight)
  // — so skip until both drain.
  let swept = 0
  const entries = journalList()
  const blocked = entries.some(e =>
    e.stage === 'accepted' ||
    (e.stage === 'intent' && Date.now() - e.at < INTENT_TTL_MS)
  )
  if (!blocked) {
    try {
      const res = await wallet.listActions({
        labels: [SPEC_OP_NOSEND_ACTIONS, 'mandala', 'abort'],
        limit: 100
      } as any)
      swept = (res as { actions?: unknown[] }).actions?.length ?? 0
    } catch { /* wallet without spec-op support — nothing to sweep */ }
  }

  return { rebroadcast, aborted, swept }
}
