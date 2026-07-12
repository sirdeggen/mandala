/**
 * Public proof-of-reserves, per issuing entity:
 *   /transparency                     directory of entities that opted in
 *   /transparency/:issuer             one entity's transparency page
 *   /transparency/:issuer/:assetId    one instrument's proof-of-reserves page
 * Reachable without a wallet. Supply is read live from the public ledger, so
 * anyone (holder, auditor, regulator) can verify without trusting the issuer.
 * Entities publish their page and opt into the directory from Organisation
 * settings; issuers publish individual instruments from the instrument view.
 */
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck, ArrowLeft, ChevronRight, TriangleAlert, Building2, Search } from 'lucide-react'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useAdminSummary } from '../hooks/useAdminHistory'
import { usePublicReserve } from '../lib/publicReserve'
import { useTransparencyPublished, usePublishedMap } from '../lib/transparencySettings'
import { useEntityTransparency, useListedEntityKeys } from '../lib/orgTransparency'
import { useDiscoverInstruments } from '../hooks/useDiscoverInstruments'
import { useAssetMetadata } from '../hooks/usePublicInstrument'
import { useOrgName } from '../lib/orgDirectory'
import { flagForTicker } from '../lib/instrumentCategory'
import 'flag-icons/css/flag-icons.min.css'
import { InstrumentTransparencyView } from './transparency/InstrumentTransparencyView'
import { BrandMark } from './ui/BrandMark'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { Input } from '@/components/ui/input'
import { Spinner } from './ui/spinner'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// ── Shared chrome ─────────────────────────────────────────────────────────────

function Chrome({ issuerKey, children }: { issuerKey?: string; children: React.ReactNode }) {
  const orgName = useOrgName(issuerKey ?? '')
  const showOrg = issuerKey != null && issuerKey !== ''
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to={showOrg ? `/transparency/${encodeURIComponent(issuerKey!)}` : '/transparency'} className="flex items-center gap-3">
            {showOrg ? <CompanyAvatar name={orgName} size={40} className="rounded-lg" /> : <BrandMark />}
            <div>
              <div className="text-[15px] font-semibold text-foreground">{showOrg ? orgName : 'Reserve transparency'}</div>
              <div className="text-[12.5px] text-muted-foreground">{showOrg ? 'Reserve transparency' : 'Verifiable on the public ledger'}</div>
            </div>
          </Link>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            Live on-chain supply
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">{children}</main>
      <footer className="py-6">
        <a href="/" className="mx-auto flex w-fit items-center gap-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <img src="/icon-192.png" alt="" aria-hidden className="size-5 rounded" />
          Powered by <span className="font-handwritten text-[17px] font-bold leading-none text-foreground">Underwrite</span>
        </a>
      </footer>
    </div>
  )
}

// ── Directory (opted-in entities) ────────────────────────────────────────────

export function TransparencyDirectory() {
  const keys = useListedEntityKeys()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const looksLikeKey = q.length >= 40 && /^[0-9a-f]+$/i.test(query.trim())

  return (
    <Chrome>
      <h1 data-tour-id="transparency-hero" className="font-heading text-[28px] font-medium tracking-[-0.02em] text-foreground">Reserve transparency</h1>
      <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
        Find an issuing institution to see the instruments it has in circulation and how they are backed.
        Supply is counted directly from the public blockchain, in real time.
      </p>

      <div className="relative mt-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by institution name or identity key"
          className="pl-9"
        />
      </div>

      {looksLikeKey && (
        <Link to={`/transparency/${encodeURIComponent(query.trim())}`} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          Open entity page for this identity key <ChevronRight className="size-4" />
        </Link>
      )}

      <div className="mt-8 space-y-3">
        {keys.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">
            No institutions are listed in the public directory yet.
          </p>
        ) : (
          keys.map(k => <DirectoryCard key={k} issuerKey={k} query={q} />)
        )}
      </div>
    </Chrome>
  )
}

function DirectoryCard({ issuerKey, query }: { issuerKey: string; query: string }) {
  const name = useOrgName(issuerKey)
  if (query !== '' && !name.toLowerCase().includes(query) && !issuerKey.toLowerCase().includes(query)) return null
  return (
    <Link
      to={`/transparency/${encodeURIComponent(issuerKey)}`}
      className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40"
    >
      <CompanyAvatar name={name} size={40} className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-foreground">{name}</div>
        <EntityFlags issuerKey={issuerKey} />
      </div>
      <ChevronRight className="size-4 shrink-0 text-faint-foreground" />
    </Link>
  )
}

/** A row of fiat-currency flags for an entity's stablecoins, falling back to the
 *  short identity key. */
function EntityFlags({ issuerKey }: { issuerKey: string }) {
  const { data } = useDiscoverInstruments()
  const instruments = data?.entities.find(e => (e.issuerKey || 'unknown') === issuerKey)?.instruments ?? []
  if (instruments.length === 0) {
    return <div className="truncate text-[12px] text-muted-foreground">{issuerKey.slice(0, 12)}…{issuerKey.slice(-6)}</div>
  }
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      {instruments.slice(0, 8).map(i => <AssetFlag key={i.assetId} assetId={i.assetId} />)}
    </div>
  )
}

function AssetFlag({ assetId }: { assetId: string }) {
  const meta = useAssetMetadata(assetId)
  const flag = flagForTicker(meta.data?.ticker as string | undefined)
  if (flag == null) return null
  return <span className={`fi fi-${flag} rounded-[2px] shadow-sm`} style={{ width: 18, height: 13 }} aria-hidden />
}

// ── Entity page ──────────────────────────────────────────────────────────────

export function TransparencyOrg() {
  const { issuer = '' } = useParams()
  const { data, isLoading } = useDiscoverInstruments()
  const published = usePublishedMap()
  const entity = useEntityTransparency(issuer)
  const name = useOrgName(issuer)

  const group = data?.entities.find(e => (e.issuerKey || 'unknown') === issuer)
  const instruments = (group?.instruments ?? []).filter(i => published[i.assetId] === true)

  return (
    <Chrome issuerKey={issuer}>
      <Link to="/transparency" className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Directory
      </Link>

      <div className="flex items-center gap-3">
        <CompanyAvatar name={name} size={44} className="rounded-xl" />
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{name}</h1>
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Building2 className="size-3.5" /> Issuing institution</div>
        </div>
      </div>

      {!entity.published ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>This institution has not published a transparency page.</span>
        </div>
      ) : isLoading ? (
        <div className="mt-10 flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner size="sm" tone="brand" /> Loading…</div>
      ) : instruments.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">No published instruments for this institution.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {instruments.map(i => <InstrumentRow key={i.assetId} issuer={issuer} assetId={i.assetId} />)}
        </div>
      )}
    </Chrome>
  )
}

/** One instrument row on an entity page: public metadata + supply + backing. */
function InstrumentRow({ issuer, assetId }: { issuer: string; assetId: string }) {
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
      to={`/transparency/${encodeURIComponent(issuer)}/${encodeURIComponent(assetId)}`}
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

// ── Instrument page ──────────────────────────────────────────────────────────

export function TransparencyInstrument() {
  const { issuer = '', assetId = '' } = useParams()
  const asset = (useAdminAssets().data ?? []).find(a => a.assetId === assetId) ?? null
  const published = useTransparencyPublished(assetId)
  const meta = useAssetMetadata(assetId)
  const name = useOrgName(issuer)

  const unknown = asset == null && meta.data == null && !meta.isLoading

  return (
    <Chrome issuerKey={issuer}>
      <Link to={`/transparency/${encodeURIComponent(issuer)}`} className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> {name}
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
