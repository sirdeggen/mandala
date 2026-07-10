/**
 * Common, non-branded ticker presets for regulated instruments. These are ISO
 * 4217 currency codes (and a couple of asset codes) - generic reference symbols,
 * not trademarked stablecoin brands (e.g. no USDC/USDT/PYUSD). Edit freely.
 */
export interface TickerPreset {
  code: string
  label: string
  /** Suggested decimal places for this reference. */
  decimals: number
}

export const CURRENCY_TICKERS: TickerPreset[] = [
  { code: 'USD', label: 'US Dollar', decimals: 2 },
  { code: 'EUR', label: 'Euro', decimals: 2 },
  { code: 'GBP', label: 'Pound Sterling', decimals: 2 },
  { code: 'CHF', label: 'Swiss Franc', decimals: 2 },
  { code: 'JPY', label: 'Japanese Yen', decimals: 0 },
  { code: 'CAD', label: 'Canadian Dollar', decimals: 2 },
  { code: 'AUD', label: 'Australian Dollar', decimals: 2 },
  { code: 'SGD', label: 'Singapore Dollar', decimals: 2 },
  { code: 'HKD', label: 'Hong Kong Dollar', decimals: 2 },
  { code: 'XAU', label: 'Gold (troy ounce)', decimals: 4 },
]
