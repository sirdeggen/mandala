/**
 * Integrations - the external services a regulated stablecoin issuer wires into
 * the platform (KYC, sanctions/AML feeds, banking & custody, SSO, attestation,
 * reporting). Everything here is a DEMO: the provider catalogue is static and
 * connections are mock records persisted per-browser (localStorage + the
 * module-store + useSyncExternalStore idiom used across the app). No real
 * network calls, keys, or OAuth handshakes happen - the UI shows exactly where
 * those would plug in. Provider names are illustrative and imply no affiliation.
 */
import { useSyncExternalStore } from 'react'

// ── Catalogue ─────────────────────────────────────────────────────────────────

export type IntegrationCategory =
  | 'kyc' | 'sanctions' | 'analytics' | 'banking' | 'sso' | 'attestation' | 'reporting'

export const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  kyc: 'KYC & identity verification',
  sanctions: 'Sanctions, PEP & AML screening',
  analytics: 'Blockchain analytics',
  banking: 'Banking, reserves & custody',
  sso: 'Access control & SSO',
  attestation: 'Attestation & proof-of-reserves',
  reporting: 'Regulatory reporting & alerts',
}

export const CATEGORY_ORDER: IntegrationCategory[] =
  ['kyc', 'sanctions', 'analytics', 'banking', 'sso', 'attestation', 'reporting']

export type AuthType = 'api_key' | 'oauth2' | 'mtls' | 'webhook'

export const AUTH_LABEL: Record<AuthType, string> = {
  api_key: 'API key',
  oauth2: 'OAuth 2.0',
  mtls: 'Mutual TLS certificate',
  webhook: 'Signed webhook',
}

/** Which simulated subsystem a provider would feed, so connecting it can
 *  relabel that area's data provenance ("via {provider}"). */
export type Subsystem = 'screening' | 'kyc' | 'reserves' | 'rbac' | 'reporting'

export interface Provider {
  id: string
  name: string
  category: IntegrationCategory
  blurb: string
  authType: AuthType
  monogram: string
  color: string          // brand-ish tile colour, used as the logo fallback
  /** Domain used to fetch the real product logo (falls back to the monogram). */
  domain?: string
  scopes: string[]
  /** Human description of what it powers in Underwrite. */
  powers: string
  /** The subsystem it feeds (drives cross-page relabelling), if any. */
  subsystem?: Subsystem
  /** Featured in the empty-state "most common" cards. */
  popular?: boolean
}

export const PROVIDERS: Provider[] = [
  // KYC / identity verification
  { id: 'onfido', name: 'Onfido', category: 'kyc', authType: 'api_key', monogram: 'On', color: '#3a3ad6', domain: 'onfido.com', popular: true, subsystem: 'kyc', powers: 'Holder identity verification & document checks', blurb: 'Automated identity document and biometric verification for holder onboarding.', scopes: ['applicants.read', 'checks.write', 'watchlist.read'] },
  { id: 'jumio', name: 'Jumio', category: 'kyc', authType: 'oauth2', monogram: 'Ju', color: '#0a7d3d', domain: 'jumio.com', subsystem: 'kyc', powers: 'ID verification & liveness', blurb: 'ID verification, liveness detection and AML screening in one flow.', scopes: ['identity.verify', 'aml.read'] },
  { id: 'persona', name: 'Persona', category: 'kyc', authType: 'api_key', monogram: 'Pe', color: '#4a55f0', domain: 'withpersona.com', subsystem: 'kyc', powers: 'Configurable KYC/KYB flows', blurb: 'Configurable KYC/KYB verification with reusable identities.', scopes: ['inquiries.write', 'accounts.read'] },
  { id: 'sumsub', name: 'Sumsub', category: 'kyc', authType: 'api_key', monogram: 'Su', color: '#ff5a1f', domain: 'sumsub.com', subsystem: 'kyc', powers: 'KYC/KYB & ongoing monitoring', blurb: 'Full-cycle verification with ongoing AML monitoring.', scopes: ['applicant.write', 'aml.monitor'] },

  // Sanctions / PEP / AML
  { id: 'complyadvantage', name: 'ComplyAdvantage', category: 'sanctions', authType: 'api_key', monogram: 'CA', color: '#0b8f7a', domain: 'complyadvantage.com', popular: true, subsystem: 'screening', powers: 'Sanctions, PEP & adverse-media screening', blurb: 'Real-time sanctions, PEP and adverse-media screening with ongoing monitoring.', scopes: ['search.write', 'monitors.write', 'webhooks.read'] },
  { id: 'worldcheck', name: 'Refinitiv World-Check', category: 'sanctions', authType: 'mtls', monogram: 'WC', color: '#e8601c', domain: 'lseg.com', subsystem: 'screening', powers: 'Sanctions & PEP reference data', blurb: 'Structured sanctions, PEP and watchlist reference data from LSEG.', scopes: ['screening.case', 'references.read'] },
  { id: 'ofac-feed', name: 'OFAC / EU / UN list feed', category: 'sanctions', authType: 'webhook', monogram: 'GL', color: '#334155', subsystem: 'screening', powers: 'Official consolidated sanctions lists', blurb: 'Direct consolidated sanctions list ingestion (OFAC SDN, EU, UN, HMT).', scopes: ['lists.read'] },

  // Blockchain analytics
  { id: 'chainalysis', name: 'Chainalysis', category: 'analytics', authType: 'api_key', monogram: 'Ch', color: '#1355ff', domain: 'chainalysis.com', popular: true, powers: 'Wallet risk scoring & transaction monitoring', blurb: 'On-chain risk scoring, exposure analysis and transaction monitoring.', scopes: ['kyt.write', 'address.screen'] },
  { id: 'elliptic', name: 'Elliptic', category: 'analytics', authType: 'api_key', monogram: 'El', color: '#12b3a6', domain: 'elliptic.co', powers: 'On-chain AML & wallet screening', blurb: 'Wallet and transaction screening with source-of-funds analytics.', scopes: ['wallet.screen', 'tx.screen'] },

  // Banking, reserves & custody
  { id: 'fireblocks', name: 'Fireblocks', category: 'banking', authType: 'mtls', monogram: 'Fb', color: '#f5820b', domain: 'fireblocks.com', popular: true, subsystem: 'reserves', powers: 'Reserve custody & wallet operations', blurb: 'MPC custody for reserve assets with policy-governed transfers.', scopes: ['vaults.read', 'transactions.write', 'policy.read'] },
  { id: 'modern-treasury', name: 'Modern Treasury', category: 'banking', authType: 'api_key', monogram: 'MT', color: '#5b3df5', domain: 'moderntreasury.com', popular: true, subsystem: 'reserves', powers: 'Reserve bank accounts & payment ops', blurb: 'Bank account balances, statements and payment operations across reserve banks.', scopes: ['accounts.read', 'ledgers.read', 'payments.write'] },
  { id: 'core-banking', name: 'Core banking (ISO 20022)', category: 'banking', authType: 'mtls', monogram: 'CB', color: '#1f6feb', subsystem: 'reserves', powers: 'Reserve balances & statement feed', blurb: 'Direct ISO 20022 balance and statement feed from your reserve bank.', scopes: ['balances.read', 'statements.read'] },
  { id: 'swift-gpi', name: 'SWIFT gpi', category: 'banking', authType: 'mtls', monogram: 'SW', color: '#0f2d52', domain: 'swift.com', subsystem: 'reserves', powers: 'Cross-border settlement tracking', blurb: 'Track cross-border reserve settlements end to end.', scopes: ['payments.track'] },

  // Access control / SSO
  { id: 'okta', name: 'Okta', category: 'sso', authType: 'oauth2', monogram: 'Ok', color: '#0a66ff', domain: 'okta.com', popular: true, subsystem: 'rbac', powers: 'Operator SSO & role-based access', blurb: 'Single sign-on and role-based access for issuer, approver and auditor teams.', scopes: ['openid', 'profile', 'groups.read'] },
  { id: 'entra', name: 'Microsoft Entra ID', category: 'sso', authType: 'oauth2', monogram: 'MS', color: '#2f6fed', domain: 'microsoft.com', subsystem: 'rbac', powers: 'Enterprise SSO & directory', blurb: 'Enterprise SSO, directory and conditional-access policy.', scopes: ['openid', 'User.Read', 'Directory.Read'] },

  // Attestation / proof-of-reserves
  { id: 'auditor-portal', name: 'Auditor portal', category: 'attestation', authType: 'oauth2', monogram: 'AP', color: '#7c3aed', powers: 'Independent auditor sign-off', blurb: 'Route attestations to an external audit firm for independent, signed sign-off.', scopes: ['attestations.read', 'signoff.write'] },
  { id: 'por-oracle', name: 'Proof-of-Reserves oracle', category: 'attestation', authType: 'api_key', monogram: 'PoR', color: '#0891b2', domain: 'chain.link', subsystem: 'reserves', powers: 'On-chain reserve attestation', blurb: 'Publish signed reserve attestations to an on-chain proof-of-reserves oracle.', scopes: ['feeds.write'] },

  // Reporting & alerts
  { id: 'reg-reporting', name: 'Regulatory report filer', category: 'reporting', authType: 'api_key', monogram: 'RR', color: '#475569', subsystem: 'reporting', powers: 'MiCA / GENIUS periodic filings', blurb: 'File periodic reserve and transparency reports to your regulator.', scopes: ['filings.write'] },
  { id: 'slack', name: 'Slack', category: 'reporting', authType: 'oauth2', monogram: 'Sl', color: '#611f69', domain: 'slack.com', powers: 'Compliance & operations alerts', blurb: 'Route sanctions hits, redemptions and control-action alerts to a channel.', scopes: ['chat:write', 'channels:read'] },
  { id: 'webhooks', name: 'Outbound webhooks', category: 'reporting', authType: 'webhook', monogram: '{}', color: '#334155', powers: 'Push events to your systems', blurb: 'Signed webhook events for issuance, redemption and compliance changes.', scopes: ['events.subscribe'] },
]

export const providerById = (id: string): Provider | undefined => PROVIDERS.find(p => p.id === id)
export const popularProviders = (): Provider[] => PROVIDERS.filter(p => p.popular)

/** Curated starter set surfaced in the empty state - the providers a Swiss bank
 *  issuing stablecoins is most likely to wire first: AML screening, reserve
 *  custody, and holder identity verification. */
const STARTER_IDS = ['complyadvantage', 'fireblocks', 'onfido']
export const starterProviders = (): Provider[] =>
  STARTER_IDS.map(id => providerById(id)).filter((p): p is Provider => p != null)

// Real product logos bundled under src/assets/integrations/<provider-id>.png,
// resolved to hashed asset URLs at build time. Providers without a file fall
// back to the coloured monogram tile.
const LOGO_FILES = import.meta.glob('../assets/integrations/*.png', { eager: true, import: 'default' }) as Record<string, string>
const LOGO_BY_ID: Record<string, string> = {}
for (const [path, url] of Object.entries(LOGO_FILES)) {
  const id = (path.split('/').pop() ?? '').replace(/\.png$/, '')
  if (id !== '') LOGO_BY_ID[id] = url
}

/** Bundled product-logo URL for a provider, or null to use the monogram. */
export const logoUrl = (provider: Provider): string | null => LOGO_BY_ID[provider.id] ?? null

// ── Connections (mock, persisted) ─────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'sandbox' | 'action_required' | 'error' | 'disconnected'

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  sandbox: 'Connected · Sandbox',
  action_required: 'Action required',
  error: 'Error',
  disconnected: 'Disconnected',
}

export interface ConnEvent { at: string; kind: 'connected' | 'sync' | 'test' | 'rotated' | 'error'; detail: string }

export interface Connection {
  id: string
  providerId: string
  label: string                 // account / environment label
  status: ConnectionStatus
  environment: 'production' | 'sandbox'
  scopes: string[]
  maskedKey: string
  webhookURL: string
  ownerName: string
  usedByCount: number           // instruments / workflows relying on it
  createdAt: string             // ISO
  updatedAt: string             // ISO
  lastSyncAt?: string           // ISO
  events: ConnEvent[]
}

const KEY = 'underwrite.integrations.v1'
const listeners = new Set<() => void>()

function read(): Connection[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(KEY)
    if (raw == null) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as Connection[] : []
  } catch {
    return []
  }
}

let current = read()
let seq = 0

function persist(next: Connection[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

const rand = (n: number): string => Math.random().toString(36).slice(2, 2 + n)
function maskedKey(env: 'production' | 'sandbox'): string {
  return `sk_${env === 'production' ? 'live' : 'test'}_••••${rand(4)}`
}
function webhookURL(providerId: string): string {
  return `https://hooks.underwrite.app/v1/${providerId}/${rand(10)}`
}

export interface NewConnection {
  providerId: string
  label: string
  environment: 'production' | 'sandbox'
  scopes: string[]
  ownerName: string
  /** Simulate a connection that still needs a step (e.g. verify webhook). */
  actionRequired?: boolean
}

export function addConnection(input: NewConnection): Connection {
  seq += 1
  const now = new Date().toISOString()
  const status: ConnectionStatus = input.actionRequired
    ? 'action_required'
    : input.environment === 'sandbox' ? 'sandbox' : 'connected'
  const conn: Connection = {
    id: `conn-${current.length}-${seq}-${rand(4)}`,
    providerId: input.providerId,
    label: input.label,
    status,
    environment: input.environment,
    scopes: input.scopes,
    maskedKey: maskedKey(input.environment),
    webhookURL: webhookURL(input.providerId),
    ownerName: input.ownerName,
    usedByCount: 0,
    createdAt: now,
    updatedAt: now,
    lastSyncAt: status === 'action_required' ? undefined : now,
    events: [{ at: now, kind: 'connected' as const, detail: `Connected in ${input.environment} mode` }],
  }
  persist([conn, ...current])
  return conn
}

export function removeConnection(id: string): void {
  persist(current.filter(c => c.id !== id))
}

function patch(id: string, fn: (c: Connection) => Connection): void {
  persist(current.map(c => (c.id === id ? fn(c) : c)))
}

export function setConnectionStatus(id: string, status: ConnectionStatus): void {
  patch(id, c => ({ ...c, status, updatedAt: new Date().toISOString() }))
}

/** Simulate a "Test connection" round-trip; returns the resulting status. */
export function recordTest(id: string, ok: boolean): void {
  const now = new Date().toISOString()
  patch(id, c => ({
    ...c,
    status: ok ? (c.environment === 'sandbox' ? 'sandbox' : 'connected') : 'error',
    updatedAt: now,
    lastSyncAt: ok ? now : c.lastSyncAt,
    events: [{ at: now, kind: (ok ? 'test' : 'error') as ConnEvent['kind'], detail: ok ? 'Test connection succeeded' : 'Test connection failed (mock)' }, ...c.events].slice(0, 20),
  }))
}

/** Simulate an immediate sync. */
export function recordSync(id: string): void {
  const now = new Date().toISOString()
  patch(id, c => ({
    ...c,
    lastSyncAt: now,
    updatedAt: now,
    events: [{ at: now, kind: 'sync' as const, detail: 'Manual sync completed' }, ...c.events].slice(0, 20),
  }))
}

export function rotateKey(id: string): void {
  const now = new Date().toISOString()
  patch(id, c => ({
    ...c,
    maskedKey: maskedKey(c.environment),
    updatedAt: now,
    events: [{ at: now, kind: 'rotated' as const, detail: 'API key rotated' }, ...c.events].slice(0, 20),
  }))
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useConnections(): Connection[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}

/** The active integration feeding a given subsystem, for cross-page relabelling
 *  ("Screening via ComplyAdvantage · Sandbox"). Returns the first live match. */
export interface ActiveIntegration { providerName: string; environment: 'production' | 'sandbox'; status: ConnectionStatus }

export function useActiveIntegration(subsystem: Subsystem): ActiveIntegration | null {
  const conns = useConnections()
  const match = conns.find(c => {
    const p = providerById(c.providerId)
    return p?.subsystem === subsystem && (c.status === 'connected' || c.status === 'sandbox')
  })
  if (match == null) return null
  const p = providerById(match.providerId)
  return p != null ? { providerName: p.name, environment: match.environment, status: match.status } : null
}
