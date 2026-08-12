/**
 * Transaction monitoring (demo). A rules-style alert feed over token activity and
 * holder risk, with a lightweight case workflow (open -> investigating ->
 * cleared / escalated) and a SAR-draft note. Seeded with realistic alerts;
 * statuses persist per browser. In production these alerts would be raised by a
 * monitoring engine over the on-chain activity feed and your AML provider.
 */
import { useSyncExternalStore } from 'react'

export type AlertKind = 'large_transfer' | 'velocity' | 'structuring' | 'sanctions' | 'high_risk' | 'new_counterparty'
export type AlertSeverity = 'high' | 'medium' | 'low'
export type AlertStatus = 'open' | 'investigating' | 'cleared' | 'escalated'

export const KIND_LABEL: Record<AlertKind, string> = {
  large_transfer: 'Large transfer',
  velocity: 'Unusual velocity',
  structuring: 'Possible structuring',
  sanctions: 'Sanctions screen match',
  high_risk: 'High-risk holder active',
  new_counterparty: 'New high-value counterparty',
}
export const SEVERITY_LABEL: Record<AlertSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' }
export const STATUS_LABEL: Record<AlertStatus, string> = { open: 'Open', investigating: 'Investigating', cleared: 'Cleared', escalated: 'Escalated' }

export interface Alert {
  id: string
  kind: AlertKind
  severity: AlertSeverity
  title: string
  detail: string
  subjectName: string
  instrument: string
  at: string            // ISO
  status: AlertStatus
  note?: string
}

const KEY = 'underwrite.monitoring.v1'
const listeners = new Set<() => void>()

function seed(): Alert[] {
  const now = Date.now()
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString()
  return [
    { id: 'al1', kind: 'sanctions', severity: 'high', title: 'Sanctions screen match', detail: 'Counterparty matched an OFAC SDN entry on an inbound transfer. Hold and review before allowing further activity.', subjectName: 'Restricted Party Ltd', instrument: 'USDX', at: at(1), status: 'open' },
    { id: 'al2', kind: 'large_transfer', severity: 'high', title: 'Transfer above threshold', detail: 'A single transfer of 250,000 exceeded the 100,000 review threshold for this instrument.', subjectName: 'Nordkap Asset Management AG', instrument: 'CHFD', at: at(4), status: 'open' },
    { id: 'al3', kind: 'structuring', severity: 'medium', title: 'Possible structuring', detail: 'Nine transfers of 9,900 within an hour, each just below the 10,000 reporting threshold.', subjectName: 'Holder 0x8f…4a2c', instrument: 'EURD', at: at(9), status: 'investigating' },
    { id: 'al4', kind: 'velocity', severity: 'medium', title: 'Unusual velocity', detail: '14 outbound transfers in 60 minutes, well above this holder’s baseline.', subjectName: 'Holder 0x21…9be1', instrument: 'CHFD', at: at(20), status: 'open' },
    { id: 'al5', kind: 'high_risk', severity: 'medium', title: 'High-risk holder active', detail: 'A holder rated high-risk by screening transacted after a period of inactivity.', subjectName: 'Holder 0x5c…77af', instrument: 'USDX', at: at(30), status: 'open' },
    { id: 'al6', kind: 'new_counterparty', severity: 'low', title: 'New high-value counterparty', detail: 'First transfer to a previously unseen wallet exceeded 50,000.', subjectName: 'Holder 0xb4…d290', instrument: 'EURD', at: at(52), status: 'cleared' },
  ]
}

function read(): Alert[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY)
      const parsed = raw != null ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) return parsed as Alert[]
    }
  } catch { /* fall through */ }
  return seed()
}

let current = read()

function persist(next: Alert[]): void {
  current = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function setAlertStatus(id: string, status: AlertStatus): void {
  persist(current.map(a => (a.id === id ? { ...a, status } : a)))
}

export function setAlertNote(id: string, note: string): void {
  persist(current.map(a => (a.id === id ? { ...a, note } : a)))
}

export function useAlerts(): Alert[] {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
    () => current,
  )
}
