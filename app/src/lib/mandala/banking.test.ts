// app/src/lib/mandala/banking.test.ts
import { it, expect } from 'vitest'
import { reconcile, bankBalance } from './banking'

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
