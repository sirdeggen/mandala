import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { parseAmount } from '@bsv/mandala/amount'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useIssuerMutations } from '../hooks/useIssuerMutations'
import { useHolderData } from '../hooks/useHolderData'
import { useOnboarding, isReviewerRole } from '../lib/onboarding'
import TabHeader from './issuer/TabHeader'
import { guardIssueSubmit, guardRedeemSubmit } from '@bsv/mandala/submitGuards'
import { isAdminAuthInFlight } from '@bsv/mandala/adminAuthGate'
import { Sparkles, Flame } from 'lucide-react'
import { Input } from './ui/input'
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

  const handleIssue = () => {
    if (issueStartedRef.current || busy) return
    const asset = assets.find(a => a.assetId === effectiveIssueAsset)
    if (asset == null) return
    if (isAdminAuthInFlight(asset.assetId)) {
      toast.error('Admin action already in progress for this asset')
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
  const inputCls = 'bg-muted border border-border rounded px-[13px] py-[11px] text-[13px] text-subtle-foreground placeholder:text-subtle-foreground w-full'
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
                <div>
                  <label className={labelCls} htmlFor="issue-amount">Amount</label>
                  <Input id="issue-amount" type="number" min="0" step="any" value={issueAmount} onChange={e => setIssueAmount(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="issue-ref">Backed by (optional)</label>
                  <Input id="issue-ref" type="text" value={issueRef} onChange={e => setIssueRef(e.target.value)} placeholder="Bank deposit ref · BR-…" className={inputCls} />
                </div>
              </div>
              <Button
                onClick={handleIssue}
                disabled={busy || effectiveIssueAsset === '' || issueAmount === ''}
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
                <div>
                  <label className={labelCls} htmlFor="redeem-amount">Amount</label>
                  <Input id="redeem-amount" type="number" min="0" step="any" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="redeem-note">Settlement note (optional)</label>
                  <Input id="redeem-note" type="text" value={redeemNote} onChange={e => setRedeemNote(e.target.value)} placeholder="e.g. wire returned to holder" className={inputCls} />
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
