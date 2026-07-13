/**
 * Reviewer console for auditors and individuals. Unlike the issuer console
 * (driven by the connected wallet's own admin assets), this is built for a
 * *different* identity: it discovers instruments across all issuers from the
 * overlay's public feed, lets the reviewer watch the ones they care about, and
 * opens each in a read-only view fed entirely by public data. Signing an
 * attestation still uses the reviewer's own wallet.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Compass, Eye, ShieldCheck, BookOpen, Plus, Check, ExternalLink, Search, TriangleAlert, BadgeCheck } from 'lucide-react'
import type { AdminAsset } from '@bsv/mandala/assets'
import { useWallet } from '../../context/WalletContext'
import { useOnboarding } from '../../lib/onboarding'
import { useUserAvatar } from '../../lib/userAvatar'
import { useWatchlist, toggleWatch } from '../../lib/watchlist'
import { useOrgName, orgNameFor } from '../../lib/orgDirectory'
import { useDiscoverInstruments, type DiscoveredEntity } from '../../hooks/useDiscoverInstruments'
import { useAssetMetadata } from '../../hooks/usePublicInstrument'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useComplianceSnapshot } from '../../lib/compliance'
import { usePublicReserve } from '../../lib/publicReserve'
import { assetImage, flagForTicker } from '../../lib/instrumentCategory'
import { iconColor } from '../../lib/instrumentIcons'
import 'flag-icons/css/flag-icons.min.css'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarInset, SidebarTrigger, SidebarRail,
} from '@/components/ui/sidebar'
import { UserAvatar } from '@/components/ui/user-avatar'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { Input } from '@/components/ui/input'
import { Spinner } from '../ui/spinner'
import ReserveAttestations from '../issuer/ReserveAttestations'
import OverlayActivity from '../issuer/OverlayActivity'
import RegulatoryControls from '../issuer/RegulatoryControls'
import InstrumentExports from '../issuer/InstrumentExports'
import AccountSettings from '../settings/AccountSettings'
import { InstrumentTransparencyView } from '../transparency/InstrumentTransparencyView'
import { cn } from '@/lib/utils'

type Section = 'discover' | 'instrument' | 'settings'
const VALID: Section[] = ['discover', 'instrument', 'settings']


/** Minimal AdminAsset synthesised from public metadata for read-only reuse. */
function publicAsset(assetId: string, meta: { label?: string; ticker?: unknown; decimals?: unknown } | null): AdminAsset {
  return {
    assetId,
    label: meta?.label ?? 'Instrument',
    metadata: { ticker: meta?.ticker, decimals: meta?.decimals },
  } as unknown as AdminAsset
}

export default function ReviewerDashboard() {
  const params = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { identityKey } = useWallet()
  const { name, role } = useOnboarding()
  const avatar = useUserAvatar()
  const watchlist = useWatchlist()

  const section: Section = VALID.includes(params.section as Section) ? (params.section as Section) : 'discover'
  const assetId = searchParams.get('asset') ?? ''

  // Redirect bare/unknown sections to discover.
  useEffect(() => {
    if (params.section != null && !VALID.includes(params.section as Section)) {
      navigate('/reviewer/discover', { replace: true })
    }
  }, [params.section, navigate])

  const go = (s: Section) => navigate(`/reviewer/${s}`)
  const openInstrument = (id: string) => navigate(`/reviewer/instrument?asset=${encodeURIComponent(id)}`)

  const roleLabel = role === 'individual' ? 'VIEWER' : 'AUDITOR'
  const displayName = name.trim() !== '' ? name.trim() : (identityKey != null ? `${identityKey.slice(0, 10)}…` : 'Reviewer')

  return (
    <SidebarProvider className="h-screen overflow-hidden bg-sidebar">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <img src="/icon-192.png" alt="" aria-hidden className="size-8 shrink-0 rounded-md object-contain group-data-[collapsible=icon]:hidden" />
            <div className="grid flex-1 group-data-[collapsible=icon]:hidden">
              <span className="font-handwritten text-[22px] font-bold leading-none tracking-[-0.2px]">Underwrite</span>
              <span className="mt-[3px] text-[9px] font-medium leading-none tracking-[1px] text-sidebar-foreground/60">{roleLabel}</span>
            </div>
            <SidebarTrigger className="size-8 shrink-0 text-muted-foreground hover:text-foreground" />
          </div>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <SidebarGroup className="pb-1">
            <SidebarMenu>
              <SidebarMenuItem data-tour-id="nav-discover">
                <SidebarMenuButton isActive={section === 'discover'} tooltip="Discover" onClick={() => go('discover')}>
                  <Compass strokeWidth={1.9} />
                  <span>Discover</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="min-h-0 flex-1 overflow-y-auto">
            <SidebarGroupLabel>Watching</SidebarGroupLabel>
            <SidebarMenu data-tour-id="watchlist">
              {watchlist.length === 0 ? (
                <p className="px-2 py-1.5 text-[12px] leading-snug text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
                  Nothing watched yet. Find instruments under Discover.
                </p>
              ) : watchlist.map(id => (
                <WatchedNavItem
                  key={id}
                  assetId={id}
                  active={section === 'instrument' && assetId === id}
                  onOpen={() => openInstrument(id)}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Transparency" onClick={() => window.open('/transparency', '_blank')}>
                <ShieldCheck strokeWidth={1.9} />
                <span>Transparency</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Guides" onClick={() => navigate('/help/getting-started')}>
                <BookOpen strokeWidth={1.9} />
                <span>Guides</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Account" onClick={() => go('settings')} isActive={section === 'settings'}>
                <UserAvatar seed={identityKey ?? 'reviewer'} src={avatar} size={22} />
                <span className="truncate">{displayName}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
        <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center border-b border-border bg-card px-3 md:hidden">
          <SidebarTrigger />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-5 lg:p-8">
            {section === 'discover' && <DiscoverPanel onOpen={openInstrument} />}
            {section === 'instrument' && <ReviewerInstrument assetId={assetId} onOpen={openInstrument} />}
            {section === 'settings' && <div className="mx-auto w-full max-w-2xl"><AccountSettings /></div>}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ── Sidebar watched item ────────────────────────────────────────────────────

function WatchedNavItem({ assetId, active, onOpen }: { assetId: string; active: boolean; onOpen: () => void }) {
  const asset = (useAdminAssets().data ?? []).find(a => a.assetId === assetId) ?? null
  const meta = useAssetMetadata(assetId)
  const summary = useAdminSummary(assetId).data
  const label = asset?.label ?? meta.data?.label ?? 'Instrument'
  const ticker = String(asset?.metadata?.ticker ?? meta.data?.ticker ?? '').toUpperCase()
  const decimals = Number(asset?.metadata?.decimals ?? meta.data?.decimals ?? 0) || 0
  const img = asset != null ? assetImage(asset) : undefined
  const flag = flagForTicker(ticker)
  const issued = summary?.totalIssued ?? 0
  const circulation = summary != null ? summary.totalIssued - summary.totalRedeemed : 0
  const showBadge = summary != null && issued > 0

  return (
    <SidebarMenuItem>
      {/* Expanded: photo row, matching the issuer sidebar */}
      <button
        type="button"
        onClick={onOpen}
        className={cn('relative block h-12 w-full overflow-hidden rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden', active && 'ring-2 ring-white/70')}
      >
        {img != null
          ? <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className="absolute inset-0" style={{ backgroundColor: iconColor(assetId) }} />}
        <div className="absolute inset-0" style={{ backgroundColor: iconColor(assetId), opacity: 0.5 }} />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/15" />
        <div className="relative flex h-full items-center gap-2 px-2.5">
          {flag != null && <span className={`fi fi-${flag} h-3.5 w-5 shrink-0 rounded-[2px] shadow-sm ring-1 ring-black/20`} aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold leading-tight text-white">{label}</div>
            {ticker !== '' && <div className="truncate text-[10.5px] font-medium leading-tight text-white/75">{ticker}</div>}
          </div>
          {showBadge && (
            <span className="tabular shrink-0 rounded-full border border-white/45 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/90" title={`${circulation.toLocaleString()} in circulation`}>
              {compact(circulation / 10 ** decimals)}
            </span>
          )}
        </div>
      </button>
      {/* Collapsed: icon */}
      <button
        type="button"
        onClick={onOpen}
        title={label}
        className="hidden w-full place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:grid"
      >
        <InstrumentIcon assetId={assetId} size={28} image={img} className={cn('rounded-md', active && 'ring-2 ring-sidebar-ring ring-offset-2 ring-offset-sidebar')} />
      </button>
    </SidebarMenuItem>
  )
}

// ── Discover ────────────────────────────────────────────────────────────────

function DiscoverPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading, isError } = useDiscoverInstruments()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const entities = (data?.entities ?? []).filter(e => {
    if (q === '') return true
    return orgNameFor(e.issuerKey).toLowerCase().includes(q) || e.issuerKey.toLowerCase().includes(q)
  })

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-heading text-[28px] font-medium tracking-[-0.02em] text-foreground">Discover instruments</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
        Every issued instrument in circulation, grouped by its issuing institution. Add the ones you audit
        or hold to your watchlist and they stay to hand in the sidebar.
      </p>

      <div className="relative mt-6 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by institution name or entity ID"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="mt-10 flex items-center gap-2 text-[13px] text-muted-foreground"><Spinner size="sm" tone="brand" /> Loading instruments…</div>
      ) : isError || data == null ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">Couldn’t reach the overlay feed.</p>
      ) : data.entities.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">No instruments found on the overlay yet.</p>
      ) : entities.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">No institutions match “{query.trim()}”.</p>
      ) : (
        <div className="mt-8 space-y-8">
          {entities.map(entity => <EntityGroup key={entity.issuerKey} entity={entity} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  )
}

function EntityGroup({ entity, onOpen }: { entity: DiscoveredEntity; onOpen: (id: string) => void }) {
  const entityName = useOrgName(entity.issuerKey)
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <CompanyAvatar name={entityName} size={24} className="rounded-md" />
        <span className="text-[13px] font-semibold text-foreground">{entityName}</span>
        <span className="text-[12px] text-muted-foreground">· {entity.instruments.length} instrument{entity.instruments.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {entity.instruments.map((inst, i) => (
          <DiscoverRow key={inst.assetId} assetId={inst.assetId} first={i === 0} onOpen={() => onOpen(inst.assetId)} />
        ))}
      </div>
    </div>
  )
}

function DiscoverRow({ assetId, first, onOpen }: { assetId: string; first: boolean; onOpen: () => void }) {
  const asset = (useAdminAssets().data ?? []).find(a => a.assetId === assetId) ?? null
  const meta = useAssetMetadata(assetId)
  const summary = useAdminSummary(assetId).data
  const snap = useComplianceSnapshot()
  const watchlist = useWatchlist()
  const watched = watchlist.includes(assetId)

  const label = asset?.label ?? meta.data?.label ?? 'Instrument'
  const ticker = String(asset?.metadata?.ticker ?? meta.data?.ticker ?? '').toUpperCase()
  const decimals = Number(asset?.metadata?.decimals ?? meta.data?.decimals ?? 0) || 0
  const flag = flagForTicker(ticker)

  const circulation = summary != null ? (summary.totalIssued - summary.totalRedeemed) / 10 ** decimals : 0
  const reserve = usePublicReserve(assetId, circulation, decimals)
  const backing = circulation > 0 ? (reserve.total / circulation) * 100 : (reserve.total > 0 ? 100 : null)
  const fullyBacked = backing != null && backing >= 100
  const attested = snap.attestations.some(a => a.assetId === assetId && a.status === 'signed')

  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', !first && 'border-t border-separator')}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <InstrumentIcon assetId={assetId} size={36} className="rounded-lg" image={asset != null ? assetImage(asset) : undefined} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-foreground">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {flag != null && <span className={`fi fi-${flag} shrink-0 rounded-[2px] shadow-sm`} style={{ width: 16, height: 12 }} aria-hidden />}
            <span>{ticker || '—'}</span>
          </div>
        </div>
      </button>

      {/* Auditor summary: supply, backing, attestation */}
      <div className="hidden items-center gap-4 md:flex">
        <div className="text-right">
          <div className="tabular text-[13px] font-semibold text-foreground">{compact(circulation)} {ticker}</div>
          <div className="text-[10.5px] text-subtle-foreground">in circulation</div>
        </div>
        <span className={cn('inline-flex w-[116px] items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold',
          backing == null ? 'bg-muted text-muted-foreground' : fullyBacked ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
          {backing == null ? 'No supply' : fullyBacked ? <><ShieldCheck className="size-3 shrink-0" /> {backing.toFixed(0)}% backed</> : <><TriangleAlert className="size-3 shrink-0" /> {backing.toFixed(0)}% backed</>}
        </span>
        <span className={cn('inline-flex w-[92px] items-center justify-center gap-1 text-[11px] font-medium', attested ? 'text-success' : 'text-subtle-foreground')}>
          {attested ? <><BadgeCheck className="size-3.5" /> Attested</> : 'Unattested'}
        </span>
      </div>

      <button
        type="button"
        onClick={() => toggleWatch(assetId)}
        aria-pressed={watched}
        className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
          watched ? 'border-border bg-card text-foreground hover:bg-muted' : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90')}
      >
        {watched ? <><Check className="size-3.5" strokeWidth={3} /> Watching</> : <><Plus className="size-3.5" strokeWidth={2.4} /> Watch</>}
      </button>
    </div>
  )
}

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

// ── Read-only instrument view ────────────────────────────────────────────────

type ITab = 'overview' | 'attestations' | 'activity' | 'restrictions' | 'reports'
const ITABS: { id: ITab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'attestations', label: 'Attestations' },
  { id: 'activity', label: 'Activity' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'reports', label: 'Reports' },
]

function ReviewerInstrument({ assetId }: { assetId: string; onOpen: (id: string) => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const meta = useAssetMetadata(assetId)
  const discovery = useDiscoverInstruments().data
  const watchlist = useWatchlist()
  const watched = watchlist.includes(assetId)

  const paramTab = searchParams.get('tab')
  const tab: ITab = ITABS.some(t => t.id === paramTab) ? (paramTab as ITab) : 'overview'
  const setTab = (id: ITab) => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('tab', id); return n }, { replace: true })

  if (assetId === '') {
    return <p className="mx-auto max-w-3xl rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">Select an instrument from Discover or your watchlist.</p>
  }

  const label = meta.data?.label ?? 'Instrument'
  const ticker = String(meta.data?.ticker ?? '').toUpperCase()
  const decimals = Number(meta.data?.decimals ?? 0) || 0
  const asset = publicAsset(assetId, meta.data ?? null)
  const issuerKey = discovery?.instruments.find(i => i.assetId === assetId)?.issuerKey ?? ''
  const publicHref = issuerKey !== '' ? `/transparency/${encodeURIComponent(issuerKey)}/${encodeURIComponent(assetId)}` : null

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CompanyAvatar name={label} size={44} className="rounded-xl" />
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{label}</h1>
            {ticker !== '' && <div className="text-[13px] font-medium text-muted-foreground">{ticker}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {publicHref != null && (
            <a href={publicHref} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted">
              <ExternalLink className="size-3.5" /> Public page
            </a>
          )}
          <button type="button" onClick={() => toggleWatch(assetId)} aria-pressed={watched}
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              watched ? 'border-border text-foreground hover:bg-muted' : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90')}>
            {watched ? <><Eye className="size-3.5" /> Watching</> : <><Plus className="size-3.5" strokeWidth={2.4} /> Watch</>}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div data-tour-id="instrument-tabs" className="mb-6 mt-6 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ITABS.map(({ id, label: l }) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={cn('relative whitespace-nowrap pb-3 pt-1 text-[14px] font-medium transition-colors',
              'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-opacity',
              tab === id ? 'text-foreground after:opacity-100' : 'text-muted-foreground hover:text-foreground after:opacity-0')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'overview' && <InstrumentTransparencyView assetId={assetId} asset={asset} />}
      {tab === 'attestations' && <ReserveAttestations assetId={assetId} asset={asset} />}
      {tab === 'activity' && <div className="rounded-xl border border-border bg-card p-4"><OverlayActivity assetId={assetId} decimals={decimals} standalone /></div>}
      {tab === 'restrictions' && <RegulatoryControls assets={[asset]} assetId={assetId} embedded />}
      {tab === 'reports' && <InstrumentExports assetId={assetId} asset={asset} />}
    </div>
  )
}
