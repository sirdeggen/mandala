/**
 * Editable presets for the published redemption-terms field. Seeded with a few
 * sensible defaults, then fully user-managed: the issuer can add the current
 * text as a new preset and remove any preset from the field's popover. Persisted
 * per browser in localStorage via the module-store + useSyncExternalStore idiom
 * (same pattern as lib/onboarding.ts and lib/instrumentIcons.tsx).
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.redemptionTermsPresets.v1'

const DEFAULT_PRESETS: string[] = [
  'Redeem to your bank account within one business day, no fee.',
  'Redemptions settled at par (1:1) in the reference currency.',
  'Same-day settlement for requests received before 15:00 UTC.',
  'Redemptions may be paused during exceptional market conditions.',
]

function read(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [...DEFAULT_PRESETS]
    const raw = localStorage.getItem(KEY)
    if (raw == null) return [...DEFAULT_PRESETS]
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [...DEFAULT_PRESETS]
  } catch {
    return [...DEFAULT_PRESETS]
  }
}

let current = read()
const listeners = new Set<() => void>()

function write(next: string[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

/** Add `text` as a preset (no-op if blank or already present). */
export function addTermsPreset(text: string): void {
  const t = text.trim()
  if (t === '' || current.includes(t)) return
  write([t, ...current])
}

/** Remove a preset by exact text. */
export function removeTermsPreset(text: string): void {
  write(current.filter(p => p !== text))
}

/** Reactive list of the current presets. */
export function useTermsPresets(): string[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
