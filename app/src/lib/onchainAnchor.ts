/**
 * Anchor a compliance record on-chain as a wallet-owned PushDrop output. The
 * record's canonical JSON (digest + signature + signer) is committed to a 1-sat
 * output so the sign-off is timestamped and tamper-evident beyond localStorage.
 * Best-effort: callers keep the local signature even if anchoring is declined.
 * Mirrors the PushDrop create pattern used by the contacts store.
 */
import { PushDrop, Utils, type WalletClient, type WalletProtocol } from '@bsv/sdk'

const ANCHOR_BASKET = 'underwrite-attestations'
const ANCHOR_PROTOCOL: WalletProtocol = [2, 'underwrite anchor']

export async function anchorOnChain(wallet: WalletClient, keyID: string, payload: unknown, description: string): Promise<string> {
  const json = JSON.stringify(payload)
  const fields = [Utils.toArray(json, 'utf8')]
  const lockingScript = await new PushDrop(wallet).lock(fields, ANCHOR_PROTOCOL, keyID, 'self', true, false)

  const created = await wallet.createAction({
    description: description.slice(0, 50),
    outputs: [{
      satoshis: 1,
      lockingScript: lockingScript.toHex(),
      outputDescription: description.slice(0, 50),
      basket: ANCHOR_BASKET,
      customInstructions: json,
      tags: ['underwrite', 'attestation'],
    }],
    options: { randomizeOutputs: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  if (created.txid != null) return created.txid
  if (created.signableTransaction != null) {
    const signed = await wallet.signAction({ reference: created.signableTransaction.reference, spends: {} })
    if (signed.txid != null) return signed.txid
  }
  throw new Error('anchorOnChain: createAction returned no txid')
}
