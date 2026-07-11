import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, FileSpreadsheet } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import type { ActivityEntry } from '@bsv/mandala/overlayActivity'
import { useOverlayActivity } from '../../hooks/useOverlayActivity'
import { useAdminSummaries } from '../../hooks/useAdminHistory'
import { useComplianceSnapshot } from '../../lib/compliance'
import { useAllReconLinks } from '../../lib/reconciliation'
import {
  REPORT_SPECS, buildReport, withInstrumentColumn,
  type ReportCtx, type DateFilter, type ReportKey,
} from '../../lib/reports'
import { exportBundle, FORMAT_LABEL, type ReportTable, type ExportFormat, type ReportSection } from '../../lib/exports'
import { logExport } from '../../lib/exportHistory'
import { YearSelect, availableYears } from './YearSelect'
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
 * Cross-instrument compliance exports. Pick a scope (all instruments or one),
 * a period (all time, a year, or a custom range), the report types, and pull
 * everything as a single CSV or spreadsheet (.xls). Mirrors the per-instrument
 * Exports tab but rolls up across the whole book.
 */
export default function ComplianceExports({ assets }: { assets: AdminAsset[] }) {
  const snap = useComplianceSnapshot()
  const summaries = useAdminSummaries(assets.map(a => a.assetId))
  const allLinks = useAllReconLinks()

  const [scope, setScope] = useState<'all' | string>('all')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all')
  const [year, setYear] = useState<number>(() => new Date().getFullYear())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<Set<ReportKey>>(() => new Set(REPORT_SPECS.map(s => s.key)))
  const [ledgerMap, setLedgerMap] = useState<Record<string, ActivityEntry[]>>({})

  const collect = useCallback((id: string, entries: ActivityEntry[]) => {
    setLedgerMap(m => (m[id] === entries ? m : { ...m, [id]: entries }))
  }, [])

  const scopeAssets = scope === 'all' ? assets : assets.filter(a => a.assetId === scope)
  const needLedger = selected.has('ledger')

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

  // Build a table per report for the current scope. Screening is global (holders
  // are per Badge ID, not per instrument), so it is never duplicated per row.
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

  const download = (format: ExportFormat) => {
    const sections: ReportSection[] = REPORT_SPECS
      .filter(s => selected.has(s.key) && tablesByKey[s.key].rows.length > 0)
      .map(s => ({ title: s.name, table: tablesByKey[s.key] }))
    if (sections.length === 0) { toast.error('No rows to export for this selection.'); return }
    exportBundle(`${scopeName} compliance ${periodName}`, format, sections)
    logExport({ assetId: scope === 'all' ? '' : scope, reportKey: 'summary', reportName: `${scopeName} · ${sections.length} reports`, format, rowCount: sections.reduce((n, s) => n + s.table.rows.length, 0) })
    toast.success(`Exported ${sections.length} reports (${FORMAT_LABEL[format]})`)
  }

  const toggle = (key: ReportKey) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const allOn = selected.size === REPORT_SPECS.length
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(REPORT_SPECS.map(s => s.key)))

  return (
    <div className="w-full max-w-3xl space-y-5">
      {needLedger && scopeAssets.map(a => <LedgerCollector key={a.assetId} assetId={a.assetId} onEntries={collect} />)}

      {/* Scope + period controls */}
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Scope</label>
          <Select value={scope} onChange={e => setScope(e.target.value)} className="h-9 text-[13px]">
            <option value="all">All instruments</option>
            {assets.map(a => <option key={a.assetId} value={a.assetId}>{a.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Period</label>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>
      </div>

      {/* Report selection */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[14px] font-semibold text-foreground">Reports</div>
          <button type="button" onClick={toggleAll} className="text-[12px] font-medium text-primary hover:underline">
            {allOn ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {REPORT_SPECS.map(s => {
            const count = tablesByKey[s.key]?.rows.length ?? 0
            const on = selected.has(s.key)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-foreground/30 bg-accent' : 'border-border hover:bg-muted')}
              >
                <span className={cn('grid size-4 shrink-0 place-items-center rounded border', on ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/40')}>
                  {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">{s.name}</span>
                  <span className="block text-[11px] text-subtle-foreground">{count} row{count === 1 ? '' : 's'}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Download */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="text-[12.5px] text-muted-foreground">
          {selected.size} report{selected.size === 1 ? '' : 's'} · {scopeName} · {periodName}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => download('csv')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted">
            <FileText className="size-4" /> Download CSV
          </button>
          <button type="button" onClick={() => download('xls')} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <FileSpreadsheet className="size-4" /> Download .xls
          </button>
        </div>
      </div>
    </div>
  )
}
