import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { parseAmount } from '../lib/mandala/amount'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useIssuerMutations } from '../hooks/useIssuerMutations'
import { Sparkles, Flame } from 'lucide-react'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'

interface IssuerPanelProps {
  /** When set, sync to issue/redeem asset selection and hide per-section dropdowns. */
  assetId?: string
}

export default function IssuerPanel({ assetId: controlledAssetId }: IssuerPanelProps = {}) {
  const { wallet } = useWallet()
  const [label, setLabel] = useState('')
  const [ticker, setTicker] = useState('')
  const [decimals, setDecimals] = useState('0')
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
  const { register, issue, redeem } = useIssuerMutations()
  // Register/Issue/Redeem are independent actions — only the pressed button
  // shows its spinner, but all three stay mutually exclusive.
  const busy = register.isPending || issue.isPending || redeem.isPending

  // When controlled assetId changes, sync it into each section's selection
  useEffect(() => {
    if (controlledAssetId == null) return
    setIssueAsset(controlledAssetId)
    setRedeemAsset(controlledAssetId)
  }, [controlledAssetId])

  // Effective asset ids: controlled prop takes precedence over internal state
  const effectiveIssueAsset = controlledAssetId ?? issueAsset
  const effectiveRedeemAsset = controlledAssetId ?? redeemAsset

  const handleRegister = () => {
    if (wallet == null || label.trim() === '') return
    const dec = Number(decimals)
    if (!Number.isInteger(dec) || dec < 0) { toast.error('Decimals must be a non-negative integer'); return }
    register.mutate({ label, ticker, decimals: dec }, {
      onSuccess: () => { setLabel(''); setTicker(''); setDecimals('0') }
    })
  }

  const handleIssue = () => {
    const asset = assets.find(a => a.assetId === effectiveIssueAsset)
    const amount = parseAmount(issueAmount, Number(asset?.metadata?.decimals) || 0)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    issue.mutate({ asset, amount }, { onSuccess: () => setIssueAmount('') })
  }

  const handleRedeem = () => {
    const asset = assets.find(a => a.assetId === effectiveRedeemAsset)
    const amount = parseAmount(redeemAmount, Number(asset?.metadata?.decimals) || 0)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    redeem.mutate({ asset, amount }, { onSuccess: () => setRedeemAmount('') })
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
  const inputCls = 'bg-muted border border-[rgba(27,30,36,.12)] rounded-[10px] px-[13px] py-[11px] text-[13px] text-subtle-foreground placeholder:text-subtle-foreground w-full'
  const labelCls = 'block text-[11px] font-medium text-subtle-foreground mb-[7px]'

  return (
    <div className="space-y-5">
      {/* Page heading */}
      <div className="mb-1">
        <h1 style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.5px', lineHeight: 1.15 }}>
          Operations
        </h1>
        <p className="text-subtle-foreground text-[13.5px] mt-1">
          Mint &amp; redeem the US Dollar stablecoin
        </p>
      </div>

      {/* Issue + Redeem: 2-col grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Issue card */}
        <div className="bg-card border border-border rounded-[14px] p-[18px] flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: 'rgba(35,64,94,.1)', color: '#23405E' }}
            >
              <Sparkles className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Issue tokens</p>
              <p className="text-[11.5px] text-subtle-foreground mt-0.5">Mint new tokens into circulation</p>
            </div>
          </div>

          <div className="space-y-3">
            {controlledAssetId == null && (
              <div>
                <label className={labelCls} htmlFor="issue-asset">Asset</label>
                <Select id="issue-asset" value={issueAsset} onChange={e => setIssueAsset(e.target.value)} className={inputCls}>
                  {assetOptions}
                </Select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="issue-amount">Amount</label>
              <Input
                id="issue-amount"
                type="number"
                min="0"
                step="any"
                value={issueAmount}
                onChange={e => setIssueAmount(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="issue-ref">Backed by (optional)</label>
              <Input
                id="issue-ref"
                type="text"
                value={issueRef}
                onChange={e => setIssueRef(e.target.value)}
                placeholder="Bank deposit ref · BR-…"
                className={inputCls}
              />
            </div>
          </div>

          <Button
            onClick={handleIssue}
            disabled={busy || effectiveIssueAsset === '' || issueAmount === ''}
            loading={issue.isPending}
            loadingText="Issuing…"
            className="w-full rounded-[11px] bg-primary text-primary-foreground mt-auto"
          >
            Issue Tokens
          </Button>
        </div>

        {/* Redeem card */}
        <div className="bg-card border border-border rounded-[14px] p-[18px] flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: 'rgba(180,112,58,.12)', color: '#B4703A' }}
            >
              <Flame className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Redeem tokens</p>
              <p className="text-[11.5px] text-subtle-foreground mt-0.5">Burn tokens out of circulation</p>
            </div>
          </div>

          <div className="space-y-3">
            {controlledAssetId == null && (
              <div>
                <label className={labelCls} htmlFor="redeem-asset">Asset</label>
                <Select id="redeem-asset" value={redeemAsset} onChange={e => setRedeemAsset(e.target.value)} className={inputCls}>
                  {assetOptions}
                </Select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="redeem-amount">Amount</label>
              <Input
                id="redeem-amount"
                type="number"
                min="0"
                step="any"
                value={redeemAmount}
                onChange={e => setRedeemAmount(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="redeem-note">Settlement note (optional)</label>
              <Input
                id="redeem-note"
                type="text"
                value={redeemNote}
                onChange={e => setRedeemNote(e.target.value)}
                placeholder="e.g. wire returned to holder"
                className={inputCls}
              />
            </div>
          </div>

          <button
            onClick={handleRedeem}
            disabled={busy || effectiveRedeemAsset === '' || redeemAmount === ''}
            className="w-full rounded-[11px] mt-auto py-[10px] px-4 text-[13.5px] font-medium transition-opacity disabled:opacity-40 bg-background border border-destructive/40 text-destructive flex items-center justify-center gap-2"
          >
            {redeem.isPending && <Spinner size="sm" tone="current" />}
            {redeem.isPending ? 'Redeeming…' : 'Redeem (burn)'}
          </button>
        </div>
      </div>

      {/* Recovery of a frozen output lives in Regulatory → "Reissue from frozen
          output": it ties the minted amount to the frozen row and the overlay
          enforces conservation (reissue guard), so circulation can't drift. A
          free-form "recover" mint here could not guarantee that, so it's gone. */}

      {/* Register: slim strip at bottom */}
      <div
        className="rounded-[12px] border-dashed border p-[14px_18px]"
        style={{ background: '#EFE9DD', borderColor: 'rgba(27,30,36,.18)' }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="shrink-0">
            <p className="text-[13.5px] font-semibold leading-tight">Register a new asset</p>
            <p className="text-[11.5px] text-subtle-foreground mt-0.5">
              Rare — most issuers run a single stablecoin
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2 flex-1 sm:justify-end">
            <div className="flex flex-col min-w-[110px]">
              <label className={labelCls} htmlFor="reg-label">Label</label>
              <Input
                id="reg-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Gold Coin"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
              />
            </div>
            <div className="flex flex-col min-w-[72px]">
              <label className={labelCls} htmlFor="reg-ticker">Ticker</label>
              <Input
                id="reg-ticker"
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                placeholder="USD"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
              />
            </div>
            <div className="flex flex-col min-w-[64px]">
              <label className={labelCls} htmlFor="reg-decimals">Decimals</label>
              <Input
                id="reg-decimals"
                type="number"
                min="0"
                step="1"
                value={decimals}
                onChange={e => setDecimals(e.target.value)}
                placeholder="0"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground tabular-nums"
              />
            </div>
            <button
              onClick={handleRegister}
              disabled={busy || label.trim() === ''}
              className="shrink-0 rounded-[8px] border px-4 py-[8px] text-[12.5px] font-medium transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: '#fff', borderColor: 'rgba(27,30,36,.2)', color: '#23405E' }}
            >
              {register.isPending && <Spinner size="sm" tone="current" />}
              {register.isPending ? 'Registering…' : 'Register asset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
