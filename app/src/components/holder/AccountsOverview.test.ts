/**
 * Smoke test: AccountsOverview module loads without throwing.
 * @bsv/identity-react is mocked because it pulls in metanet-react-prompt
 * which contains JSX that fails in the node vitest environment.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/identity-react', () => ({
  useIdentitySearch: vi.fn(),
  resolveByIdentityKey: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: null })
}))

vi.mock('../../lib/mandala/tokens', () => ({
  decodeBalances: vi.fn().mockReturnValue([])
}))

vi.mock('../../lib/mandala/history', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  exportTransactionsCsv: vi.fn().mockReturnValue('')
}))

vi.mock('../../lib/mandala/metadata', () => ({
  resolveAssetMetadata: vi.fn().mockResolvedValue(null)
}))

describe('AccountsOverview smoke', () => {
  it('module is importable', async () => {
    await expect(import('./AccountsOverview')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./AccountsOverview')
    expect(typeof mod.default).toBe('function')
  })
})
