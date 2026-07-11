/**
 * Demo roster of banking institutions for the reserve-account feed. The banking
 * feed is a sandbox standing in for a real bank / Plaid connection, so these are
 * used only to make demo transfers look like they came from a recognised
 * institution (monogram "logo" + name + masked account). Not real logos and not
 * real account data - purely presentational.
 */
export interface DemoBank {
  name: string
  /** 2-letter monogram shown in the logo tile. */
  short: string
  /** Brand-ish colour for the logo tile. */
  color: string
}

export const DEMO_BANKS: DemoBank[] = [
  { name: 'JPMorgan Chase', short: 'JP', color: '#1a4b8c' },
  { name: 'HSBC', short: 'HS', color: '#c8102e' },
  { name: 'Barclays', short: 'BA', color: '#00aeef' },
  { name: 'Citibank', short: 'CI', color: '#003b70' },
  { name: 'BNP Paribas', short: 'BP', color: '#00915a' },
  { name: 'UBS', short: 'UB', color: '#d5001c' },
  { name: 'Deutsche Bank', short: 'DB', color: '#0b1f3a' },
  { name: 'Santander', short: 'SA', color: '#ec0000' },
  { name: 'Standard Chartered', short: 'SC', color: '#0473ea' },
  { name: 'Société Générale', short: 'SG', color: '#e60028' },
]

/** FNV-1a 32-bit hash - deterministic, so a given reference always maps to the
 *  same bank and account (stable across reloads). */
function hashStr(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface ResolvedBank extends DemoBank {
  /** Masked account number, e.g. "•••• 4821". */
  account: string
}

/** Deterministically resolve a bank + masked account for a transfer reference. */
export function bankForRef(ref: string): ResolvedBank {
  const h = hashStr(ref)
  const bank = DEMO_BANKS[h % DEMO_BANKS.length]!
  const last4 = String(h % 10000).padStart(4, '0')
  return { ...bank, account: `•••• ${last4}` }
}
