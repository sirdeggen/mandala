import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  FileText, FileSpreadsheet, Eye, Download, Trash2, X,
  ListOrdered, Layers, BadgeCheck, HandCoins, ShieldAlert, Link2, GaugeCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { formatAmount } from '@bsv/mandala/amount'
import { useOverlayActivity } from '../../hooks/useOverlayActivity'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import {
  useReserveBucket, useAttestations, useHolders, useRedemptionRequests,
  reservesTotalOf,
} from '../../lib/compliance'
import { useReconLinks } from '../../lib/reconciliation'
import { RESERVE_CLASS_BY_KEY } from '@/content/reserveClasses'
import { bankForRef } from '@/content/banks'
import { exportReport, FORMAT_LABEL, type ReportTable, type ExportFormat } from '../../lib/exports'
import { logExport, removeExport, useExportHistory } from '../../lib/exportHistory'
import TabHeader from './TabHeader'
import { cn } from '@/lib/utils'

interface ReportDef {
  key: string
  name: string
  description: string
  Icon: LucideIcon
  table: ReportTable
}

const fmtDate = (iso?: string): string => {
  if (iso == null) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Reports & exports - the auditor's evidence pack for a single instrument. Every
 * compliance surface (ledger, reserves, attestations, screening, redemptions,
 * reconciliation) can be previewed and exported as CSV or a spreadsheet, and a
 * recent-exports log tracks what has been pulled.
 */
export default function InstrumentExports({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const decimals = Number(asset?.metadata?.decimals) || 0
  const currency = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'
  const amt = (n: number) => formatAmount(n, decimals)

  const { entries } = useOverlayActivity(assetId)
  const { data: summary } = useAdminSummary(assetId)
  const bucket = useReserveBucket(assetId)
  const attestations = useAttestations(assetId)
  const holders = useHolders()
  const redemptions = useRedemptionRequests(assetId)
  const links = useReconLinks(assetId)
  const history = useExportHistory(assetId)

  const [preview, setPreview] = useState<ReportDef | null>(null)

  const reports = useMemo<ReportDef[]>(() => {
    const circ = summary != null ? summary.totalIssued - summary.totalRedeemed : 0
    const reserves = reservesTotalOf(bucket)

    const ledger: ReportTable = {
      columns: ['When', 'Type', 'From', 'To', 'Amount', 'Transaction hash', 'Linkages'],
      rows: entries.map(e => [
        fmtDate(e.when),
        e.kind,
        e.from ?? 'Minted',
        e.to ?? (e.kind === 'redeem' ? 'Burned' : ''),
        amt(e.amount),
        e.txid,
        String(e.proofs.length),
      ]),
    }

    const composition: ReportTable = {
      columns: ['Reserve class', 'Eligible', 'Amount'],
      rows: bucket.composition.map(l => [
        RESERVE_CLASS_BY_KEY[l.assetClass]?.label ?? l.assetClass,
        RESERVE_CLASS_BY_KEY[l.assetClass]?.eligible === false ? 'No' : 'Yes',
        l.amount.toLocaleString('en-US'),
      ]),
    }

    const attest: ReportTable = {
      columns: ['Period', 'Status', 'Reserves', 'Circulation', 'Backing %', 'Auditor', 'Reviewed'],
      rows: attestations.map(a => [
        a.period,
        a.status,
        a.reservesTotal.toLocaleString('en-US'),
        `${a.circulation.toLocaleString('en-US')} ${a.currency}`,
        a.circulation > 0 ? ((a.reservesTotal / a.circulation) * 100).toFixed(1) : '',
        a.auditorName ?? '',
        fmtDate(a.reviewedAt),
      ]),
    }

    const screening: ReportTable = {
      columns: ['Badge ID', 'Name', 'KYC', 'Sanctions', 'PEP', 'Risk', 'Updated'],
      rows: holders.map(h => [
        h.identityKey, h.name, h.kyc, h.sanctions, h.pep ? 'Yes' : 'No', h.risk, fmtDate(h.updatedAt),
      ]),
    }

    const redemption: ReportTable = {
      columns: ['Requested', 'Holder', 'Badge ID', 'Amount', 'Status', 'Processed', 'Note'],
      rows: redemptions.map(r => [
        fmtDate(r.requestedAt), r.holderName, r.holderKey, `${amt(r.amount)} ${r.currency}`, r.status, fmtDate(r.processedAt), r.note ?? '',
      ]),
    }

    const reconciliation: ReportTable = {
      columns: ['Ledger hash', 'Kind', 'Reference', 'Amount', 'Status'],
      rows: links.map(l => {
        if (l.adjustment != null) {
          return [l.ledgerTxid, 'Manual adjustment', l.adjustment.reason, amt(l.amount), l.adjustment.status === 'signed' ? `Signed by ${l.adjustment.auditorName}` : 'Awaiting sign-off']
        }
        const bank = l.bankTransferId != null ? bankForRef(l.bankTransferId) : null
        return [l.ledgerTxid, 'Bank statement', bank != null ? `${bank.name} ${bank.account}` : (l.bankTransferId ?? ''), amt(l.amount), 'Linked']
      }),
    }

    const backing = circ > 0 ? `${((reserves / circ) * 100).toFixed(1)}%` : (reserves > 0 ? '100%' : 'n/a')
    const summaryTable: ReportTable = {
      columns: ['Metric', 'Value'],
      rows: [
        ['Instrument', asset?.label ?? assetId],
        ['Reference currency', currency],
        ['In circulation', `${amt(circ)} ${currency}`],
        ['Total issued', summary != null ? amt(summary.totalIssued) : '0'],
        ['Total redeemed', summary != null ? amt(summary.totalRedeemed) : '0'],
        ['Reserves recorded', reserves.toLocaleString('en-US')],
        ['Backing', backing],
        ['Reserve lines', String(bucket.composition.length)],
        ['Signed attestations', String(attestations.filter(a => a.status === 'signed').length)],
        ['Holders screened', String(holders.length)],
        ['Sanctions hits', String(holders.filter(h => h.sanctions === 'hit').length)],
        ['Open redemptions', String(redemptions.filter(r => r.status === 'pending').length)],
        ['Reconciliation links', String(links.length)],
        ['Generated', fmtDate(new Date().toISOString())],
      ],
    }

    return [
      { key: 'summary', name: 'Compliance summary', description: 'Backing, circulation, reserves and open items at a glance.', Icon: GaugeCircle, table: summaryTable },
      { key: 'ledger', name: 'Transaction ledger', description: 'Every issuance, transfer and redemption with linkage proofs.', Icon: ListOrdered, table: ledger },
      { key: 'composition', name: 'Reserve composition', description: 'The assets held to back this instrument, by class.', Icon: Layers, table: composition },
      { key: 'attestations', name: 'Reserve attestations', description: 'Period attestations and their auditor sign-off.', Icon: BadgeCheck, table: attest },
      { key: 'redemptions', name: 'Redemption register', description: 'Redemption requests and how they were settled.', Icon: HandCoins, table: redemption },
      { key: 'screening', name: 'Holder screening & KYC', description: 'Screening, KYC status and risk for every holder.', Icon: ShieldAlert, table: screening },
      { key: 'reconciliation', name: 'Reconciliation', description: 'Ledger statements linked to bank statements and adjustments.', Icon: Link2, table: reconciliation },
    ]
  }, [entries, summary, bucket, attestations, holders, redemptions, links, asset, assetId, currency])

  const runExport = (r: ReportDef, format: ExportFormat) => {
    exportReport(`${asset?.label ?? 'instrument'} ${r.name}`, format, r.table)
    logExport({ assetId, reportKey: r.key, reportName: r.name, format, rowCount: r.table.rows.length })
    toast.success(`Exported ${r.name} (${FORMAT_LABEL[format]})`)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <TabHeader
        title="Reports & exports"
        description="Preview and export the evidence an auditor needs - as CSV or a spreadsheet - across every compliance surface for this instrument."
        guide="/help/for-auditors/reading-reconciliation-reports"
      />

      {/* Report catalogue */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {reports.map(r => (
          <div key={r.key} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <r.Icon className="size-4.5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-foreground">{r.name}</div>
                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{r.description}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint-foreground">{r.table.rows.length} row{r.table.rows.length === 1 ? '' : 's'}</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                <ActionBtn Icon={Eye} label="View" onClick={() => setPreview(r)} />
                <ActionBtn Icon={FileText} label="CSV" onClick={() => runExport(r, 'csv')} disabled={r.table.rows.length === 0} />
                <ActionBtn Icon={FileSpreadsheet} label="Spreadsheet" onClick={() => runExport(r, 'xls')} disabled={r.table.rows.length === 0} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent exports */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-3 text-[14px] font-semibold text-foreground">Recent exports</div>
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            No exports yet. Export a report above and it will be logged here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[1.4fr_90px_60px_1fr_72px] items-center border-b border-border bg-muted/40 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
              <div>Report</div><div>Format</div><div className="text-right">Rows</div><div className="text-right">Created</div><div className="text-right">Actions</div>
            </div>
            {history.map(h => {
              const report = reports.find(r => r.key === h.reportKey)
              return (
                <div key={h.id} className="grid grid-cols-[1.4fr_90px_60px_1fr_72px] items-center border-t border-separator px-3 py-2 text-[12.5px]">
                  <div className="truncate font-medium text-foreground">{h.reportName}</div>
                  <div><span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">{FORMAT_LABEL[h.format]}</span></div>
                  <div className="text-right tabular text-muted-foreground">{h.rowCount}</div>
                  <div className="truncate text-right text-[11.5px] text-subtle-foreground">{fmtDate(h.createdAt)}</div>
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label="Re-download"
                      disabled={report == null}
                      onClick={() => report != null && runExport(report, h.format)}
                      className="grid size-7 place-items-center rounded border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <Download className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={() => removeExport(h.id)}
                      className="grid size-7 place-items-center rounded border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {preview != null && <PreviewModal report={preview} onClose={() => setPreview(null)} onExport={runExport} />}
    </div>
  )
}

function ActionBtn({ Icon, label, onClick, disabled }: { Icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
    >
      <Icon className="size-3.5" strokeWidth={2} /> {label}
    </button>
  )
}

/** Full report preview - the "view the report" experience, exportable in place. */
function PreviewModal({ report, onClose, onExport }: {
  report: ReportDef
  onClose: () => void
  onExport: (r: ReportDef, format: ExportFormat) => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 animate-in" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-pop)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-foreground">{report.name}</h2>
            <p className="text-[12px] text-muted-foreground">{report.table.rows.length} row{report.table.rows.length === 1 ? '' : 's'}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <ActionBtn Icon={FileText} label="CSV" onClick={() => onExport(report, 'csv')} disabled={report.table.rows.length === 0} />
            <ActionBtn Icon={FileSpreadsheet} label="Spreadsheet" onClick={() => onExport(report, 'xls')} disabled={report.table.rows.length === 0} />
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {report.table.rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">No data for this report yet.</p>
          ) : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                <tr>
                  {report.table.columns.map(c => (
                    <th key={c} className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-subtle-foreground">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.table.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/40">
                    {row.map((cell, j) => (
                      <td key={j} className={cn('border-b border-separator px-3 py-1.5 align-top', j === 0 && 'font-medium text-foreground', report.table.columns[j] === 'Transaction hash' || report.table.columns[j] === 'Badge ID' || report.table.columns[j]?.includes('hash') ? 'font-mono text-[11px] text-subtle-foreground' : 'text-muted-foreground')}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
