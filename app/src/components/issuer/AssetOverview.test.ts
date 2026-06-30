/**
 * Smoke test: AssetOverview module loads without throwing.
 * In the node test environment (no DOM), we verify the module exports are
 * non-null and the component function is defined.
 */
import { describe, it, expect } from 'vitest'

// The module itself should import cleanly (no side-effects at module level
// that would throw in a node environment).
describe('AssetOverview smoke', () => {
  it('module is importable', async () => {
    // Dynamic import avoids top-level JSX evaluation issues in node env.
    // We just assert it resolves without throwing.
    await expect(import('./AssetOverview')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./AssetOverview')
    expect(typeof mod.default).toBe('function')
  })
})
