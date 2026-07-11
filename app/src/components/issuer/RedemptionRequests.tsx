import { useState } from 'react'
import { toast } from 'sonner'
import { Check, X, Plus, Clock } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import {
  useRedemptionPolicy, useRedemptionRequests, setRedemptionPolicy,
  createRedemptionRequest, settleRedemption, rejectRedemption,
  useGovernance, proposeSettlement,
  SETTLEMENT_WINDOW_LABEL, type RedemptionRequest, type SettlementWindow,
} from '../../lib/compliance'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { Label } from '../ui/label'
import { EditablePresetField } from './EditablePresetField'
import { RelationshipField } from './RelationshipField'
import { cn } from '@/lib/utils'

/**
 * Holder redemption at par - a published redemption policy plus the queue of
 * redemption requests the issuer settles at par. Settling removes the redeemed
 * units from circulation, so the Attestations backing ratio stays honest.
 * Redemption at par on demand is a core obligation under MiCA and the GENIUS Act.
 */
export default function RedemptionRequests({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const policy = useRedemptionPolicy(assetId)
  const requests = useRedemptionRequests(assetId)
  const currency = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'
  const isAuditor = isReviewerRole(useOnboarding().role)

  const [adding, setAdding] = useState(false)
  const pending = requests.filter(r => r.status === 'pending')
  const processed = requests.filter(r => r.status !== 'pending')

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-foreground">Holder redemptions</h2>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">
          Holders have the right to redeem {asset?.label ?? 'this instrument'} at par. Set your policy and settle requests below.
        </p>
      </div>

      {/* Policy */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-semibold text-foreground">Redemption policy</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Published to holders. Redemptions are always settled at par (1:1).</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={policy.enabled}
            aria-label="Accept redemptions"
            disabled={isAuditor}
            onClick={() => setRedemptionPolicy(assetId, { enabled: !policy.enabled })}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50',
              policy.enabled ? 'bg-success' : 'bg-muted-foreground/40'
            )}
          >
            <span className={cn('inline-block size-4 transform rounded-full bg-white shadow transition-transform', policy.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rdm-window" className="text-[11px]">Settlement window</Label>
            <Select
              id="rdm-window"
              value={policy.window}
              disabled={!policy.enabled || isAuditor}
              onChange={e => setRedemptionPolicy(assetId, { window: e.target.value as SettlementWindow })}
              className="h-10 text-[13px]"
            >
              {(Object.keys(SETTLEMENT_WINDOW_LABEL) as SettlementWindow[]).map(w => (
                <option key={w} value={w}>{SETTLEMENT_WINDOW_LABEL[w]}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rdm-min" className="text-[11px]">Minimum amount ({currency})</Label>
            <Input
              id="rdm-min"
              type="number"
              min="0"
              step="any"
              disabled={!policy.enabled || isAuditor}
              value={policy.minAmount !== 0 ? String(policy.minAmount) : ''}
              placeholder="No minimum"
              onChange={e => setRedemptionPolicy(assetId, { minAmount: Number(e.target.value) || 0 })}
              className="tabular h-10 text-[13px]"
            />
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="rdm-terms" className="text-[11px]">Published terms (optional)</Label>
          <EditablePresetField
            id="rdm-terms"
            disabled={!policy.enabled || isAuditor}
            value={policy.terms}
            placeholder="e.g. Redeem to your bank account within one business day, no fee."
            onChange={v => setRedemptionPolicy(assetId, { terms: v })}
            className="text-[13px]"
          />
        </div>
      </div>

      {/* Requests */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-foreground">
            Redemption requests {pending.length > 0 && <span className="ml-1 text-[12px] font-medium text-warning">· {pending.length} pending</span>}
          </div>
          {!isAuditor && (
            <button
              type="button"
              onClick={() => setAdding(a => !a)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="size-4" /> New request
            </button>
          )}
        </div>

        {adding && (
          <NewRequestForm
            assetId={assetId}
            currency={currency}
            minAmount={policy.minAmount}
            onDone={() => setAdding(false)}
          />
        )}

        {requests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            No redemption requests yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {[...pending, ...processed].map(r => (
              <RedemptionRow key={r.id} req={r} fmt={fmt} readOnly={isAuditor} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

// ── New request form ──────────────────────────────────────────────────────────

function NewRequestForm({ assetId, currency, minAmount, onDone }: {
  assetId: string
  currency: string
  minAmount: number
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [amount, setAmount] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (key.trim() === '') { toast.error('Enter the holder’s Badge ID.'); return }
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter an amount to redeem.'); return }
    if (minAmount > 0 && amt < minAmount) { toast.error(`Below the ${fmt(minAmount)} ${currency} minimum.`); return }
    createRedemptionRequest({ assetId, holderKey: key.trim(), holderName: name.trim(), amount: amt, currency })
    toast.success('Redemption request logged')
    onDone()
  }

  return (
    <form onSubmit={submit} className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-2 text-[11.5px] text-muted-foreground">Log a redemption request received from a holder.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Holder name (optional)" className="h-9 text-[13px]" />
        <Input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="any" placeholder={`Amount (${currency})`} className="tabular h-9 text-[13px]" />
      </div>
      <div className="mt-2">
        <RelationshipField
          id="rdm-holder-key"
          value={key}
          onChange={setKey}
          onSelect={r => { setKey(r.identityKey); if (r.name) setName(r.name) }}
          placeholder="Relationship or Badge ID"
          className="h-9 font-mono text-[12px]"
        />
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="submit" className="h-8 px-3 text-[12.5px]">Log request</Button>
        <button type="button" onClick={onDone} className="rounded-md border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-muted">Cancel</button>
      </div>
    </form>
  )
}

// ── Request row ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<RedemptionRequest['status'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-warning/10 text-warning' },
  settled: { label: 'Settled at par', cls: 'bg-success/10 text-success' },
  rejected: { label: 'Rejected', cls: 'bg-destructive/10 text-destructive' },
}

function RedemptionRow({ req, fmt, readOnly }: { req: RedemptionRequest; fmt: (n: number) => string; readOnly: boolean }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const dualControl = useGovernance().dualControl
  const status = STATUS_STYLE[req.status]

  const settle = () => {
    if (dualControl) {
      proposeSettlement({ id: req.id, assetId: req.assetId, amount: req.amount, currency: req.currency, holderName: req.holderName })
      toast.success('Sent for approval (dual control)')
    } else {
      settleRedemption(req.id)
      toast.success('Redeemed at par - units removed from circulation')
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <IdentitySigil value={req.holderKey} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-foreground">{req.holderName || 'Holder'}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', status.cls)}>{status.label}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-subtle-foreground" title={req.holderKey}>
            {req.holderKey.length > 12 ? `${req.holderKey.slice(0, 5)}…${req.holderKey.slice(-5)}` : req.holderKey}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tabular text-[15px] font-semibold text-foreground">{fmt(req.amount)}</div>
          <div className="text-[10.5px] text-subtle-foreground">{req.currency}</div>
        </div>
      </div>

      {!readOnly && req.status === 'pending' && !rejecting && (
        <div className="mt-3 flex gap-2">
          <Button onClick={settle} className="h-8 gap-1.5 px-3 text-[12.5px]">
            <Check className="size-4" /> Settle at par
          </Button>
          <button type="button" onClick={() => setRejecting(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/5">
            <X className="size-4" /> Reject
          </button>
        </div>
      )}

      {req.status === 'pending' && rejecting && (
        <div className="mt-3 space-y-2">
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (e.g. failed KYC re-check)" className="h-9 text-[12.5px]" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { rejectRedemption(req.id, reason.trim() || 'No reason given'); toast.success('Request rejected') }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-[12.5px] font-semibold text-destructive-foreground hover:opacity-90"
            >
              Confirm reject
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-md border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {req.status !== 'pending' && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
          <Clock className="size-3.5" />
          {req.status === 'settled' ? 'Settled' : 'Rejected'} {formatDate(req.processedAt)}
          {req.note && <span className="truncate">· {req.note}</span>}
        </div>
      )}
    </div>
  )
}

function formatDate(iso?: string): string {
  if (iso == null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
