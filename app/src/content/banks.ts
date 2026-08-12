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
  /** SWIFT/BIC - used to build realistic backing-reference presets. */
  bic: string
}

export const DEMO_BANKS: DemoBank[] = [
  { name: 'JPMorgan Chase', short: 'JP', color: '#1a4b8c', bic: 'CHASUS33' },
  { name: 'HSBC', short: 'HS', color: '#c8102e', bic: 'HBUKGB4B' },
  { name: 'Barclays', short: 'BA', color: '#00aeef', bic: 'BARCGB22' },
  { name: 'Citibank', short: 'CI', color: '#003b70', bic: 'CITIUS33' },
  { name: 'BNP Paribas', short: 'BP', color: '#00915a', bic: 'BNPAFRPP' },
  { name: 'UBS', short: 'UB', color: '#d5001c', bic: 'UBSWCHZH80A' },
  { name: 'Deutsche Bank', short: 'DB', color: '#0b1f3a', bic: 'DEUTDEFF' },
  { name: 'Santander', short: 'SA', color: '#ec0000', bic: 'BSCHESMM' },
  { name: 'Standard Chartered', short: 'SC', color: '#0473ea', bic: 'SCBLGB2L' },
  { name: 'Société Générale', short: 'SG', color: '#e60028', bic: 'SOGEFRPP' },
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

export interface BackingRefSuggestion {
  /** What kind of reference this is. */
  label: string
  /** A fully-formed example reference to drop into the field. */
  value: string
  /** One-line context for when this reference type is used. */
  hint: string
}

const bic = (i: number) => DEMO_BANKS[i]!.bic

/**
 * Typical references an issuer records against an issuance to evidence the
 * reserve deposit that backs it. These mirror the payment rails the supported
 * banks settle on (SWIFT MT103, Fedwire, SEPA, CHAPS, UETR) plus the artefacts
 * an auditor reconciles against (deposit confirmations, custody statements).
 */
export const BACKING_REF_SUGGESTIONS: BackingRefSuggestion[] = [
  { label: 'SWIFT MT103 wire', value: `MT103 ${bic(0)} REF-8842019`, hint: 'Incoming international wire' },
  { label: 'Fedwire (IMAD)', value: 'IMAD 20260710B1QGC08C000123', hint: 'US domestic same-day wire' },
  { label: 'SEPA credit transfer', value: `SEPA-CT ${bic(4)} 2026071000047`, hint: 'Euro-area bank transfer' },
  { label: 'CHAPS payment', value: `CHAPS ${bic(2)} 20260710-0091`, hint: 'UK same-day sterling' },
  { label: 'UETR (end-to-end ref)', value: 'UETR 7f3a1c9e-4b2d-4c6a-9e21-8a5f0d2b1c34', hint: 'Unique payment tracking id' },
  { label: 'Deposit confirmation', value: 'DEP-20260710-4471', hint: 'Bank reserve deposit slip' },
  { label: 'Custody statement line', value: 'CUST-STMT-2026Q3-118', hint: 'Reconciles to custodian report' },
]

/**
 * Typical notes an issuer records when settling a redemption - how the reserves
 * were returned to the holder. Mirror the same payment rails as backing
 * references, plus the reserve-release artefacts an auditor reconciles against.
 */
export const SETTLEMENT_NOTE_SUGGESTIONS: BackingRefSuggestion[] = [
  { label: 'Wire returned to holder', value: `Wire returned to holder · MT103 ${bic(0)}`, hint: 'International wire out' },
  { label: 'SEPA transfer to holder', value: `SEPA transfer to holder · ${bic(4)}`, hint: 'Euro-area, same/next day' },
  { label: 'CHAPS payment to holder', value: `CHAPS to holder · ${bic(2)}`, hint: 'UK same-day sterling' },
  { label: 'Reserves released from custody', value: 'Redeemed at par (1:1), reserves released from custody', hint: 'Custody account debited' },
  { label: 'Bank transfer · T+1', value: 'Bank transfer initiated · T+1 settlement', hint: 'Next-day value' },
  { label: 'Off-ramp to linked account', value: 'Off-ramped to holder’s linked bank account', hint: 'Returned to source account' },
]
