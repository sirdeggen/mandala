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
  sinceAt: string         // ISO
  instruments: string[]
  people: Person[]
}

// ── Seed ──────────────────────────────────────────────────────────────────────

const hrs = (base: number, h: number) => new Date(base - h * 3_600_000).toISOString()
const days = (base: number, d: number) => new Date(base - d * 86_400_000).toISOString()

function seed(): Entity[] {
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
  return [
    {
      id: 'e-helvetia', name: 'Helvetia Kantonalbank AG', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'HK', color: '#b91c1c', sinceAt: days(now, 420),
      instruments: ['CHFD', 'EURD'],
      people: [
        p('Andrea Vogt', 'Head of Correspondent Banking', 'approver', 'active', 2),
        p('Marco Brunner', 'Treasury Operations Lead', 'operator', 'active', 9),
        p('Lena Frei', 'Compliance Officer', 'auditor', 'active', 30),
      ],
    },
    {
      id: 'e-alpine', name: 'Alpine Custody Services SA', type: 'custodian', relationship: 'custody',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'AC', color: '#0e7490', sinceAt: days(now, 300),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Julien Moreau', 'Custody Relationship Manager', 'operator', 'active', 1),
        p('Sophie Blanc', 'Vault Operations', 'operator', 'active', 5),
        p('Thomas Roth', 'Head of Custody', 'admin', 'active', 20),
        p('Nadia Keller', 'Risk & Controls', 'approver', 'active', 48),
      ],
    },
    {
      id: 'e-matterhorn', name: 'Matterhorn Market Making AG', type: 'market-maker', relationship: 'liquidity',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'MM', color: '#7c3aed', sinceAt: days(now, 210),
      instruments: ['CHFD', 'USDX'],
      people: [
        p('David Iten', 'Head of Trading', 'operator', 'active', 3),
        p('Priya Nair', 'Liquidity Desk', 'operator', 'active', 6),
      ],
    },
    {
      id: 'e-rhone', name: 'Rhône Liquidity Partners SA', type: 'market-maker', relationship: 'liquidity',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'RL', color: '#4f46e5', sinceAt: days(now, 160),
      instruments: ['EURD'],
      people: [
        p('Camille Girard', 'Managing Partner', 'admin', 'active', 12),
        p('Louis Favre', 'Quant Trader', 'operator', 'active', 26),
      ],
    },
    {
      id: 'e-zurichdx', name: 'Zürich Digital Exchange AG', type: 'exchange', relationship: 'distribution',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'ZD', color: '#0891b2', sinceAt: days(now, 130),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Elena Fischer', 'Listings Manager', 'operator', 'active', 4),
        p('Ravi Menon', 'Integrations Engineer', 'operator', 'active', 8, ['integrations', 'reports']),
        p('Hanna Suter', 'Compliance', 'auditor', 'active', 40),
      ],
    },
    {
      id: 'e-nordkap', name: 'Nordkap Asset Management AG', type: 'corporate-treasury', relationship: 'distribution',
      jurisdiction: 'Switzerland', status: 'onboarding', monogram: 'NK', color: '#334155', sinceAt: days(now, 14),
      instruments: ['CHFD'],
      people: [
        p('Erik Lindqvist', 'Treasurer', 'viewer', 'invited', 72),
        p('Mia Holm', 'Operations', 'viewer', 'invited', 96),
      ],
    },
    {
      id: 'e-helvetic-assurance', name: 'Helvetic Assurance AG', type: 'auditor', relationship: 'audit',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'HA', color: '#7c2d12', sinceAt: days(now, 260),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Dr. Petra Wenger', 'Lead Auditor', 'auditor', 'active', 18),
        p('Simon Baumann', 'Audit Associate', 'auditor', 'active', 34),
      ],
    },
    {
      id: 'e-finma', name: 'FINMA', type: 'regulator', relationship: 'oversight',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'FI', color: '#0a3161', sinceAt: days(now, 500),
      instruments: ['CHFD', 'EURD', 'USDX'],
      people: [
        p('Regulatory Liaison', 'Supervision Desk', 'viewer', 'active', 240, ['reports']),
      ],
    },
    {
      id: 'e-aare', name: 'Aare Digital Custody AG', type: 'custodian', relationship: 'custody',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'AA', color: '#166534', sinceAt: days(now, 95),
      instruments: ['USDX'],
      people: [
        p('Felix Wyss', 'Head of Digital Assets', 'admin', 'active', 15),
        p('Ana Costa', 'Settlement Ops', 'operator', 'active', 52),
      ],
    },
    {
      id: 'e-lemanmm', name: 'Lemanic Capital Markets AG', type: 'market-maker', relationship: 'liquidity',
      jurisdiction: 'Switzerland', status: 'suspended', monogram: 'LC', color: '#9a3412', sinceAt: days(now, 200),
      instruments: ['EURD'],
      people: [
        p('Olivier Dubois', 'Head of Markets', 'operator', 'suspended', 500),
      ],
    },
    {
      id: 'e-genevepb', name: 'Genève Private Bank SA', type: 'reserve-bank', relationship: 'reserve',
      jurisdiction: 'Switzerland', status: 'active', monogram: 'GP', color: '#1e3a8a', sinceAt: days(now, 350),
      instruments: ['EURD'],
      people: [
        p('Isabelle Rey', 'Head of Institutional', 'approver', 'active', 22),
        p('Pierre Meier', 'Reserve Accounts', 'operator', 'active', 44),
      ],
    },
    {
      id: 'e-alpinefund', name: 'Alpine Money Market Fund', type: 'fund', relationship: 'reserve',
      jurisdiction: 'Luxembourg', status: 'active', monogram: 'AF', color: '#0d9488', sinceAt: days(now, 120),
      instruments: ['USDX'],
      people: [
        p('Klaus Berger', 'Fund Manager', 'viewer', 'active', 60, ['reserves', 'reports']),
      ],
    },
  ]
}

// ── Store ─────────────────────────────────────────────────────────────────────

const KEY = 'underwrite.entities.v1'
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

export interface NewEntity {
  name: string
  type: EntityType
  relationship: RelationshipKind
  jurisdiction: string
  instruments?: string[]
}

export function addEntity(input: NewEntity): Entity {
  const now = new Date().toISOString()
  const monogram = input.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '??'
  const palette = ['#b91c1c', '#0e7490', '#7c3aed', '#1e3a8a', '#166534', '#9a3412', '#0891b2', '#4f46e5']
  const entity: Entity = {
    id: uid('e'),
    name: input.name.trim(),
    type: input.type,
    relationship: input.relationship,
    jurisdiction: input.jurisdiction.trim() || 'Switzerland',
    status: 'onboarding',
    monogram,
    color: palette[(current.length) % palette.length],
    sinceAt: now,
    instruments: input.instruments ?? [],
    people: [],
  }
  persist([entity, ...current])
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
