import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, Plus, Trash2, AlertTriangle, BadgeCheck, Check, Flag, FileCheck2 } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { useWallet } from '../../context/WalletContext'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import {
  useReserveBucket, useAttestations, reservesTotalOf,
  addReserveLine, updateReserveLine, removeReserveLine,
  createAttestation, reviewAttestation, setAttestationAnchor, type Attestation,
} from '../../lib/compliance'
import { signAttestation, verifyAttestationSignature, attestationMessage } from '../../lib/complianceSignature'
import { anchorOnChain } from '../../lib/onchainAnchor'
import { RESERVE_CLASSES, RESERVE_CLASS_BY_KEY } from '@/content/reserveClasses'
import { IdentitySigil } from '@/components/ui/identity-sigil'
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

  const [evidence, setEvidence] = useState('')

  function create() {
    if (bucket.composition.length === 0) { toast.error('Add at least one reserve line first.'); return }
    createAttestation(assetId, currency, circ ?? 0, evidence)
    setEvidence('')
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
      <div className={cn('relative overflow-hidden rounded-xl border p-4', fullyBacked ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5')}>
        {/* Subtle diagonal tint - green when backed, red when under-collateralised */}
        <div aria-hidden className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', fullyBacked ? 'from-success/12' : 'from-destructive/12')} />
        <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('grid size-10 place-items-center rounded-xl', fullyBacked ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
              {fullyBacked ? <ShieldCheck className="size-5" strokeWidth={2} /> : <AlertTriangle className="size-5" strokeWidth={2} />}
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
        </div>

        {!isAuditor && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="min-w-[200px] flex-1 space-y-1">
              <label htmlFor="att-evidence" className="text-[11px] font-medium text-muted-foreground">Evidence reference (bank / custody confirmation)</label>
              <Input id="att-evidence" value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="e.g. Custodian statement 2026-Q3 · confirmation #4471" className="h-9 text-[12.5px]" />
            </div>
            <Button onClick={create} className="h-9 gap-1.5 px-3 text-[13px]">
              <FileCheck2 className="size-4" /> Create attestation
            </Button>
          </div>
        )}

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
  const { wallet, identityKey } = useWallet()
  const [note, setNote] = useState('')
  const [signing, setSigning] = useState(false)
  const [anchoring, setAnchoring] = useState(false)
  const backing = att.circulation > 0 ? (att.reservesTotal / att.circulation) * 100 : (att.reservesTotal > 0 ? 100 : null)
  const status = STATUS_STYLE[att.status]

  async function sign(exceptions: boolean) {
    if (wallet == null || identityKey == null) { toast.error('Connect a wallet to sign this attestation.'); return }
    setSigning(true)
    try {
      const signature = await signAttestation(wallet, att)
      reviewAttestation(att.id, { status: 'signed', auditorName, note: note.trim() || undefined, auditorKey: identityKey, signature, exceptions })
      toast.success(exceptions ? 'Signed with exceptions' : 'Attestation cryptographically signed')
    } catch {
      toast.error('Could not sign the attestation')
    } finally {
      setSigning(false)
    }
  }

  function flag() {
    if (note.trim() === '') { toast.error('Add a note explaining the flag.'); return }
    reviewAttestation(att.id, { status: 'flagged', auditorName, note: note.trim() })
    toast.success('Attestation flagged')
  }

  async function anchor() {
    if (wallet == null || att.signature == null || att.auditorKey == null) return
    setAnchoring(true)
    try {
      const txid = await anchorOnChain(wallet, `attestation:${att.id}`, {
        digest: attestationMessage(att), signature: att.signature, auditorKey: att.auditorKey, period: att.period,
      }, `attestation ${att.period}`)
      setAttestationAnchor(att.id, txid)
      toast.success('Attestation anchored on-chain')
    } catch {
      toast.error('Could not anchor on-chain')
    } finally {
      setAnchoring(false)
    }
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

      {att.evidence != null && (
        <div className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
          <FileCheck2 className="mt-0.5 size-3.5 shrink-0 text-faint-foreground" />
          <span>Evidence: <span className="text-foreground">{att.evidence}</span></span>
        </div>
      )}

      {att.auditorName != null && att.status !== 'submitted' && (
        <div className="mt-2.5 border-t border-border pt-2 text-[12px] text-muted-foreground">
          <span className={att.status === 'signed' ? 'text-success' : 'text-destructive'}>
            {att.status === 'signed' ? (att.exceptions ? 'Signed with exceptions' : 'Signed') : 'Flagged'} by {att.auditorName}
          </span>{' '}· {formatDate(att.reviewedAt)}
          {att.auditorNote && <span className="mt-0.5 block text-muted-foreground">“{att.auditorNote}”</span>}
          {att.status === 'signed' && att.signature != null && att.auditorKey != null && (
            <>
              <SignatureBadge att={att} />
              <div className="mt-1.5">
                {att.anchorTxid != null ? (
                  <a href={`https://whatsonchain.com/tx/${att.anchorTxid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    <ShieldCheck className="size-3.5" /> Anchored on-chain · {att.anchorTxid.slice(0, 10)}…
                  </a>
                ) : !isAuditor ? (
                  <Button onClick={anchor} loading={anchoring} loadingText="Anchoring…" variant="ghost" className="h-7 gap-1.5 px-2 text-[11.5px]">
                    <ShieldCheck className="size-3.5" /> Anchor on-chain
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}

      {isAuditor && att.status === 'submitted' && (
        <div className="mt-3 border-t border-border pt-3">
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (required to flag or note exceptions)"
            className="h-9 text-[12.5px]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => sign(false)} loading={signing} loadingText="Signing…" className="h-8 gap-1.5 px-3 text-[12.5px]">
              <Check className="size-4" /> Sign clean
            </Button>
            <button
              type="button"
              disabled={signing}
              onClick={() => sign(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warning/50 px-3 text-[12.5px] font-medium text-warning transition-colors hover:bg-warning/5 disabled:opacity-50"
            >
              <AlertTriangle className="size-4" /> Sign with exceptions
            </button>
            <button
              type="button"
              onClick={flag}
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

/** Verifies the auditor's ECDSA signature over the attestation and shows the
 *  result with the signing Badge ID - proof the sign-off is genuine and the
 *  attested figures haven't been altered since. */
function SignatureBadge({ att }: { att: Attestation }) {
  const { wallet } = useWallet()
  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking')

  useEffect(() => {
    let alive = true
    if (wallet == null) { setState('invalid'); return }
    verifyAttestationSignature(wallet, att).then(ok => { if (alive) setState(ok ? 'valid' : 'invalid') })
    return () => { alive = false }
  }, [wallet, att])

  const key = att.auditorKey ?? ''
  const short = key.length > 12 ? `${key.slice(0, 5)}…${key.slice(-5)}` : key
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      {state === 'checking' ? (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><ShieldCheck className="size-3.5" /> Verifying signature…</span>
      ) : state === 'valid' ? (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-success"><ShieldCheck className="size-3.5" /> Signature verified</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-destructive"><AlertTriangle className="size-3.5" /> Signature invalid</span>
      )}
      <span aria-hidden className="text-faint-foreground">·</span>
      <span className="inline-flex items-center gap-1.5" title={key}>
        <IdentitySigil value={key} size={16} className="rounded" />
        <span className="font-mono text-[11px] text-subtle-foreground">{short}</span>
      </span>
    </div>
  )
}

function formatDate(iso?: string): string {
  if (iso == null) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
