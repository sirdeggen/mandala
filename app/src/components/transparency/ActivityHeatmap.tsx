/**
 * A GitHub-contributions-style calendar of on-chain activity, adapted to our
 * design language. Each day is tinted by the dominant activity type that day
 * (issuance / redemption / audit), with intensity by volume; clicking a day
 * opens a popover breaking it down with links to the on-chain transactions.
 *
 * Fed by public overlay activity (issuance + redemption) and signed attestations
 * (audits), filtered to the given instruments — one on an instrument page, all
 * of an institution's on its entity page. The window auto-fits the data.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { fetchOverlayActivity } from '@bsv/mandala/overlayActivity'
import { useComplianceSnapshot } from '../../lib/compliance'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const DAY_MS = 86_400_000
const MIN_WEEKS = 12

type Kind = 'issue' | 'redeem' | 'audit'
interface DayItem { kind: Kind; txid?: string; label: string }
interface Day { date: Date; iso: string; future: boolean; issue: number; redeem: number; audit: number; items: DayItem[] }

const KIND_LABEL: Record<Kind, string> = { issue: 'Issuance', redeem: 'Redemption', audit: 'Audit' }
const KIND_DOT: Record<Kind, string> = { issue: 'bg-success', redeem: 'bg-warning', audit: 'bg-brass' }
// Literal classes so Tailwind emits them; [type][intensity 0..2].
const CELL: Record<Kind, [string, string, string]> = {
  issue: ['bg-success/35', 'bg-success/60', 'bg-success/90'],
  redeem: ['bg-warning/35', 'bg-warning/60', 'bg-warning/90'],
  audit: ['bg-brass/35', 'bg-brass/65', 'bg-brass/95'],
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

function cellClass(d: Day): string {
  const total = d.issue + d.redeem + d.audit
  if (total === 0) return d.future ? 'bg-transparent' : 'bg-muted/50'
  const dominant: Kind = d.audit >= d.issue && d.audit >= d.redeem ? 'audit' : d.issue >= d.redeem ? 'issue' : 'redeem'
  const level = total <= 2 ? 0 : total <= 5 ? 1 : 2
  return CELL[dominant][level]
}

export function ActivityHeatmap({ assetIds, className }: { assetIds: string[]; className?: string }) {
  const set = useMemo(() => new Set(assetIds), [assetIds])
  const snap = useComplianceSnapshot()
  const activity = useQuery({
    queryKey: ['heatmap-activity'] as const,
    staleTime: 60_000,
    queryFn: async () => (await fetchOverlayActivity(undefined, { limit: 1000 })).entries,
  })

  const { weeks, totals } = useMemo(() => {
    const map = new Map<string, Day>()
    const ensure = (iso: string): Day => {
      let d = map.get(iso)
      if (d == null) { d = { date: new Date(`${iso}T00:00:00Z`), iso, future: false, issue: 0, redeem: 0, audit: 0, items: [] }; map.set(iso, d) }
      return d
    }

    for (const e of activity.data ?? []) {
      if (!set.has(e.assetId) || (e.kind !== 'issue' && e.kind !== 'redeem')) continue
      const day = ensure(e.when.slice(0, 10))
      if (e.kind === 'issue') day.issue++; else day.redeem++
      day.items.push({ kind: e.kind, txid: e.txid, label: KIND_LABEL[e.kind] })
    }
    for (const a of snap.attestations) {
      if (!set.has(a.assetId) || a.status !== 'signed') continue
      const day = ensure(a.createdAt.slice(0, 10))
      day.audit++
      day.items.push({ kind: 'audit', txid: a.anchorTxid, label: `${a.auditorName ?? 'Auditor'} · ${a.period}` })
    }

    const totals = { issue: 0, redeem: 0, audit: 0 }
    for (const d of map.values()) { totals.issue += d.issue; totals.redeem += d.redeem; totals.audit += d.audit }

    // Auto-fit window: earliest event to today, at least MIN_WEEKS.
    const todayMs = Date.parse(`${isoDay(new Date())}T00:00:00Z`)
    let earliest = todayMs
    for (const iso of map.keys()) earliest = Math.min(earliest, Date.parse(`${iso}T00:00:00Z`))
    const minStart = todayMs - MIN_WEEKS * 7 * DAY_MS
    let startMs = Math.min(earliest, minStart)
    // Align to the Sunday of the start week (getUTCDay: 0 = Sun).
    startMs -= new Date(startMs).getUTCDay() * DAY_MS

    const cols: Day[][] = []
    for (let wk = startMs; wk <= todayMs; wk += 7 * DAY_MS) {
      const col: Day[] = []
      for (let i = 0; i < 7; i++) {
        const ms = wk + i * DAY_MS
        const iso = isoDay(new Date(ms))
        const d = map.get(iso) ?? { date: new Date(ms), iso, future: ms > todayMs, issue: 0, redeem: 0, audit: 0, items: [] }
        d.future = ms > todayMs
        col.push(d)
      }
      cols.push(col)
    }
    return { weeks: cols, totals }
  }, [activity.data, snap.attestations, set])

  // Month labels above the columns.
  const monthLabels = useMemo(() => weeks.map((col, i) => {
    const first = col[0].date
    const prev = i > 0 ? weeks[i - 1][0].date : null
    const show = prev == null || first.getUTCMonth() !== prev.getUTCMonth()
    return show ? first.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : ''
  }), [weeks])

  const grandTotal = totals.issue + totals.redeem + totals.audit

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-foreground">Activity</div>
          <p className="text-[12px] text-muted-foreground">Issuance, redemption and audits over time, from the public ledger.</p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
          {(['issue', 'redeem', 'audit'] as Kind[]).map(k => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={cn('size-2.5 rounded-[3px]', KIND_DOT[k])} /> {KIND_LABEL[k]}</span>
          ))}
        </div>
      </div>

      {grandTotal === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">No on-chain activity yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto pb-1">
          <div className="inline-block min-w-full">
            {/* Month labels */}
            <div className="mb-1 flex gap-[3px] pl-0">
              {monthLabels.map((m, i) => (
                <div key={i} className="text-[10px] text-subtle-foreground" style={{ width: 13 }}>{m}</div>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((col, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-[3px]">
                  {col.map((d, dIdx) => {
                    const total = d.issue + d.redeem + d.audit
                    if (total === 0) {
                      return <div key={dIdx} className={cn('rounded-[3px]', cellClass(d))} style={{ width: 13, height: 13 }} title={d.future ? undefined : `No activity · ${fmtDate(d.date)}`} />
                    }
                    return (
                      <Popover key={dIdx}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label={`${total} events on ${fmtDate(d.date)}`}
                            className={cn('rounded-[3px] outline-none ring-offset-1 ring-offset-card transition-[box-shadow] hover:ring-2 hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring', cellClass(d))}
                            style={{ width: 13, height: 13 }}
                          />
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-3">
                          <div className="text-[12.5px] font-semibold text-foreground">{fmtDate(d.date)}</div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                            {d.issue > 0 && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-success" /> {d.issue} issuance{d.issue === 1 ? '' : 's'}</span>}
                            {d.redeem > 0 && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-warning" /> {d.redeem} redemption{d.redeem === 1 ? '' : 's'}</span>}
                            {d.audit > 0 && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-brass" /> {d.audit} audit{d.audit === 1 ? '' : 's'}</span>}
                          </div>
                          <div className="mt-2.5 max-h-48 space-y-1.5 overflow-auto border-t border-separator pt-2">
                            {d.items.map((it, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11.5px]">
                                <span className={cn('size-2 shrink-0 rounded-[2px]', KIND_DOT[it.kind])} />
                                <span className="min-w-0 flex-1 truncate text-foreground">{it.label}</span>
                                {it.txid != null && (
                                  <a href={`https://whatsonchain.com/tx/${it.txid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                                    <ExternalLink className="size-3" /> tx
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
