/**
 * Eligible reserve asset classes for backing a regulated instrument, modelled on
 * the reserve-composition rules in MiCA (EMT reserve of assets) and the US
 * GENIUS Act (permitted payment-stablecoin reserves). Purely content - edit
 * freely or move to a database later.
 *
 * `eligible: false` marks a class that is NOT a permitted reserve. Each class
 * also declares the per-line attributes an auditor expects; a `maturity` field
 * drives the short-dated (<= 93 day) eligibility rule for government securities
 * and repos.
 */
export const MATURITY_CAP_DAYS = 93

export interface ReserveField {
  key: string
  label: string
  type: 'text' | 'number' | 'date'
  placeholder?: string
  /** A weighted-average maturity (days) field governing short-dated eligibility. */
  maturity?: boolean
}

export interface ReserveClass {
  key: string
  label: string
  /** Short, plain-language note on why it qualifies (or doesn't). */
  note: string
  eligible: boolean
  /** Compliance attributes an auditor expects for each line of this class. */
  fields: ReserveField[]
}

export const RESERVE_CLASSES: ReserveClass[] = [
  {
    key: 'cash',
    label: 'Cash at bank (insured deposits)',
    note: 'Segregated demand deposits held at regulated, insured banks.',
    eligible: true,
    fields: [
      { key: 'custodian', label: 'Custodian bank', type: 'text', placeholder: 'e.g. JPMorgan Chase' },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', placeholder: 'e.g. United States' },
      { key: 'insurance', label: 'Deposit-insurance scheme', type: 'text', placeholder: 'e.g. FDIC' },
    ],
  },
  {
    key: 'tbills',
    label: 'Short-dated government securities',
    note: 'Sovereign treasury bills with a residual maturity of 93 days or less.',
    eligible: true,
    fields: [
      { key: 'issuer', label: 'Issuer (sovereign)', type: 'text', placeholder: 'e.g. US Treasury' },
      { key: 'maturityDays', label: 'Weighted-avg maturity (days)', type: 'number', placeholder: '<= 93', maturity: true },
      { key: 'custodian', label: 'Custodian', type: 'text', placeholder: 'e.g. BNY Mellon' },
    ],
  },
  {
    key: 'repo',
    label: 'Overnight reverse repos',
    note: 'Collateralised by eligible government securities.',
    eligible: true,
    fields: [
      { key: 'counterparty', label: 'Counterparty', type: 'text', placeholder: 'e.g. Fixed Income Clearing Corp' },
      { key: 'collateral', label: 'Collateral', type: 'text', placeholder: 'e.g. US Treasuries' },
      { key: 'maturityDays', label: 'Maturity (days)', type: 'number', placeholder: '<= 93', maturity: true },
      { key: 'custodian', label: 'Custodian', type: 'text', placeholder: 'e.g. BNY Mellon' },
    ],
  },
  {
    key: 'mmf',
    label: 'Government money-market funds',
    note: 'Funds invested solely in eligible government assets.',
    eligible: true,
    fields: [
      { key: 'fundName', label: 'Fund name', type: 'text', placeholder: 'e.g. Govt MMF' },
      { key: 'isin', label: 'ISIN', type: 'text', placeholder: 'e.g. US0000000000' },
      { key: 'custodian', label: 'Administrator / custodian', type: 'text', placeholder: 'e.g. State Street' },
    ],
  },
  {
    key: 'other',
    label: 'Other assets',
    note: 'Not a permitted reserve under MiCA / the GENIUS Act - flag for review.',
    eligible: false,
    fields: [
      { key: 'description', label: 'Description', type: 'text', placeholder: 'What is this asset?' },
    ],
  },
]

export const RESERVE_CLASS_BY_KEY: Record<string, ReserveClass> = Object.fromEntries(
  RESERVE_CLASSES.map(c => [c.key, c] as const)
)

/** Required-field labels still missing for a line (empty = complete). */
export function missingReserveFields(assetClass: string, attributes?: Record<string, string>): string[] {
  const cls = RESERVE_CLASS_BY_KEY[assetClass]
  if (cls == null) return []
  return cls.fields.filter(f => (attributes?.[f.key] ?? '').trim() === '').map(f => f.label)
}

/**
 * Whether a reserve line counts toward full backing: its class must be a
 * permitted reserve, and for maturity-driven classes the weighted-avg maturity
 * must be present and within the 93-day cap.
 */
export function isReserveLineEligible(assetClass: string, attributes?: Record<string, string>): boolean {
  const cls = RESERVE_CLASS_BY_KEY[assetClass]
  if (cls == null || !cls.eligible) return false
  const maturityField = cls.fields.find(f => f.maturity)
  if (maturityField != null) {
    const days = Number(attributes?.[maturityField.key] ?? '')
    if (!Number.isFinite(days) || days <= 0 || days > MATURITY_CAP_DAYS) return false
  }
  return true
}
