// app/src/lib/mandala/banking.ts
export interface MockDeposit { id: string, amount: number, currency: string, originator: string, timestamp: number }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Picks a random uppercase letter A-Z via the given RNG (defaults to Math.random). */
export function randomLetter(random: () => number = Math.random): string {
  return LETTERS[Math.floor(random() * LETTERS.length)]
}

/**
 * Builds a demo incoming deposit for the admin to issue against. The
 * counterparty is always a synthetic "Company {letter}" — this is a sandbox
 * feed standing in for a real bank/Plaid integration, not real originator
 * data, so it must not look like one.
 */
export function makeDeposit(
  amount: number,
  opts: { now?: () => number, random?: () => number } = {}
): MockDeposit {
  const now = opts.now ?? Date.now
  const random = opts.random ?? Math.random
  const ts = now()
  return {
    id: `BR-${ts.toString(36).toUpperCase().slice(-6)}`,
    amount,
    currency: 'USD',
    originator: `Company ${randomLetter(random)}`,
    timestamp: ts
  }
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
