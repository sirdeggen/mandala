import { HTTPSOverlayBroadcastFacilitator, WalletInterface } from '@bsv/sdk'
import { TOPIC, OVERLAY_URL } from './constants'

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
 * Overlay-gated finalize. The transaction must already be created + signed with
 * `noSend` (built, not broadcast). Submit it to the overlay FIRST; only when the
 * overlay accepts (admits outputs) is it broadcast to the network. On rejection,
 * abort the action so its inputs are released for a retry, then rethrow — the
 * transaction never reaches the network.
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
      try { await wallet.abortAction({ reference }) } catch { /* best-effort */ }
    }
    throw e
  }
  await broadcastAcceptedTx(wallet, signed.txid)
  return admitted
}
