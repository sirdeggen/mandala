import { MandalaAdmin } from '@bsv/templates'
import type { MandalaActionDetails } from '@bsv/templates'
import { OVERLAY_URL } from './constants'

export interface AdminHistoryRow {
  assetId: string
  txid: string
  outputIndex: number
  height: number
  offset: number
  actionDetails: MandalaActionDetails
}

export async function resolveAdminHistory (assetId: string): Promise<AdminHistoryRow[]> {
  try {
    const res = await fetch(`${OVERLAY_URL}/admin/admin-history/${encodeURIComponent(assetId)}`)
    if (!res.ok) return []
    const entries: Array<{
      assetId: string
      txid: string
      outputIndex: number
      height: number
      offset: number
      actionDetails: MandalaActionDetails
    }> = await res.json()
    return entries.map(e => ({
      assetId: e.assetId,
      txid: e.txid,
      outputIndex: e.outputIndex,
      height: e.height,
      offset: e.offset,
      actionDetails: e.actionDetails
    }))
  } catch {
    return []
  }
}

const short = (k?: string): string => k == null ? '' : `${k.slice(0, 8)}…`

export function describeAction (d: MandalaActionDetails): string {
  switch (d.kind) {
    case 'register': return `Registered asset ${d.assetId}`
    case 'issue': return `Issued ${d.amount} units`
    case 'redeem': return `Redeemed (burned) ${d.amount} units`
    case 'recover': return `Recovered ${d.amount} units to ${short(d.recipient as string)}`
    case 'pause': return 'Paused transfers'
    case 'unpause': return 'Resumed transfers'
    case 'blockIdentity': return `Blocked identity ${short(d.identityKey as string)}`
    case 'unblockIdentity': return `Unblocked identity ${short(d.identityKey as string)}`
    case 'allowIdentity': return `Allowlisted identity ${short(d.identityKey as string)}`
    case 'unallowIdentity': return `Removed ${short(d.identityKey as string)} from allowlist`
    case 'setAccessMode': return `Set access mode to ${d.mode}`
    case 'freezeOutput': return `Froze output ${d.outpoint}`
    case 'unfreezeOutput': return `Unfroze output ${d.outpoint}`
    case 'reissue': return `Reissued ${d.amount} units to ${short(d.recipient as string)}${d.bankRef != null ? ` (bankRef ${d.bankRef})` : ''}`
    default: return (d as MandalaActionDetails).kind
  }
}

const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`

export function exportAdminHistoryCsv (rows: AdminHistoryRow[]): string {
  const header = ['txid', 'outputIndex', 'priorOutpoint', 'kind', 'canonicalDetailsJson', 'commitment', 'height', 'offset', 'description']
  const lines = [header.join(',')]
  for (const r of rows) {
    const canonical = MandalaAdmin.canonicalize(r.actionDetails)
    const commitment = MandalaAdmin.commitment(r.actionDetails)
    lines.push([
      esc(r.txid),
      String(r.outputIndex),
      esc(String(r.actionDetails.priorOutpoint ?? '')),
      esc(r.actionDetails.kind),
      esc(canonical),
      esc(commitment),
      String(r.height),
      String(r.offset),
      esc(describeAction(r.actionDetails))
    ].join(','))
  }
  return lines.join('\n')
}
