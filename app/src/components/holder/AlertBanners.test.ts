/**
 * Smoke test: AlertBanners module loads without throwing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/identity-react', () => ({
  useIdentitySearch: vi.fn(),
  resolveByIdentityKey: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: null })
}))

vi.mock('../../lib/mandala/adminState', () => ({
  resolveAssetState: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../lib/mandala/metadata', () => ({
  resolveAssetMetadata: vi.fn().mockResolvedValue(null)
}))

describe('AlertBanners smoke', () => {
  it('module is importable', async () => {
    await expect(import('./AlertBanners')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./AlertBanners')
    expect(typeof mod.default).toBe('function')
  })
})
