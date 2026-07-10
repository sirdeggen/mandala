import { HTTPSOverlayBroadcastFacilitator, WalletInterface } from '@bsv/sdk'
import { TOPIC, OVERLAY_URL } from './constants.js'
import { journalPut, journalRemove } from './txJournal.js'

interface OverlayBroadcastFacilitator {
  send(url: string, taggedBEEF: { beef: number[]; topics: string[]; offChainValues?: number[] }): Promise<Record<string, { outputsToAdmit: number[] }>>
}

export async function submitToOverlay (
  beef: number[],
  offChainValues?: number[],
  facilitator: OverlayBroadcastFacilitator = new HTTPSOverlayBroadcastFacilitator(undefined, true)
): Promise<number[]> {
  const taggedBEEF = { beef, topics: [TOPIC], offChainValues }
  const steak = await facilitator.send(OVERLAY_URL, taggedBEEF)
  const admit = steak[TOPIC]?.outputsToAdmit ?? []
  if (admit.length === 0) throw new Error('overlay rejected the transaction')
  return admit
}

/**
 * Broadcast a previously-created `noSend` action now that the overlay has
 * accepted it. Synchronous (`acceptDelayedBroadcast: false`) so a broadcast
 * failure surfaces here rather than in a background process.
 */
export async function broadcastAcceptedTx (wallet: WalletInterface, txid: string): Promise<void> {
  await wallet.createAction({
    description: 'broadcast overlay-accepted tx',
    options: { sendWith: [txid], acceptDelayedBroadcast: false }
  })
}

/**
 * Broadcast errors that mean the network/wallet already has the tx — for
 * recovery purposes these ARE success (the journal entry can clear).
 */
export function isAlreadyBroadcast (e: unknown): boolean {
  return /already|known|duplicate|mempool|txn-already/i.test(String(e))
}

/**
 * Overlay-gated finalize. The transaction must already be created + signed with
 * `noSend` (built, not broadcast). Submit it to the overlay FIRST; only when the
 * overlay accepts (admits outputs) is it broadcast to the network. On rejection,
 * abort the action so its inputs are released for a retry, then rethrow — the
 * transaction never reaches the network.
 *
 * Resolves at the overlay-accept commit point: acceptance is the moment the
 * outcome is decided, so callers (and the UI) don't wait on the network
 * broadcast. The broadcast continues in the background under journal
 * protection — a failure keeps the 'accepted' entry and reconcileWallet
 * retries it; it must never be aborted (that would desync wallet from overlay).
 *
 * `reference` is the `createAction` signableTransaction.reference; pass it for
 * signable actions so a rejected tx's inputs are released. Genesis/register
 * actions have no signable reference — omit it (only wallet-managed funding is
 * held, which the wallet reclaims).
 */
export async function submitAndBroadcast (
  wallet: WalletInterface,
  signed: { tx: number[]; txid: string },
  offChainValues: number[] | undefined,
  reference?: string,
  facilitator?: OverlayBroadcastFacilitator
): Promise<number[]> {
  let admitted: number[]
  try {
    admitted = await submitToOverlay(signed.tx, offChainValues, facilitator)
  } catch (e) {
    // Overlay refused (policy/pause/insufficient) — release the held inputs.
    if (reference != null) {
      try {
        await wallet.abortAction({ reference })
      } catch {
        // Inputs still held by the dead action — journal so reconcileWallet
        // retries the abort on the next load instead of the asset vanishing.
        journalPut({ txid: signed.txid, stage: 'abort', reference, at: Date.now() })
      }
    }
    throw e
  }

  // Overlay has folded this tx into its state — from here the tx MUST reach the
  // network. Journal first, then broadcast in the background: the entry only
  // clears on success, so an interrupted/failed broadcast is retried by
  // reconcileWallet.
  journalPut({ txid: signed.txid, stage: 'accepted', at: Date.now() })
  void broadcastAcceptedTx(wallet, signed.txid)
    .then(() => journalRemove(signed.txid))
    .catch(e => {
      if (isAlreadyBroadcast(e)) {
        // The network already has it — recovery complete, clear the entry.
        journalRemove(signed.txid)
        return
      }
      console.warn(
        `[mandala] overlay accepted ${signed.txid} but broadcast failed; will retry via reconcile:`,
        e
      )
    })
  return admitted
}
