// app/src/lib/mandala/banking.test.ts
import { it, expect } from 'vitest'
import { reconcile, bankBalance, makeTransfer, randomLetter } from './banking'

it('bank balance nets deposits minus withdrawals', () => {
  expect(bankBalance([100, 50], [30])).toBe(120)
})
it('reconciles with no drift when issued-redeemed equals bank balance', () => {
  const r = reconcile({ deposits: [100], withdrawals: [40], issued: 100, redeemed: 40 })
  expect(r).toEqual({ bankBalance: 60, netSupply: 60, drift: 0 })
})
it('a redeem with no bank withdrawal does NOT flag drift only if modeled as a withdrawal', () => {
  const r = reconcile({ deposits: [100], withdrawals: [], issued: 100, redeemed: 40 })
  expect(r.drift).toBe(40) // bank 100 vs supply 60 -> 40 drift until a withdrawal is recorded
})

it('randomLetter picks deterministically from the injected RNG', () => {
  expect(randomLetter(() => 0)).toBe('A')
  expect(randomLetter(() => 0.999999)).toBe('Z')
})

it('makeTransfer always names the counterparty "Company {letter}"', () => {
  const t = makeTransfer(500, 'in', 'asset.0', { now: () => 1_780_000_000_000, random: () => 0 })
  expect(t.originator).toBe('Company A')
  expect(t.amount).toBe(500)
  expect(t.direction).toBe('in')
  expect(t.assetId).toBe('asset.0')
  expect(t.timestamp).toBe(1_780_000_000_000)
})

it('makeTransfer records the requested direction', () => {
  const t = makeTransfer(500, 'out', 'asset.0', { now: () => 1, random: () => 0 })
  expect(t.direction).toBe('out')
})

it('makeTransfer ids are unique across different timestamps', () => {
  const a = makeTransfer(10, 'in', 'asset.0', { now: () => 1, random: () => 0 })
  const b = makeTransfer(10, 'in', 'asset.0', { now: () => 2, random: () => 0 })
  expect(a.id).not.toBe(b.id)
})
