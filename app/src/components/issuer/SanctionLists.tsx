/**
 * Sanction-list governance UI. Two entry points share the store in
 * lib/sanctionsPolicy:
 *   - GlobalSanctionLists: org-wide policy (embedded in the Compliance page).
 *   - InstrumentSanctionLists: per-instrument policy (embedded in an
 *     instrument's Restrictions tab), inheriting the global set with overrides,
 *     plus the automatic provider update feed and manual add/remove of lists.
 * Everything is demo data; screening remains simulated.
 */
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plug, Check, Plus, Minus, RefreshCw, X } from 'lucide-react'
import {
  SANCTION_LISTS, listById, UPDATE_VERB,
  useGlobalLists, setGlobalList, useInstrumentPolicy, setInstrumentMode, setInstrumentList,
  useListUpdates, applyUpdate, applyAllUpdates, dismissUpdate,
  type ListUpdate,
} from '../../lib/sanctionsPolicy'
import { useActiveIntegration } from '../../lib/integrations'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip'
import { cn } from '@/lib/utils'

/** Succinct hover explainer for a sanction list: authority, region, and what
 *  the list covers. */
function ListTooltip({ id, children }: { id: string; children: ReactNode }) {
  const l = listById(id)
  if (l == null) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-center">
        <span className="block font-medium">{l.authority} · {l.region}</span>
        <span className="block text-primary-foreground/80">{l.blurb}</span>
      </TooltipContent>
    </Tooltip>
  )
}

const fmtWhen = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, mins)} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50', checked ? 'bg-primary' : 'bg-muted-foreground/40')}
    >
      <span className={cn('inline-block size-4 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
    </button>
  )
}

function SourceLine({ compact }: { compact?: boolean }) {
  const via = useActiveIntegration('screening')
  const navigate = useNavigate()
  if (via != null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Plug className="size-3.5 text-success" /> Sourced from <span className="font-medium text-foreground">{via.providerName}</span>
        <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">{via.environment}</span>
      </span>
    )
  }
  return (
    <button type="button" onClick={() => navigate('/issuer/integrations')} className={cn('inline-flex items-center gap-1 font-medium text-primary hover:underline', compact ? 'text-[11px]' : 'text-[12px]')}>
      <Plug className="size-3.5" /> Connect a sanctions provider
    </button>
  )
}

const UPDATE_TONE: Record<ListUpdate['kind'], { Icon: typeof Plus; cls: string }> = {
  added: { Icon: Plus, cls: 'text-warning' },
  amended: { Icon: RefreshCw, cls: 'text-sky-600' },
  removed: { Icon: Minus, cls: 'text-muted-foreground' },
}

function UpdatesFeed({ updates, emptyLabel }: { updates: ListUpdate[]; emptyLabel: string }) {
  if (updates.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-subtle-foreground">{emptyLabel}</p>
  }
  return (
    <div className="divide-y divide-separator">
      {updates.map(u => {
        const list = listById(u.listId)
        const { Icon, cls } = UPDATE_TONE[u.kind]
        const pending = u.status === 'pending'
        return (
          <div key={u.id} className="flex items-center gap-2.5 py-2">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full bg-muted', cls)}>
              <Icon className="size-3.5" strokeWidth={2.4} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] text-foreground">
                <span className="font-medium">{list?.name ?? u.listId}</span> · {u.count} {UPDATE_VERB[u.kind]}
              </div>
              <div className="text-[11px] text-subtle-foreground">{fmtWhen(u.at)}</div>
            </div>
            {pending ? (
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => applyUpdate(u.id)} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                  <Check className="size-3" /> Apply
                </button>
                <button type="button" onClick={() => dismissUpdate(u.id)} aria-label="Dismiss" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-success"><Check className="size-3" /> Applied</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Global (Compliance page) ──────────────────────────────────────────────────

export function GlobalSanctionLists() {
  const enabled = useGlobalLists()
  const updates = useListUpdates()
  const pending = updates.filter(u => u.status === 'pending')
  const set = new Set(enabled)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Lists */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-foreground">Active lists</div>
          <SourceLine />
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Applied to every instrument by default. Override per instrument in its Restrictions tab.</p>
        <div className="mt-3 divide-y divide-separator">
          {SANCTION_LISTS.map(l => (
            <div key={l.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">{l.name}</div>
                <div className="truncate text-[11.5px] text-subtle-foreground">{l.authority} · {l.region}</div>
              </div>
              <Switch checked={set.has(l.id)} onChange={on => setGlobalList(l.id, on)} label={`Enable ${l.name} globally`} />
            </div>
          ))}
        </div>
      </div>

      {/* Incoming updates */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-foreground">
            Incoming updates {pending.length > 0 && <span className="text-[12px] font-medium text-warning">· {pending.length} pending</span>}
          </div>
          {pending.length > 0 && (
            <button type="button" onClick={applyAllUpdates} className="text-[12px] font-medium text-primary hover:underline">Apply all</button>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">List changes pushed by the connected provider.</p>
        <div className="mt-3">
          <UpdatesFeed updates={updates} emptyLabel="No list updates." />
        </div>
      </div>
    </div>
  )
}

// ── Per-instrument (Restrictions tab) ─────────────────────────────────────────

export function InstrumentSanctionLists({ assetId, assetLabel }: { assetId: string; assetLabel: string }) {
  const global = useGlobalLists()
  const { policy, effective } = useInstrumentPolicy(assetId)
  const updates = useListUpdates()
  const effSet = new Set(effective)
  const custom = policy.mode === 'custom'
  // Updates that touch a list in force for this instrument.
  const relevant = updates.filter(u => effSet.has(u.listId))
  const pending = relevant.filter(u => u.status === 'pending')

  return (
    <TooltipProvider delayDuration={150}>
    <div className="rounded-md border border-border bg-card p-[16px_18px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-semibold">Sanction lists</div>
        <SourceLine compact />
      </div>
      <p className="mt-1 text-[12px] leading-[1.5] text-subtle-foreground">
        Which lists screen holders of {assetLabel}. Inherit the org-wide policy or add/remove lists for this instrument.
      </p>

      {/* Mode */}
      <div className="mt-3 inline-flex rounded-lg border border-border p-0.5">
        {(['inherit', 'custom'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setInstrumentMode(assetId, m)}
            className={cn('rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors', policy.mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {m === 'inherit' ? 'Inherit global' : 'Customise'}
          </button>
        ))}
      </div>

      {!custom ? (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Effective lists · inherited</div>
          {effective.length === 0 ? (
            <p className="text-[12px] text-subtle-foreground">No lists active globally.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {effective.map(id => (
                <ListTooltip key={id} id={id}>
                  <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-success/30 bg-success/5 px-2.5 py-0.5 text-[11.5px] font-medium text-foreground">
                    <Check className="size-3 text-success" strokeWidth={3} /> {listById(id)?.name ?? id}
                  </span>
                </ListTooltip>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-separator">
          {SANCTION_LISTS.map(l => {
            const on = effSet.has(l.id)
            return (
              <div key={l.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <ListTooltip id={l.id}>
                    <div className="inline-block cursor-help text-[12.5px] font-medium text-foreground">{l.name}</div>
                  </ListTooltip>
                  <div className="truncate text-[11px] text-subtle-foreground">
                    {l.authority}{!global.includes(l.id) && on ? ' · added for this instrument' : ''}{global.includes(l.id) && !on ? ' · removed for this instrument' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInstrumentList(assetId, l.id, !on)}
                  className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors', on ? 'border-border text-foreground hover:bg-muted' : 'border-primary/40 text-primary hover:bg-primary/5')}
                >
                  {on ? <><Minus className="size-3" /> Remove</> : <><Plus className="size-3" /> Add</>}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Automatic updates affecting this instrument */}
      <div className="mt-4 border-t border-separator pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] font-semibold text-foreground">
            Automatic updates {pending.length > 0 && <span className="font-medium text-warning">· {pending.length} pending</span>}
          </div>
          {pending.length > 0 && (
            <button type="button" onClick={() => pending.forEach(u => applyUpdate(u.id))} className="text-[11.5px] font-medium text-primary hover:underline">Apply all</button>
          )}
        </div>
        <div className="mt-2">
          <UpdatesFeed updates={relevant} emptyLabel="No updates for this instrument’s lists." />
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}
