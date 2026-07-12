/**
 * State for the in-app demo walkthrough panel: whether it's open and which hero
 * steps have been ticked. Persisted per browser so a presenter's progress
 * survives navigation and reloads.
 */
import { useSyncExternalStore } from 'react'

interface GuideState { open: boolean; done: string[] }

const KEY = 'underwrite.demoGuide'
const listeners = new Set<() => void>()

function read(): GuideState {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY)
      if (raw != null) {
        const p = JSON.parse(raw) as Partial<GuideState>
        return { open: p.open === true, done: Array.isArray(p.done) ? p.done : [] }
      }
    }
  } catch { /* ignore */ }
  return { open: false, done: [] }
}

let current = read()

function persist(next: GuideState): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setGuideOpen(open: boolean): void {
  persist({ ...current, open })
}

export function toggleGuideStep(id: string): void {
  const done = current.done.includes(id) ? current.done.filter(x => x !== id) : [...current.done, id]
  persist({ ...current, done })
}

export function useDemoGuide(): GuideState {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
