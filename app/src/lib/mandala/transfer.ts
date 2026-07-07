/**
 * Holder → recipient FT transfer pipeline, extracted from the Send screen so
 * the UI layer only orchestrates state. Overlay-first: the tx is built and
 * signed `noSend`, submitted to the overlay (which evaluates the topic-manager
 * rules), and only broadcast to the network after acceptance — a rejection
 * aborts the action and releases its inputs (see submitAndBroadcast).
 *
 * Privacy shape: change is split across several outputs (see ftChange.ts —
 * the wallet-toolbox change-spread ported to token units) and output order is
 * randomized by the wallet, so an observer cannot tell recipient from change
 * by position or by amount. Final output indices are recovered by matching
 * locking scripts (matchOutputIndices) and the recipient learns theirs from
 * the messagebox body.
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
import { revealLinkage, matchOutputIndices } from './tokens'
import { submitAndBroadcast } from './overlay'
import { encodeLinkagePayload } from './encoding'
import { loadFtCandidates } from './ftCandidates'
import { selectFtInputs } from './ftSelect'
import { generateFtChange } from './ftChange'

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

  // Split change across several outputs, spreading the per-asset UTXO pool
  // toward its target size exactly as the toolbox does for satoshis.
  const changeAmounts = generateFtChange({
    change,
    poolCount: candidates.length,
    inputCount: selected.length
  })

  const stamp = Date.now()
  const keyIDOut = 'xfer-' + stamp
  const ftOut = await new MandalaToken(wallet as any).lockBRC29(assetId, amount, FT_PROTOCOL, keyIDOut, recipientKey)
  const recipientScript = ftOut.toHex()

  // One keyID per change output (the loop index keeps same-millisecond keyIDs
  // unique — colliding keyIDs would reuse keys and produce byte-identical
  // scripts, breaking index matching below).
  const changePlans: Array<{ keyID: string, amount: number, script: string }> = []
  for (let i = 0; i < changeAmounts.length; i++) {
    const keyID = `change-${stamp}-${i}`
    // Change back to self: use our identity key (hex), not the literal 'self' —
    // the overlay parses linkage.counterparty as a public key (it echoes verbatim).
    const script = await new MandalaToken(wallet as any).lockBRC29(assetId, changeAmounts[i], FT_PROTOCOL, keyID, identityKey)
    changePlans.push({ keyID, amount: changeAmounts[i], script: script.toHex() })
  }

  const outputs: any[] = [{
    satoshis: 1,
    lockingScript: recipientScript,
    outputDescription: 'FT to recipient',
    customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDOut, counterparty: recipientKey, direction: 'sent', recipient: recipientKey }),
    tags: ['mandala', 'sent', assetId]
  }]
  for (const plan of changePlans) {
    outputs.push({
      satoshis: 1,
      lockingScript: plan.script,
      outputDescription: 'FT change',
      basket: BASKET,
      // direction/recipient/sentAmount give history classification the send
      // context even when the recipient output (not basket-tracked) drops out
      // of listActions — change outputs are the ones the wallet always keeps.
      // Every change output carries the FULL sentAmount (history reads the
      // first one it finds; per-output values would under-report).
      customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: plan.keyID, counterparty: identityKey, direction: 'change', recipient: recipientKey, sentAmount: amount })
    })
  }

  const created = await wallet.createAction({
    description: `Send ${amount} of ${assetId}`,
    // The recipient key rides as an action label: output customInstructions
    // are erased when the output is later spent/relinquished, but labels stay
    // with the action for good — history reads the counterparty from here.
    labels: ['mandala', 'transfer', `to-${recipientKey.toLowerCase()}`],
    inputBEEF: beef.toBinary(),
    inputs,
    outputs
    // No randomizeOutputs:false — let the wallet shuffle output order so
    // position reveals nothing about which output pays the counterparty.
  })

  if (!created.signableTransaction) throw new Error('createAction returned no signableTransaction')

  const tx = Transaction.fromBEEF(created.signableTransaction.tx as number[])

  // Recover where the shuffle put each planned output.
  const [recipientIndex, ...changeIndices] =
    matchOutputIndices(tx, [recipientScript, ...changePlans.map(c => c.script)])

  // Input order is caller order (randomizeOutputs only shuffles outputs).
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

  // Build offChain linkage payload. Every FT output needs its own entry (an
  // unlinked FT output is skipped by the overlay and breaks conservation);
  // inputs are revealed so the overlay can screen senders under access mode
  // (A6 gate 3). The reveals are independent wallet calls — run them together.
  const [linkOut, ...restLinks] = await Promise.all([
    revealLinkage(wallet as any, keyIDOut, recipientKey),
    ...changePlans.map(async c => await revealLinkage(wallet as any, c.keyID, identityKey)),
    ...spendInfo.map(async s => await revealLinkage(wallet as any, s.keyID, s.counterparty))
  ])
  const changeLinks = restLinks.slice(0, changePlans.length)
  const inputLinks = restLinks.slice(changePlans.length)
  const outLinks = [
    { index: recipientIndex, linkage: linkOut },
    ...changeLinks.map((linkage, i) => ({ index: changeIndices[i], linkage }))
  ]
  const inLinks = inputLinks.map((linkage, i) => ({ index: i, linkage }))
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
        // With randomized output order the recipient can no longer assume
        // their output sits at index 0 — tell them where it landed.
        outputIndex: recipientIndex,
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
