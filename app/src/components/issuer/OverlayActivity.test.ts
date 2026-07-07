/**
 * Smoke test: OverlayActivity module loads without throwing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: null })
}))

describe('OverlayActivity smoke', () => {
  it('module is importable', async () => {
    await expect(import('./OverlayActivity')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./OverlayActivity')
    expect(typeof mod.default).toBe('function')
  })
})
