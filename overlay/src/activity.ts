/**
 * Overlay-wide transaction activity feed — the admin-oversight view.
 *
 * Built entirely from data the overlay operator already holds:
 *   - mandalaLinkageRecords (append-only): every FT output ever admitted, with
 *     the identityKey proven via revealSpecificKeyLinkage at submission time.
 *   - the engine's raw transaction store: lets us decode amounts/assetIds for
 *     every output — including spent ones — and walk each tx's inputs back to
 *     their source outpoints to identify the sender.
 *
 * Each transaction is summarised semantically (sender → recipient, net units
 * moved) rather than per-output: outputs are a technical detail (one is
 * usually change back to the sender). Classification falls out of token
 * conservation:
 *   - no FT inputs                          → issue   (minted to recipient)
 *   - outputs to someone other than sender  → transfer (amount = external outs)
 *   - all outputs to sender, in > out       → redeem  (amount = burned units)
 *   - all outputs to sender, in = out       → self    (0 units transferred)
 */
import { Transaction } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'

export interface LinkageRowLite {
  txid: string
  outputIndex: number
  identityKey: string
  linkage: {
    prover: string
    verifier: string
    counterparty: string
    keyID: string
    proofType: number
  }
  createdAt: Date | string
}

export interface ActivityProof {
  outputIndex: number
  identityKey: string
  keyID: string
  counterparty: string
  proofType: number
}

export interface ActivityEntry {
  txid: string
  when: string
  assetId: string
  kind: 'issue' | 'transfer' | 'self' | 'redeem'
  /** Sender identityKey (owner of the spent outputs); null for issuance. */
  from: string | null
  /** Recipient identityKey; null for redeem (units burned, nobody receives). */
  to: string | null
  /** Units moved to the recipient (0 for self), or units burned for redeem. */
  amount: number
  /** Key-linkage proof metadata for this tx's outputs (encrypted blobs omitted). */
  proofs: ActivityProof[]
}

export interface ActivityDeps {
  /** Newest-first linkage records, capped at `limit`; when `before` is set,
   *  only rows with createdAt <= before (inclusive — see nextCursor). */
  listLinkage: (limit: number, before?: string) => Promise<LinkageRowLite[]>
  /** Linkage records for specific outpoints (senders of spent outputs). */
  findLinkageByOutpoints: (outpoints: Array<{ txid: string, outputIndex: number }>) => Promise<LinkageRowLite[]>
  /** Raw tx hex by txid, for every txid the engine has seen. */
  findRawTxs: (txids: string[]) => Promise<Map<string, string>>
}

export interface ActivityPage {
  entries: ActivityEntry[]
  /**
   * Pass as `before` to fetch the next (older) page; null when exhausted.
   * The cursor is INCLUSIVE (createdAt <= cursor) so a tx group dropped at
   * this page's boundary is re-served complete — consumers must dedupe
   * entries by txid across pages (keep the first occurrence).
   */
  nextCursor: string | null
}

/** Extra linkage rows fetched past the page size so a tx whose outputs straddle
 *  the boundary can be dropped whole and re-served complete on the next page. */
const GROUP_OVERLAP = 8

interface FtOutput { outputIndex: number, identityKey: string, amount: number, assetId: string }

/** Decode every MandalaToken output of a raw tx, attaching owner identities. */
function decodeFtOutputs (rawTx: string, owners: Map<number, string>): FtOutput[] {
  const tx = Transaction.fromHex(rawTx)
  const out: FtOutput[] = []
  for (let i = 0; i < tx.outputs.length; i++) {
    try {
      const decoded = MandalaToken.decode(tx.outputs[i].lockingScript)
      out.push({ outputIndex: i, identityKey: owners.get(i) ?? '', amount: decoded.amount, assetId: decoded.assetId })
    } catch { /* not an FT output */ }
  }
  return out
}

/** Pure classifier — exported for tests. */
export function summarizeTx (p: {
  txid: string
  when: string
  ftInputs: Array<{ identityKey: string, amount: number, assetId: string }>
  ftOutputs: FtOutput[]
  proofs: ActivityProof[]
}): ActivityEntry | null {
  const { ftInputs, ftOutputs } = p
  if (ftInputs.length === 0 && ftOutputs.length === 0) return null // no FT movement (pure admin tx)

  const assetId = ftOutputs[0]?.assetId ?? ftInputs[0]?.assetId ?? ''
  const sender = ftInputs[0]?.identityKey ?? null
  const inTotal = ftInputs.reduce((a, b) => a + b.amount, 0)
  const outTotal = ftOutputs.reduce((a, b) => a + b.amount, 0)
  const base = { txid: p.txid, when: p.when, assetId, proofs: p.proofs }

  if (sender == null || sender === '') {
    // Nothing verifiably spent — minted supply. Recipient = largest output.
    const to = [...ftOutputs].sort((a, b) => b.amount - a.amount)[0]
    return { ...base, kind: 'issue', from: null, to: to?.identityKey ?? null, amount: outTotal }
  }

  const external = ftOutputs.filter(o => o.identityKey !== sender && o.identityKey !== '')
  if (external.length > 0) {
    const to = [...external].sort((a, b) => b.amount - a.amount)[0]
    return {
      ...base,
      kind: 'transfer',
      from: sender,
      to: to.identityKey,
      amount: external.reduce((a, b) => a + b.amount, 0)
    }
  }
  if (inTotal > outTotal) {
    return { ...base, kind: 'redeem', from: sender, to: null, amount: inTotal - outTotal }
  }
  return { ...base, kind: 'self', from: sender, to: sender, amount: 0 }
}

export async function buildActivity (
  deps: ActivityDeps,
  opts: { assetId?: string, limit?: number, before?: string } = {}
): Promise<ActivityPage> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
  const rows = await deps.listLinkage(limit + GROUP_OVERLAP, opts.before)
  const hasMore = rows.length === limit + GROUP_OVERLAP

  // Group output-linkage rows by txid, newest first.
  const byTx = new Map<string, LinkageRowLite[]>()
  for (const r of rows) {
    const list = byTx.get(r.txid)
    if (list != null) list.push(r)
    else byTx.set(r.txid, [r])
  }

  // When more rows exist past this page, the last (oldest) group may be
  // missing outputs that fall on the next page — drop it whole and let the
  // cursor re-serve it complete. Its newest row's createdAt is the cursor.
  let nextCursor: string | null = null
  if (hasMore && byTx.size > 1) {
    const lastTxid = [...byTx.keys()].at(-1) as string
    const dropped = byTx.get(lastTxid) as LinkageRowLite[]
    byTx.delete(lastTxid)
    nextCursor = dropped
      .map(r => new Date(r.createdAt).toISOString())
      .sort()
      .at(-1) as string
  }

  const txids = [...byTx.keys()]
  const rawTxs = await deps.findRawTxs(txids)

  // Collect every input's source outpoint across all txs (senders + amounts).
  const sourceOutpoints: Array<{ txid: string, outputIndex: number }> = []
  const parsed = new Map<string, Transaction>()
  for (const txid of txids) {
    const raw = rawTxs.get(txid)
    if (raw == null) continue
    const tx = Transaction.fromHex(raw)
    parsed.set(txid, tx)
    for (const input of tx.inputs) {
      if (input.sourceTXID != null) {
        sourceOutpoints.push({ txid: input.sourceTXID, outputIndex: input.sourceOutputIndex })
      }
    }
  }

  const senderRows = await deps.findLinkageByOutpoints(sourceOutpoints)
  const senderByOutpoint = new Map(senderRows.map(r => [`${r.txid}.${r.outputIndex}`, r]))
  const sourceRaw = await deps.findRawTxs([...new Set(sourceOutpoints.map(o => o.txid))])

  const entries: ActivityEntry[] = []
  for (const [txid, linkRows] of byTx) {
    const tx = parsed.get(txid)
    if (tx == null) continue

    const owners = new Map(linkRows.map(r => [r.outputIndex, r.identityKey]))
    const raw = rawTxs.get(txid) as string
    const ftOutputs = decodeFtOutputs(raw, owners)

    // FT inputs: source outpoints whose linkage we hold, amounts decoded from
    // the source tx (the linkage row proves ownership; the raw tx carries value).
    const ftInputs: Array<{ identityKey: string, amount: number, assetId: string }> = []
    for (const input of tx.inputs) {
      if (input.sourceTXID == null) continue
      const link = senderByOutpoint.get(`${input.sourceTXID}.${input.sourceOutputIndex}`)
      if (link == null) continue
      const srcRaw = sourceRaw.get(input.sourceTXID)
      if (srcRaw == null) continue
      try {
        const srcTx = Transaction.fromHex(srcRaw)
        const decoded = MandalaToken.decode(srcTx.outputs[input.sourceOutputIndex].lockingScript)
        ftInputs.push({ identityKey: link.identityKey, amount: decoded.amount, assetId: decoded.assetId })
      } catch { /* source output not an FT */ }
    }

    const when = linkRows
      .map(r => new Date(r.createdAt).toISOString())
      .sort()
      .at(-1) as string
    const proofs: ActivityProof[] = linkRows.map(r => ({
      outputIndex: r.outputIndex,
      identityKey: r.identityKey,
      keyID: r.linkage.keyID,
      counterparty: r.linkage.counterparty,
      proofType: r.linkage.proofType
    }))

    const entry = summarizeTx({ txid, when, ftInputs, ftOutputs, proofs })
    if (entry == null) continue
    if (opts.assetId != null && opts.assetId !== '' && entry.assetId !== opts.assetId) continue
    entries.push(entry)
  }

  entries.sort((a, b) => b.when.localeCompare(a.when))
  return { entries, nextCursor }
}
