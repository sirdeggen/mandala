import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ShieldCheck, ClipboardCheck, HandCoins, ShieldAlert, GitPullRequestArrow,
  Check, X, ArrowRight, Plus, Flag, Signature, TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import type { AdminSummary } from '@bsv/mandala/adminHistory'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminSummaries } from '../../hooks/useAdminHistory'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { useWallet } from '../../context/WalletContext'
import { signAttestation } from '../../lib/complianceSignature'
import {
  useComplianceSnapshot, reservesTotalOf, useGovernance, setGovernance,
  approveProposal, rejectProposal, proposeGeneric, reviewAttestation,
  useControlActions, acknowledgeControlAction, setControlActionAnchor,
  type ReserveBucket, type Attestation, type Proposal, type ControlAction,
} from '../../lib/compliance'
import { signAction, verifyActionSignature, actionMessage } from '../../lib/complianceSignature'
import { anchorOnChain } from '../../lib/onchainAnchor'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { assetImage } from '@/lib/instrumentCategory'
import { GlobalSanctionLists } from './SanctionLists'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'

/**
 * Compliance overview - the cross-instrument roll-up and the maker-checker
 * approvals queue. Role-aware: issuers act (governance toggle, approve/reject,
 * propose), auditors get read-only signals plus the attestations awaiting their
 * signature.
 */
export default function ComplianceOverview({ onOpenInstrument }: {
  onOpenInstrument: (assetId: string, tab?: string) => void
}) {
  const { data } = useAdminAssets()
  const assets: AdminAsset[] = data ?? []
  const snap = useComplianceSnapshot()
  const governance = useGovernance()
  const { role, name } = useOnboarding()
  const isAuditor = isReviewerRole(role)

  const summaries = useAdminSummaries(assets.map(a => a.assetId))
  const rows = assets.map(a => compliance(a, snap.buckets[a.assetId], snap, summaries[a.assetId] ?? null))
  const backedCount = rows.filter(r => r.fullyBacked).length
  const pendingAtt = snap.attestations.filter(a => a.status === 'submitted')
  const openRedemptions = snap.requests.filter(r => r.status === 'pending')
  const hits = Object.values(snap.holders).filter(h => h.sanctions === 'hit')
  const pendingProposals = snap.proposals.filter(p => p.status === 'pending')
  const controlActions = useControlActions()
  const pendingActions = controlActions.filter(a => a.status === 'pending')

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-6">
        <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">Compliance</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {isAuditor
            ? 'Verification signals across every instrument, and the attestations awaiting your signature.'
            : 'Backing, redemptions, screening and approvals across every instrument.'}
        </p>
      </div>

      {/* Summary tiles - inset on a light panel */}
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-sidebar p-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile Icon={Signature} label="Instruments" value={String(assets.length)} />
        {(() => {
          const allBacked = assets.length > 0 && backedCount === assets.length
          return <Tile Icon={allBacked ? ShieldCheck : TriangleAlert} label="Fully backed" value={`${backedCount}/${assets.length}`} tone={allBacked ? 'success' : 'warning'} />
        })()}
        <Tile Icon={ClipboardCheck} label="Attestations to sign" value={String(pendingAtt.length)} tone={pendingAtt.length > 0 ? 'warning' : undefined} />
        <Tile Icon={HandCoins} label="Open redemptions" value={String(openRedemptions.length)} tone={openRedemptions.length > 0 ? 'warning' : undefined} />
        <Tile Icon={ShieldAlert} label="Sanctions hits" value={String(hits.length)} tone={hits.length > 0 ? 'destructive' : 'success'} />
        <Tile Icon={ShieldCheck} label={isAuditor ? 'Actions to sign off' : 'Actions awaiting sign-off'} value={String(pendingActions.length)} tone={pendingActions.length > 0 ? 'warning' : undefined} />
        {!isAuditor && (
          <Tile Icon={GitPullRequestArrow} label="Pending approvals" value={String(pendingProposals.length)} tone={pendingProposals.length > 0 ? 'warning' : undefined} />
        )}
      </div>

      {/* Control actions - sensitive admin operations, with auditor sign-off. */}
      {controlActions.length > 0 && (
        <Section title="Control actions">
          <div className="space-y-2">
            {controlActions.slice(0, 12).map(a => (
              <ControlActionRow key={a.id} action={a} assetLabel={labelOf(assets, a.assetId)} isAuditor={isAuditor} auditorName={name.trim() || 'Auditor'} />
            ))}
          </div>
        </Section>
      )}

      {/* Auditor: attestations to sign */}
      {isAuditor && (
        <Section title="Attestations awaiting signature">
          {pendingAtt.length === 0 ? (
            <Empty>No attestations are awaiting your signature.</Empty>
          ) : (
            <div className="space-y-2">
              {pendingAtt.map(a => (
                <AttestationSignRow key={a.id} att={a} assetLabel={labelOf(assets, a.assetId)} auditorName={name.trim() || 'Auditor'} onOpen={() => onOpenInstrument(a.assetId, 'attestations')} />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Sanction lists - org-wide policy + incoming provider updates */}
      <Section title="Sanction lists">
        <GlobalSanctionLists />
      </Section>

      {/* Per-instrument compliance */}
      <Section title="By instrument">
        {rows.length === 0 ? (
          <Empty>No instruments yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
            {rows.map((r, i) => (
              <button
                key={r.asset.assetId}
                type="button"
                onClick={() => onOpenInstrument(r.asset.assetId, 'attestations')}
                className={cn('group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent', i > 0 && 'border-t border-border')}
              >
                <InstrumentIcon assetId={r.asset.assetId} size={34} className="rounded-lg" image={assetImage(r.asset)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-foreground">{r.asset.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {r.latestAtt?.status === 'signed' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
                        <Check className="size-3" strokeWidth={3} /> Compliant
                      </span>
                    )}
                    <MiniPill label={r.backing != null ? `${fmt(r.backing)}% backed` : 'Not yet issued'} tone={r.backing == null ? 'muted' : r.fullyBacked ? 'success' : 'warning'} />
                    <MiniPill label={attLabel(r.latestAtt)} tone={r.latestAtt?.status === 'signed' ? 'success' : r.latestAtt?.status === 'flagged' ? 'destructive' : 'muted'} />
                    {r.openRedemptions > 0 && <MiniPill label={`${r.openRedemptions} redemption${r.openRedemptions === 1 ? '' : 's'}`} tone="outline" />}
                  </div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-foreground" />
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Governance / approvals */}
      <Section title="Governance & approvals">
        <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] font-semibold text-foreground">Dual control (maker-checker)</div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">Require a second approver before sensitive actions take effect.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={governance.dualControl}
              aria-label="Require dual control"
              disabled={isAuditor}
              onClick={() => setGovernance({ dualControl: !governance.dualControl })}
              className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50', governance.dualControl ? 'bg-primary' : 'bg-muted-foreground/40')}
            >
              <span className={cn('inline-block size-4 transform rounded-full bg-white shadow transition-transform', governance.dualControl ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
            </button>
          </div>

          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-foreground">
                Approvals queue {pendingProposals.length > 0 && <span className="text-[12px] font-medium text-warning">· {pendingProposals.length} pending</span>}
              </div>
              {!isAuditor && <NewProposal assets={assets} />}
            </div>
            {snap.proposals.length === 0 ? (
              <Empty>No approval requests.</Empty>
            ) : (
              <div className="space-y-2">
                {snap.proposals.map(p => (
                  <ProposalRow key={p.id} proposal={p} assetLabel={p.assetId ? labelOf(assets, p.assetId) : undefined} readOnly={isAuditor} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  )
}

// ── Roll-up helper ────────────────────────────────────────────────────────────

interface Row {
  asset: AdminAsset
  reserves: number
  circ: number
  backing: number | null
  fullyBacked: boolean
  latestAtt?: Attestation
  openRedemptions: number
}

function compliance(asset: AdminAsset, bucket: ReserveBucket | undefined, snap: ReturnType<typeof useComplianceSnapshot>, summary: AdminSummary | null): Row {
  const b = bucket ?? { composition: [], circulation: 0 }
  const reserves = reservesTotalOf(b)
  // Circulation from the ledger (issued - redeemed), matching the instrument
  // views; falls back to the local bucket figure only if the summary is absent.
  const decimals = Number(asset.metadata?.decimals) || 0
  const circ = summary != null ? (summary.totalIssued - summary.totalRedeemed) / 10 ** decimals : b.circulation
  const backing = circ > 0 ? (reserves / circ) * 100 : (reserves > 0 && circ === 0 ? 100 : null)
  return {
    asset,
    reserves,
    circ,
    backing,
    fullyBacked: backing != null && backing >= 100,
    latestAtt: snap.attestations.find(a => a.assetId === asset.assetId),
    openRedemptions: snap.requests.filter(r => r.assetId === asset.assetId && r.status === 'pending').length,
  }
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const labelOf = (assets: AdminAsset[], id: string) => assets.find(a => a.assetId === id)?.label ?? 'Instrument'
function attLabel(a?: Attestation) {
  if (a == null) return 'No attestation'
  return a.status === 'signed' ? `Attested ${a.period}` : a.status === 'flagged' ? `Flagged ${a.period}` : `${a.period} in review`
}

// ── Small pieces ──────────────────────────────────────────────────────────────

const TONE = {
  success: 'text-success bg-success/10',
  warning: 'text-warning bg-warning/10',
  destructive: 'text-destructive bg-destructive/10',
  muted: 'text-muted-foreground bg-muted',
  outline: 'text-muted-foreground bg-transparent border border-border',
} as const

function Tile({ Icon, label, value, tone }: { Icon: LucideIcon; label: string; value: string; tone?: keyof typeof TONE }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <span className={cn('grid size-8 place-items-center rounded-lg', tone ? TONE[tone] : 'bg-muted text-muted-foreground')}>
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <div className="mt-3 tabular text-[24px] font-semibold leading-none tracking-[-0.02em] text-foreground">{value}</div>
      <div className="mt-1 text-[12.5px] text-muted-foreground">{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-[15px] font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">{children}</div>
}

function MiniPill({ label, tone }: { label: string; tone: keyof typeof TONE }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', TONE[tone])}>{label}</span>
}

// ── Attestation sign row (auditor) ────────────────────────────────────────────

function AttestationSignRow({ att, assetLabel, auditorName, onOpen }: {
  att: Attestation; assetLabel: string; auditorName: string; onOpen: () => void
}) {
  const { wallet, identityKey } = useWallet()
  const [note, setNote] = useState('')
  const [signing, setSigning] = useState(false)
  const backing = att.circulation > 0 ? (att.reservesTotal / att.circulation) * 100 : (att.reservesTotal > 0 ? 100 : null)

  const sign = async () => {
    if (wallet == null || identityKey == null) { toast.error('Connect a wallet to sign this attestation.'); return }
    setSigning(true)
    try {
      const signature = await signAttestation(wallet, att)
      reviewAttestation(att.id, { status: 'signed', auditorName, note: note.trim() || undefined, auditorKey: identityKey, signature })
      toast.success('Attestation cryptographically signed')
    } catch {
      toast.error('Could not sign the attestation')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onOpen} className="truncate text-left text-[13.5px] font-medium text-foreground hover:underline">
          {assetLabel} · {att.period}
        </button>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium tabular', backing != null && backing >= 100 ? TONE.success : TONE.warning)}>
          {backing != null ? `${fmt(backing)}% backed` : '-'}
        </span>
      </div>
      <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="mt-2 h-9 text-[12.5px]" />
      <div className="mt-2 flex gap-2">
        <Button onClick={sign} loading={signing} loadingText="Signing…" className="h-8 gap-1.5 px-3 text-[12.5px]">
          <Check className="size-4" /> Sign
        </Button>
        <button type="button" onClick={() => { reviewAttestation(att.id, { status: 'flagged', auditorName, note: note.trim() || undefined }); toast.success('Attestation flagged') }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/5">
          <Flag className="size-4" /> Flag
        </button>
      </div>
    </div>
  )
}

// ── Control action row (auditor sign-off on sensitive admin operations) ───────

function ControlActionRow({ action, assetLabel, isAuditor, auditorName }: {
  action: ControlAction; assetLabel: string; isAuditor: boolean; auditorName: string
}) {
  const { wallet, identityKey } = useWallet()
  const [note, setNote] = useState('')
  const [signing, setSigning] = useState(false)
  const [anchoring, setAnchoring] = useState(false)
  const [verify, setVerify] = useState<'checking' | 'valid' | 'invalid'>('checking')

  useEffect(() => {
    if (action.status !== 'acknowledged' || wallet == null) return
    let alive = true
    verifyActionSignature(wallet, action).then(ok => { if (alive) setVerify(ok ? 'valid' : 'invalid') })
    return () => { alive = false }
  }, [wallet, action])

  const ack = async () => {
    if (wallet == null || identityKey == null) { toast.error('Connect a wallet to sign off.'); return }
    setSigning(true)
    try {
      const signature = await signAction(wallet, action)
      acknowledgeControlAction(action.id, { auditorName, auditorKey: identityKey, signature, note: note.trim() || undefined })
      toast.success('Control action signed off')
    } catch {
      toast.error('Could not sign off the action')
    } finally {
      setSigning(false)
    }
  }

  const anchor = async () => {
    if (wallet == null || action.signature == null || action.auditorKey == null) return
    setAnchoring(true)
    try {
      const txid = await anchorOnChain(wallet, `action:${action.id}`, {
        digest: actionMessage(action), signature: action.signature, auditorKey: action.auditorKey, kind: action.kind,
      }, `control action ${action.kind}`)
      setControlActionAnchor(action.id, txid)
      toast.success('Sign-off anchored on-chain')
    } catch {
      toast.error('Could not anchor on-chain')
    } finally {
      setAnchoring(false)
    }
  }

  const when = new Date(action.createdAt)
  const whenStr = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{action.detail}</span>
        <MiniPill label={action.status === 'acknowledged' ? 'Signed off' : 'Awaiting sign-off'} tone={action.status === 'acknowledged' ? 'success' : 'warning'} />
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{assetLabel} · {action.reason}</p>
      <div className="mt-0.5 text-[11px] text-subtle-foreground">By {action.actorName || 'issuer'} · {whenStr}</div>

      {action.status === 'acknowledged' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
          {verify === 'valid' ? (
            <span className="inline-flex items-center gap-1 font-medium text-success"><ShieldCheck className="size-3.5" /> Signed off by {action.auditorName}</span>
          ) : verify === 'invalid' ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive"><X className="size-3.5" /> Signature invalid</span>
          ) : (
            <span className="text-muted-foreground">Verifying…</span>
          )}
          {action.auditorNote && <span className="text-muted-foreground">· “{action.auditorNote}”</span>}
          {action.anchorTxid != null ? (
            <a href={`https://whatsonchain.com/tx/${action.anchorTxid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <ShieldCheck className="size-3.5" /> Anchored · {action.anchorTxid.slice(0, 10)}…
            </a>
          ) : isAuditor ? (
            <button type="button" onClick={anchor} disabled={anchoring} className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
              <ShieldCheck className="size-3.5" /> {anchoring ? 'Anchoring…' : 'Anchor on-chain'}
            </button>
          ) : null}
        </div>
      )}

      {isAuditor && action.status === 'pending' && (
        <div className="mt-2 space-y-2">
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Sign-off note (optional)" className="h-8 text-[12px]" />
          <Button onClick={ack} loading={signing} loadingText="Signing…" className="h-8 gap-1.5 px-3 text-[12.5px]">
            <ShieldCheck className="size-4" /> Acknowledge &amp; sign
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Proposal row + new proposal ───────────────────────────────────────────────

const PROP_STATUS: Record<Proposal['status'], { label: string; tone: keyof typeof TONE }> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'destructive' },
}

function ProposalRow({ proposal, assetLabel, readOnly }: { proposal: Proposal; assetLabel?: string; readOnly: boolean }) {
  const s = PROP_STATUS[proposal.status]
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{proposal.title}</span>
        <MiniPill label={s.label} tone={s.tone} />
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{proposal.detail}{assetLabel ? ` · ${assetLabel}` : ''}</p>
      {!readOnly && proposal.status === 'pending' && (
        <div className="mt-2.5 flex gap-2">
          <Button onClick={() => { approveProposal(proposal.id); toast.success('Approved') }} className="h-8 gap-1.5 px-3 text-[12.5px]">
            <Check className="size-4" /> Approve
          </Button>
          <button type="button" onClick={() => { rejectProposal(proposal.id, 'Rejected by checker'); toast.success('Rejected') }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/5">
            <X className="size-4" /> Reject
          </button>
        </div>
      )}
    </div>
  )
}

function NewProposal({ assets }: { assets: AdminAsset[] }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [assetId, setAssetId] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim() === '') { toast.error('Describe the action to approve.'); return }
    proposeGeneric({ title: title.trim(), detail: 'Manual approval request', assetId: assetId || undefined })
    toast.success('Sent for approval')
    setTitle(''); setAssetId(''); setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted">
        <Plus className="size-4" /> Request approval
      </button>
    )
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Freeze holding pending court order" className="h-8 w-64 text-[12.5px]" autoFocus />
      <select value={assetId} onChange={e => setAssetId(e.target.value)} className="h-8 rounded border border-input-border bg-input px-2 text-[12px]">
        <option value="">Any</option>
        {assets.map(a => <option key={a.assetId} value={a.assetId}>{a.label}</option>)}
      </select>
      <Button type="submit" className="h-8 px-3 text-[12px]">Send</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
    </form>
  )
}
