import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Search, Trash2 } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import type { ActivityEntry } from '@bsv/mandala/overlayActivity'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useOverlayActivity } from '../../hooks/useOverlayActivity'
import { useAdminSummaries } from '../../hooks/useAdminHistory'
import { useComplianceSnapshot } from '../../lib/compliance'
import { useAllReconLinks } from '../../lib/reconciliation'
import {
  REPORT_SPECS, buildReport, withInstrumentColumn,
  type ReportCtx, type DateFilter, type ReportKey,
} from '../../lib/reports'
import { exportReport, exportBundle, FORMAT_LABEL, type ReportTable, type ExportFormat, type ReportSection } from '../../lib/exports'
import { logExport, removeExport, useExportHistory } from '../../lib/exportHistory'
import { YearSelect, availableYears } from './YearSelect'
import { ExportFormatPicker } from './ExportFormatPicker'
import { DownloadSignoffButton, DownloadEventRows } from './DownloadSignoffButton'
import { PopoverSelect, PopoverMultiSelect } from './PopoverSelect'
import { ReportCell, isNowrapColumn } from './ReportCell'
import { useSignedEvents, type SignedEventKind } from '../../lib/signedEvents'

const EVENT_KINDS: { value: SignedEventKind; label: string }[] = [
  { value: 'attestation', label: 'Attestation sign-offs' },
  { value: 'control', label: 'Control sign-offs' },
  { value: 'download', label: 'Report downloads' },
  { value: 'transparency-instrument', label: 'Instrument transparency' },
  { value: 'transparency-entity', label: 'Entity transparency' },
]
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'

type PeriodMode = 'all' | 'year' | 'range'

/** Hidden collector: fetches one instrument's ledger and reports it upward, only
 *  emitting when the entry set actually changes (avoids render loops). */
function LedgerCollector({ assetId, onEntries }: { assetId: string; onEntries: (id: string, entries: ActivityEntry[]) => void }) {
  const { entries } = useOverlayActivity(assetId)
  const sig = `${entries.length}:${entries[0]?.txid ?? ''}:${entries[entries.length - 1]?.txid ?? ''}`
  const last = useRef('')
  useEffect(() => {
    if (last.current !== sig) { last.current = sig; onEntries(assetId, entries) }
  }, [sig, assetId, entries, onEntries])
  return null
}

/**
 * Reports - the cross-instrument reporting workspace. Laid out like the
 * instrument detail view (a tab per report type), but rolls up activity across
 * every instrument (or one, when scoped). Each report can be previewed and
 * exported as CSV, spreadsheet (.xls) or PDF, plus a bulk "download all".
 */
export default function ReportsPage() {
  const { data } = useAdminAssets()
  const assets: AdminAsset[] = data ?? []
  const snap = useComplianceSnapshot()
  const summaries = useAdminSummaries(assets.map(a => a.assetId))
  const allLinks = useAllReconLinks()

  // Selected instrument scope. Empty = all instruments.
  const [scope, setScope] = useState<string[]>([])
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState<ReportKey | 'recent' | 'events'>('summary')
  const [eventTypes, setEventTypes] = useState<SignedEventKind[]>(EVENT_KINDS.map(k => k.value))
  const [ledgerMap, setLedgerMap] = useState<Record<string, ActivityEntry[]>>({})

  const collect = useCallback((id: string, entries: ActivityEntry[]) => {
    setLedgerMap(m => (m[id] === entries ? m : { ...m, [id]: entries }))
  }, [])

  const scopeAssets = scope.length === 0 ? assets : assets.filter(a => scope.includes(a.assetId))

  const filter: DateFilter = periodMode === 'all'
    ? { mode: 'all' }
    : periodMode === 'year' ? { mode: 'year', year } : { mode: 'range', from, to }

  const years = useMemo(() => availableYears([
    ...snap.attestations.map(a => a.createdAt),
    ...snap.requests.map(r => r.requestedAt),
    ...snap.controlActions.map(a => a.createdAt),
    ...Object.values(snap.holders).map(h => h.updatedAt),
    ...Object.values(ledgerMap).flat().map(e => e.when),
  ]), [snap, ledgerMap])

  const ctxFor = useCallback((asset: AdminAsset): ReportCtx => {
    const id = asset.assetId
    return {
      asset, assetId: id,
      decimals: Number(asset.metadata?.decimals) || 0,
      currency: asset.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units',
      entries: ledgerMap[id] ?? [],
      summary: summaries[id] ?? null,
      bucket: snap.buckets[id] ?? { composition: [], circulation: 0 },
      attestations: snap.attestations.filter(a => a.assetId === id),
      holders: Object.values(snap.holders),
      redemptions: snap.requests.filter(r => r.assetId === id),
      links: allLinks.filter(l => l.assetId === id),
      controlActions: snap.controlActions.filter(c => c.assetId === id),
      filter,
    }
  }, [ledgerMap, summaries, snap, allLinks, filter])

  // A table per report for the current scope. Screening is global (holders are
  // per Entity ID), so it is never duplicated per instrument.
  const tablesByKey = useMemo(() => {
    const map = {} as Record<ReportKey, ReportTable>
    for (const spec of REPORT_SPECS) {
      if (spec.key === 'screening') {
        map[spec.key] = scopeAssets[0] != null ? buildReport('screening', ctxFor(scopeAssets[0])) : { columns: [], rows: [] }
      } else if (scopeAssets.length === 1) {
        map[spec.key] = scopeAssets[0] != null ? buildReport(spec.key, ctxFor(scopeAssets[0])) : { columns: [], rows: [] }
      } else {
        const combined: ReportTable = { columns: [], rows: [] }
        for (const a of scopeAssets) {
          const withCol = withInstrumentColumn(a.label, buildReport(spec.key, ctxFor(a)))
          if (combined.columns.length === 0) combined.columns = withCol.columns
          combined.rows.push(...withCol.rows)
        }
        map[spec.key] = combined
      }
    }
    return map
  }, [scope, scopeAssets, ctxFor])

  const scopeName = scope.length === 0
    ? 'All instruments'
    : scope.length === 1
      ? (assets.find(a => a.assetId === scope[0])?.label ?? 'Instrument')
      : `${scope.length} instruments`
  const periodName = periodMode === 'all' ? 'all time' : periodMode === 'year' ? String(year) : `${from || '…'} to ${to || '…'}`
  const isReport = tab !== 'recent' && tab !== 'events'
  const activeSpec = isReport ? REPORT_SPECS.find(s => s.key === tab) : undefined
  const activeTable: ReportTable = isReport ? tablesByKey[tab as ReportKey] : { columns: [], rows: [] }

  // Signed-events log: every wallet-signed, on-chain-anchored action.
  const signedEvents = useSignedEvents()
  const eventsTable: ReportTable = useMemo(() => {
    const rows = signedEvents
      .filter(e => eventTypes.includes(e.kind))
      .map(e => [fmtDateTime(e.at), e.label, e.signerName ?? '', e.signerKey, e.txid ?? ''])
    return { columns: ['When', 'Event', 'Signed by', 'Entity ID', 'Anchor'], rows }
  }, [signedEvents, eventTypes])

  // Tab order: Summary, then Events, then the remaining reports, then Recent.
  const tabItems = useMemo(() => {
    const items: { key: ReportKey | 'recent' | 'events'; label: string }[] = REPORT_SPECS.map(s => ({ key: s.key, label: TAB_SHORT[s.key] }))
    const si = items.findIndex(t => t.key === 'summary')
    items.splice(si + 1, 0, { key: 'events', label: 'Events' })
    items.push({ key: 'recent', label: 'Recent exports' })
    return items
  }, [])

  // Inline filter across every column of the active report.
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filteredRows = q === '' ? activeTable.rows : activeTable.rows.filter(row => row.some(cell => cell.toLowerCase().includes(q)))
  const filteredEvents = q === '' ? eventsTable.rows : eventsTable.rows.filter(row => row.some(cell => cell.toLowerCase().includes(q)))

  // Export history is keyed per-instrument; scope it only when exactly one is selected.
  const historyAssetId = scope.length === 1 ? scope[0]! : ''
  const history = useExportHistory(historyAssetId)

  const fmtList = (formats: ExportFormat[]) => formats.map(f => FORMAT_LABEL[f]).join(', ')

  // Generate one file per selected format.
  const downloadOne = (key: ReportKey, formats: ExportFormat[]) => {
    const spec = REPORT_SPECS.find(s => s.key === key)
    if (spec == null) return
    formats.forEach(f => exportReport(`${scopeName} ${spec.name} ${periodName}`, f, tablesByKey[key]))
  }
  const downloadAllBundle = (formats: ExportFormat[]) => {
    const sections: ReportSection[] = REPORT_SPECS
      .map(s => ({ title: s.name, table: tablesByKey[s.key] }))
      .filter(s => s.table.rows.length > 0)
    if (sections.length === 0) { toast.error('Nothing to export.'); return }
    formats.forEach(f => exportBundle(`${scopeName} all reports ${periodName}`, f, sections))
  }

  // The picker only logs to Recent exports; downloading is a wallet-signed,
  // on-chain-anchored action taken from the Recent exports row.
  const exportOne = (key: ReportKey, formats: ExportFormat[]) => {
    const spec = REPORT_SPECS.find(s => s.key === key)!
    const table = tablesByKey[key]
    if (table.rows.length === 0) { toast.error('No rows to export.'); return }
    logExport({ assetId: historyAssetId, reportKey: key, reportName: `${scopeName} · ${spec.name}`, formats, rowCount: table.rows.length })
    toast.success(`${spec.name} added to Recent exports`, { description: `Sign off to download (${fmtList(formats)}).` })
  }

  const exportAll = (formats: ExportFormat[]) => {
    const rows = REPORT_SPECS.reduce((n, s) => n + tablesByKey[s.key].rows.length, 0)
    if (rows === 0) { toast.error('No rows to export for this selection.'); return }
    logExport({ assetId: historyAssetId, reportKey: 'summary', reportName: `${scopeName} · all reports`, formats, rowCount: rows, bundle: true })
    toast.success(`All reports added to Recent exports`, { description: `Sign off to download (${fmtList(formats)}).` })
  }

  if (assets.length === 0) {
    return (
      <div className="w-full max-w-5xl">
        <Header />
        <div className="mt-6 rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
          No instruments yet. Issue an instrument to start reporting on it.
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl">
      {scopeAssets.map(a => <LedgerCollector key={a.assetId} assetId={a.assetId} onEntries={collect} />)}

      <Header />

      {/* Scope + period + download-all controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <PopoverMultiSelect
          values={scope}
          onChange={setScope}
          placeholder="All instruments"
          summaryNoun="instruments"
          options={assets.map(a => ({ value: a.assetId, label: a.label }))}
        />
        {tab === 'events' && (
          <PopoverMultiSelect
            values={eventTypes}
            onChange={v => setEventTypes(v as SignedEventKind[])}
            placeholder="All event types"
            summaryNoun="event types"
            options={EVENT_KINDS}
          />
        )}
        <PopoverSelect
          value={periodMode}
          onChange={setPeriodMode}
          options={[{ value: 'all', label: 'All time' }, { value: 'year', label: 'By year' }, { value: 'range', label: 'Custom range' }]}
        />
        {periodMode === 'year' && <YearSelect value={year} years={years.length > 0 ? years : [year]} onChange={y => setYear(y === 'all' ? new Date().getFullYear() : y)} />}
        {periodMode === 'range' && (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-auto text-[12px]" />
            <span className="text-[12px] text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-auto text-[12px]" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">Download all</span>
          <ExportFormatPicker onExport={exportAll} />
        </div>
      </div>

      {/* Reports + Recent exports grouped as manila folder tabs. The folder's
          top-edge line sits behind the tabs (absolute, so it survives the
          horizontal scroll container) and the active tab paints over it. */}
      <div className="mt-5">
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" />
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabItems.map(t => {
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'relative shrink-0 whitespace-nowrap rounded-t-lg border border-b-0 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'border-border bg-card text-foreground'
                      : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Folder body - no top border; the baseline above serves as its edge. */}
        <div className="relative rounded-b-xl rounded-tr-xl border border-t-0 border-border bg-card shadow-[var(--shadow-card)]">
          {isReport && activeSpec != null ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-foreground">{activeSpec.name}</div>
                    <p className="text-[12px] text-muted-foreground">{activeSpec.description} · {activeTable.rows.length} row{activeTable.rows.length === 1 ? '' : 's'}</p>
                  </div>
                  <ExportFormatPicker onExport={f => exportOne(tab as ReportKey, f)} disabled={activeTable.rows.length === 0} />
                </div>
                {/* Inline filter - matches any column, highlights matches below. */}
                <div className="relative mt-2.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground" />
                  <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Filter ${activeSpec.name.toLowerCase()}…`} className="h-8 pl-8 pr-20 text-[12px]" />
                  {query.trim() !== '' && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-subtle-foreground">
                      {filteredRows.length} of {activeTable.rows.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                {activeTable.rows.length === 0 ? (
                  <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">No data for this report{scope.length === 0 ? ' across your instruments' : ''} in this period.</p>
                ) : filteredRows.length === 0 ? (
                  <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">No rows match “{query.trim()}”.</p>
                ) : (
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                      <tr>
                        {activeTable.columns.map(c => (
                          <th key={c} className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-subtle-foreground">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/40">
                          {row.map((cell, j) => (
                            <td key={j} className={cn('border-b border-separator px-3 py-1.5 align-top text-muted-foreground', j === 0 && 'font-medium text-foreground', isNowrapColumn(activeTable.columns[j] ?? '') && 'whitespace-nowrap')}>
                              <ReportCell column={activeTable.columns[j] ?? ''} value={cell} query={query.trim()} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : tab === 'events' ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-foreground">Signed events</div>
                  <p className="text-[12px] text-muted-foreground">Every wallet-signed, on-chain-anchored action across the organisation · {eventsTable.rows.length} event{eventsTable.rows.length === 1 ? '' : 's'}</p>
                </div>
                <div className="relative mt-2.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground" />
                  <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter events…" className="h-8 pl-8 pr-20 text-[12px]" />
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                {eventsTable.rows.length === 0 ? (
                  <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">No signed events yet. Signing an attestation, control action, report download or transparency change records one here.</p>
                ) : filteredEvents.length === 0 ? (
                  <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">No events match “{query.trim()}”.</p>
                ) : (
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                      <tr>
                        {eventsTable.columns.map(c => (
                          <th key={c} className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-subtle-foreground">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/40">
                          {row.map((cell, j) => (
                            <td key={j} className={cn('border-b border-separator px-3 py-1.5 align-top text-muted-foreground', j === 1 && 'font-medium text-foreground', isNowrapColumn(eventsTable.columns[j] ?? '') && 'whitespace-nowrap')}>
                              <ReportCell column={eventsTable.columns[j] ?? ''} value={cell} query={query.trim()} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="p-4">
              {history.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                  No exports yet. Export a report above and it will be logged here.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-[1.6fr_120px_60px_1fr_72px] items-center border-b border-border bg-muted/40 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
                    <div>Report</div><div>Files</div><div className="text-right">Rows</div><div className="text-right">Created</div><div className="text-right">Actions</div>
                  </div>
                  {history.map(h => (
                    <Fragment key={h.id}>
                    <div className="grid grid-cols-[1.6fr_120px_60px_1fr_72px] items-center border-t border-separator px-3 py-2 text-[12.5px]">
                      <div className="truncate font-medium text-foreground">{h.reportName}</div>
                      <div className="flex flex-wrap gap-1">
                        {h.formats.map(f => (
                          <span key={f} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{FORMAT_LABEL[f]}</span>
                        ))}
                      </div>
                      <div className="text-right tabular text-muted-foreground">{h.rowCount}</div>
                      <div className="truncate text-right text-[11.5px] text-subtle-foreground">{fmtDateTime(h.createdAt)}</div>
                      <div className="flex justify-end gap-1">
                        <DownloadSignoffButton
                          record={h}
                          onDownload={() => { if (h.bundle) downloadAllBundle(h.formats); else downloadOne(h.reportKey as ReportKey, h.formats) }}
                        />
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
                    <DownloadEventRows record={h} />
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const TAB_SHORT: Record<ReportKey, string> = {
  summary: 'Summary',
  ledger: 'Ledger',
  composition: 'Reserves',
  attestations: 'Attestations',
  redemptions: 'Redemptions',
  screening: 'Screening',
  reconciliation: 'Reconciliation',
  controlActions: 'Controls',
}

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Header() {
  return (
    <div>
      <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">Reports</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">
        Roll up and export activity across every instrument - as CSV, spreadsheet (.xls) or PDF.
      </p>
    </div>
  )
}
