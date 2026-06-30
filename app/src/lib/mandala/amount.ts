// Mandala token amounts are integers (base units) on-chain. An asset's `decimals`
// (precision) metadata says how many fractional places those base units represent:
// decimals=0 → each unit is whole; decimals=6 → 1_000_000 base units = 1.0 display.
// These helpers convert at the UI boundary; never store display values on-chain.

// Split base units into a plain "[-]whole.frac" string (no grouping), frac trimmed.
function toParts (baseUnits: number, decimals: number): { negative: boolean, whole: string, frac: string } {
  const negative = baseUnits < 0
  const digits = Math.abs(baseUnits).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return { negative, whole, frac }
}

// Plain decimal string for input fields (no thousands separators).
export function formatAmountPlain (baseUnits: number, decimals = 0): string {
  if (!Number.isFinite(decimals) || decimals <= 0) return String(baseUnits)
  const { negative, whole, frac } = toParts(baseUnits, decimals)
  return `${negative ? '-' : ''}${whole}${frac.length > 0 ? '.' + frac : ''}`
}

// Grouped display string (thousands separators) for read-only display.
export function formatAmount (baseUnits: number, decimals = 0): string {
  if (!Number.isFinite(decimals) || decimals <= 0) return baseUnits.toLocaleString()
  const { negative, whole, frac } = toParts(baseUnits, decimals)
  const wholeFmt = Number(whole).toLocaleString()
  return `${negative ? '-' : ''}${wholeFmt}${frac.length > 0 ? '.' + frac : ''}`
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ' }

export function currencySymbol (ticker?: string): string {
  if (ticker == null || ticker === '') return ''
  return SYMBOLS[ticker.toUpperCase()] ?? `${ticker.toUpperCase()} `
}

export function formatCurrency (base: number, decimals: number, ticker?: string): string {
  return `${currencySymbol(ticker)}${formatAmount(base, decimals)}`
}

// Parse a user-entered display value into integer base units. Returns NaN if the
// input isn't a valid number or has more fractional places than `decimals` allows.
export function parseAmount (input: string, decimals = 0): number {
  const trimmed = input.trim()
  if (trimmed === '' || !/^\d*\.?\d*$/.test(trimmed)) return NaN
  const [whole = '', frac = ''] = trimmed.split('.')
  if (frac.length > decimals) return NaN
  const combined = whole + frac.padEnd(decimals, '0')
  const n = Number(combined === '' ? '0' : combined)
  return Number.isInteger(n) ? n : NaN
}
