/**
 * Integrations - the external services a regulated stablecoin issuer connects
 * (KYC, sanctions/AML feeds, banking & custody, SSO, attestation, reporting).
 *
 * This is a DEMO surface: it shows the exact shape of connecting real providers
 * (auth, scopes, environments, sync/test, key rotation, webhooks) but performs
 * no real network calls - connections are mock records in localStorage. It maps
 * onto the app's simulated subsystems, so connecting e.g. ComplyAdvantage
 * relabels the (still-simulated) sanctions screening as "via ComplyAdvantage".
 * Provider names are illustrative and imply no affiliation.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus, Search, X, MoreVertical, Check, Copy, RotateCw, Plug, ArrowLeft, Info,
  Zap, RefreshCw, Trash2, ShieldAlert, UserCheck, Radar, Landmark,
  KeyRound, FileCheck2, Bell, Eye, EyeOff, LayoutGrid, List,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useOnboarding } from '../../lib/onboarding'
import {
  PROVIDERS, providerById, starterProviders, logoUrl, CATEGORY_LABEL, CATEGORY_ORDER, AUTH_LABEL,
  STATUS_LABEL, useConnections, addConnection, removeConnection, recordTest, recordSync, rotateKey,
  type Provider, type Connection, type ConnectionStatus, type IntegrationCategory,
} from '../../lib/integrations'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const CATEGORY_ICON: Record<IntegrationCategory, LucideIcon> = {
  kyc: UserCheck, sanctions: ShieldAlert, analytics: Radar, banking: Landmark,
  sso: KeyRound, attestation: FileCheck2, reporting: Bell,
}

const STATUS_TONE: Record<ConnectionStatus, string> = {
  connected: 'text-success', sandbox: 'text-sky-600', action_required: 'text-warning',
  error: 'text-destructive', disconnected: 'text-muted-foreground',
}

const fmtWhen = (iso?: string): string => {
  if (iso == null) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function ProviderTile({ provider, size = 40 }: { provider: Provider; size?: number }) {
  const [broken, setBroken] = useState(false)
  const logo = logoUrl(provider)
  const showLogo = logo != null && !broken
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60 font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: showLogo ? '#fff' : provider.color, fontSize: size * 0.34 }}
      aria-hidden
    >
      {showLogo ? (
        <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: size * 0.66, height: size * 0.66, objectFit: 'contain' }} />
      ) : provider.monogram}
    </span>
  )
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] font-medium', STATUS_TONE[status])}>
      <span className="size-2 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { name } = useOnboarding()
  const ownerName = name.trim() || 'Issuer'
  const connections = useConnections()

  const [view, setView] = useState<'connections' | 'apps'>('connections')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ConnectionStatus | 'all'>('all')
  const [connectProvider, setConnectProvider] = useState<Provider | null | 'picker'>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [requestCategory, setRequestCategory] = useState<IntegrationCategory | null>(null)

  const q = query.trim().toLowerCase()

  const filteredConnections = useMemo(() => connections.filter(c => {
    const p = providerById(c.providerId)
    const matchesQ = q === '' || c.label.toLowerCase().includes(q) || (p?.name.toLowerCase().includes(q) ?? false)
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter
    return matchesQ && matchesStatus
  }), [connections, q, statusFilter])

  const openConnect = (p: Provider | 'picker') => setConnectProvider(p)
  const detail = detailId != null ? connections.find(c => c.id === detailId) ?? null : null

  return (
    <div className="w-full max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">Integrations</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">
            Connect the KYC, sanctions, banking, custody and access providers that power compliance.
          </p>
        </div>
        <Button onClick={() => openConnect('picker')} className="h-10 shrink-0 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" /> Add connection
        </Button>
      </div>

      {/* View toggle + filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([['connections', 'Connections', List], ['apps', 'Apps', LayoutGrid]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                view === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={view === 'connections' ? 'Search connection or app name' : 'Search apps'}
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        {view === 'connections' && connections.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(['all', 'connected', 'sandbox', 'action_required', 'error'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                  statusFilter === s ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s].replace('Connected · ', '')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mt-4">
        {view === 'apps' ? (
          <AppsCatalog query={q} connections={connections} onConnect={openConnect} onOpenDetail={setDetailId} onRequest={setRequestCategory} />
        ) : connections.length === 0 ? (
          <EmptyState onConnect={openConnect} onBrowseAll={() => setView('apps')} />
        ) : (
          <ConnectionsTable rows={filteredConnections} onOpenDetail={setDetailId} onAdd={() => openConnect('picker')} />
        )}
      </div>

      <ConnectDrawer
        target={connectProvider}
        ownerName={ownerName}
        onClose={() => setConnectProvider(null)}
        onConnected={id => { setConnectProvider(null); setView('connections'); setDetailId(id) }}
      />
      <DetailDrawer connection={detail} onClose={() => setDetailId(null)} />
      <RequestDrawer category={requestCategory} onClose={() => setRequestCategory(null)} />
    </div>
  )
}

// ── Request-integration drawer ────────────────────────────────────────────────

function RequestDrawer({ category, onClose }: { category: IntegrationCategory | null; onClose: () => void }) {
  return (
    <Sheet open={category != null} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Request an integration</SheetTitle>
        {category != null && <RequestBody category={category} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function RequestBody({ category, onClose }: { category: IntegrationCategory; onClose: () => void }) {
  const [appName, setAppName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const Icon = CATEGORY_ICON[category]

  const submit = () => {
    if (appName.trim() === '') { toast.error('Enter the provider name.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error('Enter a valid work email.'); return }
    setSubmitting(true)
    window.setTimeout(() => { setSubmitting(false); setDone(true) }, 650)
  }

  if (done) {
    return (
      <>
        <DrawerHeader title="Request received" onClose={onClose} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-success/10 text-success">
            <Check className="size-7" strokeWidth={2.5} />
          </span>
          <h3 className="mt-4 text-[16px] font-semibold text-foreground">Thanks — we’re on it</h3>
          <p className="mt-1.5 max-w-xs text-balance text-[13px] leading-relaxed text-muted-foreground">
            We’ll review <span className="font-medium text-foreground">{appName.trim()}</span> for {CATEGORY_LABEL[category].toLowerCase()} and follow up at <span className="font-medium text-foreground">{email.trim()}</span>.
          </p>
          <Button variant="outline" onClick={onClose} className="mt-6 h-9 px-5 text-[13px]">Done</Button>
        </div>
      </>
    )
  }

  return (
    <>
      <DrawerHeader title="Request an integration" subtitle={CATEGORY_LABEL[category]} onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          Tell us which provider you need and we’ll prioritise wiring it up.
        </p>

        <div>
          <FieldLabel>Category</FieldLabel>
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[12.5px] font-medium text-foreground">
            <Icon className="size-3.5 text-muted-foreground" /> {CATEGORY_LABEL[category]}
          </div>
        </div>

        <div>
          <FieldLabel>Provider / app name</FieldLabel>
          <Input autoFocus value={appName} onChange={e => setAppName(e.target.value)} placeholder="e.g. Sygnum, Metaco, Trulioo…" className="mt-1.5 h-10 text-[13px]" />
        </div>

        <div>
          <FieldLabel>Work email</FieldLabel>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@bank.example" className="mt-1.5 h-10 text-[13px]" />
        </div>

        <div>
          <FieldLabel>What do you need it for? (optional)</FieldLabel>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="How you’d use this integration…"
            className="mt-1.5 w-full resize-none rounded-md border border-input-border bg-input px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </div>
      </div>

      <div className="border-t border-border px-5 py-3">
        <Button onClick={submit} loading={submitting} loadingText="Sending…" size="lg" className="w-full gap-1.5">
          <Plus className="size-4" /> Send request
        </Button>
      </div>
    </>
  )
}

// ── Connections table ─────────────────────────────────────────────────────────

function ConnectionsTable({ rows, onOpenDetail, onAdd }: {
  rows: Connection[]; onOpenDetail: (id: string) => void; onAdd: () => void
}) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">No connections match your filters.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-[1.6fr_1fr_150px_90px_130px_44px] items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
        <div>Name</div><div>Category</div><div>Status</div><div className="text-right">Used by</div><div className="text-right">Last synced</div><div />
      </div>
      {rows.map((c, i) => {
        const p = providerById(c.providerId)
        if (p == null) return null
        return (
          <div key={c.id} className={cn('grid grid-cols-[1.6fr_1fr_150px_90px_130px_44px] items-center gap-2 px-4 py-3', i > 0 && 'border-t border-separator')}>
            <button type="button" onClick={() => onOpenDetail(c.id)} className="flex min-w-0 items-center gap-3 text-left">
              <ProviderTile provider={p} size={34} />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium text-foreground hover:underline">{c.label}</div>
                <div className="truncate text-[11.5px] text-subtle-foreground">{p.name}</div>
              </div>
            </button>
            <div className="min-w-0 truncate text-[12.5px] text-muted-foreground">{CATEGORY_LABEL[p.category]}</div>
            <div><StatusBadge status={c.status} /></div>
            <div className="flex items-center justify-end gap-1 text-right text-[12.5px] tabular text-muted-foreground">
              <Zap className="size-3 text-faint-foreground" />{c.usedByCount}
            </div>
            <div className="truncate text-right text-[11.5px] text-subtle-foreground">{fmtWhen(c.lastSyncAt)}</div>
            <RowMenu connection={c} onOpenDetail={() => onOpenDetail(c.id)} />
          </div>
        )
      })}
      <div className="border-t border-separator px-4 py-2.5">
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary hover:underline">
          <Plus className="size-3.5" /> Add connection
        </button>
      </div>
    </div>
  )
}

function RowMenu({ connection, onOpenDetail }: { connection: Connection; onOpenDetail: () => void }) {
  const [open, setOpen] = useState(false)
  const act = (fn: () => void) => { fn(); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Connection actions"
        className="grid size-8 place-items-center justify-self-end rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <MoreVertical className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <MenuItem Icon={Info} label="View details" onClick={() => act(onOpenDetail)} />
        <MenuItem Icon={RefreshCw} label="Sync now" onClick={() => act(() => { recordSync(connection.id); toast.success('Synced') })} />
        <MenuItem Icon={Check} label="Test connection" onClick={() => act(() => { recordTest(connection.id, true); toast.success('Test succeeded') })} />
        <div className="my-1 h-px bg-border" />
        <MenuItem Icon={Trash2} label="Disconnect" danger onClick={() => act(() => { removeConnection(connection.id); toast.success('Disconnected') })} />
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({ Icon, label, onClick, danger }: { Icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent', danger ? 'text-destructive hover:bg-destructive/5' : 'text-foreground')}
    >
      <Icon className="size-3.5 shrink-0" /> {label}
    </button>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onConnect, onBrowseAll }: { onConnect: (p: Provider) => void; onBrowseAll: () => void }) {
  const starters = starterProviders()
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
      {/* Illustration - the platform hub wired to real providers (not a card) */}
      <div className="mx-auto h-40 w-full max-w-[340px]">
        <div className="relative mx-auto h-40 w-[320px]">
          {/* soft glow behind the hub */}
          <div className="absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-primary)_14%,transparent),transparent_70%)]" />
          {/* dashed connectors from hub (160,80) to each provider */}
          <svg viewBox="0 0 320 160" className="absolute inset-0 h-full w-full text-border" fill="none" aria-hidden>
            <g stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4">
              <path d="M160 80 L160 22" />
              <path d="M160 80 L58 130" />
              <path d="M160 80 L262 130" />
            </g>
          </svg>
          {/* hub - nudged down, gently bobbing, with a glossy gel sheen */}
          <div className="absolute left-1/2 top-[calc(50%+8px)] -translate-x-1/2 -translate-y-1/2">
            <div className="animate-bob relative grid size-16 place-items-center overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-pop)]">
              {/* gel: top-down gloss + a soft corner highlight */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
              <div className="pointer-events-none absolute -left-2 -top-4 size-10 rounded-full bg-white/20 blur-md" />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
              <Plug className="relative size-7" strokeWidth={2} />
            </div>
          </div>
          {/* provider logo tiles */}
          {[{ p: starters[0], x: 160, y: 22 }, { p: starters[1], x: 58, y: 130 }, { p: starters[2], x: 262, y: 130 }].map(({ p, x, y }) =>
            p != null ? (
              <div key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-1 shadow-[var(--shadow-card)]" style={{ left: x, top: y }}>
                <ProviderTile provider={p} size={40} />
              </div>
            ) : null
          )}
        </div>
      </div>

      <div className="mt-6 text-center">
        <h2 className="text-[17px] font-semibold text-foreground">Connect your first integration</h2>
        <p className="mx-auto mt-1.5 max-w-md text-balance text-[13.5px] leading-relaxed text-muted-foreground">
          Your identity is your on-chain key. KYC, sanctions and attestation are handled by the providers you connect here.
        </p>
      </div>

      {/* Three curated starters for a Swiss stablecoin issuer */}
      <div className="mx-auto mt-6 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
        {starters.map(p => {
          const Icon = CATEGORY_ICON[p.category]
          return (
            <div key={p.id} className="flex flex-col rounded-xl border border-border bg-sidebar p-4">
              <div className="flex items-center gap-2.5">
                <ProviderTile provider={p} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-foreground">{p.name}</div>
                  <div className="flex items-center gap-1 text-[10.5px] text-subtle-foreground">
                    <Icon className="size-3" /> {CATEGORY_LABEL[p.category]}
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 flex-1 text-[11.5px] leading-snug text-muted-foreground">{p.blurb}</p>
              <Button variant="outline" onClick={() => onConnect(p)} className="mt-3 h-8 w-full gap-1.5 text-[12.5px]">
                <Plus className="size-3.5" /> Connect
              </Button>
            </div>
          )
        })}
      </div>

      <div className="mt-5 text-center">
        <button type="button" onClick={onBrowseAll} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          Browse all {PROVIDERS.length} apps <ArrowLeft className="size-3.5 rotate-180" />
        </button>
      </div>
    </div>
  )
}

// ── Apps catalogue ────────────────────────────────────────────────────────────

function AppsCatalog({ query, connections, onConnect, onOpenDetail, onRequest }: {
  query: string; connections: Connection[]; onConnect: (p: Provider) => void; onOpenDetail: (id: string) => void; onRequest: (cat: IntegrationCategory) => void
}) {
  const connByProvider = useMemo(() => {
    const m = new Map<string, Connection>()
    for (const c of connections) if (!m.has(c.providerId)) m.set(c.providerId, c)
    return m
  }, [connections])

  const groups = CATEGORY_ORDER
    .map(cat => ({
      cat,
      items: PROVIDERS.filter(p => p.category === cat && (query === '' || p.name.toLowerCase().includes(query) || p.blurb.toLowerCase().includes(query))),
    }))
    .filter(g => g.items.length > 0)

  if (groups.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">No apps match “{query}”.</p>
  }

  return (
    <div className="space-y-6">
      {groups.map(({ cat, items }) => {
        const Icon = CATEGORY_ICON[cat]
        return (
          <div key={cat}>
            <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Icon className="size-4 text-muted-foreground" /> {CATEGORY_LABEL[cat]}
            </div>
            <div className="grid gap-3 rounded-xl bg-sidebar p-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map(p => {
                const conn = connByProvider.get(p.id)
                return (
                  <div key={p.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <ProviderTile provider={p} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-foreground">{p.name}</div>
                        <div className="text-[11px] text-subtle-foreground">{AUTH_LABEL[p.authType]}</div>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 flex-1 text-[12px] leading-snug text-muted-foreground">{p.blurb}</p>
                    {conn != null ? (
                      <button
                        type="button"
                        onClick={() => onOpenDetail(conn.id)}
                        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <StatusBadge status={conn.status} />
                      </button>
                    ) : (
                      <Button variant="outline" onClick={() => onConnect(p)} className="mt-3 h-8 w-full gap-1.5 text-[12.5px]">
                        <Plus className="size-3.5" /> Connect
                      </Button>
                    )}
                  </div>
                )
              })}
              <RequestCard onRequest={() => onRequest(cat)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RequestCard({ onRequest }: { onRequest: () => void }) {
  return (
    <button
      type="button"
      onClick={onRequest}
      className="flex min-h-[128px] flex-col items-start justify-center rounded-xl border border-dashed border-border bg-transparent p-4 text-left transition-colors hover:border-muted-foreground/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Plus className="size-4.5" />
      </span>
      <div className="mt-2 text-[13px] font-semibold text-foreground">Request an integration</div>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">Don’t see the provider you use? Ask us to add it.</p>
    </button>
  )
}

// ── Connect drawer ────────────────────────────────────────────────────────────

function ConnectDrawer({ target, ownerName, onClose, onConnected }: {
  target: Provider | 'picker' | null
  ownerName: string
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const open = target != null
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Add connection</SheetTitle>
        {open && <ConnectDrawerBody initial={target} ownerName={ownerName} onClose={onClose} onConnected={onConnected} />}
      </SheetContent>
    </Sheet>
  )
}

function ConnectDrawerBody({ initial, ownerName, onClose, onConnected }: {
  initial: Provider | 'picker'
  ownerName: string
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const [provider, setProvider] = useState<Provider | null>(initial === 'picker' ? null : initial)
  const [pickQuery, setPickQuery] = useState('')

  if (provider == null) {
    const q = pickQuery.trim().toLowerCase()
    const groups = CATEGORY_ORDER
      .map(cat => ({ cat, items: PROVIDERS.filter(p => p.category === cat && (q === '' || p.name.toLowerCase().includes(q))) }))
      .filter(g => g.items.length > 0)
    return (
      <>
        <DrawerHeader title="Add a connection" subtitle="Choose a provider to connect." onClose={onClose} />
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" />
            <Input autoFocus value={pickQuery} onChange={e => setPickQuery(e.target.value)} placeholder="Search apps" className="h-9 pl-8 text-[13px]" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {groups.map(({ cat, items }) => (
            <div key={cat} className="mb-2">
              <div className="px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">{CATEGORY_LABEL[cat]}</div>
              {items.map(p => (
                <button key={p.id} type="button" onClick={() => setProvider(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent">
                  <ProviderTile provider={p} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">{p.name}</div>
                    <div className="truncate text-[11.5px] text-subtle-foreground">{p.blurb}</div>
                  </div>
                  <ArrowLeft className="size-4 shrink-0 rotate-180 text-faint-foreground" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </>
    )
  }

  return <ConnectForm provider={provider} ownerName={ownerName} onBack={initial === 'picker' ? () => setProvider(null) : undefined} onClose={onClose} onConnected={onConnected} />
}

function ConnectForm({ provider, ownerName, onBack, onClose, onConnected }: {
  provider: Provider
  ownerName: string
  onBack?: () => void
  onClose: () => void
  onConnected: (id: string) => void
}) {
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('sandbox')
  const [label, setLabel] = useState(`${provider.name} · ${ownerName}`)
  const [apiKey, setApiKey] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(() => new Set(provider.scopes))
  const [connecting, setConnecting] = useState(false)
  const Icon = CATEGORY_ICON[provider.category]
  const isOAuth = provider.authType === 'oauth2'

  const toggleScope = (s: string) => setScopes(prev => {
    const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next
  })

  const submit = () => {
    if (label.trim() === '') { toast.error('Give this connection a label.'); return }
    if (!isOAuth && apiKey.trim() === '') { toast.error(`Enter your ${provider.name} ${AUTH_LABEL[provider.authType].toLowerCase()}.`); return }
    setConnecting(true)
    // Simulate the handshake round-trip.
    window.setTimeout(() => {
      const conn = addConnection({
        providerId: provider.id,
        label: label.trim(),
        environment,
        scopes: [...scopes],
        ownerName,
      })
      setConnecting(false)
      toast.success(`Connected ${provider.name}`, { description: `${environment === 'sandbox' ? 'Sandbox' : 'Production'} · relabelled where it applies.` })
      onConnected(conn.id)
    }, 650)
  }

  return (
    <>
      <DrawerHeader title="Connect" onClose={onClose} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3">
          <ProviderTile provider={provider} size={44} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-foreground">{provider.name}</div>
            <div className="flex items-center gap-1 text-[11.5px] text-subtle-foreground"><Icon className="size-3" /> {CATEGORY_LABEL[provider.category]}</div>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">{provider.blurb}</p>

        <div className="mt-4 space-y-4">
          {/* Environment */}
          <div>
            <FieldLabel>Environment</FieldLabel>
            <div className="mt-1.5 inline-flex rounded-lg border border-border p-0.5">
              {(['sandbox', 'production'] as const).map(env => (
                <button key={env} type="button" onClick={() => setEnvironment(env)}
                  className={cn('rounded-md px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors', environment === env ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {env}
                </button>
              ))}
            </div>
          </div>

          {/* Label */}
          <div>
            <FieldLabel>Connection label</FieldLabel>
            <Input value={label} onChange={e => setLabel(e.target.value)} className="mt-1.5 h-10 text-[13px]" />
          </div>

          {/* Auth */}
          {isOAuth ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-[12.5px] text-muted-foreground">
              In production this launches the {provider.name} OAuth 2.0 consent screen. For the demo, connecting simulates a granted token.
            </div>
          ) : (
            <div>
              <FieldLabel>{AUTH_LABEL[provider.authType]}</FieldLabel>
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={provider.authType === 'mtls' ? 'Paste client certificate…' : 'sk_live_…'} className="mt-1.5 h-10 font-mono text-[12.5px]" />
              <p className="mt-1 text-[11px] text-faint-foreground">Stored only in your browser for this demo — never transmitted.</p>
            </div>
          )}

          {/* Scopes */}
          <div>
            <FieldLabel>Permissions requested</FieldLabel>
            <div className="mt-1.5 space-y-1.5">
              {provider.scopes.map(s => (
                <label key={s} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-foreground">
                  <input type="checkbox" checked={scopes.has(s)} onChange={() => toggleScope(s)} className="size-3.5 rounded border-input-border accent-[var(--color-primary)]" />
                  <span className="font-mono text-[12px] text-muted-foreground">{s}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>Powers <span className="font-medium text-foreground">{provider.powers}</span>. No real request is made — this records a mock connection.</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-3">
        <Button onClick={submit} loading={connecting} loadingText="Connecting…" size="lg" className="w-full gap-1.5">
          {isOAuth ? <><KeyRound className="size-4" /> Authorise {provider.name}</> : <><Plug className="size-4" /> Connect {provider.name}</>}
        </Button>
      </div>
    </>
  )
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ connection, onClose }: { connection: Connection | null; onClose: () => void }) {
  return (
    <Sheet open={connection != null} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Connection details</SheetTitle>
        {connection != null && <DetailBody connection={connection} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const p = providerById(connection.providerId)
  const [revealed, setRevealed] = useState(false)
  const [testing, setTesting] = useState(false)
  if (p == null) return null
  const Icon = CATEGORY_ICON[p.category]

  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`)).catch(() => {}) }
  const test = () => {
    setTesting(true)
    window.setTimeout(() => { recordTest(connection.id, true); setTesting(false); toast.success('Test connection succeeded') }, 700)
  }

  return (
    <>
      <DrawerHeader title="Connection" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3">
          <ProviderTile provider={p} size={44} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-foreground">{connection.label}</div>
            <div className="flex items-center gap-1 text-[11.5px] text-subtle-foreground"><Icon className="size-3" /> {p.name}</div>
          </div>
          <StatusBadge status={connection.status} />
        </div>

        {/* What it powers */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>Powers <span className="font-medium text-foreground">{p.powers}</span>{p.subsystem != null && <> — the matching area is relabelled “via {p.name}”.</>}</span>
        </div>

        {/* Meta */}
        <dl className="mt-4 divide-y divide-separator rounded-lg border border-border">
          <Row label="Environment"><span className="capitalize">{connection.environment}</span></Row>
          <Row label="Owner">{connection.ownerName}</Row>
          <Row label="Used by">{connection.usedByCount} workflow{connection.usedByCount === 1 ? '' : 's'}</Row>
          <Row label="Connected">{fmtWhen(connection.createdAt)}</Row>
          <Row label="Last synced">{fmtWhen(connection.lastSyncAt)}</Row>
        </dl>

        {/* Credentials */}
        {p.authType !== 'oauth2' && (
          <div className="mt-4">
            <FieldLabel>{AUTH_LABEL[p.authType]}</FieldLabel>
            <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                {revealed ? `${connection.maskedKey.replace(/•+/, '3f9a72b1c4')}` : connection.maskedKey}
              </span>
              <button type="button" onClick={() => setRevealed(v => !v)} aria-label={revealed ? 'Hide' : 'Reveal'} className="text-muted-foreground hover:text-foreground">
                {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button type="button" onClick={() => copy(connection.maskedKey, 'Key')} aria-label="Copy" className="text-muted-foreground hover:text-foreground">
                <Copy className="size-4" />
              </button>
              <button type="button" onClick={() => { rotateKey(connection.id); toast.success('API key rotated') }} aria-label="Rotate" className="text-muted-foreground hover:text-foreground">
                <RotateCw className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Webhook */}
        <div className="mt-4">
          <FieldLabel>Webhook endpoint</FieldLabel>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{connection.webhookURL}</span>
            <button type="button" onClick={() => copy(connection.webhookURL, 'URL')} aria-label="Copy URL" className="text-muted-foreground hover:text-foreground"><Copy className="size-4" /></button>
          </div>
        </div>

        {/* Scopes */}
        <div className="mt-4">
          <FieldLabel>Permissions</FieldLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {connection.scopes.map(s => (
              <span key={s} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{s}</span>
            ))}
          </div>
        </div>

        {/* Activity */}
        <div className="mt-4">
          <FieldLabel>Recent activity</FieldLabel>
          <div className="mt-1.5 space-y-2">
            {connection.events.slice(0, 8).map((e, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-muted-foreground">{e.detail}</span>
                <span className="shrink-0 text-subtle-foreground">{fmtWhen(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Button variant="outline" onClick={test} loading={testing} loadingText="Testing…" className="h-9 flex-1 gap-1.5 text-[12.5px]">
          <Check className="size-4" /> Test connection
        </Button>
        <Button variant="outline" onClick={() => { recordSync(connection.id); toast.success('Synced') }} className="h-9 gap-1.5 px-3 text-[12.5px]">
          <RefreshCw className="size-4" /> Sync
        </Button>
        <button
          type="button"
          onClick={() => { removeConnection(connection.id); toast.success('Disconnected'); onClose() }}
          className="grid size-9 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive"
          aria-label="Disconnect"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </>
  )
}

// ── Shared drawer chrome ──────────────────────────────────────────────────────

function DrawerHeader({ title, subtitle, onClose, onBack }: { title: string; subtitle?: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
      {onBack != null && (
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-foreground">{title}</div>
        {subtitle != null && <div className="text-[12px] text-muted-foreground">{subtitle}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{children}</div>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  )
}
