/**
 * Eligible reserve asset classes for backing a regulated instrument, modelled on
 * the reserve-composition rules in MiCA (EMT reserve of assets) and the US
 * GENIUS Act (permitted payment-stablecoin reserves). Purely content - edit
 * freely or move to a database later.
 *
 * `eligible: false` marks a class that is NOT a permitted reserve; the UI warns
 * when any reserve value sits in an ineligible class.
 */
export interface ReserveClass {
  key: string
  label: string
  /** Short, plain-language note on why it qualifies (or doesn't). */
  note: string
  eligible: boolean
}

export const RESERVE_CLASSES: ReserveClass[] = [
  {
    key: 'cash',
    label: 'Cash at bank (insured deposits)',
    note: 'Segregated demand deposits held at regulated, insured banks.',
    eligible: true,
  },
  {
    key: 'tbills',
    label: 'Short-dated government securities',
    note: 'Sovereign treasury bills with a residual maturity of 93 days or less.',
    eligible: true,
  },
  {
    key: 'repo',
    label: 'Overnight reverse repos',
    note: 'Collateralised by eligible government securities.',
    eligible: true,
  },
  {
    key: 'mmf',
    label: 'Government money-market funds',
    note: 'Funds invested solely in eligible government assets.',
    eligible: true,
  },
  {
    key: 'other',
    label: 'Other assets',
    note: 'Not a permitted reserve under MiCA / the GENIUS Act - flag for review.',
    eligible: false,
  },
]

export const RESERVE_CLASS_BY_KEY: Record<string, ReserveClass> = Object.fromEntries(
  RESERVE_CLASSES.map(c => [c.key, c] as const)
)
