/**
 * First-run onboarding profile - a one-time welcome shown the first time a user
 * opens Underwrite, then never again. It collects a self-declared role, a
 * display name, and (for issuers) issuing-entity details, and persists them so
 * the wizard is gated on read.
 *
 * The role here is a *label* for personalisation - it does not grant privileges.
 * Actual issuer authority stays wallet-derived (`useWallet().isIssuer`, the
 * wallet identity matching the overlay's). State lives in localStorage under
 * `underwrite.onboarding.v1`; a module-level store + useSyncExternalStore keeps
 * subscribers in sync without a context provider (mirrors lib/devMode.ts).
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.onboarding.v1'

export type OnboardingRole = 'issuer' | 'auditor' | 'individual'

/** Roles that get the read-only reviewer experience (auditor + individual).
 *  Individuals are members of the public checking an instrument; they see the
 *  same read-only dashboard as auditors, but with masked ledger details. */
export function isReviewerRole(role: OnboardingRole | null): boolean {
  return role === 'auditor' || role === 'individual'
}

export interface EntityDetails {
  legalName: string
  country: string
  address: string
}

export interface OnboardingProfile {
  completed: boolean
  role: OnboardingRole | null
  name: string
  email: string
  entity: EntityDetails | null
}

const EMPTY: OnboardingProfile = { completed: false, role: null, name: '', email: '', entity: null }

const listeners = new Set<() => void>()

function read(): OnboardingProfile {
  try {
    if (typeof localStorage === 'undefined') return EMPTY
    const raw = localStorage.getItem(KEY)
    if (raw == null) return EMPTY
    const parsed = JSON.parse(raw) as Partial<OnboardingProfile>
    return {
      completed: parsed.completed === true,
      role: parsed.role === 'issuer' || parsed.role === 'auditor' || parsed.role === 'individual' ? parsed.role : null,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      entity: parsed.entity ?? null
    }
  } catch {
    return EMPTY
  }
}

let current = read()

function persist(next: OnboardingProfile): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

/** Mark onboarding done, saving the collected profile. */
export function completeOnboarding(profile: Omit<OnboardingProfile, 'completed'>): void {
  persist({ ...profile, completed: true })
}

/** Patch the stored profile in place (e.g. from Account settings). */
export function updateProfile(patch: Partial<Omit<OnboardingProfile, 'completed'>>): void {
  persist({ ...current, ...patch })
}

/** Reset onboarding (e.g. a "redo setup" affordance or tests). */
export function resetOnboarding(): void {
  persist(EMPTY)
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive access to the persisted onboarding profile. */
export function useOnboarding(): OnboardingProfile {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
