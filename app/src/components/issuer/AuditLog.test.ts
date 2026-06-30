/**
 * Smoke test: AuditLog module loads without throwing.
 */
import { describe, it, expect } from 'vitest'

describe('AuditLog smoke', () => {
  it('module is importable', async () => {
    await expect(import('./AuditLog')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./AuditLog')
    expect(typeof mod.default).toBe('function')
  })
})
