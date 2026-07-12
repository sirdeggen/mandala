import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import 'flag-icons/css/flag-icons.min.css'
import { ChevronRight, FileText, ShieldCheck, Signature, Users, Coins } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOnboarding } from '../../lib/onboarding'
import { useComplianceSnapshot, reservesTotalOf } from '../../lib/compliance'
import { useAdminSummaries } from '../../hooks/useAdminHistory'
import { ICON_BY_NAME } from '@/lib/instrumentIcons'
import { INSTRUMENT_TEMPLATES, TEMPLATE_CATEGORIES, type InstrumentTemplate } from '@/content/instrumentTemplates'
import IssueInstrumentDrawer, { type IssuePrefill } from './IssueInstrumentDrawer'
import { cn } from '@/lib/utils'

/**
 * Issuer home - a visual, category-tabbed gallery of starter templates for the
 * most common instrument types. Picking a card opens the Issue drawer pre-filled
 * ("Custom" starts blank). Each card is an image tile with a dark→transparent
 * gradient and the instrument label laid over it. Tabs fade the grid in on
 * switch via CSS (`animate-in`) - no animation dependency.
 */
export default function IssuerHome({ assets, onReload, onOpenInstrument }: {
  assets: AdminAsset[]
  onReload: () => void
  onOpenInstrument: (assetId: string) => void
}) {
  const { name } = useOnboarding()
  const [active, setActive] = useState<string>(TEMPLATE_CATEGORIES[0]!)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [prefill, setPrefill] = useState<IssuePrefill | undefined>()

  const items = useMemo(
    () => INSTRUMENT_TEMPLATES.filter(t => t.category === active),
    [active]
  )

  const useTemplate = (t: InstrumentTemplate) => {
    setPrefill({ templateId: t.id, label: t.name, ticker: t.ticker, decimals: t.decimals })
    setDrawerOpen(true)
  }

  return (
    <div>
      {/* Hero */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">
            Welcome{name.trim() !== '' ? `, ${name.trim()}` : ''}
          </h1>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            Pick a starter template to issue a reserve-backed instrument, or start from scratch.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] text-muted-foreground">
          <ShieldCheck className="size-4 text-success" />
          Reserve-backed, auditor-ready
        </span>
      </div>

      {/* Category tabs */}
      <div className="mt-8 flex gap-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TEMPLATE_CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className={cn(
              'relative whitespace-nowrap pb-3 pt-2 text-[14px] font-medium transition-colors',
              'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-opacity',
              active === c ? 'text-foreground after:opacity-100' : 'text-muted-foreground hover:text-foreground after:opacity-0'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Cards - keyed by tab so the fade-in replays on switch */}
      <div key={active} className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((t, i) => (
          <TemplateCard key={t.id} template={t} index={i} onUse={() => useTemplate(t)} />
        ))}
      </div>

      {/* In-circulation financial stats */}
      {assets.length > 0 && <CirculationStats assets={assets} />}

      <IssueInstrumentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        prefill={prefill}
        onIssued={(id) => { onReload(); if (id) onOpenInstrument(id) }}
      />
    </div>
  )
}

// ── In-circulation stats ──────────────────────────────────────────────────────

interface Stat {
  key: string
  value: number
  format: (n: number) => string
  label: string
  Icon: LucideIcon
  accent: string          // tailwind text color for the icon
  tint: string            // tailwind bg for the icon chip
  hint?: string           // small secondary line under the value
  to?: string             // route to navigate to on click
}

/** Animated count-up driven by requestAnimationFrame (no animation dependency).
 *  Honours prefers-reduced-motion by snapping to the final value. */
function useCountUp(to: number, duration = 1400): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVal(to)
      return
    }
    let raf = 0
    let start: number | null = null
    const tick = (t: number) => {
      if (start == null) start = t
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setVal(to * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, duration])
  return val
}

function CirculationStats({ assets }: { assets: AdminAsset[] }) {
  const navigate = useNavigate()
  const snap = useComplianceSnapshot()
  const summaries = useAdminSummaries(assets.map(a => a.assetId))

  // Aggregate real figures across every issued instrument. Circulation comes
  // from the overlay summaries (issued − redeemed); reserves from the compliance
  // reserve buckets; holders from the global screened-holder set.
  const agg = useMemo(() => {
    let reserves = 0
    let circulation = 0
    for (const a of assets) {
      const decimals = Number(a.metadata?.decimals) || 0
      const bucket = snap.buckets[a.assetId]
      if (bucket != null) reserves += reservesTotalOf(bucket)
      const s = summaries[a.assetId]
      if (s != null) circulation += (s.totalIssued - s.totalRedeemed) / 10 ** decimals
    }
    const backing = circulation > 0 ? (reserves / circulation) * 100 : (reserves > 0 ? 100 : 0)
    const holders = Object.keys(snap.holders).length
    return { reserves, circulation, backing, holders }
  }, [assets, snap, summaries])

  const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

  const stats: Stat[] = [
    {
      key: 'instruments', value: assets.length, format: n => String(Math.round(n)),
      label: 'Instruments in circulation', Icon: Signature, accent: 'text-indigo-600', tint: 'bg-indigo-500/10',
      to: '/issuer/overview',
    },
    {
      key: 'backing', value: agg.backing, format: n => `${Math.round(n)}%`,
      label: 'Reserves backing', hint: 'Across all instruments', Icon: ShieldCheck, accent: 'text-success', tint: 'bg-success/10',
      to: '/issuer/compliance',
    },
    {
      key: 'holders', value: agg.holders, format: n => Math.round(n).toLocaleString('en-US'),
      label: 'Holders', hint: 'Screened, all instruments', Icon: Users, accent: 'text-amber-600', tint: 'bg-amber-500/10',
      to: '/issuer/relationships',
    },
    {
      key: 'circulation', value: agg.circulation, format: n => compact(n),
      label: 'Total in circulation', hint: 'Issued − redeemed', Icon: Coins, accent: 'text-sky-600', tint: 'bg-sky-500/10',
      to: '/issuer/reports',
    },
  ]

  return (
    <div className="mt-12">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">In circulation</h2>
      <p className="mt-0.5 text-[13.5px] text-muted-foreground">A live snapshot across every instrument you’ve issued.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-sidebar p-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(s => <StatCard key={s.key} stat={s} onClick={s.to != null ? () => navigate(s.to!) : undefined} />)}
      </div>
    </div>
  )
}

function StatCard({ stat, onClick }: { stat: Stat; onClick?: () => void }) {
  const n = useCountUp(stat.value)
  const { Icon } = stat
  const clickable = onClick != null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        'flex flex-col justify-between rounded-xl border border-border bg-card p-5 text-left transition-colors',
        clickable && 'group hover:border-muted-foreground/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('grid size-9 place-items-center rounded-xl', stat.tint)}>
          <Icon className={cn('size-[18px]', stat.accent)} strokeWidth={2} />
        </span>
        {clickable && <ChevronRight className="size-4 text-faint-foreground transition-colors group-hover:text-foreground" />}
      </div>
      <div className="mt-6">
        <div className="tabular text-[32px] font-semibold leading-none tracking-[-0.02em] text-foreground">
          {stat.format(n)}
        </div>
        <div className="mt-1.5 text-[13px] text-muted-foreground">{stat.label}</div>
        {stat.hint != null && <div className="mt-0.5 text-[11px] text-faint-foreground">{stat.hint}</div>}
      </div>
    </button>
  )
}

function TemplateCard({ template, index, onUse }: {
  template: InstrumentTemplate
  index: number
  onUse: () => void
}) {
  const Icon = ICON_BY_NAME[template.icon] ?? FileText
  return (
    <button
      type="button"
      onClick={onUse}
      style={{ animationDelay: `${(index % 4) * 45}ms`, animationFillMode: 'backwards' }}
      className="group animate-in relative block aspect-[4/3] overflow-hidden rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <img
        src={template.image}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full bg-muted object-cover transition-transform duration-500 group-hover:scale-[1.05]"
      />
      {/* Dark → transparent gradient the label sits on */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

      {/* Icon glyph */}
      <span className="absolute left-3 top-3 grid size-7 place-items-center rounded-lg bg-black/35 text-white backdrop-blur-sm">
        <Icon className="size-3.5" strokeWidth={2} />
      </span>

      {/* Popular badge */}
      {template.popular && (
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-900">
          Popular
        </span>
      )}

      {/* Label over the gradient */}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.7px] text-white/70">{template.category}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[16px] font-semibold leading-tight text-white">
          {template.flag != null && (
            <span className={`fi fi-${template.flag} shrink-0 rounded-[3px] shadow-sm`} aria-hidden="true" />
          )}
          {template.name || 'Custom instrument'}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-white/90">
          {template.name ? 'Use template' : 'Start from scratch'}
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  )
}
