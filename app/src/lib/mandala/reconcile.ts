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
 *   2. Journal 'abort' entries — overlay rejected, abort pending: retry the
 *      abortAction that releases the held inputs.
 *   3. Bulk sweep — wallet-toolbox specOpNoSendActions with the 'abort' label
 *      aborts every remaining stuck nosend mandala action server-side (it
 *      chain-checks first and refuses to abort anything already broadcast).
 *      Skipped while an 'accepted' entry is still pending so an
 *      overlay-admitted tx can't be swept away before its broadcast retry.
 *
 * Aborting a stuck action releases the old auth output → the asset reappears.
 */
import { WalletInterface } from '@bsv/sdk'
import { broadcastAcceptedTx } from './overlay'
import { journalList, journalRemove } from './txJournal'

/**
 * wallet-toolbox listActions spec-op: intercepts this "label" to list actions
 * with status 'nosend'; adding the 'abort' label bulk-aborts them (skipping any
 * the chain already knows). Values are defined in @bsv/wallet-toolbox sdk/types.
 */
export const SPEC_OP_NOSEND_ACTIONS = 'ac6b20a3bb320adafecd637b25c84b792ad828d3aa510d05dc841481f664277d'

export interface ReconcileResult {
  /** Overlay-accepted txids whose broadcast was successfully retried. */
  rebroadcast: string[]
  /** Rejected txids whose pending abort was successfully retried. */
  aborted: string[]
  /** Stuck nosend mandala actions released by the bulk sweep. */
  swept: number
}

export async function reconcileWallet(wallet: WalletInterface): Promise<ReconcileResult> {
  const rebroadcast: string[] = []
  const aborted: string[] = []

  for (const entry of journalList()) {
    if (entry.stage === 'accepted') {
      try {
        await broadcastAcceptedTx(wallet, entry.txid)
        journalRemove(entry.txid)
        rebroadcast.push(entry.txid)
      } catch { /* still unreachable — keep the entry for the next reconcile */ }
    } else {
      try {
        if (entry.reference != null) await wallet.abortAction({ reference: entry.reference })
        journalRemove(entry.txid)
        aborted.push(entry.txid)
      } catch {
        // Reference no longer abortable (already aborted / retired) — the bulk
        // sweep below owns it from here.
        journalRemove(entry.txid)
      }
    }
  }

  // Bulk sweep of any remaining stuck nosend mandala actions (crashed flows
  // that never journaled). Unsafe while an overlay-accepted tx still awaits
  // broadcast — the sweep can't tell it apart — so skip until the journal drains.
  let swept = 0
  if (!journalList().some(e => e.stage === 'accepted')) {
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
