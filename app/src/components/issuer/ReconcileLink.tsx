import { useMemo, useState } from 'react'
import { Link2, Search, Check, Trash2, Plus, ShieldCheck, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '../ui/input'
import { formatAmount } from '@bsv/mandala/amount'
import { useMockTransfers } from '../../lib/mandala/mockBankStore'
import { useOverlayActivity } from '../../hooks/useOverlayActivity'
import { bankForRef } from '@/content/banks'
import { useOnboarding } from '../../lib/onboarding'
import {
  useReconLinks, linksForLedger, linksForBank,
  addBankLink, addAdjustment, signoffAdjustment, removeLink,
} from '../../lib/reconciliation'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = { issue: 'Issued', redeem: 'Redeemed', transfer: 'Transfer', self: 'Self' }
const short = (s: string) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s)

/** className for the icon+text trigger, styled to reflect linked state. */
function triggerCls(count: number): string {
  return cn(
    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
    count > 0
      ? 'border-success/40 bg-success/10 text-success hover:bg-success/15'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  )
}

// ── Ledger side: link a ledger statement to bank statements / adjustment ────────

/**
 * On a ledger row - reconcile this on-chain statement to one or more bank
 * statements, or record a manual adjustment (which needs an auditor sign-off).
 */
export function LedgerReconcileButton({ assetId, ledgerTxid, amount, decimals }: {
  assetId: string
  ledgerTxid: string
  amount: number
  decimals: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const links = useReconLinks(assetId)
  const transfers = useMockTransfers(assetId)
  const onboarding = useOnboarding()
  const isAuditor = onboarding.role === 'auditor'
  const auditorName = onboarding.name.trim() || 'Auditor'

  const mine = linksForLedger(links, ledgerTxid)
  const linkedBankIds = new Set(mine.filter(l => l.bankTransferId != null).map(l => l.bankTransferId))
  const adjustments = mine.filter(l => l.adjustment != null)

  const candidates = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const list = transfers.filter(t => {
      if (ql === '') return true
      const bank = bankForRef(t.id)
      return t.originator.toLowerCase().includes(ql) || bank.name.toLowerCase().includes(ql) || t.id.toLowerCase().includes(ql)
    })
    // Same-amount statements first (the likely match), then the rest.
    return [...list].sort((a, b) => (a.amount === amount ? 0 : 1) - (b.amount === amount ? 0 : 1))
  }, [transfers, q, amount])

  const toggle = (transferId: string) => {
    const existing = mine.find(l => l.bankTransferId === transferId)
    if (existing) removeLink(existing.id)
    else addBankLink(assetId, ledgerTxid, transferId, amount)
  }

  const saveAdjustment = () => {
    if (adjReason.trim() === '') { toast.error('Describe the adjustment.'); return }
    addAdjustment(assetId, ledgerTxid, adjReason.trim(), amount)
    setAdjReason('')
    toast.success('Adjustment recorded - awaiting auditor sign-off')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="Reconcile to bank statement" className={triggerCls(mine.length)}>
        <Link2 className="size-3.5" strokeWidth={2} />
        {mine.length > 0 ? `${mine.length} linked` : 'Link'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="border-b border-border p-2">
          <div className="mb-1.5 px-1 text-[11px] font-semibold text-foreground">Reconcile to bank statement</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bank statements…" className="h-8 pl-7 text-[12px]" />
          </div>
        </div>

        <div className="max-h-56 overflow-y-auto p-1">
          {candidates.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">No bank statements yet.</p>
          ) : candidates.map(t => {
            const bank = bankForRef(t.id)
            const linked = linkedBankIds.has(t.id)
            const sameAmt = t.amount === amount
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent', linked && 'bg-accent')}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded text-[9px] font-bold text-white" style={{ backgroundColor: bank.color }}>{bank.short}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">{t.originator}</span>
                  <span className="block truncate text-[10.5px] text-subtle-foreground">{bank.name} · {t.direction === 'in' ? 'in' : 'out'}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn('block tabular text-[11.5px] font-semibold', sameAmt ? 'text-success' : 'text-foreground')}>{formatAmount(t.amount, decimals)}</span>
                  {sameAmt && <span className="block text-[9px] font-medium uppercase text-success">match</span>}
                </span>
                {linked && <Check className="size-3.5 shrink-0 text-success" />}
              </button>
            )
          })}
        </div>

        {/* Manual adjustment - when no bank statement matches. Needs auditor sign-off. */}
        <div className="border-t border-border p-2">
          {adjustments.map(a => (
            <div key={a.id} className="mb-1.5 flex items-start gap-2 rounded-md border border-border px-2 py-1.5">
              <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', a.adjustment!.status === 'signed' ? 'text-success' : 'text-warning')}>
                {a.adjustment!.status === 'signed' ? <ShieldCheck className="size-4" /> : <Clock className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-medium text-foreground">Manual adjustment</div>
                <div className="truncate text-[10.5px] text-subtle-foreground">{a.adjustment!.reason}</div>
                <div className={cn('mt-0.5 text-[10px] font-semibold', a.adjustment!.status === 'signed' ? 'text-success' : 'text-warning')}>
                  {a.adjustment!.status === 'signed' ? `Signed off by ${a.adjustment!.auditorName}` : 'Awaiting auditor sign-off'}
                </div>
              </div>
              {a.adjustment!.status === 'pending' && isAuditor && (
                <button type="button" onClick={() => { signoffAdjustment(a.id, auditorName); toast.success('Adjustment signed off') }} className="shrink-0 rounded border border-success/40 px-1.5 py-0.5 text-[10px] font-semibold text-success hover:bg-success/10">
                  Sign off
                </button>
              )}
              <button type="button" onClick={() => removeLink(a.id)} aria-label="Remove adjustment" className="shrink-0 text-faint-foreground hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {!isAuditor && (
            <div className="flex items-center gap-1.5">
              <Input value={adjReason} onChange={e => setAdjReason(e.target.value)} placeholder="Manual adjustment reason…" className="h-8 text-[11.5px]" />
              <button type="button" onClick={saveAdjustment} aria-label="Add manual adjustment" className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="size-4" />
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Bank side: link a bank statement to ledger statements ───────────────────────

/** On a bank transfer row - reconcile it to one or more ledger statements. */
export function BankReconcileButton({ assetId, transferId, amount, decimals }: {
  assetId: string
  transferId: string
  amount: number
  decimals: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const links = useReconLinks(assetId)
  const { entries } = useOverlayActivity(assetId)

  const mine = linksForBank(links, transferId)
  const linkedTxids = new Set(mine.map(l => l.ledgerTxid))

  const candidates = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const list = entries.filter(e => ql === '' || e.txid.toLowerCase().includes(ql) || (KIND_LABEL[e.kind] ?? '').toLowerCase().includes(ql))
    return [...list].sort((a, b) => (a.amount === amount ? 0 : 1) - (b.amount === amount ? 0 : 1))
  }, [entries, q, amount])

  const toggle = (txid: string, entryAmount: number) => {
    const existing = mine.find(l => l.ledgerTxid === txid)
    if (existing) removeLink(existing.id)
    else addBankLink(assetId, txid, transferId, entryAmount)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="Link ledger statements" className={triggerCls(mine.length)}>
        <Link2 className="size-3.5" strokeWidth={2} />
        {mine.length > 0 ? `${mine.length} linked` : 'Link ledger'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <div className="border-b border-border p-2">
          <div className="mb-1.5 px-1 text-[11px] font-semibold text-foreground">Link ledger statements</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ledger…" className="h-8 pl-7 text-[12px]" />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {candidates.length === 0 ? (
            <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">No ledger statements loaded.</p>
          ) : candidates.map(e => {
            const linked = linkedTxids.has(e.txid)
            const sameAmt = e.amount === amount
            return (
              <button
                key={e.txid}
                type="button"
                onClick={() => toggle(e.txid, e.amount)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent', linked && 'bg-accent')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span className="block truncate font-mono text-[10.5px] text-subtle-foreground">{short(e.txid)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn('block tabular text-[11.5px] font-semibold', sameAmt ? 'text-success' : 'text-foreground')}>{formatAmount(e.amount, decimals)}</span>
                  {sameAmt && <span className="block text-[9px] font-medium uppercase text-success">match</span>}
                </span>
                {linked && <Check className="size-3.5 shrink-0 text-success" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
