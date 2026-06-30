/**
 * Smoke test: TransactionHistory module loads without throwing.
 * @bsv/identity-react is mocked because resolveByIdentityKey transitively pulls
 * in metanet-react-prompt which contains JSX that fails in node vitest.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/identity-react', () => ({
  useIdentitySearch: vi.fn()
}))

vi.mock('@bsv/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bsv/sdk')>()
  return {
    ...actual,
    IdentityClient: vi.fn().mockImplementation(() => ({
      resolveByIdentityKey: vi.fn().mockResolvedValue([])
    }))
  }
})

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: null })
}))

vi.mock('../../lib/mandala/history', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  exportTransactionsCsv: vi.fn().mockReturnValue('txid,assetId,direction,kind,amount,counterparty,when')
}))

describe('TransactionHistory smoke', () => {
  it('module is importable', async () => {
    await expect(import('./TransactionHistory')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./TransactionHistory')
    expect(typeof mod.default).toBe('function')
  })
})
