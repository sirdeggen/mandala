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
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

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

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CompanyAvatar name={label} size={40} className="rounded-lg" />
          <div>
            <div className="text-[17px] font-semibold text-foreground">{label}</div>
            {ticker !== '' && <div className="text-[12.5px] font-medium text-subtle-foreground">{ticker}</div>}
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
          backing == null ? 'bg-muted text-muted-foreground' : fullyBacked ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
          {backing == null ? 'Not yet issued' : fullyBacked ? <><ShieldCheck className="size-3.5" /> Fully backed</> : <><TriangleAlert className="size-3.5" /> Under-reserved</>}
        </span>
      </div>

      {/* Figures */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="In circulation" value={compact(circulation)} suffix={ticker} />
        <Figure label="Reserves recorded" value={compact(reserve.total)} suffix={ticker} />
        <Figure label="Backing" value={backing != null ? `${backing.toFixed(1)}%` : '—'} tone={backing == null ? undefined : fullyBacked ? 'success' : 'warning'} />
      </div>

      {/* Backing bar */}
      {backing != null && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', fullyBacked ? 'bg-success' : 'bg-warning')} style={{ width: `${Math.min(100, backing)}%` }} />
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
          <span className="text-muted-foreground">Attestation pending</span>
        )}
        {att?.anchorTxid != null && (
          <a href={`https://whatsonchain.com/tx/${att.anchorTxid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <ExternalLink className="size-3.5" /> Verify attestation on-chain
          </a>
        )}
        <span className="text-muted-foreground">Redeemable at par (1:1)</span>
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-subtle-foreground">
        Circulation is read live from the public overlay. Reserve figures are
        {reserve.source === 'issuer' ? ' as recorded by the issuer' : ' illustrative until connected to a production reserve feed'}.
      </p>
    </div>
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
