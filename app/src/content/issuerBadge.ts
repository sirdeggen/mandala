/**
 * Instrument categories an issuer Badge can be whitelisted for. Purely
 * descriptive content shown in Account settings - edit freely or move to a
 * database later. `requirementsMet` describes the checks the Badge satisfies
 * for that category and is surfaced in the pill's tooltip.
 */
export interface BadgeCategory {
  /** Short label shown on the pill. */
  label: string
  /** One-line description of the instrument type. */
  type: string
  /** Whitelist requirements this Badge satisfies for the category. */
  requirementsMet: string
}

export const WHITELISTED_CATEGORIES: BadgeCategory[] = [
  {
    label: 'Stablecoins',
    type: 'Fiat-referenced tokens redeemable 1:1 against a currency reserve.',
    requirementsMet: 'Licensed issuer, reserve attestation on file.',
  },
  {
    label: 'Deposit tokens',
    type: 'Tokenised commercial-bank deposits.',
    requirementsMet: 'Banking licence verified, reserves segregated.',
  },
  {
    label: 'E-money',
    type: 'Electronic money instruments for payments.',
    requirementsMet: 'EMI authorisation confirmed.',
  },
  {
    label: 'Vouchers',
    type: 'Prepaid, single-purpose redeemable value.',
    requirementsMet: 'KYC/AML programme approved.',
  },
]
