/**
 * Smoke test: ContactsPage module loads without throwing.
 * Mocks wallet context, contactsStore, and @bsv/sdk IdentityClient.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bsv/sdk')>()
  return {
    ...actual,
    IdentityClient: vi.fn().mockImplementation(() => ({
      resolveByAttributes: vi.fn().mockResolvedValue([])
    }))
  }
})

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: null, isInitialized: true, error: null })
}))

vi.mock('../../lib/mandala/contactsStore', () => ({
  listContacts: vi.fn().mockResolvedValue([]),
  saveContact: vi.fn().mockResolvedValue({ txid: 'abc123' }),
  removeContact: vi.fn().mockResolvedValue(undefined)
}))

describe('ContactsPage smoke', () => {
  it('module is importable', async () => {
    await expect(import('./ContactsPage')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./ContactsPage')
    expect(typeof mod.default).toBe('function')
  })
})
