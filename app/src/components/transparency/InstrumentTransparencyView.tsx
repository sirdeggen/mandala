/**
 * The public proof-of-reserves body for a single instrument, driven entirely by
 * public inputs (on-chain supply via the overlay + a public reserve snapshot),
 * so it renders for any identity or an anonymous visitor. Reused by the public
 * /transparency/:assetId route and by the issuer's in-app preview.
 */
import { ShieldCheck, TriangleAlert, ExternalLink, BadgeCheck } from 'lucide-react'
import type { AdminAsset } from '@bsv/mandala/assets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useAssetMetadata } from '../../hooks/usePublicInstrument'
import { usePublicReserve } from '../../lib/publicReserve'
import { useComplianceSnapshot } from '../../lib/compliance'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { assetImage } from '@/lib/instrumentCategory'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// Harmonious palette for reserve-asset classes; deterministic per index.
const RESERVE_COLORS = ['#0e7490', '#0d9488', '#1e3a8a', '#e8622c', '#6d5bd0', '#0891b2', '#64748b']
const reserveColor = (i: number) => RESERVE_COLORS[i % RESERVE_COLORS.length]

/** Last day of the current month, as a monthly attestation cadence stand-in. */
function nextAttestationDue(): string {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function InstrumentTransparencyView({ assetId, asset }: { assetId: string; asset?: AdminAsset | null }) {
  const summary = useAdminSummary(assetId).data
  const metaQuery = useAssetMetadata(assetId)
  const snap = useComplianceSnapshot()

  // Prefer the in-context admin asset (issuer view) for instant metadata; fall
  // back to the public genesis-metadata lookup for anonymous / cross-identity.
  const label = asset?.label ?? metaQuery.data?.label ?? 'Instrument'
  const ticker = String(asset?.metadata?.ticker ?? metaQuery.data?.ticker ?? '').toUpperCase()
  const decimals = Number(asset?.metadata?.decimals ?? metaQuery.data?.decimals ?? 0) || 0

  const circulation = summary != null ? (summary.totalIssued - summary.totalRedeemed) / 10 ** decimals : 0
  const reserve = usePublicReserve(assetId, circulation)
  const backing = circulation > 0 ? (reserve.total / circulation) * 100 : (reserve.total > 0 ? 100 : null)
  const fullyBacked = backing != null && backing >= 100

  const att = snap.attestations
    .filter(x => x.assetId === assetId)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]

  const backingHint = backing == null
    ? 'No tokens are in circulation yet, so there is nothing to back.'
    : fullyBacked
      ? 'Reserves on record cover 100% or more of every token in circulation, redeemable one-for-one.'
      : 'Reserves on record are currently less than the tokens in circulation.'

  return (
    <TooltipProvider delayDuration={120}>
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <InstrumentIcon assetId={assetId} size={40} className="rounded-lg" image={asset != null ? assetImage(asset) : undefined} />
          <div>
            <div className="text-[17px] font-semibold text-foreground">{label}</div>
            {ticker !== '' && <div className="text-[12.5px] font-medium text-subtle-foreground">{ticker}</div>}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className={cn('inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              backing == null ? 'bg-muted text-muted-foreground' : fullyBacked ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
              {backing == null ? 'Not yet issued' : fullyBacked ? <><ShieldCheck className="size-3.5" /> Fully backed</> : <><TriangleAlert className="size-3.5" /> Under-reserved</>}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-center">{backingHint}</TooltipContent>
        </Tooltip>
      </div>

      {/* Figures */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="In circulation" value={compact(circulation)} suffix={ticker} />
        <Figure label="Reserves recorded" value={compact(reserve.total)} suffix={ticker} />
        <Figure label="Backing" value={backing != null ? `${backing.toFixed(1)}%` : '—'} tone={backing == null ? undefined : fullyBacked ? 'success' : 'warning'} />
      </div>

      {/* Backing bar - segmented by reserve-asset class */}
      {backing != null && (
        <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          {reserve.lines.map((l, i) => {
            const seg = reserve.total > 0 ? (l.amount / reserve.total) * Math.min(100, backing) : 0
            if (seg <= 0) return null
            const share = reserve.total > 0 ? (l.amount / reserve.total) * 100 : 0
            return (
              <Tooltip key={l.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${l.label}: ${share.toFixed(0)}% of reserves`}
                    className="h-full outline-none transition-[filter] hover:brightness-110 focus-visible:brightness-110"
                    style={{ width: `${seg}%`, backgroundColor: reserveColor(i) }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-center">
                  <span className="block font-medium">{l.label}</span>
                  <span className="block text-primary-foreground/80">{share.toFixed(0)}% of reserves · {compact(l.amount)} {ticker}</span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      )}

      {/* Reserve composition */}
      {reserve.lines.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Reserve composition</div>
          <div className="overflow-hidden rounded-xl border border-border">
            {reserve.lines.map((l, i) => {
              const share = reserve.total > 0 ? (l.amount / reserve.total) * 100 : 0
              return (
                <div key={l.label} className={cn('flex items-center gap-3 px-3.5 py-2.5', i > 0 && 'border-t border-separator')}>
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: reserveColor(i) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{l.label}</span>
                  <span className="tabular text-[12.5px] text-muted-foreground">{share.toFixed(0)}%</span>
                  <span className="tabular w-24 text-right text-[13px] font-semibold text-foreground">{compact(l.amount)} {ticker}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Attestation + terms */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-separator pt-3 text-[12.5px]">
        {att != null && att.status === 'signed' ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <BadgeCheck className="size-4 text-success" />
            Attested {att.period} by <span className="font-medium text-foreground">{att.auditorName ?? 'auditor'}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Attestation pending · next due {nextAttestationDue()}</span>
        )}
        {att?.anchorTxid != null && (
          <a href={`https://whatsonchain.com/tx/${att.anchorTxid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <ExternalLink className="size-3.5" /> Verify attestation on-chain
          </a>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Redeemable at par (1:1)</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help font-medium text-primary underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60">What is this?</button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-left">
              Every token can be redeemed with the issuer for one unit of the underlying currency at any time, at face value, with no fee or haircut.
            </TooltipContent>
          </Tooltip>
        </span>
      </div>

      <p className="mt-4 text-balance text-[11.5px] leading-relaxed text-subtle-foreground">
        Tokens in circulation are counted directly from the public blockchain, in real time. Reserves shown are
        {reserve.source === 'issuer' ? ' the balances reported by the issuer' : ' an illustrative full-reserve position'}, held to redeem every token one-for-one.
      </p>
    </div>
    </TooltipProvider>
  )
}

function Figure({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: 'success' | 'warning' }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className={cn('mt-1 tabular text-[22px] font-semibold leading-none', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground')}>
        {value}{suffix != null && suffix !== '' && value !== '—' && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}
