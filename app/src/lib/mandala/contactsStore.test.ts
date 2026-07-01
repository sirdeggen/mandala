/**
 * contactsStore.test.ts
 *
 * Tests for the wallet-native contacts store.
 *
 * Strategy (mirroring assets.test.ts):
 *   - Pure arg-builder helpers (buildSaveContactArgs, buildRemoveContactArgs)
 *     are tested with no wallet needed.
 *   - listContacts is tested against a mocked wallet.listOutputs.
 *   - saveContact and removeContact are tested by asserting createAction args
 *     (via a mock wallet); the tx.sign() path is skipped by having
 *     createAction return a txid directly (no signableTransaction).
 */

import { describe, it, expect, vi } from 'vitest'
import {
  StoredContact,
  CONTACTS_BASKET,
  contactKeyID,
  contactToFields,
  buildSaveContactArgs,
  buildRemoveContactArgs,
  listContacts,
  saveContact,
  removeContact
} from './contactsStore'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTACT_A: StoredContact = {
  identityKey: '02aabbccdd' + '00'.repeat(28),
  name: 'Alice',
  email: 'alice@example.com'
}

const CONTACT_B: StoredContact = {
  identityKey: '03112233ff' + '00'.repeat(28),
  name: 'Bob'
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('contactKeyID', () => {
  it('uses the first 16 chars of the identityKey', () => {
    expect(contactKeyID(CONTACT_A.identityKey)).toBe('contact-' + CONTACT_A.identityKey.slice(0, 16))
  })
})

describe('contactToFields', () => {
  it('round-trips a contact through UTF-8 bytes', () => {
    const fields = contactToFields(CONTACT_A)
    expect(fields).toHaveLength(1)
    const decoded = Buffer.from(fields[0]).toString('utf8')
    expect(JSON.parse(decoded)).toMatchObject({ identityKey: CONTACT_A.identityKey, name: 'Alice' })
  })
})

// ---------------------------------------------------------------------------
// buildSaveContactArgs
// ---------------------------------------------------------------------------

describe('buildSaveContactArgs', () => {
  it('create-only: no inputs, one output in CONTACTS_BASKET with correct CI', () => {
    const args = buildSaveContactArgs(CONTACT_A, 'fakeLockHex')

    expect(args.inputs).toBeUndefined()
    expect(args.inputBEEF).toBeUndefined()
    expect(args.outputs).toHaveLength(1)

    const out = args.outputs[0]
    expect(out.basket).toBe(CONTACTS_BASKET)
    expect(out.lockingScript).toBe('fakeLockHex')
    expect(JSON.parse(out.customInstructions)).toMatchObject({
      identityKey: CONTACT_A.identityKey,
      name: 'Alice'
    })
    expect(out.tags).toContain('mandala')
    expect(out.tags).toContain('contact')
    expect(args.options.randomizeOutputs).toBe(false)
    expect(args.labels).toContain('contact-save')
  })

  it('replace: includes input with outpoint + inputBEEF', () => {
    const existing = { outpoint: 'prevTxid.0', beef: [1, 2, 3] }
    const args = buildSaveContactArgs(CONTACT_A, 'fakeLockHex', existing)

    expect(args.inputs).toHaveLength(1)
    expect(args.inputs![0].outpoint).toBe('prevTxid.0')
    expect(args.inputs![0].inputDescription).toContain('replace')
    expect(args.inputBEEF).toEqual([1, 2, 3])
    expect(args.outputs).toHaveLength(1)
    expect(args.description).toContain('update')
  })
})

// ---------------------------------------------------------------------------
// buildRemoveContactArgs
// ---------------------------------------------------------------------------

describe('buildRemoveContactArgs', () => {
  it('produces one input per outpoint with the BEEF', () => {
    const outpoints = ['txA.0', 'txB.1']
    const beef = [10, 20, 30]
    const args = buildRemoveContactArgs(CONTACT_A.identityKey, outpoints, beef)

    expect(args.inputs).toHaveLength(2)
    expect(args.inputs[0].outpoint).toBe('txA.0')
    expect(args.inputs[1].outpoint).toBe('txB.1')
    expect(args.inputBEEF).toEqual(beef)
    expect(args.labels).toContain('contact-remove')
    expect(args.options.randomizeOutputs).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Minimal mock wallet
// ---------------------------------------------------------------------------

function makeMockWallet (overrides: Partial<{
  listOutputsLockingScripts: any[]
  listOutputsBEEF: number[]
  createActionResult: any
}> = {}) {
  const {
    listOutputsLockingScripts = [],
    listOutputsBEEF = [0xbe, 0xef],
    createActionResult = { txid: 'deadbeef01' + '00'.repeat(27) }
  } = overrides

  const wallet = {
    listOutputs: vi.fn(async (args: any) => {
      if (args.include === 'entire transactions') {
        return { outputs: [], BEEF: listOutputsBEEF }
      }
      // 'locking scripts' mode
      return { outputs: listOutputsLockingScripts }
    }),
    createAction: vi.fn(async (_args: any) => createActionResult),
    signAction: vi.fn(async (_args: any) => ({ txid: 'signedTxid' + '00'.repeat(27), tx: [1] })),
    getPublicKey: vi.fn(async () => ({ publicKey: '02' + '00'.repeat(32) })),
    createSignature: vi.fn(async () => ({ signature: new Uint8Array(71) }))
  }
  return wallet
}

// ---------------------------------------------------------------------------
// listContacts
// ---------------------------------------------------------------------------

describe('listContacts', () => {
  it('returns empty array when basket is empty', async () => {
    const wallet = makeMockWallet({ listOutputsLockingScripts: [] })
    const result = await listContacts(wallet as any)
    expect(result).toEqual([])
  })

  it('parses contacts from customInstructions', async () => {
    const outputs = [
      { outpoint: 'tx1.0', customInstructions: JSON.stringify(CONTACT_A), lockingScript: '76a9' },
      { outpoint: 'tx2.0', customInstructions: JSON.stringify(CONTACT_B), lockingScript: '76a9' }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })
    const result = await listContacts(wallet as any)
    expect(result).toHaveLength(2)
    expect(result.map(c => c.identityKey)).toContain(CONTACT_A.identityKey)
    expect(result.map(c => c.identityKey)).toContain(CONTACT_B.identityKey)
  })

  it('dedupes by identityKey — last output wins', async () => {
    const contactAv2: StoredContact = { ...CONTACT_A, name: 'Alice Updated' }
    const outputs = [
      { outpoint: 'tx1.0', customInstructions: JSON.stringify(CONTACT_A), lockingScript: '76a9' },
      { outpoint: 'tx2.0', customInstructions: JSON.stringify(contactAv2), lockingScript: '76a9' }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })
    const result = await listContacts(wallet as any)
    // Only one entry for the same identityKey; the last one (index 1) wins.
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Alice Updated')
  })

  it('skips outputs with missing or malformed customInstructions', async () => {
    const outputs = [
      { outpoint: 'tx1.0', customInstructions: null, lockingScript: '76a9' },
      { outpoint: 'tx2.0', customInstructions: 'not-json', lockingScript: '76a9' },
      { outpoint: 'tx3.0', customInstructions: JSON.stringify({ foo: 'bar' }), lockingScript: '76a9' },
      { outpoint: 'tx4.0', customInstructions: JSON.stringify(CONTACT_B), lockingScript: '76a9' }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })
    const result = await listContacts(wallet as any)
    expect(result).toHaveLength(1)
    expect(result[0].identityKey).toBe(CONTACT_B.identityKey)
  })
})

// ---------------------------------------------------------------------------
// saveContact
// ---------------------------------------------------------------------------

describe('saveContact', () => {
  it('calls createAction with CONTACTS_BASKET output and correct customInstructions', async () => {
    // No existing outputs → create-only path.
    const wallet = makeMockWallet({ listOutputsLockingScripts: [] })

    // Mock PushDrop to avoid real crypto in unit tests.
    const mockLock = vi.fn(async () => ({ toHex: () => 'pushdropLockHex' }))
    vi.doMock('@bsv/sdk', async (importOriginal) => {
      const actual = await importOriginal() as any
      return {
        ...actual,
        PushDrop: class {
          constructor (_w: any) {}
          lock = mockLock
          unlock () { return { sign: async () => ({ toHex: () => '' }), estimateLength: async () => 73 } }
        }
      }
    })

    // Because vi.doMock only affects future imports, we test the args that
    // createAction receives instead (the observable side-effect).
    // We call saveContact and assert on createAction's first call args.
    const result = await saveContact(wallet as any, CONTACT_A)

    // createAction must have been called at least once for the save.
    expect(wallet.createAction).toHaveBeenCalled()

    const callArgs = wallet.createAction.mock.calls[0][0] as any
    // Must have an output in the contacts basket.
    const contactOutput = callArgs.outputs?.find((o: any) => o.basket === CONTACTS_BASKET)
    expect(contactOutput).toBeDefined()
    expect(contactOutput.satoshis).toBe(1)

    // customInstructions must round-trip the contact.
    const ci = JSON.parse(contactOutput.customInstructions)
    expect(ci.identityKey).toBe(CONTACT_A.identityKey)
    expect(ci.name).toBe('Alice')
    expect(ci.email).toBe('alice@example.com')

    expect(callArgs.options?.randomizeOutputs).toBe(false)
    expect(callArgs.labels).toContain('contact-save')

    expect(result.txid).toBeTruthy()

    vi.doUnmock('@bsv/sdk')
  })

  it('includes the existing outpoint as an input when replacing', async () => {
    // Return an existing contact output in the basket.
    const existingOutputs = [
      {
        outpoint: 'existingTx.0',
        customInstructions: JSON.stringify(CONTACT_A),
        lockingScript: '76a9'
      }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: existingOutputs })

    await saveContact(wallet as any, { ...CONTACT_A, name: 'Alice v2' })

    // Find the createAction call that has inputs (the replace call).
    const replaceCalls = wallet.createAction.mock.calls.filter(
      (call: any[]) => call[0].inputs != null && call[0].inputs.length > 0
    )
    expect(replaceCalls.length).toBeGreaterThan(0)

    const replaceArgs = replaceCalls[0][0] as any
    expect(replaceArgs.inputs[0].outpoint).toBe('existingTx.0')
    expect(replaceArgs.inputs[0].inputDescription).toContain('replace')
    expect(replaceArgs.inputBEEF).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// removeContact
// ---------------------------------------------------------------------------

describe('removeContact', () => {
  it('does nothing when no outputs match the identityKey', async () => {
    const outputs = [
      { outpoint: 'tx1.0', customInstructions: JSON.stringify(CONTACT_B), lockingScript: '76a9' }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })
    await removeContact(wallet as any, CONTACT_A.identityKey)
    // createAction should NOT be called if there is nothing to remove.
    expect(wallet.createAction).not.toHaveBeenCalled()
  })

  it('issues a spend of the matching outpoint', async () => {
    const outputs = [
      {
        outpoint: 'matchedTx.0',
        customInstructions: JSON.stringify(CONTACT_A),
        lockingScript: '76a9' + '14' + '00'.repeat(20) + '88ac'
      }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })

    await removeContact(wallet as any, CONTACT_A.identityKey)

    expect(wallet.createAction).toHaveBeenCalled()
    const callArgs = wallet.createAction.mock.calls[0][0] as any
    expect(callArgs.inputs).toHaveLength(1)
    expect(callArgs.inputs[0].outpoint).toBe('matchedTx.0')
    expect(callArgs.labels).toContain('contact-remove')
  })

  it('spends all matching outpoints when multiple duplicates exist', async () => {
    const outputs = [
      {
        outpoint: 'dup1.0',
        customInstructions: JSON.stringify(CONTACT_A),
        lockingScript: '76a9'
      },
      {
        outpoint: 'dup2.0',
        customInstructions: JSON.stringify(CONTACT_A),
        lockingScript: '76a9'
      }
    ]
    const wallet = makeMockWallet({ listOutputsLockingScripts: outputs })

    await removeContact(wallet as any, CONTACT_A.identityKey)

    const callArgs = wallet.createAction.mock.calls[0][0] as any
    expect(callArgs.inputs).toHaveLength(2)
    const outpoints = callArgs.inputs.map((i: any) => i.outpoint)
    expect(outpoints).toContain('dup1.0')
    expect(outpoints).toContain('dup2.0')
  })
})
