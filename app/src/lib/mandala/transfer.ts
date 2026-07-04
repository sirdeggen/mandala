/**
 * Holder → recipient FT transfer pipeline, extracted from the Send screen so
 * the UI layer only orchestrates state. Overlay-first: the tx is built and
 * signed `noSend`, submitted to the overlay (which evaluates the topic-manager
 * rules), and only broadcast to the network after acceptance — a rejection
 * aborts the action and releases its inputs (see submitAndBroadcast).
 *
 * Resolves at the overlay-accept commit point. The messagebox notification to
 * the recipient is awaited separately by the caller-visible `notified` flag —
 * a notify failure never fails the transfer (the tx is already final).
 */
import { Transaction, Beef, WalletInterface } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import type { MessageBoxClient } from '@bsv/message-box-client'
import { BASKET, FT_PROTOCOL, MESSAGEBOX } from './constants'
import { walletMandalaUnlock } from './unlock'
import { revealLinkage } from './tokens'
import { submitAndBroadcast } from './overlay'
import { encodeLinkagePayload } from './encoding'
import { loadFtCandidates } from './ftCandidates'
import { selectFtInputs } from './ftSelect'

export interface TransferParams {
  wallet: WalletInterface
  messageBoxClient: MessageBoxClient
  identityKey: string
  assetId: string
  amount: number
  recipientKey: string
}

export interface TransferResult {
  txid: string
  /** False when the tx committed but the recipient messagebox notify failed. */
  notified: boolean
}

export async function transferTokens (p: TransferParams): Promise<TransferResult> {
  const { wallet, messageBoxClient, identityKey, assetId, amount, recipientKey } = p

  // Token-aware coin selection: confirmed-first, fewest UTXOs (see ftSelect).
  const { candidates, beef: beefBytes } = await loadFtCandidates(wallet as any, assetId)
  const { selected, total: gathered } = selectFtInputs(candidates, amount) // throws if insufficient
  const beef = new Beef()
  beef.mergeBeef(beefBytes)
  const inputs = selected.map(s => ({ outpoint: s.outpoint, unlockingScriptLength: 108, inputDescription: 'spend FT' }))
  const spendInfo = selected.map(s => ({ keyID: s.keyID, counterparty: s.counterparty }))
  const change = gathered - amount

  const keyIDOut = 'xfer-' + Date.now()
  const ftOut = await new MandalaToken(wallet as any).lockBRC29(assetId, amount, FT_PROTOCOL, keyIDOut, recipientKey)
  const outputs: any[] = [{
    satoshis: 1,
    lockingScript: ftOut.toHex(),
    outputDescription: 'FT to recipient',
    customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDOut, counterparty: recipientKey, direction: 'sent', recipient: recipientKey }),
    tags: ['mandala', 'sent', assetId]
  }]

  let keyIDChange = ''
  if (change > 0) {
    keyIDChange = 'change-' + Date.now()
    // Change back to self: use our identity key (hex), not the literal 'self' —
    // the overlay parses linkage.counterparty as a public key (it echoes verbatim).
    const ftChange = await new MandalaToken(wallet as any).lockBRC29(assetId, change, FT_PROTOCOL, keyIDChange, identityKey)
    outputs.push({
      satoshis: 1,
      lockingScript: ftChange.toHex(),
      outputDescription: 'FT change',
      basket: BASKET,
      customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: identityKey })
    })
  }

  const created = await wallet.createAction({
    description: `Send ${amount} of ${assetId}`,
    labels: ['mandala', 'transfer'],
    inputBEEF: beef.toBinary(),
    inputs,
    outputs,
    options: { randomizeOutputs: false }
  })

  if (!created.signableTransaction) throw new Error('createAction returned no signableTransaction')

  const tx = Transaction.fromBEEF(created.signableTransaction.tx as number[])
  for (let i = 0; i < spendInfo.length; i++) {
    tx.inputs[i].unlockingScriptTemplate = walletMandalaUnlock(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty)
  }
  await tx.sign()

  const spends: Record<string, { unlockingScript: string }> = {}
  for (let i = 0; i < spendInfo.length; i++) {
    const hex = tx.inputs[i].unlockingScript?.toHex()
    if (!hex) throw new Error(`Missing unlocking script for input ${i}`)
    spends[String(i)] = { unlockingScript: hex }
  }

  const signed = await wallet.signAction({
    reference: created.signableTransaction.reference,
    spends,
    options: { noSend: true } // hold — broadcast only after the overlay accepts
  })

  // Build offChain linkage payload
  const linkOut = await revealLinkage(wallet as any, keyIDOut, recipientKey)
  const outLinks: Array<{ index: number, linkage: any }> = [{ index: 0, linkage: linkOut }]
  if (change > 0) {
    outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, identityKey) })
  }
  // Reveal linkage for each spent FT input so the overlay can screen senders
  // under access mode (A6 gate 3).
  const inLinks: Array<{ index: number, linkage: any }> = []
  for (let i = 0; i < spendInfo.length; i++) {
    inLinks.push({ index: i, linkage: await revealLinkage(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty) })
  }
  const offChainValues = encodeLinkagePayload({ inputs: inLinks, outputs: outLinks })
  // Overlay gates: submit first; broadcast only on acceptance, else abort + throw.
  const txid = signed.txid ?? Transaction.fromBEEF(signed.tx as number[]).id('hex')
  await submitAndBroadcast(wallet as any, { tx: signed.tx as number[], txid }, offChainValues, created.signableTransaction.reference)

  // The tx is committed (overlay accepted); a notify failure must not undo it.
  let notified = true
  try {
    await messageBoxClient.sendMessage({
      recipient: recipientKey,
      messageBox: MESSAGEBOX,
      body: {
        assetId,
        amount,
        transaction: signed.tx,
        keyID: keyIDOut,
        protocolID: FT_PROTOCOL,
        sender: identityKey
      }
    })
  } catch (e) {
    console.warn('[mandala] transfer committed but recipient notify failed:', e)
    notified = false
  }

  return { txid, notified }
}
