import { useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, Plus, Trash2, AlertTriangle, BadgeCheck, Check, Flag, FileCheck2 } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import {
  useReserveBucket, useAttestations, reservesTotalOf,
  addReserveLine, updateReserveLine, removeReserveLine,
  createAttestation, reviewAttestation, type Attestation,
} from '../../lib/compliance'
import { RESERVE_CLASSES, RESERVE_CLASS_BY_KEY } from '@/content/reserveClasses'
import TabHeader from './TabHeader'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { cn } from '@/lib/utils'

/**
 * Reserve attestations - the issuer maintains the composition of the reserves
 * backing this instrument, and snapshots it as an attestation an auditor signs
 * off. Makes backing provable (MiCA reserve-of-assets / GENIUS monthly
 * attestation), and shows a public-style transparency summary.
 */
export default function ReserveAttestations({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const { role, name } = useOnboarding()
  const isAuditor = isReviewerRole(role)
  const bucket = useReserveBucket(assetId)
  const attestations = useAttestations(assetId)

  const currency = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'
  const decimals = Number(asset?.metadata?.decimals) || 0
  const reserves = reservesTotalOf(bucket)

  // Circulation is read from the ledger (issued - redeemed), not entered by
  // hand, so it always matches the on-chain record. Null while the summary
  // loads; 0 once loaded means nothing has been issued yet.
  const { data: summary, isPending: circPending } = useAdminSummary(assetId)
  const circ = summary != null ? (summary.totalIssued - summary.totalRedeemed) / 10 ** decimals : null
  const backing = circ != null && circ > 0 ? (reserves / circ) * 100 : (circ === 0 && reserves > 0 ? 100 : null)
  const fullyBacked = backing != null && backing >= 100
  const hasIneligible = bucket.composition.some(l => RESERVE_CLASS_BY_KEY[l.assetClass]?.eligible === false)

  const latestSigned = attestations.find(a => a.status === 'signed')

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

  function create() {
    if (bucket.composition.length === 0) { toast.error('Add at least one reserve line first.'); return }
    createAttestation(assetId, currency, circ ?? 0)
    toast.success('Attestation submitted for audit')
  }

  return (
    <div className="max-w-3xl space-y-4">
      <TabHeader
        title="Reserve attestations"
        description="Prove this instrument is fully backed. Maintain the reserve composition, then submit a period attestation for your auditor to sign."
        guide="/help/for-issuers/backing-instruments-with-reserves"
      />

      {/* Transparency summary */}
      <div className={cn('rounded-xl border p-4', fullyBacked ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('grid size-10 place-items-center rounded-xl', fullyBacked ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
              <ShieldCheck className="size-5" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular text-foreground">
                {backing != null ? `${fmt(backing)}%` : circPending ? '…' : '-'}
              </div>
              <div className="mt-1 text-[12.5px] text-muted-foreground">
                {backing != null
                  ? (fullyBacked ? 'Fully backed by reserves' : 'Under-collateralised')
                  : circPending
                    ? 'Reading circulation from the ledger…'
                    : circ === 0
                      ? 'No units issued yet'
                      : 'Add reserves to show backing'}
              </div>
            </div>
          </div>
          <div className="text-right text-[12px] text-muted-foreground">
            <div><span className="tabular font-medium text-foreground">{fmt(reserves)}</span> reserves</div>
            <div><span className="tabular font-medium text-foreground">{circ != null ? fmt(circ) : '-'}</span> {currency} in circulation</div>
          </div>
        </div>
        <div className="mt-3 border-t border-border/60 pt-2.5 text-[12px] text-muted-foreground">
          {latestSigned != null ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <BadgeCheck className="size-3.5" strokeWidth={2.4} />
              Last attested by {latestSigned.auditorName || 'auditor'} · {formatDate(latestSigned.reviewedAt)}
            </span>
          ) : (
            <span>Awaiting an auditor-signed attestation.</span>
          )}
        </div>
      </div>

      {/* Reserve composition */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-foreground">Reserve composition</div>
          <div className="text-[12px] text-muted-foreground">Total <span className="tabular font-medium text-foreground">{fmt(reserves)}</span></div>
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">
          The assets held to back {asset?.label ?? 'this instrument'}. Only permitted reserve classes count toward full backing.
        </p>

        {bucket.composition.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted-foreground">
            No reserves recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {bucket.composition.map(line => {
              const cls = RESERVE_CLASS_BY_KEY[line.assetClass]
              const ineligible = cls?.eligible === false
              return (
                <div key={line.id} className="flex items-center gap-2">
                  <Select
                    value={line.assetClass}
                    disabled={isAuditor}
                    onChange={e => updateReserveLine(assetId, line.id, { assetClass: e.target.value })}
                    className={cn('h-10 flex-1 text-[13px]', ineligible && 'border-warning/50')}
                  >
                    {RESERVE_CLASSES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    disabled={isAuditor}
                    value={line.amount !== 0 ? String(line.amount) : ''}
                    placeholder="0"
                    onChange={e => updateReserveLine(assetId, line.id, { amount: Number(e.target.value) || 0 })}
                    className="tabular h-10 w-36 text-[13px]"
                  />
                  {!isAuditor && (
                    <button
                      type="button"
                      onClick={() => removeReserveLine(assetId, line.id)}
                      aria-label="Remove reserve line"
                      className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {hasIneligible && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-[12px] leading-snug text-muted-foreground">
              Some reserves sit in a class that isn't a permitted reserve under MiCA / the GENIUS Act. Move them into an eligible class or they won't count toward full backing.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {!isAuditor ? (
            <button
              type="button"
              onClick={() => addReserveLine(assetId)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="size-4" /> Add reserve line
            </button>
          ) : <span />}
          {/* Circulation is read straight from the ledger - not editable. */}
          <div className="text-right">
            <div className="text-[11px] text-faint-foreground">Units in circulation (from ledger)</div>
            <div className="tabular text-[14px] font-semibold text-foreground">
              {circ != null ? `${fmt(circ)} ${currency}` : circPending ? '…' : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Attestation register */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-foreground">Attestations</div>
          {!isAuditor && (
            <Button onClick={create} className="h-9 gap-1.5 px-3 text-[13px]">
              <FileCheck2 className="size-4" /> Create attestation
            </Button>
          )}
        </div>

        {attestations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
            {isAuditor ? 'No attestations submitted for review yet.' : 'No attestations yet. Snapshot the reserves above to submit one for audit.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {attestations.map(a => (
              <AttestationRow key={a.id} att={a} isAuditor={isAuditor} auditorName={name.trim() || 'Auditor'} fmt={fmt} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Attestation row ───────────────────────────────────────────────────────────

const STATUS_STYLE: Record<Attestation['status'], { label: string; cls: string }> = {
  submitted: { label: 'Awaiting review', cls: 'bg-warning/10 text-warning' },
  signed: { label: 'Signed', cls: 'bg-success/10 text-success' },
  flagged: { label: 'Flagged', cls: 'bg-destructive/10 text-destructive' },
}

function AttestationRow({ att, isAuditor, auditorName, fmt }: {
  att: Attestation
  isAuditor: boolean
  auditorName: string
  fmt: (n: number) => string
}) {
  const [note, setNote] = useState('')
  const backing = att.circulation > 0 ? (att.reservesTotal / att.circulation) * 100 : (att.reservesTotal > 0 ? 100 : null)
  const status = STATUS_STYLE[att.status]

  function review(kind: 'signed' | 'flagged') {
    reviewAttestation(att.id, { status: kind, auditorName, note: note.trim() || undefined })
    toast.success(kind === 'signed' ? 'Attestation signed' : 'Attestation flagged')
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-foreground">{att.period}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', status.cls)}>{status.label}</span>
        </div>
        <div className="text-[11.5px] text-muted-foreground">Submitted {formatDate(att.createdAt)}</div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <div className="text-faint-foreground">Reserves</div>
          <div className="tabular font-medium text-foreground">{fmt(att.reservesTotal)}</div>
        </div>
        <div>
          <div className="text-faint-foreground">Circulation</div>
          <div className="tabular font-medium text-foreground">{fmt(att.circulation)} {att.currency}</div>
        </div>
        <div>
          <div className="text-faint-foreground">Backing</div>
          <div className={cn('tabular font-medium', backing != null && backing >= 100 ? 'text-success' : 'text-warning')}>
            {backing != null ? `${fmt(backing)}%` : '-'}
          </div>
        </div>
      </div>

      {att.auditorName != null && att.status !== 'submitted' && (
        <div className="mt-2.5 border-t border-border pt-2 text-[12px] text-muted-foreground">
          <span className={att.status === 'signed' ? 'text-success' : 'text-destructive'}>
            {att.status === 'signed' ? 'Signed' : 'Flagged'} by {att.auditorName}
          </span>{' '}· {formatDate(att.reviewedAt)}
          {att.auditorNote && <span className="mt-0.5 block text-muted-foreground">“{att.auditorNote}”</span>}
        </div>
      )}

      {isAuditor && att.status === 'submitted' && (
        <div className="mt-3 border-t border-border pt-3">
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="h-9 text-[12.5px]"
          />
          <div className="mt-2 flex gap-2">
            <Button onClick={() => review('signed')} className="h-8 gap-1.5 px-3 text-[12.5px]">
              <Check className="size-4" /> Sign attestation
            </Button>
            <button
              type="button"
              onClick={() => review('flagged')}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/5"
            >
              <Flag className="size-4" /> Flag
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso?: string): string {
  if (iso == null) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
