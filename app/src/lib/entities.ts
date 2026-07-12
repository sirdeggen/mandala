/**
 * Institutional relationships (demo). The organisations an issuer works with -
 * reserve banks, custodians, market makers, exchanges, auditors, regulators -
 * and the people at each who have access to this platform, with their system
 * role and permissions. Seeded with realistic mock data and editable; persisted
 * per browser via the module-store + useSyncExternalStore idiom.
 */
import { useSyncExternalStore } from 'react'

// ── Taxonomy ──────────────────────────────────────────────────────────────────

export type EntityType =
  | 'reserve-bank' | 'custodian' | 'market-maker' | 'corporate-treasury'
  | 'exchange' | 'fund' | 'auditor' | 'regulator'

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  'reserve-bank': 'Reserve bank',
  custodian: 'Custodian',
  'market-maker': 'Market maker',
  'corporate-treasury': 'Corporate treasury',
  exchange: 'Exchange',
  fund: 'Fund',
  auditor: 'Auditor',
  regulator: 'Regulator',
}

export type RelationshipKind = 'reserve' | 'custody' | 'liquidity' | 'distribution' | 'audit' | 'oversight'

export const RELATIONSHIP_LABEL: Record<RelationshipKind, string> = {
  reserve: 'Reserve banking',
  custody: 'Custody',
  liquidity: 'Liquidity',
  distribution: 'Distribution',
  audit: 'Audit',
  oversight: 'Oversight',
}

export type EntityStatus = 'active' | 'onboarding' | 'suspended'
export const ENTITY_STATUS_LABEL: Record<EntityStatus, string> = { active: 'Active', onboarding: 'Onboarding', suspended: 'Suspended' }

export type SystemRole = 'admin' | 'approver' | 'operator' | 'auditor' | 'viewer'
export const SYSTEM_ROLE_LABEL: Record<SystemRole, string> = {
  admin: 'Administrator', approver: 'Approver', operator: 'Operator', auditor: 'Auditor', viewer: 'Viewer',
}

export type Permission = 'issue' | 'redeem' | 'attest' | 'reserves' | 'screening' | 'controls' | 'integrations' | 'reports'
export const PERMISSION_LABEL: Record<Permission, string> = {
  issue: 'Issue', redeem: 'Redeem', attest: 'Attest & sign-off', reserves: 'Manage reserves',
  screening: 'Screening & KYC', controls: 'Freeze & controls', integrations: 'Integrations', reports: 'Reports & exports',
}
export const PERMISSION_DESCRIPTION: Record<Permission, string> = {
  issue: 'Put new units into circulation.',
  redeem: 'Take units out of circulation at par.',
  attest: 'Sign reserve attestations and control actions.',
  reserves: 'Record and manage reserve composition.',
  screening: 'Screen holders and manage KYC/sanctions.',
  controls: 'Pause, freeze and manage access controls.',
  integrations: 'Connect and manage external providers.',
  reports: 'View and export compliance reports.',
}
export const ALL_PERMISSIONS: Permission[] = ['issue', 'redeem', 'attest', 'reserves', 'screening', 'controls', 'integrations', 'reports']

export const ROLE_DEFAULT_PERMISSIONS: Record<SystemRole, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  approver: ['attest', 'controls', 'screening', 'reports'],
  operator: ['issue', 'redeem', 'reserves', 'reports'],
  auditor: ['attest', 'screening', 'reports'],
  viewer: ['reports'],
}

export type PersonStatus = 'active' | 'invited' | 'suspended'
export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = { active: 'Active', invited: 'Invited', suspended: 'Suspended' }

export interface Person {
  id: string
  name: string
  title: string
  systemRole: SystemRole
  permissions: Permission[]
  badgeKey: string        // seeds the identity sigil
  status: PersonStatus
  lastActiveAt: string    // ISO
}

export interface Entity {
  id: string
  name: string
  type: EntityType
  relationship: RelationshipKind
  jurisdiction: string
  status: EntityStatus
  monogram: string
  color: string
  /** True for our own organisation - whose members we manage. External orgs
   *  are view-only (they manage their own members). */
  own?: boolean
  /** Real product logo bundled under src/assets/entities/<id>.png, if any. */
  domain?: string
  sinceAt: string         // ISO
  instruments: string[]
  people: Person[]
}

// Real institution logos, resolved to hashed asset URLs at build time.
const LOGO_FILES = import.meta.glob('../assets/entities/*.png', { eager: true, import: 'default' }) as Record<string, string>
const LOGO_BY_ID: Record<string, string> = {}
for (const [path, url] of Object.entries(LOGO_FILES)) {
  const id = (path.split('/').pop() ?? '').replace(/\.png$/, '')
  if (id !== '') LOGO_BY_ID[id] = url
}

/** Bundled logo URL for an entity, or null to fall back to the monogram tile. */
export const entityLogo = (id: string): string | null => LOGO_BY_ID[id] ?? null

// ── Seed ──────────────────────────────────────────────────────────────────────

const hrs = (base: number, h: number) => new Date(base - h * 3_600_000).toISOString()
const days = (base: number, d: number) => new Date(base - d * 86_400_000).toISOString()

/** Build our own organisation + the full known-institution directory fresh
 *  (people/timestamps regenerated each call - fine for mock data). */
function buildAll(): { own: Entity; directory: Entity[] } {
  const now = Date.now()
  let pid = 0
  const p = (name: string, title: string, systemRole: SystemRole, status: PersonStatus, lastH: number, perms?: Permission[]): Person => {
    pid += 1
    return {
      id: `p${pid}`,
      name,
      title,
      systemRole,
      permissions: perms ?? ROLE_DEFAULT_PERMISSIONS[systemRole],
      badgeKey: `02${(pid * 2654435761 >>> 0).toString(16).padStart(8, '0')}${name.replace(/\s/g, '').toLowerCase()}`,
      status,
      lastActiveAt: hrs(now, lastH),
    }
  }
  const own: Entity = {
    id: 'self', name: 'Your organisation', type: 'reserve-bank', relationship: 'reserve', own: true,
    jurisdiction: 'Switzerland', status: 'active', monogram: 'YO', color: '#0f172a', sinceAt: days(now, 600),
    instruments: ['CHFD', 'EURD', 'USDX'],
    people: [
      p('Anna Weber', 'Head of Issuance', 'admin', 'active', 0),
      p('Marc Bianchi', 'Compliance Lead', 'approver', 'active', 3),
      p('Sofia Meier', 'Treasury Operations', 'operator', 'active', 8),
      p('Daniel Roth', 'Internal Audit', 'auditor', 'active', 26),
    ],
  }
  const directory: Entity[] = [
    {
      id: 'sygnum', name: 'Sygnum Bank', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'Sy', color: '#111827', domain: 'sygnum.com', sinceAt: days(now, 420),
      instruments: ['CHFD', 'EURD'],
      people: [
        p('Andrea Vogt', 'Head of Correspondent Banking', 'approver', 'active', 2),
        p('Marco Brunner', 'Treasury Operations Lead', 'operator', 'active', 9),
        p('Lena Frei', 'Compliance Officer', 'auditor', 'active', 30),
      ],
    },
    {
      id: 'amina', name: 'AMINA Bank', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'AM', color: '#0f766e', domain: 'aminagroup.com', sinceAt: days(now, 300),
      instruments: ['CHFD', 'USDX'],
      people: [
        p('Julien Moreau', 'Relationship Manager', 'operator', 'active', 1),
        p('Nadia Keller', 'Risk & Controls', 'approver', 'active', 48),
      ],
    },
    {
      id: 'zkb', name: 'Zürcher Kantonalbank', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'ZK', color: '#005aa0', domain: 'zkb.ch', sinceAt: days(now, 350),
      instruments: ['CHFD'],
      people: [
        p('Isabelle Rey', 'Head of Institutional', 'approver', 'active', 22),
        p('Pierre Meier', 'Reserve Accounts', 'operator', 'active', 44),
      ],
    },
    {
      id: 'postfinance', name: 'PostFinance', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'onboarding', monogram: 'PF', color: '#ffcc00', domain: 'postfinance.ch', sinceAt: days(now, 14),
      instruments: ['CHFD'],
      people: [
        p('Erik Lindqvist', 'Treasury Lead', 'viewer', 'invited', 72),
      ],
    },
    {
      id: 'fireblocks', name: 'Fireblocks', type: 'custodian', relationship: 'custody',
      jurisdiction: 'United States', status: 'active', monogram: 'Fb', color: '#f5820b', domain: 'fireblocks.com', sinceAt: days(now, 260),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Sophie Blanc', 'Vault Operations', 'operator', 'active', 5),
        p('Thomas Roth', 'Solutions Engineer', 'operator', 'active', 20, ['integrations', 'reports']),
      ],
    },
    {
      id: 'taurus', name: 'Taurus', type: 'custodian', relationship: 'custody',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'Ta', color: '#1f2937', domain: 'taurushq.com', sinceAt: days(now, 200),
      instruments: ['CHFD', 'EURD'],
      people: [
        p('Felix Wyss', 'Head of Custody', 'admin', 'active', 15),
        p('Ana Costa', 'Settlement Ops', 'operator', 'active', 52),
      ],
    },
    {
      id: 'sdx', name: 'SIX Digital Exchange', type: 'exchange', relationship: 'distribution',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'SD', color: '#e60000', domain: 'sdx.com', sinceAt: days(now, 160),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Elena Fischer', 'Listings Manager', 'operator', 'active', 4),
        p('Hanna Suter', 'Compliance', 'auditor', 'active', 40),
      ],
    },
    {
      id: 'pwc', name: 'PwC Switzerland', type: 'auditor', relationship: 'audit',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'Pw', color: '#d04a02', domain: 'pwc.ch', sinceAt: days(now, 300),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Dr. Petra Wenger', 'Lead Auditor', 'auditor', 'active', 18),
        p('Simon Baumann', 'Audit Associate', 'auditor', 'active', 34),
      ],
    },
    {
      id: '21shares', name: '21Shares', type: 'fund', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: '21', color: '#111827', domain: '21shares.com', sinceAt: days(now, 120),
      instruments: ['USDX'],
      people: [
        p('Klaus Berger', 'Product Manager', 'viewer', 'active', 60, ['reserves', 'reports']),
      ],
    },
    {
      id: 'finma', name: 'FINMA', type: 'regulator', relationship: 'oversight',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'FI', color: '#0a3161', domain: 'finma.ch', sinceAt: days(now, 500),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Supervision Desk', 'Regulatory Liaison', 'viewer', 'active', 240, ['reports']),
      ],
    },
  ]
  return { own, directory }
}

/** All known institutions (the directory the Add-relationship picker draws from). */
export function directoryEntities(): Entity[] { return buildAll().directory }

/** Relationships added by default. Others in the directory can be added later. */
const INITIAL_ADDED = ['sygnum', 'zkb', 'postfinance', 'pwc', 'finma']

function seed(): Entity[] {
  const { own, directory } = buildAll()
  return [own, ...directory.filter(e => INITIAL_ADDED.includes(e.id))]
}

// ── Store ─────────────────────────────────────────────────────────────────────

const KEY = 'underwrite.entities.v4'
const listeners = new Set<() => void>()

function read(): Entity[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY)
      if (raw != null) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed as Entity[]
      }
    }
  } catch { /* fall through */ }
  return seed()
}

let current = read()
let seq = 0

function persist(next: Entity[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const uid = (p: string) => { seq += 1; return `${p}-${current.length}-${seq}-${(seq * 2654435761 >>> 0).toString(16).slice(0, 4)}` }

// ── Entity mutations ──────────────────────────────────────────────────────────

/** Add an existing institution from the directory as a relationship. Creation
 *  of brand-new institutions is intentionally not supported - you can only add
 *  organisations that already exist in the network. */
export function addFromDirectory(id: string): Entity | null {
  if (current.some(e => e.id === id)) return null
  const entity = buildAll().directory.find(d => d.id === id)
  if (entity == null) return null
  persist([...current, { ...entity, status: 'onboarding', sinceAt: new Date().toISOString() }])
  return entity
}

export function removeEntity(id: string): void {
  persist(current.filter(e => e.id !== id))
}

function patchEntity(id: string, fn: (e: Entity) => Entity): void {
  persist(current.map(e => (e.id === id ? fn(e) : e)))
}

export function setEntityStatus(id: string, status: EntityStatus): void {
  patchEntity(id, e => ({ ...e, status }))
}

// ── Person mutations ──────────────────────────────────────────────────────────

export interface NewPerson {
  name: string
  title: string
  systemRole: SystemRole
}

export function addPerson(entityId: string, input: NewPerson): void {
  const id = uid('p')
  const person: Person = {
    id,
    name: input.name.trim(),
    title: input.title.trim(),
    systemRole: input.systemRole,
    permissions: ROLE_DEFAULT_PERMISSIONS[input.systemRole],
    badgeKey: `02${(seq * 2654435761 >>> 0).toString(16).padStart(8, '0')}${input.name.replace(/\s/g, '').toLowerCase()}`,
    status: 'invited',
    lastActiveAt: new Date().toISOString(),
  }
  patchEntity(entityId, e => ({ ...e, people: [...e.people, person] }))
}

export function removePerson(entityId: string, personId: string): void {
  patchEntity(entityId, e => ({ ...e, people: e.people.filter(p => p.id !== personId) }))
}

function patchPerson(entityId: string, personId: string, fn: (p: Person) => Person): void {
  patchEntity(entityId, e => ({ ...e, people: e.people.map(p => (p.id === personId ? fn(p) : p)) }))
}

export function setPersonRole(entityId: string, personId: string, role: SystemRole): void {
  patchPerson(entityId, personId, p => ({ ...p, systemRole: role, permissions: ROLE_DEFAULT_PERMISSIONS[role] }))
}

export function togglePersonPermission(entityId: string, personId: string, perm: Permission): void {
  patchPerson(entityId, personId, p => ({
    ...p,
    permissions: p.permissions.includes(perm) ? p.permissions.filter(x => x !== perm) : [...p.permissions, perm],
  }))
}

export function setPersonStatus(entityId: string, personId: string, status: PersonStatus): void {
  patchPerson(entityId, personId, p => ({ ...p, status }))
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useEntities(): Entity[] {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

export function useEntity(id: string | null): Entity | null {
  const all = useEntities()
  return id == null ? null : all.find(e => e.id === id) ?? null
}

/** Directory institutions not yet added as a relationship. */
export function useAvailableEntities(): Entity[] {
  const added = new Set(useEntities().map(e => e.id))
  return directoryEntities().filter(e => !added.has(e.id))
}
