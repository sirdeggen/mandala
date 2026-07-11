import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { parseAmount, formatAmount } from '@bsv/mandala/amount'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useAdminSummary } from '../hooks/useAdminHistory'
import { useIssuerMutations } from '../hooks/useIssuerMutations'
import { useHolderData } from '../hooks/useHolderData'
import { useOnboarding, isReviewerRole } from '../lib/onboarding'
import { useReserveBucket, reservesTotalOf } from '../lib/compliance'
import { useMockTransfers } from '../lib/mandala/mockBankStore'
import TabHeader from './issuer/TabHeader'
import { guardIssueSubmit, guardRedeemSubmit } from '@bsv/mandala/submitGuards'
import { isAdminAuthInFlight } from '@bsv/mandala/adminAuthGate'
import { Sparkles, Flame, ShieldCheck } from 'lucide-react'
import { Input } from './ui/input'
import { SuggestField } from './issuer/SuggestField'
import { BACKING_REF_SUGGESTIONS, SETTLEMENT_NOTE_SUGGESTIONS, bankForRef, type BackingRefSuggestion } from '@/content/banks'
import { Select } from './ui/select'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { cn } from '@/lib/utils'

interface IssuerPanelProps {
  /** When set, sync to issue/redeem asset selection and hide per-section dropdowns. */
  assetId?: string
}

export default function IssuerPanel({ assetId: controlledAssetId }: IssuerPanelProps = {}) {
  const [tab, setTab] = useState<'issue' | 'redeem'>('issue')
  const [issueAsset, setIssueAsset] = useState('')
  const [issueAmount, setIssueAmount] = useState('')
  const [redeemAsset, setRedeemAsset] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')

  // UI-only state (not passed to any core function)
  const [issueRef, setIssueRef] = useState('')
  const [redeemNote, setRedeemNote] = useState('')
  const [wildbank, setWildbank] = useState(false)

  // Shared cached admin-asset list; mutations invalidate it on settle.
  const { data } = useAdminAssets()
  const assets = data ?? []
  const { data: holderData } = useHolderData()
  const { issue, redeem } = useIssuerMutations()
  // Issue/Redeem are independent actions - only the pressed button shows its
  // spinner, but both stay mutually exclusive. Sync refs block double-click
  // before isPending re-renders; adminAuthGate serializes wallet work.
  const busy = issue.isPending || redeem.isPending
  const issueStartedRef = useRef(false)
  const redeemStartedRef = useRef(false)

  // When controlled assetId changes, sync it into each section's selection
  useEffect(() => {
    if (controlledAssetId == null) return
    setIssueAsset(controlledAssetId)
    setRedeemAsset(controlledAssetId)
  }, [controlledAssetId])

  // Effective asset ids: controlled prop takes precedence over internal state
  const effectiveIssueAsset = controlledAssetId ?? issueAsset
  const effectiveRedeemAsset = controlledAssetId ?? redeemAsset

  // ── Backing references: real reserve-account statements + format presets ──────
  const issueAssetObj = assets.find(a => a.assetId === effectiveIssueAsset) ?? null
  const issueDecimals = Number(issueAssetObj?.metadata?.decimals) || 0
  const bankTransfers = useMockTransfers(effectiveIssueAsset)
  const bankStatementSuggestions: BackingRefSuggestion[] = bankTransfers
    .filter(t => t.direction === 'in')
    .map(t => {
      const bank = bankForRef(t.id)
      return {
        label: `${bank.name} deposit`,
        value: `${bank.name} ${bank.account} · ${formatAmount(t.amount, issueDecimals)}`,
        hint: new Date(t.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      }
    })
  const backingSuggestions = [...bankStatementSuggestions, ...BACKING_REF_SUGGESTIONS]

  // ── Wildbank protection: cap issuance at the available reserve balance ────────
  const reserves = reservesTotalOf(useReserveBucket(effectiveIssueAsset))
  const { data: issueSummary } = useAdminSummary(effectiveIssueAsset)
  const circulation = issueSummary != null ? (issueSummary.totalIssued - issueSummary.totalRedeemed) / 10 ** issueDecimals : 0
  const availableReserve = Math.max(0, reserves - circulation)
  const issueAmountNum = Number(issueAmount)
  const exceedsReserve = wildbank && Number.isFinite(issueAmountNum) && issueAmountNum > availableReserve

  const handleIssue = () => {
    if (issueStartedRef.current || busy) return
    const asset = assets.find(a => a.assetId === effectiveIssueAsset)
    if (asset == null) return
    if (isAdminAuthInFlight(asset.assetId)) {
      toast.error('Admin action already in progress for this asset')
      return
    }
    if (wildbank && Number(issueAmount) > availableReserve) {
      toast.error(`Wildbank protection: cannot mint more than the available reserve balance (${availableReserve.toLocaleString('en-US')}).`)
      return
    }
    const amount = parseAmount(issueAmount, Number(asset.metadata?.decimals) || 0)
    const gate = guardIssueSubmit({
      assetId: asset.assetId,
      amount,
      walletReady: true
    })
    if (!gate.ok) {
      toast.error(gate.reason)
      return
    }
    issueStartedRef.current = true
    issue.mutate(
      { asset, amount },
      {
        onSuccess: () => setIssueAmount(''),
        onSettled: () => { issueStartedRef.current = false }
      }
    )
  }

  const handleRedeem = () => {
    if (redeemStartedRef.current || busy) return
    const asset = assets.find(a => a.assetId === effectiveRedeemAsset)
    if (asset == null) return
    if (isAdminAuthInFlight(asset.assetId)) {
      toast.error('Admin action already in progress for this asset')
      return
    }
    const amount = parseAmount(redeemAmount, Number(asset.metadata?.decimals) || 0)
    const held = holderData?.assets.find(a => a.assetId === asset.assetId)?.balance
    const gate = guardRedeemSubmit({
      assetId: asset.assetId,
      amount,
      balance: held,
      walletReady: true
    })
    if (!gate.ok) {
      toast.error(gate.reason)
      return
    }
    redeemStartedRef.current = true
    redeem.mutate(
      { asset, amount },
      {
        onSuccess: () => setRedeemAmount(''),
        onSettled: () => { redeemStartedRef.current = false }
      }
    )
  }

  const assetOptions = (
    <>
      <option value="">Select…</option>
      {assets.map(a => (
        <option key={a.assetId} value={a.assetId}>{a.label}</option>
      ))}
    </>
  )

  // Shared input style
  const inputCls = 'bg-muted border border-border rounded px-[13px] py-[11px] text-[13px] text-foreground placeholder:text-subtle-foreground w-full'
  const labelCls = 'block text-[11px] font-medium text-subtle-foreground mb-[7px]'

  const TABS = [
    { id: 'issue' as const, label: 'Issue', Icon: Sparkles },
    { id: 'redeem' as const, label: 'Redeem', Icon: Flame },
  ]

  const isAuditor = isReviewerRole(useOnboarding().role)
  const header = (
    <TabHeader
      title="Issue & redeem"
      description="Issue new units backed by your reserves, or redeem them from circulation when reserves are returned to a holder."
      guide="/help/for-issuers/issuing-your-first-instrument"
    />
  )

  if (isAuditor) {
    return (
      <div className="max-w-3xl">
        {header}
        <div className="rounded-xl border border-border bg-card p-5 text-[13px] text-muted-foreground shadow-[var(--shadow-card)]">
          Issuing and redeeming are issuer actions. As an auditor you have read-only access - see the Ledger for every issuance and redemption, and the Attestations tab to review backing.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-4">
      {header}

      {/* One card with manila-folder tabs for Issue / Redeem */}
      <div>
        <div className="flex gap-1">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'z-10 border-border bg-card text-foreground'
                    : 'border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            )
          })}
        </div>

        <div className="relative rounded-lg rounded-tl-none border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          {tab === 'issue' ? (
            <div className="space-y-4">
              <p className="text-[13px] text-subtle-foreground">
                Put new units into circulation. Each unit should be matched by reserves you hold.
              </p>
              <div className="space-y-3">
                {controlledAssetId == null && (
                  <div>
                    <label className={labelCls} htmlFor="issue-asset">Instrument</label>
                    <Select id="issue-asset" value={issueAsset} onChange={e => setIssueAsset(e.target.value)} className={inputCls}>
                      {assetOptions}
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="issue-amount">Amount</label>
                    <Input id="issue-amount" type="number" min="0" step="any" value={issueAmount} onChange={e => setIssueAmount(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="issue-ref">Backed by (optional)</label>
                    <SuggestField id="issue-ref" value={issueRef} onChange={setIssueRef} suggestions={backingSuggestions} heading={bankStatementSuggestions.length > 0 ? 'Reserve deposits & references' : 'Common backing references'} placeholder="Bank wire, SWIFT, or deposit reference…" className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Wildbank protection - block minting beyond the available reserve balance. */}
              <div className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', exceedsReserve ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40')}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={wildbank}
                  aria-label="Wildbank protection"
                  onClick={() => setWildbank(v => !v)}
                  className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', wildbank ? 'bg-primary' : 'bg-muted-foreground/40')}
                >
                  <span className={cn('inline-block size-4 transform rounded-full bg-white shadow transition-transform', wildbank ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                    <ShieldCheck className="size-3.5 text-success" /> Wildbank protection
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {wildbank
                      ? <>Minting is capped at the available reserve balance: <span className="tabular font-medium text-foreground">{availableReserve.toLocaleString('en-US')}</span>.</>
                      : 'Prevent minting more than the current available reserve balance.'}
                  </p>
                  {exceedsReserve && (
                    <p className="mt-1 text-[11.5px] font-medium text-destructive">
                      Amount exceeds the available reserve balance.
                    </p>
                  )}
                </div>
              </div>

              <Button
                onClick={handleIssue}
                disabled={busy || effectiveIssueAsset === '' || issueAmount === '' || exceedsReserve}
                loading={issue.isPending}
                loadingText="Issuing…"
                className="w-full rounded bg-primary text-primary-foreground"
              >
                Issue units
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[13px] text-subtle-foreground">
                Take units out of circulation - typically once the matching reserves have been returned to a holder.
              </p>
              <div className="space-y-3">
                {controlledAssetId == null && (
                  <div>
                    <label className={labelCls} htmlFor="redeem-asset">Instrument</label>
                    <Select id="redeem-asset" value={redeemAsset} onChange={e => setRedeemAsset(e.target.value)} className={inputCls}>
                      {assetOptions}
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="redeem-amount">Amount</label>
                    <Input id="redeem-amount" type="number" min="0" step="any" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="redeem-note">Settlement note (optional)</label>
                    <SuggestField id="redeem-note" value={redeemNote} onChange={setRedeemNote} suggestions={SETTLEMENT_NOTE_SUGGESTIONS} heading="Common settlement notes" placeholder="How reserves were returned to the holder…" className={inputCls} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRedeem}
                disabled={busy || effectiveRedeemAsset === '' || redeemAmount === ''}
                className="flex w-full items-center justify-center gap-2 rounded border border-destructive/40 bg-background px-4 py-[10px] text-[13.5px] font-medium text-destructive transition-opacity disabled:opacity-40"
              >
                {redeem.isPending && <Spinner size="sm" tone="current" />}
                {redeem.isPending ? 'Redeeming…' : 'Redeem units'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
