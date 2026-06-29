import { WalletInterface } from '@bsv/sdk'
import { MandalaActionDetails } from '@bsv/templates'
import { BASKET } from './constants'

// Admin auth bookkeeping lives in the admin output's customInstructions, so the
// wallet basket is the single source of truth — no localStorage, no on-chain
// marker. The live admin auth UTXO for an asset carries everything needed to
// spend it next: the assetId, a human label, and the action details whose
// commitment derives the locking key.
const ADMIN_CI_TYPE = 'mandala-admin'

export interface AdminAsset {
  assetId: string
  label: string
  authOutpoint: string
  authDetails: MandalaActionDetails
  metadata?: Record<string, unknown>
}

interface AdminCI {
  type: typeof ADMIN_CI_TYPE
  assetId: string
  label: string
  authDetails: MandalaActionDetails
  metadata?: Record<string, unknown>
}

export function adminCustomInstructions (
  assetId: string, label: string, authDetails: MandalaActionDetails, metadata?: Record<string, unknown>
): string {
  return JSON.stringify({ type: ADMIN_CI_TYPE, assetId, label, authDetails, metadata } satisfies AdminCI)
}

export function parseAdminCI (ci: string | null | undefined): AdminCI | null {
  if (ci == null) return null
  try {
    const parsed = JSON.parse(ci)
    return parsed?.type === ADMIN_CI_TYPE ? parsed as AdminCI : null
  } catch {
    return null
  }
}

// Map a wallet output (with customInstructions) to an AdminAsset, or null if it
// is not a mandala admin auth output.
export function adminAssetFromOutput (
  o: { outpoint: string, customInstructions?: string }
): AdminAsset | null {
  const ci = parseAdminCI(o.customInstructions)
  if (ci == null) return null
  return { assetId: ci.assetId, label: ci.label, authOutpoint: o.outpoint, authDetails: ci.authDetails, metadata: ci.metadata }
}

// List the issuer's live admin assets straight from the wallet basket.
export async function listAdminAssets (wallet: WalletInterface): Promise<AdminAsset[]> {
  const res = await wallet.listOutputs({
    basket: BASKET,
    includeCustomInstructions: true,
    limit: 1000
  })
  return res.outputs
    .map(o => adminAssetFromOutput(o as { outpoint: string, customInstructions?: string }))
    .filter((a): a is AdminAsset => a != null)
}
