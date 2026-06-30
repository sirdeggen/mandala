/**
 * Smoke test: IssuerDashboard module loads without throwing.
 * @bsv/identity-react is mocked because it pulls in metanet-react-prompt
 * which contains JSX that fails in the node vitest environment.
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

describe('IssuerDashboard smoke', () => {
  it('module is importable', async () => {
    await expect(import('./IssuerDashboard')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./IssuerDashboard')
    expect(typeof mod.default).toBe('function')
  })
})
