/**
 * Pure report builders shared by the per-instrument Exports tab and the
 * cross-instrument compliance exports dashboard. Given the data for an
 * instrument, each builder returns a { columns, rows } table; an optional date
 * filter scopes the time-based reports to a year or an explicit range.
 */
import type { AdminAsset } from '@bsv/mandala/assets'
import type { AdminSummary } from '@bsv/mandala/adminHistory'
import type { ActivityEntry } from '@bsv/mandala/overlayActivity'
import { formatAmount } from '@bsv/mandala/amount'
import type { ReserveBucket, Attestation, HolderRecord, RedemptionRequest, ControlAction } from './compliance'
import { reservesTotalOf } from './compliance'
import type { ReconLink } from './reconciliation'
import { RESERVE_CLASS_BY_KEY } from '@/content/reserveClasses'
import { bankForRef } from '@/content/banks'
import type { ReportTable } from './exports'

export type DateFilter =
  | { mode: 'all' }
  | { mode: 'year'; year: number }
  | { mode: 'range'; from: string; to: string }

export function inFilter(iso: string | undefined, filter: DateFilter): boolean {
  if (filter.mode === 'all') return true
  if (iso == null || iso === '') return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (filter.mode === 'year') return new Date(iso).getFullYear() === filter.year
  const from = filter.from !== '' ? new Date(filter.from).getTime() : -Infinity
  const to = filter.to !== '' ? new Date(filter.to).getTime() + 86_400_000 : Infinity // inclusive end day
  return t >= from && t <= to
}

export interface ReportCtx {
  asset: AdminAsset | null
  assetId: string
  decimals: number
  currency: string
  entries: ActivityEntry[]
  summary: AdminSummary | null
  bucket: ReserveBucket
  attestations: Attestation[]
  holders: HolderRecord[]
  redemptions: RedemptionRequest[]
  links: ReconLink[]
  controlActions: ControlAction[]
  filter?: DateFilter
}

export type ReportKey =
  | 'summary' | 'ledger' | 'composition' | 'attestations'
  | 'redemptions' | 'screening' | 'reconciliation' | 'controlActions'

export interface ReportSpec {
  key: ReportKey
  name: string
  description: string
  /** Whether the date filter narrows this report. */
  timeScoped: boolean
}

export const REPORT_SPECS: ReportSpec[] = [
  { key: 'summary', name: 'Compliance summary', description: 'Backing, circulation, reserves and open items at a glance.', timeScoped: false },
  { key: 'ledger', name: 'Transaction ledger', description: 'Every issuance, transfer and redemption with linkage proofs.', timeScoped: true },
  { key: 'composition', name: 'Reserve composition', description: 'The assets held to back this instrument, by class.', timeScoped: false },
  { key: 'attestations', name: 'Reserve attestations', description: 'Period attestations and their auditor sign-off.', timeScoped: true },
  { key: 'redemptions', name: 'Redemption register', description: 'Redemption requests and how they were settled.', timeScoped: true },
  { key: 'screening', name: 'Holder screening & KYC', description: 'Screening, KYC status and risk for every holder.', timeScoped: true },
  { key: 'reconciliation', name: 'Reconciliation', description: 'Ledger statements linked to bank statements and adjustments.', timeScoped: false },
  { key: 'controlActions', name: 'Control actions', description: 'Sensitive admin operations and their auditor sign-off.', timeScoped: true },
]

const fmtDate = (iso?: string): string => {
  if (iso == null || iso === '') return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function buildReport(key: ReportKey, ctx: ReportCtx): ReportTable {
  const filter = ctx.filter ?? { mode: 'all' }
  const amt = (n: number) => formatAmount(n, ctx.decimals)
  const circ = ctx.summary != null ? ctx.summary.totalIssued - ctx.summary.totalRedeemed : 0
  const reserves = reservesTotalOf(ctx.bucket)

  switch (key) {
    case 'ledger': return {
      columns: ['When', 'Type', 'From', 'To', 'Amount', 'Transaction hash', 'Linkages'],
      rows: ctx.entries.filter(e => inFilter(e.when, filter)).map(e => [
        fmtDate(e.when), e.kind, e.from ?? 'Minted', e.to ?? (e.kind === 'redeem' ? 'Burned' : ''), amt(e.amount), e.txid, String(e.proofs.length),
      ]),
    }
    case 'composition': return {
      columns: ['Reserve class', 'Eligible', 'Amount'],
      rows: ctx.bucket.composition.map(l => [
        RESERVE_CLASS_BY_KEY[l.assetClass]?.label ?? l.assetClass,
        RESERVE_CLASS_BY_KEY[l.assetClass]?.eligible === false ? 'No' : 'Yes',
        l.amount.toLocaleString('en-US'),
      ]),
    }
    case 'attestations': return {
      columns: ['Period', 'Status', 'Reserves', 'Circulation', 'Backing %', 'Evidence', 'Auditor', 'Auditor Badge ID', 'Exceptions', 'Reviewed', 'Anchor'],
      rows: ctx.attestations.filter(a => inFilter(a.createdAt, filter)).map(a => [
        a.period, a.status, a.reservesTotal.toLocaleString('en-US'),
        `${a.circulation.toLocaleString('en-US')} ${a.currency}`,
        a.circulation > 0 ? ((a.reservesTotal / a.circulation) * 100).toFixed(1) : '',
        a.evidence ?? '', a.auditorName ?? '', a.auditorKey ?? '',
        a.status === 'signed' ? (a.exceptions ? 'Yes' : 'No') : '',
        fmtDate(a.reviewedAt), a.anchorTxid ?? '',
      ]),
    }
    case 'redemptions': return {
      columns: ['Requested', 'Holder', 'Badge ID', 'Amount', 'Status', 'Processed', 'At-par confirmed by', 'Confirmed Badge ID', 'Confirmed at', 'Anchor', 'Note'],
      rows: ctx.redemptions.filter(r => inFilter(r.requestedAt, filter)).map(r => [
        fmtDate(r.requestedAt), r.holderName, r.holderKey, `${amt(r.amount)} ${r.currency}`, r.status, fmtDate(r.processedAt),
        r.auditorName ?? '', r.auditorKey ?? '', fmtDate(r.attestedAt), r.anchorTxid ?? '', r.note ?? '',
      ]),
    }
    case 'controlActions': return {
      columns: ['When', 'Action', 'Detail', 'Reason', 'Actor', 'Actor Badge ID', 'Status', 'Signed off by', 'Auditor Badge ID', 'Reviewed', 'Anchor'],
      rows: ctx.controlActions.filter(a => inFilter(a.createdAt, filter)).map(a => [
        fmtDate(a.createdAt), a.kind, a.detail, a.reason, a.actorName ?? '', a.actorKey,
        a.status, a.auditorName ?? '', a.auditorKey ?? '', fmtDate(a.reviewedAt), a.anchorTxid ?? '',
      ]),
    }
    case 'screening': return {
      columns: ['Badge ID', 'Name', 'KYC', 'Sanctions', 'PEP', 'Risk', 'Updated'],
      rows: ctx.holders.filter(h => inFilter(h.updatedAt, filter)).map(h => [
        h.identityKey, h.name, h.kyc, h.sanctions, h.pep ? 'Yes' : 'No', h.risk, fmtDate(h.updatedAt),
      ]),
    }
    case 'reconciliation': return {
      columns: ['Ledger hash', 'Kind', 'Reference', 'Amount', 'Status'],
      rows: ctx.links.map(l => {
        if (l.adjustment != null) {
          return [l.ledgerTxid, 'Manual adjustment', l.adjustment.reason, amt(l.amount), l.adjustment.status === 'signed' ? `Signed by ${l.adjustment.auditorName}` : 'Awaiting sign-off']
        }
        const bank = l.bankTransferId != null ? bankForRef(l.bankTransferId) : null
        return [l.ledgerTxid, 'Bank statement', bank != null ? `${bank.name} ${bank.account}` : (l.bankTransferId ?? ''), amt(l.amount), 'Linked']
      }),
    }
    case 'summary':
    default: {
      const backing = circ > 0 ? `${((reserves / circ) * 100).toFixed(1)}%` : (reserves > 0 ? '100%' : 'n/a')
      return {
        columns: ['Metric', 'Value'],
        rows: [
          ['Instrument', ctx.asset?.label ?? ctx.assetId],
          ['Reference currency', ctx.currency],
          ['In circulation', `${amt(circ)} ${ctx.currency}`],
          ['Total issued', ctx.summary != null ? amt(ctx.summary.totalIssued) : '0'],
          ['Total redeemed', ctx.summary != null ? amt(ctx.summary.totalRedeemed) : '0'],
          ['Reserves recorded', reserves.toLocaleString('en-US')],
          ['Backing', backing],
          ['Reserve lines', String(ctx.bucket.composition.length)],
          ['Signed attestations', String(ctx.attestations.filter(a => a.status === 'signed').length)],
          ['Holders screened', String(ctx.holders.length)],
          ['Sanctions hits', String(ctx.holders.filter(h => h.sanctions === 'hit').length)],
          ['Open redemptions', String(ctx.redemptions.filter(r => r.status === 'pending').length)],
          ['Redemptions confirmed at par', String(ctx.redemptions.filter(r => r.auditorSignature != null).length)],
          ['Reconciliation links', String(ctx.links.length)],
          ['Control actions', String(ctx.controlActions.length)],
          ['Actions awaiting sign-off', String(ctx.controlActions.filter(a => a.status === 'pending').length)],
          ['Generated', fmtDate(new Date().toISOString())],
        ],
      }
    }
  }
}

/** Prepend an "Instrument" column to a table (for cross-instrument bundles). */
export function withInstrumentColumn(label: string, table: ReportTable): ReportTable {
  return {
    columns: ['Instrument', ...table.columns],
    rows: table.rows.map(r => [label, ...r]),
  }
}
