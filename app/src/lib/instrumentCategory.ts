import { AdminAsset } from '@bsv/mandala/assets'

/**
 * Instrument type classification, derived from the label/ticker (template names
 * carry the type, e.g. "USD Stablecoin", "Gift Voucher"). Used to group
 * instruments and to pick a representative background photo per type. Falls back
 * to "Other instruments".
 */
export const CATEGORY_ORDER = [
  'Stablecoins', 'Deposit tokens', 'E-money', 'Vouchers & loyalty', 'Asset-backed', 'Other instruments',
] as const

export function categoryOf(asset: AdminAsset | null): string {
  if (asset == null) return 'Other instruments'
  const s = `${asset.label} ${asset.metadata?.ticker ?? ''}`.toLowerCase()
  if (/stablecoin|\bstable\b/.test(s)) return 'Stablecoins'
  if (/deposit|money.?market/.test(s)) return 'Deposit tokens'
  if (/e-?money|prepaid/.test(s)) return 'E-money'
  if (/voucher|gift|loyalty|points|reward|credit/.test(s)) return 'Vouchers & loyalty'
  if (/gold|silver|commodity|carbon|asset-?backed/.test(s)) return 'Asset-backed'
  return 'Other instruments'
}

/** Representative background photo per type (self-hosted under public/templates). */
const CATEGORY_IMAGE: Record<string, string> = {
  'Stablecoins': '/templates/usd-stablecoin.jpg',
  'Deposit tokens': '/templates/deposit-token.jpg',
  'E-money': '/templates/emoney.jpg',
  'Vouchers & loyalty': '/templates/gift-voucher.jpg',
  'Asset-backed': '/templates/gold-token.jpg',
  'Other instruments': '/templates/custom.jpg',
}

export function categoryImage(category: string): string {
  return CATEGORY_IMAGE[category] ?? CATEGORY_IMAGE['Other instruments']!
}

/**
 * Specific per-instrument photos, matched ahead of the generic category image
 * so a CHF stablecoin gets the Swiss photo rather than the generic dollar one.
 * Each entry pairs a matcher (tested against "label ticker", lower-cased) with a
 * self-hosted template image. Order matters - first match wins.
 */
const SPECIFIC_IMAGE: { test: RegExp; image: string }[] = [
  { test: /\bchf\b|swiss|franc/, image: '/templates/chf-stablecoin.jpg' },
  { test: /\beur\b|euro/, image: '/templates/eur-stablecoin.jpg' },
  { test: /\bgbp\b|sterling|pound/, image: '/templates/gbp-stablecoin.jpg' },
  { test: /\busd\b|dollar/, image: '/templates/usd-stablecoin.jpg' },
  { test: /money.?market/, image: '/templates/money-market.jpg' },
  { test: /prepaid/, image: '/templates/prepaid.jpg' },
  { test: /loyalty|points|reward/, image: '/templates/loyalty-points.jpg' },
  { test: /store.?credit|\bcredit\b/, image: '/templates/store-credit.jpg' },
  { test: /gold|\bxau\b/, image: '/templates/gold-token.jpg' },
  { test: /carbon|\bco2\b|offset/, image: '/templates/carbon-credit.jpg' },
]

/** ISO 4217 ticker prefix -> flag-icons country code, for the fiat currency a
 *  stablecoin's reserves are held in. */
const CURRENCY_FLAG: Record<string, string> = {
  USD: 'us', EUR: 'eu', GBP: 'gb', CHF: 'ch', JPY: 'jp', CAD: 'ca',
  AUD: 'au', SGD: 'sg', HKD: 'hk', NZD: 'nz', SEK: 'se', NOK: 'no',
  DKK: 'dk', CNY: 'cn', INR: 'in',
}

/**
 * flag-icons country code for the fiat currency backing a stablecoin's
 * reserves, or null for non-stablecoins / unrecognised currencies. Matches the
 * ticker prefix first (USDX -> us, CHFX -> ch), then the label as a fallback.
 */
export function stablecoinFlag(asset: AdminAsset | null): string | null {
  if (asset == null || categoryOf(asset) !== 'Stablecoins') return null
  const ticker = String(asset.metadata?.ticker ?? '').toUpperCase()
  for (const [code, flag] of Object.entries(CURRENCY_FLAG)) {
    if (ticker.startsWith(code)) return flag
  }
  const label = asset.label.toUpperCase()
  if (/SWISS|FRANC/.test(label)) return 'ch'
  if (/\bEURO?\b/.test(label)) return 'eu'
  if (/STERLING|POUND/.test(label)) return 'gb'
  if (/DOLLAR/.test(label)) return 'us'
  if (/\bYEN\b/.test(label)) return 'jp'
  return null
}

/** The background photo for an instrument: a specific currency/asset photo when
 *  one matches, otherwise the representative photo for its derived type. */
export function assetImage(asset: AdminAsset | null): string {
  if (asset != null) {
    const s = `${asset.label} ${asset.metadata?.ticker ?? ''}`.toLowerCase()
    const specific = SPECIFIC_IMAGE.find(m => m.test.test(s))
    if (specific != null) return specific.image
  }
  return categoryImage(categoryOf(asset))
}
