/**
 * Pure pre-submit gates for holder send and issuer mutations.
 * Callers must reject without starting wallet/overlay work when these fail.
 * Returns a human-readable reason, or null when the submit is allowed.
 */

import { parseAmount } from './amount'

export type GuardResult = { ok: true } | { ok: false; reason: string }

function fail(reason: string): GuardResult {
  return { ok: false, reason }
}

const ok: GuardResult = { ok: true }

/** Positive integer base units (on-chain amount). */
export function guardPositiveAmount(amount: number): GuardResult {
  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    return fail('Amount is not a valid number')
  }
  if (!Number.isInteger(amount)) {
    return fail('Amount must be a whole number of base units')
  }
  if (amount <= 0) {
    return fail('Amount must be greater than zero')
  }
  return ok
}

/** Parse display string then apply positive-amount + optional balance cap. */
export function guardParseAmount(
  amountStr: string,
  decimals: number,
  options?: { balance?: number; label?: string }
): GuardResult & { amount?: number } {
  const amount = parseAmount(amountStr, decimals)
  if (Number.isNaN(amount)) {
    return fail('Enter a valid amount (check decimal places)')
  }
  const pos = guardPositiveAmount(amount)
  if (!pos.ok) return pos
  if (options?.balance != null && amount > options.balance) {
    return fail(options.label ?? 'Amount exceeds available balance')
  }
  return { ok: true, amount }
}

export interface SendSubmitInput {
  assetId: string
  recipientKey: string
  amount: number
  balance: number
  /** When true and not bypassed, reject before any wallet work. */
  isPaused: boolean
  /** Dev mode intentionally reaches the overlay on a paused asset. */
  pauseBypass?: boolean
  walletReady: boolean
}

/** Holder send confirm — all client-side gates before transferTokens. */
export function guardSendSubmit(input: SendSubmitInput): GuardResult {
  if (!input.walletReady) return fail('Wallet not ready')
  if (input.assetId.trim() === '') return fail('Select an asset')
  if (input.recipientKey.trim() === '') return fail('Enter a recipient')
  const pos = guardPositiveAmount(input.amount)
  if (!pos.ok) return pos
  if (input.amount > input.balance) return fail('Amount exceeds available balance')
  if (input.isPaused && !input.pauseBypass) {
    return fail('Transfers are temporarily disabled by the issuer')
  }
  return ok
}

export interface IssueRedeemSubmitInput {
  assetId: string
  amount: number
  /** Redeem only — must not burn more than held. Issue has no upper bound here. */
  balance?: number
  walletReady: boolean
}

export function guardIssueSubmit(input: IssueRedeemSubmitInput): GuardResult {
  if (!input.walletReady) return fail('Wallet not ready')
  if (input.assetId.trim() === '') return fail('Select an asset')
  return guardPositiveAmount(input.amount)
}

export function guardRedeemSubmit(input: IssueRedeemSubmitInput): GuardResult {
  if (!input.walletReady) return fail('Wallet not ready')
  if (input.assetId.trim() === '') return fail('Select an asset')
  const pos = guardPositiveAmount(input.amount)
  if (!pos.ok) return pos
  if (input.balance != null && input.amount > input.balance) {
    return fail('Amount exceeds available balance')
  }
  return ok
}

export interface RegisterSubmitInput {
  label: string
  ticker: string
  decimals: number
  walletReady: boolean
}

export function guardRegisterSubmit(input: RegisterSubmitInput): GuardResult {
  if (!input.walletReady) return fail('Wallet not ready')
  if (input.label.trim() === '') return fail('Label is required')
  if (!Number.isInteger(input.decimals) || input.decimals < 0) {
    return fail('Decimals must be a non-negative integer')
  }
  // ticker may be empty (issuer can fill later via metadata norms); no hard fail
  void input.ticker
  return ok
}

export interface AdminFieldSubmitInput {
  /** freeze / unfreeze / reissue source */
  outpoint?: string
  /** block / allow identity */
  identityKey?: string
  /** reissue recipient */
  recipient?: string
  requireOutpoint?: boolean
  requireIdentity?: boolean
  requireRecipient?: boolean
}

/** Regulatory required fields — empty strings reject without starting a pipeline. */
export function guardAdminFields(input: AdminFieldSubmitInput): GuardResult {
  if (input.requireOutpoint && (input.outpoint == null || input.outpoint.trim() === '')) {
    return fail('Outpoint is required')
  }
  if (input.requireIdentity && (input.identityKey == null || input.identityKey.trim() === '')) {
    return fail('Identity key is required')
  }
  if (input.requireRecipient && (input.recipient == null || input.recipient.trim() === '')) {
    return fail('Recipient is required')
  }
  return ok
}
