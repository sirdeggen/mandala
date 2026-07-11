import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Eye, Download, Trash2, X,
  ListOrdered, Layers, BadgeCheck, HandCoins, ShieldAlert, Link2, GaugeCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ExportButtonGroup } from './ExportButtonGroup'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOverlayActivity } from '../../hooks/useOverlayActivity'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useReserveBucket, useAttestations, useHolders, useRedemptionRequests } from '../../lib/compliance'
import { useReconLinks } from '../../lib/reconciliation'
import { exportReport, exportBundle, FORMAT_LABEL, type ReportTable, type ExportFormat } from '../../lib/exports'
import { logExport, removeExport, useExportHistory } from '../../lib/exportHistory'
import { REPORT_SPECS, buildReport, type ReportCtx, type ReportKey, type DateFilter } from '../../lib/reports'
import { YearSelect, availableYears } from './YearSelect'
import TabHeader from './TabHeader'
import { cn } from '@/lib/utils'

const REPORT_ICON: Record<ReportKey, LucideIcon> = {
  summary: GaugeCircle, ledger: ListOrdered, composition: Layers, attestations: BadgeCheck,
  redemptions: HandCoins, screening: ShieldAlert, reconciliation: Link2,
}

const fmtDate = (iso?: string): string => {
  if (iso == null) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface ReportView { key: ReportKey; name: string; description: string; Icon: LucideIcon; table: ReportTable }

/**
 * Reports & exports - the auditor's evidence pack for a single instrument. Every
 * compliance surface can be previewed and exported as CSV or a spreadsheet
 * (.xls), scoped to a year, with a bulk "download all" and a recent-exports log.
 */
export default function InstrumentExports({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const decimals = Number(asset?.metadata?.decimals) || 0
  const currency = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'

  const { entries } = useOverlayActivity(assetId)
  const { data: summary } = useAdminSummary(assetId)
  const bucket = useReserveBucket(assetId)
  const attestations = useAttestations(assetId)
  const holders = useHolders()
  const redemptions = useRedemptionRequests(assetId)
  const links = useReconLinks(assetId)
  const history = useExportHistory(assetId)

  const [year, setYear] = useState<number | 'all'>('all')
  const [preview, setPreview] = useState<ReportView | null>(null)

  const years = useMemo(
    () => availableYears([...entries.map(e => e.when), ...attestations.map(a => a.createdAt), ...redemptions.map(r => r.requestedAt)]),
    [entries, attestations, redemptions],
  )
  const filter: DateFilter = year === 'all' ? { mode: 'all' } : { mode: 'year', year }

  const reports = useMemo<ReportView[]>(() => {
    const ctx: ReportCtx = { asset, assetId, decimals, currency, entries, summary: summary ?? null, bucket, attestations, holders, redemptions, links, filter }
    return REPORT_SPECS.map(spec => ({
      key: spec.key, name: spec.name, description: spec.description, Icon: REPORT_ICON[spec.key],
      table: buildReport(spec.key, ctx),
    }))
  }, [asset, assetId, decimals, currency, entries, summary, bucket, attestations, holders, redemptions, links, filter])

  const scopeLabel = `${asset?.label ?? 'instrument'}${year === 'all' ? '' : ` ${year}`}`

  const runExport = (r: ReportView, format: ExportFormat) => {
    exportReport(`${scopeLabel} ${r.name}`, format, r.table)
    logExport({ assetId, reportKey: r.key, reportName: r.name, format, rowCount: r.table.rows.length })
    toast.success(`Exported ${r.name} (${FORMAT_LABEL[format]})`)
  }

  const downloadAll = (format: ExportFormat) => {
    const sections = reports.filter(r => r.table.rows.length > 0).map(r => ({ title: r.name, table: r.table }))
    if (sections.length === 0) { toast.error('Nothing to export yet.'); return }
    exportBundle(`${scopeLabel} all reports`, format, sections)
    logExport({ assetId, reportKey: 'summary', reportName: 'All reports', format, rowCount: sections.reduce((n, s) => n + s.table.rows.length, 0) })
    toast.success(`Exported all reports (${FORMAT_LABEL[format]})`)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <TabHeader
        title="Reports"
        description="Preview and export the evidence an auditor needs - as CSV, spreadsheet (.xls) or PDF - across every compliance surface for this instrument."
        guide="/help/for-auditors/reading-reconciliation-reports"
      />

      {/* Toolbar: scope by year + download everything */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">Period</span>
          <YearSelect value={year} years={years} onChange={setYear} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">Download all</span>
          <ExportButtonGroup onExport={downloadAll} primary />
        </div>
      </div>

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
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ActionBtn Icon={Eye} label="View" onClick={() => setPreview(r)} />
                <ExportButtonGroup onExport={f => runExport(r, f)} disabled={r.table.rows.length === 0} />
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
            <div className="grid grid-cols-[1.4fr_70px_60px_1fr_72px] items-center border-b border-border bg-muted/40 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
              <div>Report</div><div>Format</div><div className="text-right">Rows</div><div className="text-right">Created</div><div className="text-right">Actions</div>
            </div>
            {history.map(h => {
              const report = reports.find(r => r.key === h.reportKey)
              return (
                <div key={h.id} className="grid grid-cols-[1.4fr_70px_60px_1fr_72px] items-center border-t border-separator px-3 py-2 text-[12.5px]">
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
  report: ReportView
  onClose: () => void
  onExport: (r: ReportView, format: ExportFormat) => void
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
            <ExportButtonGroup onExport={f => onExport(report, f)} disabled={report.table.rows.length === 0} />
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
                      <td key={j} className={cn('border-b border-separator px-3 py-1.5 align-top', j === 0 && 'font-medium text-foreground', report.table.columns[j]?.toLowerCase().includes('hash') || report.table.columns[j] === 'Badge ID' ? 'font-mono text-[11px] text-subtle-foreground' : 'text-muted-foreground')}>
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
