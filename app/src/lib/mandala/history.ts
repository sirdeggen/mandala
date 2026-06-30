import { LockingScript, WalletInterface } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface HistoryRow {
  txid: string
  assetId: string
  direction: 'sent' | 'received' | 'issued' | 'redeemed' | 'admin'
  amount: number
  counterparty: string
  when: number
  kind: string
}

// ---------------------------------------------------------------------------
// Internal raw shape — mirrors WalletAction from @bsv/sdk Wallet.interfaces
// We keep this minimal so the pure parser is portable.
// ---------------------------------------------------------------------------

interface RawOutput {
  outputDescription?: string
  customInstructions?: string
  tags?: string[]
  satoshis?: number
  lockingScript?: string
}

interface RawAction {
  txid: string
  description?: string
  labels?: string[]
  outputs?: RawOutput[]
  /** WalletAction.lockTime is a tx lock-time field, NOT a wall-clock timestamp. */
  lockTime?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const kindFromLabels = (labels: string[] = []): string =>
  labels.find(l => l !== 'mandala') ?? 'admin'

/**
 * Attempt to decode the token amount from the output's locking script.
 * Returns 0 if the script is absent or not a MandalaToken output.
 */
function amountFromOutput (o: RawOutput): number {
  if (!o.lockingScript) return 0
  try {
    const decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript))
    return decoded.amount
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Pure parser — unit-tested with fixtures
// ---------------------------------------------------------------------------

/**
 * Convert a list of raw wallet actions (from `listActions`) into HistoryRows.
 *
 * Classification:
 *   transfer + ci.direction==='sent'  → sent
 *   transfer + otherwise              → received
 *   receive                           → received
 *   issue                             → issued
 *   redeem                            → redeemed
 *   recover                           → received
 *   anything else                     → admin
 *
 * amount: decoded from the output's lockingScript via MandalaToken.decode();
 *         falls back to output.satoshis then 0.
 *
 * when: The @bsv/sdk WalletAction interface exposes no wall-clock timestamp
 *       field (lockTime is the tx-level nLockTime, not a UNIX timestamp).
 *       `when` is left as 0; callers may populate it from another source
 *       (e.g. block headers) if required.
 */
export function parseActionsToHistory (actions: RawAction[]): HistoryRow[] {
  const rows: HistoryRow[] = []

  for (const a of actions) {
    const kind = kindFromLabels(a.labels)

    for (const o of a.outputs ?? []) {
      // Parse customInstructions
      let ci: Record<string, unknown> = {}
      try {
        ci = JSON.parse(o.customInstructions ?? '{}')
      } catch { /* malformed JSON — skip */ }

      // Derive assetId: prefer ci.assetId, fall back to first dotted tag
      const assetId: string =
        (typeof ci.assetId === 'string' && ci.assetId !== '')
          ? ci.assetId
          : (o.tags?.find(t => t.includes('.')) ?? '')

      // Skip outputs that don't belong to a known asset
      if (assetId === '') continue

      const direction: HistoryRow['direction'] =
        kind === 'transfer'
          ? (ci.direction === 'sent' ? 'sent' : 'received')
          : kind === 'receive'  ? 'received'
          : kind === 'issue'    ? 'issued'
          : kind === 'redeem'   ? 'redeemed'
          : kind === 'recover'  ? 'received'
          : 'admin'

      const counterparty =
        (typeof ci.recipient === 'string' ? ci.recipient : null) ??
        (typeof ci.counterparty === 'string' ? ci.counterparty : null) ??
        ''

      const amount = amountFromOutput(o) || (o.satoshis ?? 0)

      rows.push({
        txid: a.txid,
        assetId,
        direction,
        amount,
        counterparty,
        when: 0,  // SDK exposes no wall-clock timestamp — see JSDoc above
        kind
      })
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// loadHistory — calls the real wallet SDK
// ---------------------------------------------------------------------------

/**
 * Fetch mandala actions from the wallet, parse to HistoryRows, and optionally
 * filter by assetId.
 *
 * SDK shape verified against @bsv/sdk Wallet.interfaces.d.ts:
 *   - ListActionsArgs fields used: labels, includeLabels, includeOutputs,
 *     includeOutputLockingScripts (to decode amounts).
 *   - ListActionsResult: { totalActions, actions: WalletAction[] }
 *   - WalletAction: { txid, satoshis, status, isOutgoing, description,
 *                     labels?, version, lockTime, inputs?, outputs? }
 *   - WalletActionOutput: { satoshis, lockingScript?, spendable,
 *                           customInstructions?, tags, outputIndex,
 *                           outputDescription, basket }
 */
export async function loadHistory (
  wallet: WalletInterface,
  assetId?: string
): Promise<HistoryRow[]> {
  const res = await wallet.listActions({
    labels: ['mandala'],
    includeLabels: true,
    includeOutputs: true,
    includeOutputLockingScripts: true,
    limit: 1000
  } as any)

  const result = res as { totalActions: number; actions: RawAction[] }
  const rows = parseActionsToHistory(result.actions ?? [])
  return assetId == null ? rows : rows.filter(r => r.assetId === assetId)
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const esc = (s: string): string => `"${String(s).replace(/"/g, '""')}"`

/**
 * Serialise HistoryRows to CSV (header + one row per entry).
 * Fields: txid, assetId, direction, kind, amount, counterparty, when
 */
export function exportTransactionsCsv (rows: HistoryRow[]): string {
  const header = ['txid', 'assetId', 'direction', 'kind', 'amount', 'counterparty', 'when']
  const lines = [
    header.join(','),
    ...rows.map(r =>
      [
        esc(r.txid),
        esc(r.assetId),
        r.direction,
        r.kind,
        r.amount,
        esc(r.counterparty),
        r.when
      ].join(',')
    )
  ]
  return lines.join('\n')
}
