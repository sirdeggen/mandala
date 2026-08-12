/**
 * Sanction-list governance (demo). Which official sanction lists are active -
 * globally and per instrument - plus a mock stream of "incoming" list updates
 * that would arrive from a connected sanctions-list provider. Persisted per
 * browser via the module-store + useSyncExternalStore idiom used across the app.
 * Screening itself remains simulated; this governs which lists it applies.
 */
import { useSyncExternalStore } from 'react'

export interface SanctionList {
  id: string
  name: string
  authority: string
  region: string
  blurb: string
}

/** The official lists an issuer can switch on. Names/authorities are real; the
 *  data behind them is simulated for the demo. */
export const SANCTION_LISTS: SanctionList[] = [
  { id: 'ofac-sdn', name: 'OFAC SDN', authority: 'US Treasury · OFAC', region: 'United States', blurb: 'Specially Designated Nationals & Blocked Persons.' },
  { id: 'ofac-consolidated', name: 'OFAC Consolidated', authority: 'US Treasury · OFAC', region: 'United States', blurb: 'Non-SDN consolidated sanctions.' },
  { id: 'eu-consolidated', name: 'EU Consolidated', authority: 'European Union · EEAS', region: 'European Union', blurb: 'EU consolidated financial sanctions list.' },
  { id: 'un-consolidated', name: 'UN Security Council', authority: 'United Nations', region: 'Global', blurb: 'UN Security Council consolidated list.' },
  { id: 'uk-ofsi', name: 'UK OFSI', authority: 'HM Treasury · OFSI', region: 'United Kingdom', blurb: 'UK consolidated list of financial sanctions targets.' },
  { id: 'ch-seco', name: 'Swiss SECO', authority: 'SECO · SESAM', region: 'Switzerland', blurb: 'Swiss sanctions programme administered by SECO.' },
]

export const listById = (id: string): SanctionList | undefined => SANCTION_LISTS.find(l => l.id === id)

const DEFAULT_ENABLED = ['ofac-sdn', 'eu-consolidated', 'un-consolidated', 'ch-seco']

export type UpdateKind = 'added' | 'removed' | 'amended'

export interface ListUpdate {
  id: string
  listId: string
  kind: UpdateKind
  count: number
  at: string              // ISO
  status: 'pending' | 'applied'
}

export interface InstrumentPolicy {
  mode: 'inherit' | 'custom'
  lists: string[]         // used only when mode === 'custom'
}

interface State {
  global: string[]
  perInstrument: Record<string, InstrumentPolicy>
  updates: ListUpdate[]
}

const KEY = 'underwrite.sanctions.v1'
const listeners = new Set<() => void>()

/** Seed a realistic-looking set of recent list updates on first run. The `at`
 *  values are offsets from a fixed base so they read as "recent" without needing
 *  a live clock at seed time. */
function seedUpdates(): ListUpdate[] {
  const now = Date.now()
  const hrs = (h: number) => new Date(now - h * 3_600_000).toISOString()
  return [
    { id: 'u1', listId: 'ofac-sdn', kind: 'added', count: 14, at: hrs(3), status: 'pending' },
    { id: 'u2', listId: 'eu-consolidated', kind: 'amended', count: 6, at: hrs(9), status: 'pending' },
    { id: 'u3', listId: 'un-consolidated', kind: 'removed', count: 2, at: hrs(27), status: 'applied' },
    { id: 'u4', listId: 'ch-seco', kind: 'added', count: 5, at: hrs(52), status: 'applied' },
    { id: 'u5', listId: 'ofac-sdn', kind: 'amended', count: 3, at: hrs(76), status: 'applied' },
  ]
}

function read(): State {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY)
      if (raw != null) {
        const parsed = JSON.parse(raw) as Partial<State>
        return {
          global: Array.isArray(parsed.global) ? parsed.global : [...DEFAULT_ENABLED],
          perInstrument: parsed.perInstrument ?? {},
          updates: Array.isArray(parsed.updates) ? parsed.updates : seedUpdates(),
        }
      }
    }
  } catch { /* fall through */ }
  return { global: [...DEFAULT_ENABLED], perInstrument: {}, updates: seedUpdates() }
}

let current = read()
let seq = 0

function persist(next: State): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ── Global list toggles ───────────────────────────────────────────────────────

export function setGlobalList(id: string, on: boolean): void {
  const set = new Set(current.global)
  if (on) set.add(id); else set.delete(id)
  persist({ ...current, global: SANCTION_LISTS.filter(l => set.has(l.id)).map(l => l.id) })
}

// ── Per-instrument policy ─────────────────────────────────────────────────────

function instrumentPolicy(assetId: string): InstrumentPolicy {
  return current.perInstrument[assetId] ?? { mode: 'inherit', lists: [] }
}

export function setInstrumentMode(assetId: string, mode: 'inherit' | 'custom'): void {
  const prev = instrumentPolicy(assetId)
  // Starting a custom policy seeds it from whatever is currently effective.
  const lists = mode === 'custom' && prev.mode === 'inherit' ? [...current.global] : prev.lists
  persist({ ...current, perInstrument: { ...current.perInstrument, [assetId]: { mode, lists } } })
}

export function setInstrumentList(assetId: string, id: string, on: boolean): void {
  const prev = instrumentPolicy(assetId)
  const base = prev.mode === 'custom' ? prev.lists : current.global
  const set = new Set(base)
  if (on) set.add(id); else set.delete(id)
  persist({
    ...current,
    perInstrument: {
      ...current.perInstrument,
      [assetId]: { mode: 'custom', lists: SANCTION_LISTS.filter(l => set.has(l.id)).map(l => l.id) },
    },
  })
}

/** The list ids actually in force for an instrument (global set when inheriting). */
export function effectiveLists(assetId: string): string[] {
  const p = instrumentPolicy(assetId)
  return p.mode === 'custom' ? p.lists : current.global
}

// ── Incoming updates ──────────────────────────────────────────────────────────

export function applyUpdate(id: string): void {
  persist({ ...current, updates: current.updates.map(u => (u.id === id ? { ...u, status: 'applied' } : u)) })
}

export function applyAllUpdates(): void {
  persist({ ...current, updates: current.updates.map(u => ({ ...u, status: 'applied' })) })
}

export function dismissUpdate(id: string): void {
  persist({ ...current, updates: current.updates.filter(u => u.id !== id) })
}

/** Simulate a fresh update arriving from the provider (for the demo). */
export function simulateIncoming(listId: string, kind: UpdateKind, count: number): void {
  seq += 1
  const u: ListUpdate = { id: `u-${seq}-${current.updates.length}`, listId, kind, count, at: new Date().toISOString(), status: 'pending' }
  persist({ ...current, updates: [u, ...current.updates].slice(0, 40) })
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useStore(): State {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

export function useGlobalLists(): string[] {
  return useStore().global
}

export function useInstrumentPolicy(assetId: string): { policy: InstrumentPolicy; effective: string[] } {
  const s = useStore()
  const policy = s.perInstrument[assetId] ?? { mode: 'inherit', lists: [] }
  const effective = policy.mode === 'custom' ? policy.lists : s.global
  return { policy, effective }
}

export function useListUpdates(): ListUpdate[] {
  return useStore().updates
}

export const UPDATE_VERB: Record<UpdateKind, string> = {
  added: 'entries added',
  removed: 'delistings',
  amended: 'entries amended',
}
