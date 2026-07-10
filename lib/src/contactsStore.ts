/**
 * contactsStore.ts — wallet-native managed contacts via PushDrop + WalletClient.
 *
 * Contacts live as wallet-owned PushDrop outputs in CONTACTS_BASKET.
 * The record is stored as JSON in `customInstructions` (the wallet-native
 * readable field); the PushDrop output makes each contact a real spendable UTXO.
 *
 * Public API:
 *   listContacts(wallet)                → Promise<StoredContact[]>
 *   saveContact(wallet, contact)        → Promise<{ txid: string }>
 *   removeContact(wallet, identityKey)  → Promise<void>
 */

import { PushDrop, Utils, Transaction, WalletProtocol, WalletInterface, LockingScript } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTACTS_BASKET = 'mandala-contacts'
export const CONTACTS_PROTOCOL: WalletProtocol = [2, 'mandala contacts']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredContact {
  identityKey: string
  name: string
  email?: string
  handle?: string
  note?: string
  avatarURL?: string
  badgeLabel?: string
}

// ---------------------------------------------------------------------------
// Pure arg-builder helpers — unit-testable without wallet/signing machinery.
// ---------------------------------------------------------------------------

/** Returns the keyID string for a given identityKey. */
export function contactKeyID (identityKey: string): string {
  return 'contact-' + identityKey.slice(0, 16)
}

/** Serialise a StoredContact to UTF-8 byte array for PushDrop fields. */
export function contactToFields (contact: StoredContact): number[][] {
  return [Utils.toArray(JSON.stringify(contact), 'utf8')]
}

export interface ContactSaveArgs {
  description: string
  labels: string[]
  outputs: Array<{
    satoshis: number
    lockingScript: string
    outputDescription: string
    basket: string
    customInstructions: string
    tags: string[]
  }>
  options: { randomizeOutputs: boolean }
  /** Present when replacing an existing output. */
  inputBEEF?: number[]
  inputs?: Array<{
    outpoint: string
    unlockingScriptLength: number
    inputDescription: string
  }>
}

/**
 * Pure builder: given a lockingScript hex and optional existing outpoint to
 * replace, returns the createAction args for saveContact.
 */
export function buildSaveContactArgs (
  contact: StoredContact,
  lockingScriptHex: string,
  existing?: { outpoint: string, beef: number[] }
): ContactSaveArgs {
  const ci = JSON.stringify(contact)
  const output = {
    satoshis: 1,
    lockingScript: lockingScriptHex,
    outputDescription: 'contact record',
    basket: CONTACTS_BASKET,
    customInstructions: ci,
    tags: ['mandala', 'contact']
  }

  if (existing != null) {
    return {
      description: `update contact ${contact.name}`,
      labels: ['mandala', 'contact-save'],
      inputBEEF: existing.beef,
      inputs: [{
        outpoint: existing.outpoint,
        unlockingScriptLength: 74,
        inputDescription: 'replace contact'
      }],
      outputs: [output],
      options: { randomizeOutputs: false }
    }
  }

  return {
    description: `save contact ${contact.name}`,
    labels: ['mandala', 'contact-save'],
    outputs: [output],
    options: { randomizeOutputs: false }
  }
}

export interface ContactRemoveArgs {
  description: string
  labels: string[]
  inputBEEF: number[]
  inputs: Array<{
    outpoint: string
    unlockingScriptLength: number
    inputDescription: string
  }>
  options: { randomizeOutputs: boolean }
}

/**
 * Pure builder: given the outpoints to remove and their BEEF, returns the
 * createAction args for removeContact.
 */
export function buildRemoveContactArgs (
  identityKey: string,
  outpoints: string[],
  beef: number[]
): ContactRemoveArgs {
  return {
    description: `remove contact ${identityKey.slice(0, 12)}`,
    labels: ['mandala', 'contact-remove'],
    inputBEEF: beef,
    inputs: outpoints.map(op => ({
      outpoint: op,
      unlockingScriptLength: 74,
      inputDescription: 'remove contact'
    })),
    options: { randomizeOutputs: false }
  }
}

// ---------------------------------------------------------------------------
// listContacts — read from wallet basket
// ---------------------------------------------------------------------------

/**
 * List all stored contacts, deduped by identityKey (latest wins).
 * Records are read from customInstructions, which the wallet stores
 * alongside each PushDrop output in CONTACTS_BASKET.
 */
export async function listContacts (wallet: WalletInterface): Promise<StoredContact[]> {
  const res = await wallet.listOutputs({
    basket: CONTACTS_BASKET,
    include: 'locking scripts',
    includeCustomInstructions: true,
    limit: 1000
  })

  // Use a Map to dedupe — last entry for each identityKey wins.
  const map = new Map<string, StoredContact>()
  for (const o of res.outputs) {
    const ci = (o as { customInstructions?: string }).customInstructions
    if (ci == null || ci === '') continue
    try {
      const parsed = JSON.parse(ci) as Partial<StoredContact>
      if (typeof parsed.identityKey !== 'string' || parsed.identityKey === '') continue
      map.set(parsed.identityKey, parsed as StoredContact)
    } catch {
      // skip malformed records
    }
  }

  return [...map.values()]
}

// ---------------------------------------------------------------------------
// saveContact — create or replace a contact output
// ---------------------------------------------------------------------------

/**
 * Save (or update) a contact. If an existing output for the same identityKey
 * is found, it is spent in the same action so the record is replaced, not
 * duplicated. Falls back to create-only if BEEF is unavailable; deduplication
 * via listContacts still works in that case.
 */
export async function saveContact (
  wallet: WalletInterface,
  contact: StoredContact
): Promise<{ txid: string }> {
  const keyID = contactKeyID(contact.identityKey)

  // Build the PushDrop locking script.
  const fields = contactToFields(contact)
  const lockingScript = await new PushDrop(wallet).lock(
    fields, CONTACTS_PROTOCOL, keyID, 'self', true, false
  )
  const lockingScriptHex = lockingScript.toHex()

  // Look for an existing output to replace.
  let existing: { outpoint: string, beef: number[] } | undefined

  try {
    const scriptRes = await wallet.listOutputs({
      basket: CONTACTS_BASKET,
      include: 'locking scripts',
      includeCustomInstructions: true,
      limit: 1000
    })
    const beefRes = await wallet.listOutputs({
      basket: CONTACTS_BASKET,
      include: 'entire transactions',
      limit: 1000
    })

    for (const o of scriptRes.outputs) {
      const ci = (o as { customInstructions?: string }).customInstructions
      if (ci == null) continue
      try {
        const parsed = JSON.parse(ci) as Partial<StoredContact>
        if (parsed.identityKey === contact.identityKey) {
          const beef = beefRes.BEEF
          if (beef != null) {
            existing = { outpoint: o.outpoint as string, beef: beef as number[] }
          }
          break
        }
      } catch { /* skip */ }
    }
  } catch {
    // If we can't look up existing outputs, proceed with create-only.
  }

  const actionArgs = buildSaveContactArgs(contact, lockingScriptHex, existing)

  if (existing != null) {
    // Replace path: spend prior output + create new one in a single action.
    const created = await wallet.createAction(actionArgs as any)
    if (created.signableTransaction == null) {
      // No signing needed (wallet auto-signed) or error.
      return { txid: (created as any).txid ?? '' }
    }

    const tx = Transaction.fromBEEF(created.signableTransaction.tx as number[])
    const pd = new PushDrop(wallet)
    tx.inputs[0].unlockingScriptTemplate = pd.unlock(
      CONTACTS_PROTOCOL, keyID, 'self', 'all', false
    )
    await tx.sign()

    const signed = await wallet.signAction({
      reference: created.signableTransaction.reference,
      spends: { '0': { unlockingScript: tx.inputs[0].unlockingScript!.toHex() } }
    })

    if (signed.txid == null) throw new Error('saveContact: signAction returned no txid')
    return { txid: signed.txid }
  }

  // Create-only path (no existing output found).
  const created = await wallet.createAction(actionArgs as any)
  if (created.txid != null) return { txid: created.txid }
  if (created.signableTransaction != null) {
    // Wallet required signing even for a create-only action (unusual but handle it).
    const signed = await wallet.signAction({
      reference: created.signableTransaction.reference,
      spends: {}
    })
    return { txid: signed.txid ?? '' }
  }
  throw new Error('saveContact: createAction returned neither txid nor signableTransaction')
}

// ---------------------------------------------------------------------------
// removeContact — spend all outputs for the given identityKey
// ---------------------------------------------------------------------------

/**
 * Remove a contact by spending all its outputs from CONTACTS_BASKET.
 * Mirrors the spend pattern used by submitAdminAction in assets.ts.
 */
export async function removeContact (
  wallet: WalletInterface,
  identityKey: string
): Promise<void> {
  const scriptRes = await wallet.listOutputs({
    basket: CONTACTS_BASKET,
    include: 'locking scripts',
    includeCustomInstructions: true,
    limit: 1000
  })
  const beefRes = await wallet.listOutputs({
    basket: CONTACTS_BASKET,
    include: 'entire transactions',
    limit: 1000
  })

  if (beefRes.BEEF == null) throw new Error('removeContact: listOutputs returned no BEEF')

  // Find matching outpoints.
  const outpointsToRemove: string[] = []
  for (const o of scriptRes.outputs) {
    const ci = (o as { customInstructions?: string }).customInstructions
    if (ci == null) continue
    try {
      const parsed = JSON.parse(ci) as Partial<StoredContact>
      if (parsed.identityKey === identityKey) {
        outpointsToRemove.push(o.outpoint as string)
      }
    } catch { /* skip */ }
  }

  if (outpointsToRemove.length === 0) return // nothing to remove

  const keyID = contactKeyID(identityKey)
  const actionArgs = buildRemoveContactArgs(identityKey, outpointsToRemove, beefRes.BEEF as number[])

  const created = await wallet.createAction(actionArgs as any)
  if (created.signableTransaction == null) return // auto-signed or done

  const tx = Transaction.fromBEEF(created.signableTransaction.tx as number[])
  const pd = new PushDrop(wallet)

  // Find the locking script for the output being spent so PushDrop.unlock can
  // use it for sighash computation. We need the script from scriptRes.
  for (let i = 0; i < outpointsToRemove.length; i++) {
    const outpoint = outpointsToRemove[i]
    const matchedOutput = scriptRes.outputs.find(o => o.outpoint === outpoint)
    const lockingScriptHex = matchedOutput != null
      ? (matchedOutput as { lockingScript?: string }).lockingScript
      : undefined
    const lockScript = lockingScriptHex != null
      ? LockingScript.fromHex(lockingScriptHex)
      : undefined

    tx.inputs[i].unlockingScriptTemplate = pd.unlock(
      CONTACTS_PROTOCOL, keyID, 'self', 'all', false, 1, lockScript
    )
  }
  await tx.sign()

  const spends: Record<string, { unlockingScript: string }> = {}
  for (let i = 0; i < outpointsToRemove.length; i++) {
    spends[String(i)] = { unlockingScript: tx.inputs[i].unlockingScript!.toHex() }
  }

  await wallet.signAction({
    reference: created.signableTransaction.reference,
    spends
  })
}
