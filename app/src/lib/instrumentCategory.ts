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

/** The background photo for an instrument, from its derived type. */
export function assetImage(asset: AdminAsset | null): string {
  return categoryImage(categoryOf(asset))
}
