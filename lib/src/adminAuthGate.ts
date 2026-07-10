/**
 * Per-asset admin-auth serialization.
 *
 * Issue / redeem / regulatory actions all spend the current admin-auth UTXO
 * (`priorOutpoint` / `authOutpoint`). Two overlapping pipelines that share the
 * same prior would both try to createAction on one outpoint — one wins on-chain,
 * the other can leave a stuck nosend or a vanished-admin-auth half-state.
 *
 * This gate is synchronous and process-local: the second activation for the
 * same assetId fails cleanly before any wallet work. Half-failures that pass
 * the gate still journal via submitAndBroadcast for reconcileWallet recovery.
 */

import { BusyError } from './singleFlight'
import { tryWithLock } from './webLocks'

/** assetId → priorOutpoint currently being spent. */
const inflight = new Map<string, string>()

export class StaleAdminAuthError extends Error {
  readonly code = 'STALE_ADMIN_AUTH' as const
  constructor(message: string) {
    super(message)
    this.name = 'StaleAdminAuthError'
  }
}

export function isAdminAuthInFlight(assetId: string): boolean {
  return inflight.has(assetId)
}

export function adminAuthInFlightPrior(assetId: string): string | undefined {
  return inflight.get(assetId)
}

/**
 * Claim the admin-auth chain for `assetId` at `priorOutpoint`.
 * Throws BusyError if another admin action for this asset is already running.
 */
export function beginAdminAuth(assetId: string, priorOutpoint: string): void {
  if (assetId === '' || priorOutpoint === '') {
    throw new Error('admin auth gate requires assetId and priorOutpoint')
  }
  const held = inflight.get(assetId)
  if (held != null) {
    throw new BusyError(
      held === priorOutpoint
        ? `Admin action already in progress for this asset (prior ${priorOutpoint.slice(0, 16)}…)`
        : 'Admin action already in progress for this asset'
    )
  }
  inflight.set(assetId, priorOutpoint)
}

export function endAdminAuth(assetId: string): void {
  inflight.delete(assetId)
}

/** Test helper — drop all claims. */
export function clearAdminAuthGates(): void {
  inflight.clear()
}

/**
 * Run an admin-auth pipeline under the per-asset gate.
 * Always releases on settle so a failed attempt does not permanently lock the asset.
 */
export async function withAdminAuthGate<T>(
  assetId: string,
  priorOutpoint: string,
  fn: () => Promise<T>
): Promise<T> {
  // Two layers: the synchronous in-process Map fails a same-tab double-click
  // before any wallet work; the web lock extends the exclusion to other tabs
  // of this origin (which share the wallet and would otherwise race on the
  // same admin-auth prior).
  beginAdminAuth(assetId, priorOutpoint)
  try {
    const { acquired, result } = await tryWithLock(`mandala.admin.${assetId}`, fn)
    if (!acquired) {
      throw new BusyError('Admin action already in progress for this asset in another tab')
    }
    return result as T
  } finally {
    endAdminAuth(assetId)
  }
}

/**
 * Pure check used before createAction when the wallet basket is already listed:
 * refuse a prior that is no longer among spendable outputs (stale cache after
 * another session spent it, or a prior race that slipped past the gate).
 */
export function assertSpendablePrior(
  priorOutpoint: string,
  spendableOutpoints: ReadonlyArray<string>
): void {
  if (!spendableOutpoints.includes(priorOutpoint)) {
    throw new StaleAdminAuthError(
      'admin authority outpoint is no longer spendable — reload assets and retry'
    )
  }
}
