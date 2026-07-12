/**
 * Public proof-of-reserves. Organised per issuing organisation, with a
 * dedicated sub-page per instrument:
 *   /transparency            org overview (this org's published instruments)
 *   /transparency/:assetId   one instrument's proof-of-reserves page
 * Reachable without a wallet; supply is read live from the public overlay, so
 * anyone (holder, auditor, regulator) can verify without trusting the issuer.
 */
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck, ArrowLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useAdminSummaries } from '../hooks/useAdminHistory'
import { useComplianceSnapshot } from '../lib/compliance'
import { computePublicReserve } from '../lib/publicReserve'
import { usePublishedMap, useTransparencyPublished } from '../lib/transparencySettings'
import { useCompanyLogo } from '../lib/companyLogo'
import { useOnboarding } from '../lib/onboarding'
import { useAssetMetadata } from '../hooks/usePublicInstrument'
import { InstrumentTransparencyView } from './transparency/InstrumentTransparencyView'
import { BrandMark } from './ui/BrandMark'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// ── Shared chrome ─────────────────────────────────────────────────────────────

function Chrome({ children }: { children: React.ReactNode }) {
  const companyLogo = useCompanyLogo()
  const companyName = useOnboarding().entity?.legalName || 'Your organisation'
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/transparency" className="flex items-center gap-3">
            {companyLogo != null
              ? <img src={companyLogo} alt="" className="size-10 rounded-lg border border-border object-contain" />
              : <BrandMark />}
            <div>
              <div className="text-[15px] font-semibold text-foreground">{companyName}</div>
              <div className="text-[12.5px] text-muted-foreground">Live reserve transparency</div>
            </div>
          </Link>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            Verifiable on the public ledger
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  )
}

// ── Org overview ──────────────────────────────────────────────────────────────

export function TransparencyOverview() {
  const assets = useAdminAssets().data ?? []
  const published = usePublishedMap()
  const summaries = useAdminSummaries(assets.map(a => a.assetId))
  const snap = useComplianceSnapshot()

  const rows = assets
    .filter(a => published[a.assetId] === true)
    .map(a => {
      const decimals = Number(a.metadata?.decimals) || 0
      const ticker = a.metadata?.ticker != null ? String(a.metadata.ticker).toUpperCase() : ''
      const s = summaries[a.assetId]
      const circulation = s != null ? (s.totalIssued - s.totalRedeemed) / 10 ** decimals : 0
      const reserve = computePublicReserve(a.assetId, circulation, snap.buckets[a.assetId])
      const backing = circulation > 0 ? (reserve.total / circulation) * 100 : (reserve.total > 0 ? 100 : null)
      return { asset: a, ticker, circulation, reserves: reserve.total, backing }
    })

  const fullyBacked = rows.filter(r => r.backing != null && r.backing >= 100).length

  return (
    <Chrome>
      <h1 data-tour-id="transparency-hero" className="font-heading text-[28px] font-medium tracking-[-0.02em] text-foreground">Proof of reserves</h1>
      <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        Every unit in circulation settles on a public blockchain and is backed by recorded reserves.
        Open an instrument for its full breakdown, or verify supply yourself on-chain.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Published instruments" value={String(rows.length)} />
        <Kpi label="Fully backed" value={`${fullyBacked}/${rows.length}`} tone={rows.length > 0 && fullyBacked === rows.length ? 'success' : 'warning'} />
        <Kpi label="Signed attestations" value={String(snap.attestations.filter(a => a.status === 'signed').length)} />
        <Kpi label="Anchored on-chain" value={String(snap.attestations.filter(a => a.anchorTxid != null).length)} />
      </div>

      <div className="mt-8 space-y-3">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">
            No instruments have a published transparency page yet.
          </p>
        ) : rows.map(({ asset, ticker, circulation, backing }) => {
          const full = backing != null && backing >= 100
          return (
            <Link
              key={asset.assetId}
              to={`/transparency/${encodeURIComponent(asset.assetId)}`}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40"
            >
              <CompanyAvatar name={asset.label} size={40} className="rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-foreground">{asset.label}</div>
                <div className="text-[12.5px] text-muted-foreground">{compact(circulation)} {ticker} in circulation</div>
              </div>
              <span className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold sm:inline-flex',
                backing == null ? 'bg-muted text-muted-foreground' : full ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                {backing == null ? 'Not issued' : full ? <><ShieldCheck className="size-3.5" /> Fully backed</> : <><TriangleAlert className="size-3.5" /> Under-reserved</>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-faint-foreground" />
            </Link>
          )
        })}
      </div>

      <p className="mt-8 text-[12px] leading-relaxed text-subtle-foreground">
        Supply figures are read live from the public ledger. This is a demonstration deployment; reserve
        and attestation data are illustrative until connected to production reserve and audit feeds.
      </p>

      <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to the app
      </Link>
    </Chrome>
  )
}

// ── Per-instrument sub-page ─────────────────────────────────────────────────────

export function TransparencyInstrument() {
  const { assetId = '' } = useParams()
  const assets = useAdminAssets().data ?? []
  const asset = assets.find(a => a.assetId === assetId) ?? null
  const published = useTransparencyPublished(assetId)
  const meta = useAssetMetadata(assetId)

  // Known if the issuer holds it locally, or if public genesis metadata resolves.
  const exists = asset != null || meta.data != null || meta.isLoading

  return (
    <Chrome>
      <Link to="/transparency" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All instruments
      </Link>

      {!published && asset == null && !meta.isLoading && !exists ? (
        <NotFound />
      ) : !published ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] text-warning">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>This instrument’s transparency page has not been published by the issuer.</span>
          </div>
          <InstrumentTransparencyView assetId={assetId} asset={asset} />
        </div>
      ) : (
        <InstrumentTransparencyView assetId={assetId} asset={asset} />
      )}
    </Chrome>
  )
}

function NotFound() {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">
      Instrument not found.
    </p>
  )
}

// ── Bits ───────────────────────────────────────────────────────────────────────

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className={cn('tabular text-[22px] font-semibold leading-none', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground')}>{value}</div>
      <div className="mt-1 text-[12px] text-muted-foreground">{label}</div>
    </div>
  )
}
