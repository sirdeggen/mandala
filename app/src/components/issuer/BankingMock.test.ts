/**
 * Smoke test: BankingMock module loads without throwing.
 */
import { describe, it, expect } from 'vitest'

describe('BankingMock smoke', () => {
  it('module is importable', async () => {
    await expect(import('./BankingMock')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./BankingMock')
    expect(typeof mod.default).toBe('function')
  })
})
