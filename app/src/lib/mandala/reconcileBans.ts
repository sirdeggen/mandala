/**
 * Relinquish outputs the overlay has evicted (reissued to another holder) but
 * that still linger in our basket. Evicted outputs are permanently dead — unlike
 * frozen ones, which may later unfreeze — so they are safe to drop.
 *
 * Trust model: the endpoint is authoritative. The overlay only lists an outpoint
 * in evictedOutpoints after validating the issuer's authenticated reissue tx, so
 * no client-side sender check is needed. Fail open: an unreachable endpoint
 * (state === null) relinquishes nothing.
 */
import { WalletInterface } from '@bsv/sdk'
import { BASKET } from './constants'
import { resolveAssetState } from './adminState'

export async function reconcileBans (
  wallet: WalletInterface,
  assetIds: string[]
): Promise<string[]> {
  const relinquished: string[] = []

  // What we currently hold, once — evicted matching is by outpoint string.
  const held = new Set<string>()
  try {
    const res = await wallet.listOutputs({ basket: BASKET, limit: 1000 })
    for (const o of res.outputs) held.add(o.outpoint as string)
  } catch { return relinquished }

  for (const assetId of assetIds) {
    const state = await resolveAssetState(assetId)
    if (state == null) continue // fail open
    for (const op of state.evictedOutpoints) {
      if (!held.has(op)) continue
      try {
        await wallet.relinquishOutput({ basket: BASKET, output: op })
        relinquished.push(op)
      } catch { /* already gone / not ours — idempotent, ignore */ }
    }
  }
  return relinquished
}
