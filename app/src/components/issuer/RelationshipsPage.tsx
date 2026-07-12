/**
 * Relationships - the institutional relationship manager. A searchable,
 * filterable table of the organisations an issuer works with (built to scale to
 * thousands), and a full-page detail view for each showing the people at that
 * organisation who have access to this platform, with their system role and
 * permissions. Seeded with realistic mock data; add/edit/remove persist locally.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Plus, Search, X, MoreVertical, ArrowLeft, Users, Building2, Trash2, ShieldCheck,
  BadgeCheck, Check, Clock, Ban, ChevronRight,
} from 'lucide-react'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import {
  useEntities, useEntity, useAvailableEntities, entityLogo, addFromDirectory, removeEntity, setEntityStatus,
  addPerson, removePerson, setPersonRole, togglePersonPermission, setPersonStatus,
  ENTITY_TYPE_LABEL, RELATIONSHIP_LABEL, ENTITY_STATUS_LABEL, SYSTEM_ROLE_LABEL,
  PERMISSION_LABEL, PERMISSION_DESCRIPTION, ALL_PERMISSIONS, PERSON_STATUS_LABEL,
  type Entity, type Person, type EntityType, type EntityStatus,
  type SystemRole, type PersonStatus,
} from '../../lib/entities'
import { useCompanyLogo } from '../../lib/companyLogo'
import { useOnboarding } from '../../lib/onboarding'
import { CompanyAvatar } from '../ui/company-avatar'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const ENTITY_STATUS_TONE: Record<EntityStatus, string> = { active: 'text-success', onboarding: 'text-warning', suspended: 'text-destructive' }
const PERSON_STATUS_TONE: Record<PersonStatus, string> = { active: 'text-success', invited: 'text-warning', suspended: 'text-destructive' }

const fmtSince = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
const fmtActive = (iso: string): string => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, mins)} min ago`
  const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`
  const dd = Math.round(h / 24); return dd < 30 ? `${dd}d ago` : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Monogram({ entity, size = 40 }: { entity: Pick<Entity, 'id' | 'monogram' | 'color' | 'own'>; size?: number }) {
  const [broken, setBroken] = useState(false)
  const companyLogo = useCompanyLogo()
  const { entity: onb } = useOnboarding()
  const logo = entity.own ? companyLogo : entityLogo(entity.id)
  const showLogo = logo != null && !broken
  // Own organisation with no uploaded logo falls back to a Bauhaus tile,
  // matching the Company settings page; external orgs fall back to a monogram.
  if (!showLogo && entity.own) {
    return <CompanyAvatar name={onb?.legalName || 'Your organisation'} size={size} className="shrink-0 rounded-lg" />
  }
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border/60 font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: showLogo ? '#fff' : entity.color, fontSize: size * 0.34 }}
      aria-hidden
    >
      {showLogo
        ? <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} style={{ width: size * 0.64, height: size * 0.64, objectFit: 'contain' }} />
        : entity.monogram}
    </span>
  )
}

function StatusBadge({ status }: { status: EntityStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] font-medium', ENTITY_STATUS_TONE[status])}>
      <span className="size-2 rounded-full bg-current" /> {ENTITY_STATUS_LABEL[status]}
    </span>
  )
}

function PeopleFacepile({ people }: { people: Person[] }) {
  const shown = people.slice(0, 4)
  const extra = people.length - shown.length
  if (people.length === 0) return <span className="text-[12px] text-subtle-foreground">—</span>
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <span key={p.id} className={cn('rounded-full ring-2 ring-card', i > 0 && '-ml-2')} style={{ zIndex: shown.length - i }}>
          <IdentitySigil value={p.badgeKey} size={22} className="rounded-full" />
        </span>
      ))}
      {extra > 0 && <span className="-ml-2 grid size-[22px] place-items-center rounded-full bg-foreground text-[9px] font-semibold text-background ring-2 ring-card">+{extra}</span>}
    </div>
  )
}

function PermissionPill({ perm, on, onClick }: { perm: (typeof ALL_PERMISSIONS)[number]; on: boolean; onClick?: () => void }) {
  const cls = on ? 'border-success/30 bg-success/5 text-foreground' : 'border-border bg-muted/40 text-muted-foreground'
  const inner = (
    <>
      <BadgeCheck className={cn('size-3.5', on ? 'text-success' : 'text-faint-foreground')} strokeWidth={2.4} /> {PERMISSION_LABEL[perm]}
    </>
  )
  const trigger = onClick == null
    ? <span tabIndex={0} className={cn('inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60', cls)}>{inner}</span>
    : <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium outline-none transition-colors hover:border-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/60', cls)}>{inner}</button>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-center">{PERMISSION_DESCRIPTION[perm]}</TooltipContent>
    </Tooltip>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RelationshipsPage() {
  const [params, setParams] = useSearchParams()
  const relId = params.get('rel')
  const selected = useEntity(relId)

  const open = (id: string) => { const n = new URLSearchParams(params); n.set('rel', id); setParams(n) }
  const back = () => { const n = new URLSearchParams(params); n.delete('rel'); setParams(n) }

  if (relId != null && selected != null) {
    return <EntityDetail entity={selected} onBack={back} />
  }
  return <EntityList onOpen={open} />
}

// ── List ──────────────────────────────────────────────────────────────────────

function EntityList({ onOpen }: { onOpen: (id: string) => void }) {
  const entities = useEntities()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<EntityType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<EntityStatus | 'all'>('all')
  const [addOpen, setAddOpen] = useState(false)
  const q = query.trim().toLowerCase()

  const rows = useMemo(() => entities.filter(e => {
    const mq = q === '' || e.name.toLowerCase().includes(q) || e.jurisdiction.toLowerCase().includes(q) || ENTITY_TYPE_LABEL[e.type].toLowerCase().includes(q)
    return mq && (typeFilter === 'all' || e.type === typeFilter) && (statusFilter === 'all' || e.status === statusFilter)
  }), [entities, q, typeFilter, statusFilter])

  const totalPeople = entities.reduce((n, e) => n + e.people.length, 0)

  return (
    <div className="w-full max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">Relationships</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">
            The institutions you work with, and the people at each with access to this platform.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="h-10 shrink-0 gap-1.5 px-3.5 text-[13px]">
          <Plus className="size-4" /> Add relationship
        </Button>
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search institutions" className="h-9 pl-8 text-[13px]" />
        </div>
        <TypeSelect value={typeFilter} onChange={setTypeFilter} />
        <div className="flex flex-wrap gap-1">
          {(['all', 'active', 'onboarding', 'suspended'] as const).map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={cn('rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors', statusFilter === s ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}>
              {s === 'all' ? 'All' : ENTITY_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 text-[12px] text-subtle-foreground">{entities.length} institutions · {totalPeople} people with access</div>

      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[1.8fr_1fr_1fr_150px_110px_120px_44px] items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground">
              <div>Institution</div><div>Relationship</div><div>Jurisdiction</div><div>People</div><div>Status</div><div className="text-right">Since</div><div />
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">No institutions match your filters.</p>
            ) : rows.map((e, i) => (
              <div key={e.id} className={cn('grid grid-cols-[1.8fr_1fr_1fr_150px_110px_120px_44px] items-center gap-2 px-4 py-3', i > 0 && 'border-t border-separator')}>
                <button type="button" onClick={() => onOpen(e.id)} className="flex min-w-0 items-center gap-3 text-left">
                  <Monogram entity={e} size={34} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-medium text-foreground hover:underline">{e.name}</span>
                      {e.own && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-primary">You</span>}
                    </div>
                    <div className="truncate text-[11.5px] text-subtle-foreground">{e.own ? 'Your organisation' : ENTITY_TYPE_LABEL[e.type]}</div>
                  </div>
                </button>
                <div className="truncate text-[12.5px] text-muted-foreground">{e.own ? '—' : RELATIONSHIP_LABEL[e.relationship]}</div>
                <div className="truncate text-[12.5px] text-muted-foreground">{e.jurisdiction}</div>
                <button type="button" onClick={() => onOpen(e.id)} className="flex items-center gap-2"><PeopleFacepile people={e.people} /></button>
                <div><StatusBadge status={e.status} /></div>
                <div className="text-right text-[12px] text-subtle-foreground">{fmtSince(e.sinceAt)}</div>
                <RowMenu entity={e} onOpen={() => onOpen(e.id)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <AddEntityDrawer open={addOpen} onClose={() => setAddOpen(false)} onAdded={id => { setAddOpen(false); onOpen(id) }} />
    </div>
  )
}

function TypeSelect({ value, onChange }: { value: EntityType | 'all'; onChange: (v: EntityType | 'all') => void }) {
  const [open, setOpen] = useState(false)
  const label = value === 'all' ? 'All types' : ENTITY_TYPE_LABEL[value]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-9 items-center gap-2 rounded-md border border-input-border bg-input px-3 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        {label} <ChevronRight className="size-3.5 rotate-90 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-72 w-52 overflow-y-auto p-1">
        {(['all', ...Object.keys(ENTITY_TYPE_LABEL)] as (EntityType | 'all')[]).map(t => (
          <button key={t} type="button" onClick={() => { onChange(t); setOpen(false) }}
            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent', t === value && 'bg-accent font-medium')}>
            <Check className={cn('size-3.5 shrink-0', t === value ? 'opacity-100' : 'opacity-0')} />
            {t === 'all' ? 'All types' : ENTITY_TYPE_LABEL[t]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function RowMenu({ entity, onOpen }: { entity: Entity; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const act = (fn: () => void) => { fn(); setOpen(false) }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="Actions" className="grid size-8 place-items-center justify-self-end rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
        <MoreVertical className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <MenuItem Icon={Building2} label="Open" onClick={() => act(onOpen)} />
        {!entity.own && (entity.status !== 'suspended'
          ? <MenuItem Icon={Ban} label="Suspend" onClick={() => act(() => { setEntityStatus(entity.id, 'suspended'); toast.success('Relationship suspended') })} />
          : <MenuItem Icon={Check} label="Reactivate" onClick={() => act(() => { setEntityStatus(entity.id, 'active'); toast.success('Relationship reactivated') })} />)}
        {!entity.own && <>
          <div className="my-1 h-px bg-border" />
          <MenuItem Icon={Trash2} label="Remove" danger onClick={() => act(() => { removeEntity(entity.id); toast.success('Relationship removed') })} />
        </>}
      </PopoverContent>
    </Popover>
  )
}

function MenuItem({ Icon, label, onClick, danger }: { Icon: typeof Plus; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent', danger ? 'text-destructive hover:bg-destructive/5' : 'text-foreground')}>
      <Icon className="size-3.5 shrink-0" /> {label}
    </button>
  )
}

// ── Detail (full page) ────────────────────────────────────────────────────────

function EntityDetail({ entity, onBack }: { entity: Entity; onBack: () => void }) {
  const [addPersonOpen, setAddPersonOpen] = useState(false)
  const [managed, setManaged] = useState<Person | null>(null)
  const managedLive = managed != null ? entity.people.find(p => p.id === managed.id) ?? null : null
  const own = entity.own === true

  return (
    <div className="w-full max-w-5xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All relationships
      </button>

      {/* Header card */}
      <div className="mt-3 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Monogram entity={entity} size={56} />
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">{entity.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                {own ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">Your organisation</span>
                ) : (
                  <>
                    <span>{ENTITY_TYPE_LABEL[entity.type]}</span><span className="text-faint-foreground">·</span>
                    <span>{RELATIONSHIP_LABEL[entity.relationship]}</span><span className="text-faint-foreground">·</span>
                    <span>{entity.jurisdiction}</span>
                  </>
                )}
              </div>
              <div className="mt-2"><StatusBadge status={entity.status} /></div>
            </div>
          </div>
          {!own && (
            <div className="flex shrink-0 gap-2">
              {entity.status !== 'suspended'
                ? <Button variant="outline" onClick={() => { setEntityStatus(entity.id, 'suspended'); toast.success('Suspended') }} className="h-9 gap-1.5 px-3 text-[12.5px]"><Ban className="size-4" /> Suspend</Button>
                : <Button variant="outline" onClick={() => { setEntityStatus(entity.id, 'active'); toast.success('Reactivated') }} className="h-9 gap-1.5 px-3 text-[12.5px]"><Check className="size-4" /> Reactivate</Button>}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="People with access" value={String(entity.people.length)} Icon={Users} />
          <Stat label="Instruments" value={String(entity.instruments.length)} Icon={ShieldCheck} />
          <Stat label="Relationship since" value={fmtSince(entity.sinceAt)} Icon={Clock} />
        </div>
      </div>

      {/* People */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-foreground">People with access</h2>
          {own && <Button variant="outline" onClick={() => setAddPersonOpen(true)} className="h-8 gap-1.5 px-3 text-[12.5px]"><Plus className="size-3.5" /> Add person</Button>}
        </div>
        {!own && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            <span>Members and their permissions are managed by <span className="font-medium text-foreground">{entity.name}</span>. You have view-only access here.</span>
          </div>
        )}
        {entity.people.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-muted-foreground">No one from {entity.name} has access yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {entity.people.map(p => <PersonCard key={p.id} person={p} manageable={own} onManage={() => setManaged(p)} />)}
          </div>
        )}
      </div>

      {/* Overview */}
      <div className="mt-6">
        <h2 className="mb-3 text-[15px] font-semibold text-foreground">Overview</h2>
        <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="text-[12px] font-medium uppercase tracking-wide text-subtle-foreground">Instruments they interact with</div>
          {entity.instruments.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-muted-foreground">None recorded.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entity.instruments.map(t => <span key={t} className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium text-foreground">{t}</span>)}
            </div>
          )}
          {!own && (
            <div className="mt-4 flex items-center justify-between border-t border-separator pt-3">
              <span className="text-[12.5px] text-muted-foreground">Remove this relationship and everyone's access.</span>
              <button type="button" onClick={() => { removeEntity(entity.id); toast.success('Relationship removed'); onBack() }} className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1.5 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/5">
                <Trash2 className="size-3.5" /> Remove relationship
              </button>
            </div>
          )}
        </div>
      </div>

      <AddPersonDrawer open={addPersonOpen} entityName={entity.name} onClose={() => setAddPersonOpen(false)} onAdd={input => { addPerson(entity.id, input); setAddPersonOpen(false); toast.success(`${input.name} invited`) }} />
      <ManagePersonDrawer entityId={entity.id} person={managedLive} onClose={() => setManaged(null)} />
    </div>
  )
}

function Stat({ label, value, Icon }: { label: string; value: string; Icon: typeof Users }) {
  return (
    <div className="rounded-xl border border-border bg-sidebar p-3">
      <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
      <div className="mt-2 tabular text-[20px] font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[12px] text-muted-foreground">{label}</div>
    </div>
  )
}

function PersonCard({ person, manageable, onManage }: { person: Person; manageable: boolean; onManage: () => void }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <IdentitySigil value={person.badgeKey} size={38} className="rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-foreground">{person.name}</div>
          <div className="truncate text-[11.5px] text-subtle-foreground">{person.title}</div>
        </div>
        {manageable && <button type="button" onClick={onManage} className="shrink-0 text-[12px] font-medium text-primary hover:underline">Manage</button>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{SYSTEM_ROLE_LABEL[person.systemRole]}</span>
        <span className={cn('inline-flex items-center gap-1 text-[11.5px] font-medium', PERSON_STATUS_TONE[person.status])}>
          <span className="size-1.5 rounded-full bg-current" /> {PERSON_STATUS_LABEL[person.status]}
        </span>
        <span className="ml-auto text-[11px] text-subtle-foreground">{fmtActive(person.lastActiveAt)}</span>
      </div>
      <TooltipProvider delayDuration={120}>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {person.permissions.length === 0
            ? <span className="text-[11.5px] text-subtle-foreground">No permissions</span>
            : person.permissions.map(perm => <PermissionPill key={perm} perm={perm} on />)}
        </div>
      </TooltipProvider>
    </div>
  )
}

// ── Drawers ───────────────────────────────────────────────────────────────────

function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-foreground">{title}</div>
        {subtitle != null && <div className="truncate text-[12px] text-muted-foreground">{subtitle}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{children}</div>
}

function AddEntityDrawer({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const available = useAvailableEntities()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = available.filter(e => q === '' || e.name.toLowerCase().includes(q) || ENTITY_TYPE_LABEL[e.type].toLowerCase().includes(q))

  const add = (id: string, name: string) => {
    const e = addFromDirectory(id)
    if (e == null) { toast.error('Already added.'); return }
    toast.success(`${name} added`)
    onAdded(id)
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Add relationship</SheetTitle>
        <DrawerHeader title="Add a relationship" subtitle="Choose an institution already in the network." onClose={onClose} />
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint-foreground" />
            <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search institutions" className="h-9 pl-8 text-[13px]" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {available.length === 0 ? (
            <p className="px-2 py-10 text-center text-[13px] text-muted-foreground">Every institution in the network is already a relationship.</p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-[13px] text-muted-foreground">No institutions match “{query.trim()}”.</p>
          ) : rows.map(e => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <Monogram entity={e} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{e.name}</div>
                <div className="truncate text-[11.5px] text-subtle-foreground">{ENTITY_TYPE_LABEL[e.type]} · {e.jurisdiction}</div>
              </div>
              <Button variant="outline" onClick={() => add(e.id, e.name)} className="h-8 shrink-0 gap-1.5 px-3 text-[12px]"><Plus className="size-3.5" /> Add</Button>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-5 py-3">
          <p className="text-[11.5px] leading-snug text-subtle-foreground">Only institutions already onboarded to the network can be added. New institutions are onboarded separately.</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function AddPersonDrawer({ open, entityName, onClose, onAdd }: { open: boolean; entityName: string; onClose: () => void; onAdd: (input: { name: string; title: string; systemRole: SystemRole }) => void }) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<SystemRole>('operator')

  const submit = () => {
    if (name.trim() === '') { toast.error('Enter the person’s name.'); return }
    onAdd({ name: name.trim(), title: title.trim() || 'Team member', systemRole: role })
    setName(''); setTitle(''); setRole('operator')
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Add person</SheetTitle>
        <DrawerHeader title="Grant access" subtitle={entityName} onClose={onClose} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-[12.5px] leading-snug text-muted-foreground">Invite someone from this institution. They’ll get the default permissions for their role, which you can fine-tune after.</p>
          <div><FieldLabel>Full name</FieldLabel><Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Anna Weber" className="mt-1.5 h-10 text-[13px]" /></div>
          <div><FieldLabel>Job title</FieldLabel><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Treasury Operations" className="mt-1.5 h-10 text-[13px]" /></div>
          <div>
            <FieldLabel>System role</FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(SYSTEM_ROLE_LABEL) as SystemRole[]).map(r => (
                <button key={r} type="button" onClick={() => setRole(r)} className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors', role === r ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}>{SYSTEM_ROLE_LABEL[r]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-border px-5 py-3">
          <Button onClick={submit} size="lg" className="w-full gap-1.5"><Plus className="size-4" /> Send invite</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ManagePersonDrawer({ entityId, person, onClose }: { entityId: string; person: Person | null; onClose: () => void }) {
  return (
    <Sheet open={person != null} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Manage access</SheetTitle>
        {person != null && (
          <>
            <DrawerHeader title={person.name} subtitle={person.title} onClose={onClose} />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="flex items-center gap-3">
                <IdentitySigil value={person.badgeKey} size={40} className="rounded-full" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground">{person.badgeKey.slice(0, 10)}…{person.badgeKey.slice(-4)}</div>
                  <span className={cn('mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium', PERSON_STATUS_TONE[person.status])}>
                    <span className="size-1.5 rounded-full bg-current" /> {PERSON_STATUS_LABEL[person.status]}
                  </span>
                </div>
              </div>

              <div>
                <FieldLabel>System role</FieldLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(Object.keys(SYSTEM_ROLE_LABEL) as SystemRole[]).map(r => (
                    <button key={r} type="button" onClick={() => setPersonRole(entityId, person.id, r)} className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors', person.systemRole === r ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}>{SYSTEM_ROLE_LABEL[r]}</button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-faint-foreground">Changing the role resets permissions to that role’s defaults.</p>
              </div>

              <div>
                <FieldLabel>Permissions</FieldLabel>
                <div className="mt-1.5 space-y-0.5">
                  {ALL_PERMISSIONS.map(perm => {
                    const on = person.permissions.includes(perm)
                    return (
                      <button
                        key={perm}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => togglePersonPermission(entityId, person.id, perm)}
                        className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <span className={cn('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input-border bg-input')}>
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-foreground">{PERMISSION_LABEL[perm]}</span>
                          <span className="block text-[11.5px] leading-snug text-muted-foreground">{PERMISSION_DESCRIPTION[perm]}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <FieldLabel>Status</FieldLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(Object.keys(PERSON_STATUS_LABEL) as PersonStatus[]).map(s => (
                    <button key={s} type="button" onClick={() => setPersonStatus(entityId, person.id, s)} className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors', person.status === s ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}>{PERSON_STATUS_LABEL[s]}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <button type="button" onClick={() => { removePerson(entityId, person.id); toast.success('Access revoked'); onClose() }} className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/5">
                <Trash2 className="size-4" /> Revoke access
              </button>
              <Button onClick={onClose} className="h-9 px-4 text-[12.5px]">Done</Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
