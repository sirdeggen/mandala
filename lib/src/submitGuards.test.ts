import { describe, it, expect } from 'vitest'
import {
  guardPositiveAmount,
  guardSendSubmit,
  guardIssueSubmit,
  guardRedeemSubmit,
  guardRegisterSubmit,
  guardAdminFields
} from './submitGuards.js'

describe('guardPositiveAmount', () => {
  it('accepts positive integers', () => {
    expect(guardPositiveAmount(1).ok).toBe(true)
    expect(guardPositiveAmount(100).ok).toBe(true)
  })

  it('rejects non-positive, non-integer, NaN', () => {
    expect(guardPositiveAmount(0).ok).toBe(false)
    expect(guardPositiveAmount(-1).ok).toBe(false)
    expect(guardPositiveAmount(1.5).ok).toBe(false)
    expect(guardPositiveAmount(NaN).ok).toBe(false)
    expect(guardPositiveAmount(Infinity).ok).toBe(false)
  })
})

describe('guardSendSubmit', () => {
  const base = {
    assetId: 'asset.0',
    recipientKey: '02' + 'ab'.repeat(32),
    amount: 10,
    balance: 100,
    isPaused: false,
    walletReady: true
  }

  it('allows a valid send', () => {
    expect(guardSendSubmit(base).ok).toBe(true)
  })

  it('rejects empty asset, empty recipient, zero amount, over-balance', () => {
    expect(guardSendSubmit({ ...base, assetId: '' }).ok).toBe(false)
    expect(guardSendSubmit({ ...base, recipientKey: '' }).ok).toBe(false)
    expect(guardSendSubmit({ ...base, amount: 0 }).ok).toBe(false)
    expect(guardSendSubmit({ ...base, amount: 101 }).ok).toBe(false)
  })

  it('rejects send while paused unless pauseBypass (dev mode)', () => {
    expect(guardSendSubmit({ ...base, isPaused: true }).ok).toBe(false)
    expect(guardSendSubmit({ ...base, isPaused: true, pauseBypass: true }).ok).toBe(true)
  })

  it('rejects when wallet is not ready', () => {
    expect(guardSendSubmit({ ...base, walletReady: false }).ok).toBe(false)
  })
})

describe('guardIssueSubmit / guardRedeemSubmit', () => {
  it('issue requires asset and positive amount', () => {
    expect(guardIssueSubmit({ assetId: 'a.0', amount: 5, walletReady: true }).ok).toBe(true)
    expect(guardIssueSubmit({ assetId: '', amount: 5, walletReady: true }).ok).toBe(false)
    expect(guardIssueSubmit({ assetId: 'a.0', amount: 0, walletReady: true }).ok).toBe(false)
  })

  it('redeem refuses amount above balance when balance is provided', () => {
    expect(
      guardRedeemSubmit({ assetId: 'a.0', amount: 50, balance: 40, walletReady: true }).ok
    ).toBe(false)
    expect(
      guardRedeemSubmit({ assetId: 'a.0', amount: 40, balance: 40, walletReady: true }).ok
    ).toBe(true)
  })
})

describe('guardRegisterSubmit', () => {
  it('requires label and non-negative integer decimals', () => {
    expect(
      guardRegisterSubmit({ label: 'Gold', ticker: 'GLD', decimals: 2, walletReady: true }).ok
    ).toBe(true)
    expect(
      guardRegisterSubmit({ label: '  ', ticker: 'GLD', decimals: 0, walletReady: true }).ok
    ).toBe(false)
    expect(
      guardRegisterSubmit({ label: 'X', ticker: '', decimals: -1, walletReady: true }).ok
    ).toBe(false)
    expect(
      guardRegisterSubmit({ label: 'X', ticker: '', decimals: 1.5, walletReady: true }).ok
    ).toBe(false)
  })
})

describe('guardAdminFields', () => {
  it('rejects empty required outpoint / identity / recipient', () => {
    expect(guardAdminFields({ requireOutpoint: true, outpoint: '' }).ok).toBe(false)
    expect(guardAdminFields({ requireOutpoint: true, outpoint: '  ' }).ok).toBe(false)
    expect(guardAdminFields({ requireIdentity: true, identityKey: '' }).ok).toBe(false)
    expect(guardAdminFields({ requireRecipient: true, recipient: '' }).ok).toBe(false)
  })

  it('accepts filled required fields', () => {
    expect(
      guardAdminFields({
        requireOutpoint: true,
        outpoint: 'txid.0',
        requireRecipient: true,
        recipient: '02abc'
      }).ok
    ).toBe(true)
  })
})
