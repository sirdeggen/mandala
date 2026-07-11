import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
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
import { exportReport, exportBundle, type ReportTable, type ExportFormat, type ReportSection } from '../../lib/exports'
import { logExport } from '../../lib/exportHistory'
import { YearSelect, availableYears } from './YearSelect'
import { ExportButtonGroup } from './ExportButtonGroup'
import { Select } from '../ui/select'
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

  const [scope, setScope] = useState<'all' | string>('all')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState<ReportKey>('summary')
  const [ledgerMap, setLedgerMap] = useState<Record<string, ActivityEntry[]>>({})

  const collect = useCallback((id: string, entries: ActivityEntry[]) => {
    setLedgerMap(m => (m[id] === entries ? m : { ...m, [id]: entries }))
  }, [])

  const scopeAssets = scope === 'all' ? assets : assets.filter(a => a.assetId === scope)

  const filter: DateFilter = periodMode === 'all'
    ? { mode: 'all' }
    : periodMode === 'year' ? { mode: 'year', year } : { mode: 'range', from, to }

  const years = useMemo(() => availableYears([
    ...snap.attestations.map(a => a.createdAt),
    ...snap.requests.map(r => r.requestedAt),
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
      filter,
    }
  }, [ledgerMap, summaries, snap, allLinks, filter])

  // A table per report for the current scope. Screening is global (holders are
  // per Badge ID), so it is never duplicated per instrument.
  const tablesByKey = useMemo(() => {
    const map = {} as Record<ReportKey, ReportTable>
    for (const spec of REPORT_SPECS) {
      if (spec.key === 'screening') {
        map[spec.key] = scopeAssets[0] != null ? buildReport('screening', ctxFor(scopeAssets[0])) : { columns: [], rows: [] }
      } else if (scope !== 'all') {
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

  const scopeName = scope === 'all' ? 'All instruments' : (assets.find(a => a.assetId === scope)?.label ?? 'Instrument')
  const periodName = periodMode === 'all' ? 'all time' : periodMode === 'year' ? String(year) : `${from || '…'} to ${to || '…'}`
  const activeSpec = REPORT_SPECS.find(s => s.key === tab)!
  const activeTable = tablesByKey[tab]

  // Inline filter across every column of the active report.
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filteredRows = q === '' ? activeTable.rows : activeTable.rows.filter(row => row.some(cell => cell.toLowerCase().includes(q)))

  const exportOne = (key: ReportKey, format: ExportFormat) => {
    const spec = REPORT_SPECS.find(s => s.key === key)!
    const table = tablesByKey[key]
    if (table.rows.length === 0) { toast.error('No rows to export.'); return }
    exportReport(`${scopeName} ${spec.name} ${periodName}`, format, table)
    logExport({ assetId: scope === 'all' ? '' : scope, reportKey: key, reportName: `${scopeName} · ${spec.name}`, format, rowCount: table.rows.length })
    toast.success(`Exported ${spec.name}`)
  }

  const exportAll = (format: ExportFormat) => {
    const sections: ReportSection[] = REPORT_SPECS
      .map(s => ({ title: s.name, table: tablesByKey[s.key] }))
      .filter(s => s.table.rows.length > 0)
    if (sections.length === 0) { toast.error('No rows to export for this selection.'); return }
    exportBundle(`${scopeName} all reports ${periodName}`, format, sections)
    logExport({ assetId: scope === 'all' ? '' : scope, reportKey: 'summary', reportName: `${scopeName} · all reports`, format, rowCount: sections.reduce((n, s) => n + s.table.rows.length, 0) })
    toast.success(`Exported all reports`)
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
        <Select value={scope} onChange={e => setScope(e.target.value)} className="h-9 w-auto text-[13px]">
          <option value="all">All instruments</option>
          {assets.map(a => <option key={a.assetId} value={a.assetId}>{a.label}</option>)}
        </Select>
        <Select value={periodMode} onChange={e => setPeriodMode(e.target.value as PeriodMode)} className="h-9 w-auto text-[13px]">
          <option value="all">All time</option>
          <option value="year">By year</option>
          <option value="range">Custom range</option>
        </Select>
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
          <ExportButtonGroup onExport={exportAll} primary />
        </div>
      </div>

      {/* Report tabs */}
      <div className="mb-5 mt-5 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {REPORT_SPECS.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => setTab(s.key)}
            className={cn(
              'relative whitespace-nowrap pb-3 pt-2 text-[14px] font-medium transition-colors',
              'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-opacity',
              tab === s.key ? 'text-foreground after:opacity-100' : 'text-muted-foreground hover:text-foreground after:opacity-0'
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Active report */}
      <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-foreground">{activeSpec.name}</div>
              <p className="text-[12px] text-muted-foreground">{activeSpec.description} · {activeTable.rows.length} row{activeTable.rows.length === 1 ? '' : 's'}</p>
            </div>
            <ExportButtonGroup onExport={f => exportOne(tab, f)} disabled={activeTable.rows.length === 0} />
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
            <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">No data for this report{scope === 'all' ? ' across your instruments' : ''} in this period.</p>
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
                      <td key={j} className={cn('border-b border-separator px-3 py-1.5 align-top', j === 0 && 'font-medium text-foreground', activeTable.columns[j]?.toLowerCase().includes('hash') || activeTable.columns[j] === 'Badge ID' ? 'font-mono text-[11px] text-subtle-foreground' : 'text-muted-foreground')}>
                        <Highlight text={cell} query={query.trim()} />
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

/** Render `text`, wrapping case-insensitive matches of `query` in a highlight. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.toLowerCase()
  if (q === '' || !text.toLowerCase().includes(q)) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let n = 0
  for (;;) {
    const at = lower.indexOf(q, from)
    if (at === -1) { parts.push(text.slice(from)); break }
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={n++} className="rounded-sm bg-warning/40 px-0.5 text-foreground">{text.slice(at, at + q.length)}</mark>)
    from = at + q.length
  }
  return <>{parts}</>
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
