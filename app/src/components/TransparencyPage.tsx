/**
 * Public proof-of-reserves, organised per issuing organisation:
 *   /transparency               org index (every issuer live on the overlay)
 *   /transparency/org/:issuer    one org's instruments
 *   /transparency/:assetId       one instrument's proof-of-reserves page
 * Reachable without a wallet and spanning every issuer: instruments are
 * discovered from the overlay's public global feed and supply is read live, so
 * anyone (holder, auditor, regulator) can verify without trusting the issuer.
 */
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck, ArrowLeft, ChevronRight, TriangleAlert, Building2 } from 'lucide-react'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useAdminSummary } from '../hooks/useAdminHistory'
import { usePublicReserve } from '../lib/publicReserve'
import { useTransparencyPublished, usePublishedMap } from '../lib/transparencySettings'
import { useDiscoverInstruments } from '../hooks/useDiscoverInstruments'
import { useAssetMetadata } from '../hooks/usePublicInstrument'
import { useOrgName } from '../lib/orgDirectory'
import { InstrumentTransparencyView } from './transparency/InstrumentTransparencyView'
import { BrandMark } from './ui/BrandMark'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { Spinner } from './ui/spinner'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// ── Shared chrome ─────────────────────────────────────────────────────────────

function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/transparency" className="flex items-center gap-3">
            <BrandMark />
            <div>
              <div className="text-[15px] font-semibold text-foreground">Reserve transparency</div>
              <div className="text-[12.5px] text-muted-foreground">Verifiable on the public ledger</div>
            </div>
          </Link>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            Live on-chain supply
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">{children}</main>
    </div>
  )
}

// ── Org index ──────────────────────────────────────────────────────────────────

export function TransparencyOverview() {
  const { data, isLoading, isError } = useDiscoverInstruments()
  const published = usePublishedMap()

  // Instruments the issuer has explicitly unpublished are hidden; everything
  // else on the public overlay is listed.
  const entities = (data?.entities ?? [])
    .map(e => ({ ...e, instruments: e.instruments.filter(i => published[i.assetId] !== false) }))
    .filter(e => e.instruments.length > 0)
  const instrumentCount = entities.reduce((n, e) => n + e.instruments.length, 0)

  return (
    <Chrome>
      <h1 data-tour-id="transparency-hero" className="font-heading text-[28px] font-medium tracking-[-0.02em] text-foreground">Proof of reserves</h1>
      <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        Every issuer live on the overlay and every instrument they have in circulation. Supply is read
        straight from the public ledger; open an instrument for its full reserve breakdown.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Issuing entities" value={String(entities.length)} />
        <Kpi label="Instruments" value={String(instrumentCount)} />
      </div>

      {isLoading ? (
        <div className="mt-10 flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner size="sm" tone="brand" /> Loading instruments…</div>
      ) : isError ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">Couldn’t reach the overlay feed.</p>
      ) : entities.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">No instruments in circulation yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {entities.map(e => <OrgCard key={e.issuerKey} issuerKey={e.issuerKey} count={e.instruments.length} />)}
        </div>
      )}

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

function OrgCard({ issuerKey, count }: { issuerKey: string; count: number }) {
  const name = useOrgName(issuerKey)
  return (
    <Link
      to={`/transparency/org/${encodeURIComponent(issuerKey || 'unknown')}`}
      className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40"
    >
      <CompanyAvatar name={name} size={40} className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-foreground">{name}</div>
        <div className="text-[12.5px] text-muted-foreground">{count} instrument{count === 1 ? '' : 's'}</div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" />
    </Link>
  )
}

// ── Org page ─────────────────────────────────────────────────────────────────

export function TransparencyOrg() {
  const { issuer = '' } = useParams()
  const { data, isLoading } = useDiscoverInstruments()
  const published = usePublishedMap()
  const name = useOrgName(issuer)

  const entity = data?.entities.find(e => (e.issuerKey || 'unknown') === issuer)
  const instruments = (entity?.instruments ?? []).filter(i => published[i.assetId] !== false)

  return (
    <Chrome>
      <Link to="/transparency" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All issuers
      </Link>

      <div className="flex items-center gap-3">
        <CompanyAvatar name={name} size={44} className="rounded-xl" />
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{name}</h1>
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Building2 className="size-3.5" /> Issuing entity</div>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-10 flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner size="sm" tone="brand" /> Loading…</div>
      ) : instruments.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">No published instruments for this issuer.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {instruments.map(i => <InstrumentRow key={i.assetId} assetId={i.assetId} />)}
        </div>
      )}
    </Chrome>
  )
}

/** One instrument row on an org page: public metadata + supply + backing. */
function InstrumentRow({ assetId }: { assetId: string }) {
  const meta = useAssetMetadata(assetId)
  const summary = useAdminSummary(assetId).data
  const label = meta.data?.label ?? 'Instrument'
  const ticker = String(meta.data?.ticker ?? '').toUpperCase()
  const decimals = Number(meta.data?.decimals ?? 0) || 0
  const circulation = summary != null ? (summary.totalIssued - summary.totalRedeemed) / 10 ** decimals : 0
  const reserve = usePublicReserve(assetId, circulation)
  const backing = circulation > 0 ? (reserve.total / circulation) * 100 : (reserve.total > 0 ? 100 : null)
  const full = backing != null && backing >= 100

  return (
    <Link
      to={`/transparency/${encodeURIComponent(assetId)}`}
      className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40"
    >
      <CompanyAvatar name={label} size={40} className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-foreground">{label}</div>
        <div className="text-[12.5px] text-muted-foreground">{compact(circulation)} {ticker} in circulation</div>
      </div>
      <span className={cn('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold sm:inline-flex',
        backing == null ? 'bg-muted text-muted-foreground' : full ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
        {backing == null ? 'Not issued' : full ? <><ShieldCheck className="size-3.5" /> Fully backed</> : <><TriangleAlert className="size-3.5" /> Under-reserved</>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" />
    </Link>
  )
}

// ── Per-instrument sub-page ─────────────────────────────────────────────────────

export function TransparencyInstrument() {
  const { assetId = '' } = useParams()
  const asset = (useAdminAssets().data ?? []).find(a => a.assetId === assetId) ?? null
  const published = useTransparencyPublished(assetId)
  const meta = useAssetMetadata(assetId)

  const unknown = asset == null && meta.data == null && !meta.isLoading

  return (
    <Chrome>
      <Link to="/transparency" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All issuers
      </Link>

      {unknown ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">Instrument not found.</p>
      ) : (
        <div className="space-y-4">
          {!published && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>The issuer has not published a curated transparency page for this instrument. Figures below are read live from the public ledger.</span>
            </div>
          )}
          <InstrumentTransparencyView assetId={assetId} asset={asset} />
        </div>
      )}
    </Chrome>
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
