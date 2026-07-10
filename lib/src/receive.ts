/**
 * Incoming-transfer pipeline: list pending MessageBox transfers, internalize
 * each into the wallet basket, acknowledge the message. Pure of any UI — the
 * app layer decides how to surface results.
 *
 * Per-message failure is isolated: one bad transfer never blocks the rest,
 * and a failed message is left un-acknowledged so a later run retries it.
 */
import { AtomicBEEF, Transaction, WalletInterface } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { MESSAGEBOX, BASKET } from './constants.js'
import { resolveAssetMetadata } from './metadata.js'

/**
 * The message body contradicts the transaction it carries (or isn't a valid
 * token transfer at all). Never retried — the message is acknowledged and
 * dropped so a malicious or corrupt transfer can't wedge the receive loop.
 */
export class InvalidTransferError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'InvalidTransferError'
  }
}

/**
 * The recipient must not trust the sender's message body: verify that the
 * output the body points at actually IS a Mandala token of the claimed asset
 * and amount before internalizing. Without this a hostile sender corrupts the
 * recipient's basket/balances with mislabeled or non-token outputs.
 */
function verifyIncoming (msg: IncomingTransfer): void {
  let tx: Transaction
  try {
    tx = Transaction.fromAtomicBEEF(msg.transaction)
  } catch {
    try {
      tx = Transaction.fromBEEF(msg.transaction as unknown as number[])
    } catch (e) {
      throw new InvalidTransferError(`transaction does not parse: ${String(e)}`)
    }
  }
  const out = tx.outputs[msg.outputIndex]
  if (out == null) {
    throw new InvalidTransferError(`outputIndex ${msg.outputIndex} out of range`)
  }
  let decoded: { assetId: string, amount: number }
  try {
    decoded = MandalaToken.decode(out.lockingScript)
  } catch {
    throw new InvalidTransferError('output is not a Mandala token')
  }
  if (decoded.assetId !== msg.assetId) {
    throw new InvalidTransferError(`asset mismatch: body says ${msg.assetId}, output is ${decoded.assetId}`)
  }
  if (decoded.amount !== Number(msg.amount)) {
    throw new InvalidTransferError(`amount mismatch: body says ${msg.amount}, output is ${decoded.amount}`)
  }
}

/** Wallet errors meaning this output was internalized by an earlier attempt. */
function isAlreadyInternalized (e: unknown): boolean {
  return /already|duplicate|exists/i.test(String(e))
}

/** Message body shape produced by transferTokens / reissue notification. */
export interface IncomingTransfer {
  id: string
  assetId: string
  amount: string
  sender: string
  keyID: string
  protocolID: [0 | 1 | 2, string]
  transaction: AtomicBEEF
  /** Where the sender's (randomized) tx put our output; 0 for legacy messages. */
  outputIndex: number
}

export interface ReceivedTransfer extends IncomingTransfer {
  label: string
  decimals: number
}

/** Minimal MessageBox surface receiveTokens needs (keeps the client mockable). */
export interface MessageBoxLike {
  listMessages: (args: { messageBox: string, acceptPayments?: boolean }) => Promise<unknown>
  acknowledgeMessage: (args: { messageIds: string[] }) => Promise<unknown>
}

export interface ReceiveParams {
  wallet: WalletInterface
  messageBoxClient: MessageBoxLike
  /** Only accept transfers of this asset; others are left pending. */
  assetId?: string
  /**
   * Cross-call dedup set of messageIds currently being processed. Callers that
   * poll should pass a long-lived Set so a slow run and a refresh never
   * double-internalize the same message. Failed ids are removed for retry.
   */
  processed?: Set<string>
}

export interface ReceiveResult {
  accepted: ReceivedTransfer[]
  failed: Array<{ messageId: string, error: unknown }>
}

async function acceptOne (
  wallet: WalletInterface,
  messageBoxClient: MessageBoxLike,
  msg: IncomingTransfer
): Promise<ReceivedTransfer> {
  // Trust the transaction, not the body — reject mismatches before any
  // wallet work (throws InvalidTransferError; caller acks + drops).
  verifyIncoming(msg)

  const meta = await resolveAssetMetadata(msg.assetId)
  const label = meta?.label ?? `${msg.assetId.slice(0, 20)}…`
  const decimals = Number(meta?.decimals) || 0

  try {
    await wallet.internalizeAction({
      tx: msg.transaction,
      // Sender key as an action label — survives the output being spent,
      // unlike customInstructions (see history.ts counterparty resolution).
      labels: ['mandala', 'receive', `from-${msg.sender.toLowerCase()}`],
      outputs: [{
        outputIndex: msg.outputIndex,
        protocol: 'basket insertion',
        insertionRemittance: {
          basket: BASKET,
          customInstructions: JSON.stringify({
            protocolID: msg.protocolID,
            keyID: msg.keyID,
            counterparty: msg.sender,
            label
          }),
          tags: ['mandala', 'received', msg.assetId]
        }
      }],
      description: `Receive ${msg.amount} of ${msg.assetId}`
    })
  } catch (e) {
    // Internalize + acknowledge are not atomic: an earlier attempt may have
    // internalized this output and crashed before acknowledging. Treat
    // "already internalized" as success so the acknowledge below completes
    // the transfer instead of the message replaying forever.
    if (!isAlreadyInternalized(e)) throw e
  }
  await messageBoxClient.acknowledgeMessage({ messageIds: [msg.id] })
  return { ...msg, label, decimals }
}

/**
 * Accept every pending incoming transfer. Returns what was internalized and
 * what failed (failed messages stay un-acknowledged for a later retry).
 */
export async function receiveTokens (p: ReceiveParams): Promise<ReceiveResult> {
  const { wallet, messageBoxClient, assetId, processed } = p
  const accepted: ReceivedTransfer[] = []
  const failed: Array<{ messageId: string, error: unknown }> = []

  const messages = await messageBoxClient.listMessages({ messageBox: MESSAGEBOX, acceptPayments: false })
  for (const raw of messages as Array<{ messageId: string, body: any }>) {
    if (assetId != null && raw.body?.assetId !== assetId) continue
    if (processed?.has(raw.messageId) === true) continue
    processed?.add(raw.messageId)
    try {
      accepted.push(await acceptOne(wallet, messageBoxClient, {
        id: raw.messageId,
        assetId: raw.body.assetId,
        amount: raw.body.amount,
        sender: raw.body.sender,
        keyID: raw.body.keyID,
        protocolID: raw.body.protocolID,
        transaction: raw.body.transaction,
        // Senders now randomize output order and say where our output
        // landed; older messages predate the field (recipient was always 0).
        outputIndex: typeof raw.body.outputIndex === 'number' ? raw.body.outputIndex : 0
      }))
    } catch (error) {
      if (error instanceof InvalidTransferError) {
        // Poisoned message (body contradicts its transaction): acknowledge so
        // it never replays, report once. Retrying can't make it valid.
        try {
          await messageBoxClient.acknowledgeMessage({ messageIds: [raw.messageId] })
        } catch {
          processed?.delete(raw.messageId) // ack failed — let a later run drop it
        }
        failed.push({ messageId: raw.messageId, error })
        continue
      }
      // Transient (network/wallet) — one bad transfer shouldn't block the
      // rest; leave un-acknowledged for a later retry.
      processed?.delete(raw.messageId)
      failed.push({ messageId: raw.messageId, error })
    }
  }
  return { accepted, failed }
}
