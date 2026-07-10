import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowRight, ClipboardCheck, BookOpen } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOnboarding } from '../../lib/onboarding'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { assetImage } from '@/lib/instrumentCategory'

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

      {/* Summary tiles */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="Instruments to review" value={String(assets.length)} Icon={ClipboardCheck} />
        <StatTile label="Verification" value="Continuous" Icon={ShieldCheck} />
        <StatTile label="Source of truth" value="On-chain" Icon={ShieldCheck} />
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
              <InstrumentIcon assetId={a.assetId} size={38} className="rounded-lg" image={assetImage(a)} />
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

function StatTile({ label, value, Icon }: { label: string; value: string; Icon: typeof ShieldCheck }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <Icon className="size-5 text-muted-foreground" strokeWidth={1.8} />
      <p className="mt-3 text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">{value}</p>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  )
}
