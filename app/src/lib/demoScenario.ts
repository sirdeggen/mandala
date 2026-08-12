/**
 * One-click demo scenario for the hero walkthrough: a Swiss bank issuing a
 * CHF-pegged stablecoin. Populates the instrument-agnostic context (connected
 * integrations, screened holders, issuer entity) so every compliance surface is
 * coherent and non-empty before the presenter runs the live on-chain steps
 * (register, deposit-to-mint, attest, redeem). Instrument-specific data
 * (reserves, attestations) is created live because it keys on the real on-chain
 * assetId. Reset clears the demo stores back to defaults.
 */
import { addConnection, providerById } from './integrations'
import { screenHolder, setKyc } from './compliance'
import { updateProfile } from './onboarding'

const SEEDED_FLAG = 'underwrite.demoSeeded'

// Integrations to connect so relabels and licensing light up.
const CONNECTIONS: { providerId: string; environment: 'production' | 'sandbox' }[] = [
  { providerId: 'finma', environment: 'production' },
  { providerId: 'complyadvantage', environment: 'sandbox' },
  { providerId: 'fireblocks', environment: 'production' },
  { providerId: 'modern-treasury', environment: 'production' },
]

// Screened holders. One name matches the sample sanctions watchlist so it is a
// guaranteed hit; the rest are verified, giving the compliance signals context.
const HOLDERS: { key: string; name: string; kyc: 'verified' | 'rejected' }[] = [
  { key: '02' + 'a1b2c3d4e5f60718'.repeat(4), name: 'Sanctioned Entity Holdings', kyc: 'rejected' },
  { key: '02' + '1122334455667788'.repeat(4), name: 'Helvetia Pension Fund', kyc: 'verified' },
  { key: '02' + '99aa88bb77cc66dd'.repeat(4), name: 'Alpine Ventures AG', kyc: 'verified' },
  { key: '02' + 'f0e1d2c3b4a59687'.repeat(4), name: 'Zug Family Office SA', kyc: 'verified' },
]

export function isDemoSeeded(): boolean {
  try { return localStorage.getItem(SEEDED_FLAG) === '1' } catch { return false }
}

export function loadDemoScenario(ownerName: string): boolean {
  if (isDemoSeeded()) return false

  // Issuer entity persona (feeds the Company page + public transparency header).
  updateProfile({ entity: { legalName: 'Helvetia Digital Money AG', country: 'Switzerland', address: 'Bahnhofstrasse 1, 6300 Zug' } })

  for (const c of CONNECTIONS) {
    const p = providerById(c.providerId)
    if (p == null) continue
    addConnection({ providerId: c.providerId, label: `${p.name} · ${ownerName}`, environment: c.environment, scopes: p.scopes, ownerName })
  }

  for (const h of HOLDERS) {
    screenHolder({ identityKey: h.key, name: h.name })
    setKyc(h.key, h.kyc)
  }

  try { localStorage.setItem(SEEDED_FLAG, '1') } catch { /* ignore */ }
  return true
}

/** Clear the demo stores and reload so in-memory stores reset to defaults. */
export function resetDemo(): void {
  const keys = [
    'underwrite.integrations.v1',
    'underwrite.compliance.v1',
    'underwrite.monitoring.v1',
    'underwrite.sanctions.v1',
    'underwrite.entities.v4',
    'underwrite.mintQueue.v1',
    'mandala.mockDeposits',
    'underwrite.exportHistory.v2',
    'underwrite.reconciliation.v1',
    'underwrite.redemptionTermsPresets.v1',
    'underwrite.companyLogo.v1',
    SEEDED_FLAG,
  ]
  try { for (const k of keys) localStorage.removeItem(k) } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.location.reload()
}
