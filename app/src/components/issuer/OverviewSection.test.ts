import { describe, it, expect, vi } from 'vitest'

// Mock network calls so the module loads in Node test env
vi.mock('../../lib/mandala/adminHistory', () => ({
  resolveAdminHistory: vi.fn().mockResolvedValue([])
}))
vi.mock('../../lib/mandala/adminState', () => ({
  resolveAssetState: vi.fn().mockResolvedValue(null)
}))

describe('OverviewSection smoke', () => {
  it('module is importable', async () => {
    await expect(import('./OverviewSection')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./OverviewSection')
    expect(typeof mod.default).toBe('function')
  })
})
