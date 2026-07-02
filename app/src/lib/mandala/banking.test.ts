// app/src/lib/mandala/banking.test.ts
import { it, expect } from 'vitest'
import { reconcile, bankBalance, unissuedSum, makeDeposit, randomLetter } from './banking'

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
it('unissuedSum sums deposits not in the issued set', () => {
  const deps = [
    { id: 'BR-1', amount: 25000, currency: 'USD', originator: 'Company A', timestamp: 1 },
    { id: 'BR-2', amount: 5000, currency: 'USD', originator: 'Company B', timestamp: 2 }
  ]
  expect(unissuedSum(deps, new Set())).toBe(30000)
  expect(unissuedSum(deps, new Set(['BR-1']))).toBe(5000)
  expect(unissuedSum(deps, new Set(['BR-1', 'BR-2']))).toBe(0)
})

it('randomLetter picks deterministically from the injected RNG', () => {
  expect(randomLetter(() => 0)).toBe('A')
  expect(randomLetter(() => 0.999999)).toBe('Z')
})

it('makeDeposit always names the counterparty "Company {letter}"', () => {
  const dep = makeDeposit(500, { now: () => 1_780_000_000_000, random: () => 0 })
  expect(dep.originator).toBe('Company A')
  expect(dep.amount).toBe(500)
  expect(dep.currency).toBe('USD')
  expect(dep.timestamp).toBe(1_780_000_000_000)
})

it('makeDeposit ids are unique across different timestamps', () => {
  const a = makeDeposit(10, { now: () => 1, random: () => 0 })
  const b = makeDeposit(10, { now: () => 2, random: () => 0 })
  expect(a.id).not.toBe(b.id)
})
