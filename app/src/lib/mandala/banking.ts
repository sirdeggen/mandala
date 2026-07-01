// app/src/lib/mandala/banking.ts
export interface MockDeposit { id: string, amount: number, currency: string, originator: string, timestamp: number }

export function seedDeposits (now = 1_780_000_000_000): MockDeposit[] {
  return [
    { id: 'BR-1001', amount: 25000, currency: 'USD', originator: 'ACME Payroll', timestamp: now - 86_400_000 },
    { id: 'BR-1002', amount: 5000, currency: 'USD', originator: 'Jane Doe (wire)', timestamp: now - 3_600_000 }
  ]
}

export const bankBalance = (deposits: number[], withdrawals: number[]): number =>
  deposits.reduce((a, b) => a + b, 0) - withdrawals.reduce((a, b) => a + b, 0)

export function reconcile (p: { deposits: number[], withdrawals: number[], issued: number, redeemed: number }): { bankBalance: number, netSupply: number, drift: number } {
  const bal = bankBalance(p.deposits, p.withdrawals)
  const netSupply = p.issued - p.redeemed
  return { bankBalance: bal, netSupply, drift: bal - netSupply }
}

/** Sum the amounts of deposits that have not yet been issued against on-chain. */
export const unissuedSum = (deposits: MockDeposit[], issuedIds: Set<string>): number =>
  deposits.filter(d => !issuedIds.has(d.id)).reduce((a, d) => a + d.amount, 0)
