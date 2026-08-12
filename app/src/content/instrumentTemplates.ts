/**
 * Starter templates for issuing common instrument types. Shown on the issuer
 * home as a visual, category-tabbed gallery; selecting one opens the Issue
 * drawer pre-filled with these defaults. Purely content - edit freely or move to
 * a database later.
 *
 * `image` is a locally-hosted file under `public/templates/` (see
 * `public/templates/CREDITS.md` for image sources & licence). `icon` is a name
 * from the instrument-icon set (see lib/instrumentIcons) used as a small glyph
 * badge on the card. `flag` is an ISO country code for flag-icons (currency
 * instruments only).
 */
export interface InstrumentTemplate {
  id: string
  /** Category label - also drives the gallery tabs. */
  category: string
  /** Suggested instrument name (pre-fills the Issue drawer). '' = blank/custom. */
  name: string
  /** Suggested ticker. */
  ticker: string
  /** Suggested decimals. */
  decimals: number
  /** One-line description of what this instrument is for. */
  description: string
  /** Icon name from the curated instrument-icon set. */
  icon: string
  /** Card image, served from public/templates/. */
  image: string
  /** flag-icons country code (e.g. 'us', 'ch', 'eu', 'gb') for currency tokens. */
  flag?: string
  /** Highlight the most common starting points. */
  popular?: boolean
}

const img = (file: string) => `/templates/${file}.jpg`

export const INSTRUMENT_TEMPLATES: InstrumentTemplate[] = [
  // ── Stablecoins ──
  {
    id: 'usd-stablecoin', category: 'Stablecoins', name: 'USD Stablecoin', ticker: 'USDX', decimals: 2,
    description: 'A US-dollar-referenced token, redeemable 1:1 against reserves.',
    icon: 'CircleDollarSign', image: img('usd-stablecoin'), flag: 'us', popular: true,
  },
  {
    id: 'chf-stablecoin', category: 'Stablecoins', name: 'CHF Stablecoin', ticker: 'CHFX', decimals: 2,
    description: 'A Swiss-franc-referenced token, fully reserve-backed.',
    icon: 'SwissFranc', image: img('chf-stablecoin'), flag: 'ch',
  },
  {
    id: 'eur-stablecoin', category: 'Stablecoins', name: 'EUR Stablecoin', ticker: 'EURX', decimals: 2,
    description: 'A euro-referenced token, redeemable 1:1 against reserves.',
    icon: 'Euro', image: img('eur-stablecoin'), flag: 'eu', popular: true,
  },
  {
    id: 'gbp-stablecoin', category: 'Stablecoins', name: 'GBP Stablecoin', ticker: 'GBPX', decimals: 2,
    description: 'A pound-sterling-referenced token, fully reserve-backed.',
    icon: 'PoundSterling', image: img('gbp-stablecoin'), flag: 'gb',
  },

  // ── Deposit tokens ──
  {
    id: 'deposit-token', category: 'Deposit tokens', name: 'Deposit Token', ticker: 'DEP', decimals: 2,
    description: 'Tokenised commercial-bank deposits for institutional settlement.',
    icon: 'Landmark', image: img('deposit-token'),
  },
  {
    id: 'money-market', category: 'Deposit tokens', name: 'Money Market Token', ticker: 'MMF', decimals: 2,
    description: 'A share in a money-market fund, tokenised for instant transfer.',
    icon: 'LineChart', image: img('money-market'),
  },

  // ── E-money ──
  {
    id: 'emoney', category: 'E-money', name: 'E-Money Token', ticker: 'EMT', decimals: 2,
    description: 'An electronic-money instrument for everyday payments.',
    icon: 'Wallet', image: img('emoney'),
  },
  {
    id: 'prepaid', category: 'E-money', name: 'Prepaid Balance', ticker: 'PPB', decimals: 2,
    description: 'A reloadable prepaid balance spendable across your network.',
    icon: 'CreditCard', image: img('prepaid'),
  },

  // ── Vouchers & loyalty ──
  {
    id: 'gift-voucher', category: 'Vouchers & loyalty', name: 'Gift Voucher', ticker: 'GIFT', decimals: 0,
    description: 'Prepaid, single-purpose value redeemable with your business.',
    icon: 'Gift', image: img('gift-voucher'), popular: true,
  },
  {
    id: 'loyalty-points', category: 'Vouchers & loyalty', name: 'Loyalty Points', ticker: 'PTS', decimals: 0,
    description: 'Reward points customers earn and spend across your programme.',
    icon: 'BadgePercent', image: img('loyalty-points'),
  },
  {
    id: 'store-credit', category: 'Vouchers & loyalty', name: 'Store Credit', ticker: 'CRED', decimals: 2,
    description: 'Refund or promotional credit redeemable at checkout.',
    icon: 'Tag', image: img('store-credit'),
  },

  // ── Asset-backed ──
  {
    id: 'gold-token', category: 'Asset-backed', name: 'Gold Token', ticker: 'XAU', decimals: 4,
    description: 'A token backed by a reserve of allocated physical gold.',
    icon: 'Gem', image: img('gold-token'),
  },
  {
    id: 'carbon-credit', category: 'Asset-backed', name: 'Carbon Credit', ticker: 'CO2', decimals: 2,
    description: 'A verified carbon-offset unit, tradable and retireable on-chain.',
    icon: 'Award', image: img('carbon-credit'),
  },

  // ── Custom ──
  {
    id: 'custom', category: 'Custom', name: '', ticker: '', decimals: 2,
    description: 'Start from scratch and define every detail yourself.',
    icon: 'FileText', image: img('custom'),
  },
]

/** Categories in display order (drives the gallery tabs). */
export const TEMPLATE_CATEGORIES: string[] = INSTRUMENT_TEMPLATES.reduce<string[]>((acc, t) => {
  if (!acc.includes(t.category)) acc.push(t.category)
  return acc
}, [])
