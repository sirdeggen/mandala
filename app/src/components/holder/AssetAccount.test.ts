/**
 * Smoke test: AssetAccount module loads without throwing.
 * Mocks all child components that have problematic transitive deps.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/identity-react', () => ({
  useIdentitySearch: () => ({
    inputValue: '',
    identities: [],
    isLoading: false,
    selectedIdentity: null,
    handleInputChange: vi.fn(),
    handleSelect: vi.fn()
  })
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
  useWallet: () => ({ wallet: null, identityKey: null, messageBoxClient: null, isIssuer: false, isInitialized: true, error: null })
}))

vi.mock('../../lib/mandala/adminState', () => ({
  resolveAssetState: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../lib/mandala/history', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  exportTransactionsCsv: vi.fn().mockReturnValue('')
}))

vi.mock('../../lib/mandala/metadata', () => ({
  resolveAssetMetadata: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../lib/mandala/qr', () => ({
  toQrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,abc')
}))

vi.mock('../../lib/mandala/tokens', () => ({
  decodeBalances: vi.fn().mockReturnValue([])
}))

describe('AssetAccount smoke', () => {
  it('module is importable', async () => {
    await expect(import('./AssetAccount')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./AssetAccount')
    expect(typeof mod.default).toBe('function')
  })
})
