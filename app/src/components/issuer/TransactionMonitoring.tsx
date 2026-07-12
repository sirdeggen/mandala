/**
 * Transaction monitoring surface: an alert feed with a lightweight case workflow
 * (investigate / clear / escalate) and a SAR-draft note. Embedded in the
 * Compliance dashboard. Data comes from lib/monitoring (demo alerts + persisted
 * case state).
 */
import { useState } from 'react'
import {
  ShieldAlert, Coins, Activity, Layers, UserPlus, TriangleAlert, Check, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  useAlerts, setAlertStatus, setAlertNote,
  KIND_LABEL, SEVERITY_LABEL, STATUS_LABEL,
  type Alert, type AlertKind, type AlertSeverity, type AlertStatus,
} from '../../lib/monitoring'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<AlertKind, LucideIcon> = {
  sanctions: ShieldAlert, large_transfer: Coins, velocity: Activity, structuring: Layers,
  high_risk: TriangleAlert, new_counterparty: UserPlus,
}
const SEVERITY_TONE: Record<AlertSeverity, string> = { high: 'text-destructive', medium: 'text-warning', low: 'text-muted-foreground' }
const STATUS_TONE: Record<AlertStatus, string> = {
  open: 'bg-destructive/10 text-destructive', investigating: 'bg-warning/10 text-warning',
  cleared: 'bg-success/10 text-success', escalated: 'bg-primary/10 text-primary',
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)} min ago`
  const h = Math.round(m / 60); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

const ACTIVE: AlertStatus[] = ['open', 'investigating', 'escalated']

export function TransactionMonitoring() {
  const alerts = useAlerts()
  const order: Record<AlertStatus, number> = { open: 0, investigating: 1, escalated: 2, cleared: 3 }
  const sev: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }
  const sorted = [...alerts].sort((a, b) => order[a.status] - order[b.status] || sev[a.severity] - sev[b.severity])
  const openCount = alerts.filter(a => ACTIVE.includes(a.status)).length
  const highOpen = alerts.filter(a => a.severity === 'high' && ACTIVE.includes(a.status)).length

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[14px] font-semibold text-foreground">
          Alerts
          {openCount > 0 && <span className="ml-2 text-[12px] font-medium text-warning">{openCount} open</span>}
          {highOpen > 0 && <span className="ml-2 text-[12px] font-medium text-destructive">{highOpen} high severity</span>}
        </div>
        <span className="text-[11.5px] text-subtle-foreground">Monitoring on-chain activity and holder risk</span>
      </div>

      <div className="mt-3 space-y-2">
        {sorted.map(a => <AlertRow key={a.id} alert={a} />)}
      </div>
    </div>
  )
}

function AlertRow({ alert }: { alert: Alert }) {
  const Icon = KIND_ICON[alert.kind]
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(alert.note ?? '')
  const closed = alert.status === 'cleared'

  return (
    <div className={cn('rounded-lg border border-border p-3', closed && 'opacity-70')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-3 text-left">
        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted', SEVERITY_TONE[alert.severity])}>
          <Icon className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">{alert.title}</span>
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', SEVERITY_TONE[alert.severity], 'bg-muted')}>{SEVERITY_LABEL[alert.severity]}</span>
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', STATUS_TONE[alert.status])}>{STATUS_LABEL[alert.status]}</span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-subtle-foreground">
            {KIND_LABEL[alert.kind]} · {alert.subjectName} · {alert.instrument} · {fmtWhen(alert.at)}
          </div>
        </div>
        <ChevronRight className={cn('mt-1 size-4 shrink-0 text-faint-foreground transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-separator pt-3">
          <p className="text-[12.5px] leading-snug text-muted-foreground">{alert.detail}</p>

          <div className="flex flex-wrap gap-1.5">
            {(['open', 'investigating', 'escalated', 'cleared'] as AlertStatus[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setAlertStatus(alert.id, s)}
                className={cn('inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors',
                  alert.status === s ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted')}
              >
                {alert.status === s && <Check className="size-3" />} {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {(alert.status === 'investigating' || alert.status === 'escalated') && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
                {alert.status === 'escalated' ? 'SAR draft note' : 'Investigation note'}
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                onBlur={() => setAlertNote(alert.id, note.trim())}
                rows={2}
                placeholder={alert.status === 'escalated' ? 'Summarise the suspicious activity for the report…' : 'What have you checked so far…'}
                className="w-full resize-none rounded-md border border-input-border bg-input px-3 py-2 text-[12.5px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
