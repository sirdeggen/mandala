/**
 * Persisted state for the first-run product tour: which steps are done, whether
 * the user dismissed it, and whether it has auto-opened once already (so it only
 * pops open expanded on the very first visit, and is a quiet pill thereafter).
 *
 * localStorage under `underwrite.tour.v1`; a module-level store +
 * useSyncExternalStore keeps subscribers in sync without a context provider
 * (mirrors lib/onboarding.ts and lib/demoGuide.ts).
 */
import { useSyncExternalStore } from 'react'

const KEY = 'underwrite.tour.v1'

export interface TourState {
  dismissed: boolean
  completed: string[]
  autoOpened: boolean
}

const EMPTY: TourState = { dismissed: false, completed: [], autoOpened: false }

const listeners = new Set<() => void>()

function read(): TourState {
  try {
    if (typeof localStorage === 'undefined') return EMPTY
    const raw = localStorage.getItem(KEY)
    if (raw == null) return EMPTY
    const p = JSON.parse(raw) as Partial<TourState>
    return {
      dismissed: p.dismissed === true,
      completed: Array.isArray(p.completed) ? p.completed : [],
      autoOpened: p.autoOpened === true,
    }
  } catch {
    return EMPTY
  }
}

let current = read()

function persist(next: TourState): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

/** Mark a step complete (idempotent). */
export function markTourStep(id: string): void {
  if (current.completed.includes(id)) return
  persist({ ...current, completed: [...current.completed, id] })
}

/** Record that the pane has auto-opened once, so it stays collapsed after. */
export function markTourAutoOpened(): void {
  if (current.autoOpened) return
  persist({ ...current, autoOpened: true })
}

/** Hide the tour for good (until reset). */
export function dismissTour(): void {
  persist({ ...current, dismissed: true, autoOpened: true })
}

/** Restart the tour from scratch: it will auto-open expanded again. */
export function resetTour(): void {
  persist({ ...EMPTY })
}

export function useTour(): TourState {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
