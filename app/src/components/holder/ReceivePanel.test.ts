/**
 * Smoke test: ReceivePanel module loads without throwing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@bsv/identity-react', () => ({
  useIdentitySearch: vi.fn(),
  resolveByIdentityKey: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => ({ wallet: null, identityKey: '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab' })
}))

vi.mock('../../lib/mandala/qr', () => ({
  toQrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,abc')
}))

describe('ReceivePanel smoke', () => {
  it('module is importable', async () => {
    await expect(import('./ReceivePanel')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./ReceivePanel')
    expect(typeof mod.default).toBe('function')
  })
})
