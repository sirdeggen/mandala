import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowRight, ClipboardCheck, BookOpen, Layers, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOnboarding } from '../../lib/onboarding'
import { useComplianceSnapshot, reservesTotalOf } from '../../lib/compliance'
import { useAdminSummaries } from '../../hooks/useAdminHistory'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { cn } from '@/lib/utils'

/**
 * Auditor home - a verification workspace rather than an issuing surface.
 * Auditors don't create instruments; they confirm that the ones in circulation
 * are fully backed. This lists the instruments available to review and routes
 * into each one's reserves/ledger.
 */
export default function AuditorHome({ assets, onOpenInstrument }: {
  assets: AdminAsset[]
  onOpenInstrument: (assetId: string) => void
}) {
  const { name } = useOnboarding()
  const snap = useComplianceSnapshot()
  const summaries = useAdminSummaries(assets.map(a => a.assetId))

  // Live verification signals across the book an auditor is responsible for.
  const backedCount = assets.filter(a => {
    const decimals = Number(a.metadata?.decimals) || 0
    const s = summaries[a.assetId] ?? null
    const circ = s != null ? (s.totalIssued - s.totalRedeemed) / 10 ** decimals : 0
    const reserves = reservesTotalOf(snap.buckets[a.assetId] ?? { composition: [], circulation: 0 })
    return circ > 0 ? reserves >= circ : reserves > 0
  }).length
  const pendingAtt = snap.attestations.filter(a => a.status === 'submitted').length
  const hits = Object.values(snap.holders).filter(h => h.sanctions === 'hit').length
  const allBacked = assets.length > 0 && backedCount === assets.length

  return (
    <div>
      {/* Hero */}
      <div className="mb-8 max-w-2xl">
        <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">
          Welcome{name.trim() !== '' ? `, ${name.trim()}` : ''}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          Your verification workspace. Confirm that each instrument in circulation is fully backed by reserves.
        </p>
      </div>

      {/* Live verification signals */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Instruments to review" value={String(assets.length)} Icon={Layers} />
        <StatTile label="Fully backed" value={`${backedCount}/${assets.length}`} Icon={ShieldCheck} tone={allBacked ? 'success' : 'warning'} />
        <StatTile label="Attestations to sign" value={String(pendingAtt)} Icon={ClipboardCheck} tone={pendingAtt > 0 ? 'warning' : 'success'} />
        <StatTile label="Sanctions hits" value={String(hits)} Icon={ShieldAlert} tone={hits > 0 ? 'destructive' : 'success'} />
      </div>

      {/* Instruments to review */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Instruments to review</h2>
        <Link to="/help/for-auditors" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <BookOpen className="size-4" /> How verification works
        </Link>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
          <p className="text-[15px] font-medium text-foreground">Nothing to review yet</p>
          <p className="mx-auto mt-1 max-w-sm text-balance text-[13.5px] text-muted-foreground">
            When an issuer registers an instrument, it will appear here for you to verify against reserves.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          {assets.map((a, i) => (
            <button
              key={a.assetId}
              type="button"
              onClick={() => onOpenInstrument(a.assetId)}
              className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <InstrumentIcon assetId={a.assetId} size={38} className="rounded-lg" solid />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-foreground">{a.label}</p>
                <p className="truncate font-mono text-[11px] text-faint-foreground">{a.assetId}</p>
              </div>
              <span className="hidden items-center gap-1.5 text-[13px] font-medium text-muted-foreground sm:inline-flex">
                Verify reserves
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TONE: Record<'success' | 'warning' | 'destructive', { icon: string; value: string }> = {
  success: { icon: 'bg-success/10 text-success', value: 'text-foreground' },
  warning: { icon: 'bg-warning/10 text-warning', value: 'text-warning' },
  destructive: { icon: 'bg-destructive/10 text-destructive', value: 'text-destructive' },
}

function StatTile({ label, value, Icon, tone }: { label: string; value: string; Icon: LucideIcon; tone?: 'success' | 'warning' | 'destructive' }) {
  const t = tone != null ? TONE[tone] : null
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className={cn('grid size-8 place-items-center rounded-lg', t?.icon ?? 'bg-muted text-muted-foreground')}>
        <Icon className="size-4.5" strokeWidth={1.9} />
      </div>
      <p className={cn('mt-3 text-[22px] font-semibold leading-none tracking-[-0.01em]', t?.value ?? 'text-foreground')}>{value}</p>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  )
}
