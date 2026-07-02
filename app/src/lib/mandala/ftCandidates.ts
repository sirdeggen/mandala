/**
 * Loads spendable FT outputs of an asset as coin-selection candidates, enriched
 * with confirmation status and relative age via a listActions cross-reference
 * (listOutputs exposes neither). Feeds selectFtInputs (see ftSelect.ts).
 */
import { LockingScript, WalletInterface } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { BASKET } from './constants'
import { FtCandidate } from './ftSelect'

// Wallet action statuses we treat as confirmed for coin-selection purposes.
// Everything else (nosend/unproven/sending/unprocessed/…) is "unconfirmed" and
// only spent when confirmed outputs can't cover the target.
const CONFIRMED_STATUSES = new Set<string>(['completed'])

interface TxMeta { status: string, order: number }

/**
 * Build a txid → { status, order } map from listActions. listActions returns
 * actions oldest-first, so the array index is a usable age rank (lower = older),
 * matching how the app already derives recency elsewhere.
 */
async function loadTxMeta(wallet: WalletInterface): Promise<Map<string, TxMeta>> {
  const map = new Map<string, TxMeta>()
  try {
    const res = await wallet.listActions({ labels: ['mandala'], limit: 1000 } as any)
    const actions = (res as { actions?: Array<{ txid?: string, status?: string }> }).actions ?? []
    actions.forEach((a, i) => {
      if (typeof a.txid === 'string') map.set(a.txid, { status: a.status ?? '', order: i })
    })
  } catch { /* status unavailable — callers treat every output as unconfirmed */ }
  return map
}

/**
 * Fetch FT candidates for `assetId` plus the merged input BEEF needed to spend
 * them. Outputs whose txid is unknown to listActions are treated as unconfirmed
 * and sorted last (newest).
 */
export async function loadFtCandidates(
  wallet: WalletInterface,
  assetId: string
): Promise<{ candidates: FtCandidate[], beef: number[] }> {
  const scriptRes = await wallet.listOutputs({
    basket: BASKET,
    include: 'locking scripts',
    includeCustomInstructions: true,
    limit: 1000
  })
  const beefRes = await wallet.listOutputs({
    basket: BASKET,
    include: 'entire transactions',
    limit: 1000
  })
  const txMeta = await loadTxMeta(wallet)

  const candidates: FtCandidate[] = []
  for (const o of scriptRes.outputs) {
    let decoded
    try {
      decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
    } catch { continue } // not a Mandala FT output
    if (decoded.assetId !== assetId) continue

    let ci: { keyID?: string, counterparty?: string } = {}
    try { ci = JSON.parse((o.customInstructions as string) ?? '{}') } catch { /* malformed */ }

    const txid = (o.outpoint as string).split('.')[0]
    const meta = txMeta.get(txid)
    candidates.push({
      outpoint: o.outpoint as string,
      amount: decoded.amount,
      keyID: ci.keyID ?? '',
      counterparty: ci.counterparty ?? '',
      confirmed: meta != null && CONFIRMED_STATUSES.has(meta.status),
      order: meta?.order ?? Number.MAX_SAFE_INTEGER
    })
  }

  return { candidates, beef: beefRes.BEEF as number[] }
}
