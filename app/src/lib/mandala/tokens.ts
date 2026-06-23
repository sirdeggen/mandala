import { LockingScript, WalletInterface, WalletCounterparty } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { FT_PROTOCOL, OVERLAY_IDENTITY_KEY } from './constants'
import { SpecificLinkage } from './encoding'

export interface TokenBalance { assetId: string, amount: number }

export const outpoint = (txid: string, index: number): string => `${txid}.${index}`

export function decodeBalances (
  outputs: Array<{ lockingScript: string }>
): TokenBalance[] {
  const totals = new Map<string, number>()
  for (const o of outputs) {
    try {
      const d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript))
      totals.set(d.assetId, (totals.get(d.assetId) ?? 0) + d.amount)
    } catch { /* not a mandala token output */ }
  }
  return [...totals.entries()].map(([assetId, amount]) => ({ assetId, amount }))
}

export async function revealLinkage (
  wallet: WalletInterface, keyID: string, counterparty: WalletCounterparty
): Promise<SpecificLinkage> {
  const linkage = await wallet.revealSpecificKeyLinkage({
    counterparty: counterparty as string,
    verifier: OVERLAY_IDENTITY_KEY,
    protocolID: FT_PROTOCOL,
    keyID
  })
  return linkage as unknown as SpecificLinkage
}
