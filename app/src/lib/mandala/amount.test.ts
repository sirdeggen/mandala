import { describe, it, expect } from 'vitest'
import { formatAmount, formatAmountPlain, parseAmount, currencySymbol, formatCurrency } from './amount'

describe('amount precision helpers', () => {
  it('formats base units at a given precision (grouped)', () => {
    expect(formatAmount(1050, 2)).toBe('10.5')
    expect(formatAmount(1000000, 6)).toBe('1')
    expect(formatAmount(1234567, 6)).toBe('1.234567')
    expect(formatAmount(1234567, 0)).toBe('1,234,567')
    expect(formatAmount(50, 2)).toBe('0.5')
  })

  it('formats plain (no grouping) for input fields', () => {
    expect(formatAmountPlain(1234567, 6)).toBe('1.234567')
    expect(formatAmountPlain(1234567, 0)).toBe('1234567')
  })

  it('parses display values into base units', () => {
    expect(parseAmount('10.5', 2)).toBe(1050)
    expect(parseAmount('1', 6)).toBe(1000000)
    expect(parseAmount('1.234567', 6)).toBe(1234567)
    expect(parseAmount('100', 0)).toBe(100)
  })

  it('round-trips format → parse', () => {
    for (const [base, dec] of [[1050, 2], [1000000, 6], [1234567, 6], [42, 0]] as const) {
      expect(parseAmount(formatAmountPlain(base, dec), dec)).toBe(base)
    }
  })

  it('rejects more fractional places than precision allows', () => {
    expect(parseAmount('1.234', 2)).toBeNaN()
    expect(parseAmount('0.5', 0)).toBeNaN()
    expect(parseAmount('abc', 2)).toBeNaN()
  })
})

describe('currency', () => {
  it('maps known tickers to symbols and falls back to the ticker', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('CHF')).toBe('CHF ')
    expect(currencySymbol('XYZ')).toBe('XYZ ')
    expect(currencySymbol(undefined)).toBe('')
  })
  it('formats base units with the symbol and grouping', () => {
    expect(formatCurrency(124575, 2, 'USD')).toBe('$1,245.75')
    expect(formatCurrency(5, 0, undefined)).toBe('5')
  })
})
