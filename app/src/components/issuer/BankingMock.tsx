import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, PlusCircle, Trash2, ShieldCheck, AlertTriangle, ArrowRight, Landmark, Plug, CirclePlus, Signature, X, ExternalLink, ChevronDown, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Select } from '../ui/select'
import { Input } from '../ui/input'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Spinner } from '../ui/spinner'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useIssuerMutations } from '../../hooks/useIssuerMutations'
import { useWallet } from '../../context/WalletContext'
import { useOnboarding } from '../../lib/onboarding'
import { reconcile, makeTransfer, TransferDirection } from '@bsv/mandala/banking'
import { useMockTransfers, addMockTransfer, removeMockTransfer, clearMockTransfers } from '../../lib/mandala/mockBankStore'
import { useActiveIntegration } from '../../lib/integrations'
import { useMintRequests, createMintRequest, settleMintRequest, rejectMintRequest, removeMintRequest, type MintRequest } from '../../lib/orchestration'
import { formatAmount, parseAmount } from '@bsv/mandala/amount'
import { bankForRef } from '@/content/banks'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { BankReconcileButton } from './ReconcileLink'

interface BankingMockProps {
  /** Controlled mode: when set, use this assetId and hide the header asset selector. */
  assetId?: string
}

/** Plausible institutional counterparties for a regulated reserve feed - banks,
 *  custodians, clearing houses, market makers and corporate treasuries. Names
 *  are illustrative and do not denote real relationships. */
const RESERVE_COUNTERPARTIES = [
  'Helvetia Kantonalbank AG',
  'SIX Interbank Clearing AG',
  'Alpine Custody Services SA',
  'Lemanic Capital Markets AG',
  'Zürich Treasury Partners AG',
  'Basel Correspondent Bank AG',
  'Nordkap Asset Management AG',
  'Genève Private Bank SA',
  'Rhône Liquidity Partners SA',
  'Matterhorn Market Making AG',
  'Aare Digital Custody AG',
  'Léman Clearing House SA',
]

/**
 * Demo bank feed + reserve reconciliation. Transfers here are fake (persisted
 * in localStorage, deletable/clearable); issuance happens on the Operations
 * page - this page only shows how the bank balance reconciles against
 * on-chain supply.
 */
export default function BankingMock({ assetId: controlledAssetId }: BankingMockProps = {}) {
  const { wallet } = useWallet()
  const { data: assetsData } = useAdminAssets()
  const assets: AdminAsset[] = assetsData ?? []
  const { issue } = useIssuerMutations()
  const approverName = useOnboarding().name.trim() || 'Issuer'
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [direction, setDirection] = useState<TransferDirection>('in')
  const [bankingTab, setBankingTab] = useState<'feed' | 'manual'>('feed')
  const [feedDirection, setFeedDirection] = useState<TransferDirection>('in')
  const [feedMenuOpen, setFeedMenuOpen] = useState(false)

  // In controlled mode the active asset id comes from the prop
  const activeAssetId = controlledAssetId ?? selectedAssetId

  // Shared with the Overview reserve-ratio KPI (mockBankStore) so both reflect
  // the same per-asset feed; starts blank - nothing to reconcile until a
  // transfer is added, and switching assets switches the whole feed.
  const transfers = useMockTransfers(activeAssetId)
  const mintRequests = useMintRequests(activeAssetId)

  const asset = assets.find(a => a.assetId === activeAssetId) ?? null
  const decimals = Number(asset?.metadata?.decimals) || 0

  // Issue/redeem totals pre-aggregated on the overlay - reconciliation never
  // downloads the full admin history.
  const summaryQuery = useAdminSummary(wallet != null ? activeAssetId : '')
  const summary = summaryQuery.data

  const recon = useMemo((): { bankBalance: number, netSupply: number, drift: number } | null => {
    if (summary == null) return null
    return reconcile({
      deposits: transfers.filter(t => t.direction === 'in').map(t => t.amount),
      withdrawals: transfers.filter(t => t.direction === 'out').map(t => t.amount),
      issued: summary.totalIssued,
      redeemed: summary.totalRedeemed
    })
  }, [summary, transfers])

  // Reserve coverage links the two sides the whole tab is about: how much of the
  // circulating supply the bank reserves actually back. 100%+ = fully backed.
  const coveragePct = recon != null && recon.netSupply > 0
    ? Math.round((recon.bankBalance / recon.netSupply) * 100)
    : null
  const fullyBacked = recon != null && recon.bankBalance >= recon.netSupply

  // Free reserve = bank balance not yet backing circulating supply. Minting is
  // capped to this: an issuer can only mint up to the reserves they hold above
  // what's already in circulation (recon.drift = bankBalance − netSupply).
  const freeToMint = recon != null ? Math.max(0, recon.drift) : 0
  const pendingMintTotal = mintRequests.filter(r => r.status === 'pending').reduce((s, r) => s + r.amount, 0)

  // Switch to the instrument's Issuance & redemption tab (id 'operations').
  const [, setSearchParams] = useSearchParams()
  const reservesVia = useActiveIntegration('reserves')
  const navigate = useNavigate()
  const goToIssuance = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', 'operations')
      return next
    }, { replace: true })
  }, [setSearchParams])

  // Add a demo transfer. makeTransfer stamps a synthetic "Company {letter}"; we
  // override it with a plausible institutional counterparty for a regulated
  // reserve feed (banks, custodians, market makers, corporate treasuries). Names
  // are illustrative, not real relationships.
  const handleAddTransfer = useCallback(() => {
    const amount = parseAmount(transferAmount, decimals)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid transfer amount')
      return
    }
    const originator = RESERVE_COUNTERPARTIES[Math.floor(Math.random() * RESERVE_COUNTERPARTIES.length)]
    const t = { ...makeTransfer(amount, direction, activeAssetId), originator }
    addMockTransfer(t)
    setTransferAmount('')
    // A reserve deposit raises a mint request for a second approver to settle
    // (deposit-to-mint, maker-checker). Withdrawals just adjust the reserve
    // balance; redemptions and their burns are handled on the redemption queue.
    if (direction === 'in') {
      const bank = bankForRef(t.id)
      createMintRequest({ assetId: activeAssetId, amount, originator, reference: `${bank.name} ${bank.account}` })
      toast.success(`Deposit recorded. Mint request raised for ${formatAmount(amount, decimals)}, awaiting approval.`)
    } else {
      toast.success(`Withdrawal recorded: ${originator}, ${formatAmount(amount, decimals)}`)
    }
  }, [transferAmount, decimals, direction, activeAssetId])

  // Available balance to withdraw (display units): can't withdraw more reserves
  // than the bank actually holds.
  const availableDisplay = recon != null ? recon.bankBalance / 10 ** decimals : 0

  // Automated reserve feed: mocks an event pushed by a connected bank/custodian
  // API - a plausible amount from a random counterparty. Deposits raise the
  // same maker-checker mint request as a manual deposit; withdrawals are capped
  // to the reserves currently held.
  const simulateFeedTransfer = useCallback((dir: TransferDirection) => {
    if (activeAssetId === '') { toast.error('Select an instrument first'); return }
    const originator = RESERVE_COUNTERPARTIES[Math.floor(Math.random() * RESERVE_COUNTERPARTIES.length)]
    let displayAmt: number
    if (dir === 'out') {
      if (availableDisplay <= 0) { toast.error('No reserves available to withdraw.'); return }
      // A random 20–90% of the available balance, never more than is held.
      displayAmt = Math.min(availableDisplay, Math.max(1, Math.round(availableDisplay * (0.2 + Math.random() * 0.7))))
    } else {
      displayAmt = (Math.floor(Math.random() * 491) + 10) * 1000 // 10k–500k
    }
    const amount = parseAmount(String(displayAmt), decimals)
    if (dir === 'out' && recon != null && amount > recon.bankBalance) return // safety
    const t = { ...makeTransfer(amount, dir, activeAssetId), originator }
    addMockTransfer(t)
    if (dir === 'in') {
      const bank = bankForRef(t.id)
      createMintRequest({ assetId: activeAssetId, amount, originator, reference: `${bank.name} ${bank.account}` })
      toast.success(`Incoming deposit from ${originator}: ${formatAmount(amount, decimals)}. Mint request raised, awaiting approval.`)
    } else {
      toast.success(`Outgoing withdrawal to ${originator}: ${formatAmount(amount, decimals)}.`)
    }
  }, [activeAssetId, decimals, availableDisplay, recon])

  // Checker step: approve a pending mint request. This performs the real
  // on-chain issuance and records the txid against the request.
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const approveMint = useCallback(async (req: MintRequest) => {
    if (asset == null || approvingId != null) return
    // Maker-checker cap: never mint beyond the free reserve balance (reserves
    // above what's already in circulation). Protects against approving a mint
    // whose deposit was since withdrawn/removed, or mints queued beyond reserves.
    if (recon == null) { toast.error('Reserve balance is still loading. Try again in a moment.'); return }
    if (req.amount > recon.drift) {
      toast.error(`This mint exceeds your free reserves (${formatAmount(Math.max(0, recon.drift), decimals)} available). Record reserve deposits first.`)
      return
    }
    setApprovingId(req.id)
    try {
      const res = await issue.mutateAsync({ asset, amount: req.amount })
      settleMintRequest(req.id, { txid: res.txid, approvedBy: approverName })
      toast.success(`Issued ${formatAmount(req.amount, decimals)} on-chain`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      toast.error(/permission denied/i.test(msg)
        ? 'Your wallet declined the issuance. Approve it in your wallet, then try again.'
        : (msg !== '' ? msg : 'Could not issue on-chain'))
    } finally {
      setApprovingId(null)
    }
  }, [asset, approvingId, issue, approverName, decimals, recon])

  const handleRemoveTransfer = useCallback((id: string) => {
    removeMockTransfer(id)
  }, [])

  const handleClearAll = useCallback(() => {
    clearMockTransfers(activeAssetId)
    toast.success('Cleared all demo transfers')
  }, [activeAssetId])

  return (
    <div>
      {/* Standalone heading (when embedded in the instrument detail, the tab's
          own header covers this). Includes the asset picker. */}
      {controlledAssetId == null && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[27px] font-semibold tracking-[-0.5px] leading-tight">Reserve accounts</h1>
            <p className="text-[13px] text-muted-foreground mt-[3px]">Bank reserve feed &amp; reconciliation against circulating supply</p>
          </div>
          <Select
            id="bm-asset"
            value={selectedAssetId}
            onChange={e => setSelectedAssetId(e.target.value)}
            className="w-auto text-[13px] rounded-full px-3 py-1.5 h-auto"
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        </div>
      )}

      {/* RESERVE COVERAGE - the headline link between bank reserves and the
          circulating/issued supply they back. */}
      {recon != null && (
        <div className={cn(
          'relative overflow-hidden rounded-lg border p-4',
          fullyBacked ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
        )}>
          {/* Subtle diagonal tint - green when backed, red when under-reserved */}
          <div aria-hidden className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', fullyBacked ? 'from-success/12' : 'from-destructive/12')} />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[1.2px] text-subtle-foreground">
                Reserve coverage
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={cn('tabular text-[30px] font-semibold leading-none', fullyBacked ? 'text-success' : 'text-warning')}>
                  {coveragePct != null ? `${coveragePct}%` : '-'}
                </span>
                <span className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  fullyBacked ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                )}>
                  {fullyBacked ? <ShieldCheck className="size-3" /> : <AlertTriangle className="size-3" />}
                  {fullyBacked ? 'Fully backed' : 'Under-reserved'}
                </span>
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                <span className="font-medium text-foreground">{formatAmount(recon.bankBalance, decimals)}</span> in bank reserves backing{' '}
                <span className="font-medium text-foreground">{formatAmount(recon.netSupply, decimals)}</span> in circulation.
              </p>
            </div>
          </div>
          {/* Coverage bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', fullyBacked ? 'bg-success' : 'bg-warning')}
              style={{ width: `${Math.min(100, coveragePct ?? 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Reserve accounts: a connected bank/custodian feed (automated) and
          manual mutations, as manila folder tabs. Both write to the same
          transfers list and reconciliation below. */}
      <div className="mt-[22px]">
        <div className="flex gap-1">
          {([['feed', 'Reserve feed'], ['manual', 'Manual mutations']] as const).map(([k, label]) => {
            const active = bankingTab === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => setBankingTab(k)}
                className={cn(
                  'relative -mb-px rounded-t-lg border border-b-0 px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active ? 'z-10 border-border bg-card text-foreground' : 'border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="rounded-lg rounded-tl-none border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          {bankingTab === 'feed' ? (
            <div className="space-y-3">
              {/* Provenance: relabelled when a bank/custodian is connected. */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                {reservesVia != null ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Plug className="size-3.5 text-success" />
                    Reserve balances via <span className="font-medium text-foreground">{reservesVia.providerName}</span>
                    <span className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">{reservesVia.environment}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Plug className="size-3.5" /> Sandbox reserve feed, no bank or custodian connected
                  </span>
                )}
                <button type="button" onClick={() => navigate('/issuer/integrations')} className="text-[11.5px] font-medium text-primary hover:underline">
                  {reservesVia != null ? 'Manage' : 'Connect a bank or custodian'}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
                  Deposits and withdrawals arrive automatically from your connected bank or custodian. Simulate an event to see it flow through reconciliation.
                </p>
                {/* Split button: main action + direction chooser */}
                <div className="inline-flex shrink-0">
                  <button
                    type="button"
                    onClick={() => simulateFeedTransfer(feedDirection)}
                    disabled={activeAssetId === '' || (feedDirection === 'out' && availableDisplay <= 0)}
                    title={feedDirection === 'out' && availableDisplay <= 0 ? 'No reserves available to withdraw' : undefined}
                    className="inline-flex items-center gap-2 whitespace-nowrap rounded-l-md bg-primary px-4 py-[11px] text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {feedDirection === 'in' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                    {feedDirection === 'in' ? 'Simulate incoming deposit' : 'Simulate outgoing withdrawal'}
                  </button>
                  <Popover open={feedMenuOpen} onOpenChange={setFeedMenuOpen}>
                    <PopoverTrigger
                      aria-label="Choose feed event type"
                      className="grid place-items-center rounded-r-md border-l border-primary-foreground/25 bg-primary px-2 text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <ChevronDown className="size-4" />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-1">
                      {([['in', 'Simulate incoming deposit', ArrowDownLeft], ['out', 'Simulate outgoing withdrawal', ArrowUpRight]] as const).map(([d, label, Icon]) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => { setFeedDirection(d); setFeedMenuOpen(false) }}
                          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1">{label}</span>
                          {feedDirection === d && <Check className="size-4 text-foreground" />}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                Manually record a reserve movement, for example a correction or a transfer that didn’t come through the feed.
              </p>
              {/* Direction - segmented control */}
              <div className="inline-flex rounded-lg border border-border p-0.5">
                {(['in', 'out'] as const).map(d => {
                  const active = direction === d
                  const Icon = d === 'in' ? ArrowDownLeft : ArrowUpRight
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDirection(d)}
                      className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      <Icon className="size-3.5 shrink-0" strokeWidth={2} /> {d === 'in' ? 'Incoming' : 'Outgoing'}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={transferAmount}
                  onChange={e => setTransferAmount(e.target.value)}
                  placeholder="Amount"
                  className="flex-1"
                  aria-label="Transfer amount"
                />
                <button
                  onClick={handleAddTransfer}
                  disabled={transferAmount.trim() === '' || activeAssetId === ''}
                  className="flex items-center gap-2 whitespace-nowrap rounded bg-primary text-primary-foreground px-4 py-[11px] text-[13px] font-semibold disabled:opacity-50"
                >
                  <PlusCircle size={16} />
                  Add transfer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TRANSFERS */}
      <div className="flex items-center justify-between mb-[10px] mt-[22px]">
        <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase">
          Transfers
        </p>
        {transfers.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-[5px] text-[12px] font-medium text-subtle-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <Trash2 size={13} />
            Clear all
          </button>
        )}
      </div>
      {transfers.length === 0 ? (
        <div className="bg-card border border-border rounded-md px-[18px] py-[26px] text-center text-[13px] text-muted-foreground">
          No transfers yet - add one above to see it flow through reconciliation.
        </div>
      ) : (
      <div className="bg-card border border-border rounded-md overflow-hidden">
        {transfers.map((t, idx) => {
          const dateStr = new Date(t.timestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
          const isOut = t.direction === 'out'
          const bank = bankForRef(t.id)
          return (
            <div
              key={t.id}
              className={`flex items-center gap-[14px] px-[18px] py-[15px]${idx > 0 ? ' border-t border-separator' : ''}`}
            >
              {/* Bank avatar with a direction badge - the institution the transfer
                  moved through, plus whether it was a deposit or withdrawal. */}
              <div className="relative flex-none" title={bank.name}>
                <CompanyAvatar name={bank.name} size={40} className="rounded-lg" />
                <span className={cn(
                  'absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full text-white ring-2 ring-card',
                  isOut ? 'bg-destructive' : 'bg-success'
                )}>
                  {isOut ? <ArrowUpRight size={11} strokeWidth={2.5} /> : <ArrowDownLeft size={11} strokeWidth={2.5} />}
                </span>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="truncate text-[14px] font-semibold">{t.originator}</div>
                <div className="mt-[3px] flex items-center gap-1 text-[11.5px] text-subtle-foreground">
                  <Landmark className="size-3 shrink-0" strokeWidth={2} style={{ color: bank.color }} />
                  <span className="truncate">{bank.name} · {bank.account} · {dateStr}</span>
                </div>
              </div>
              {/* Amount */}
              <span className={cn('text-[15px] font-semibold tabular-nums', isOut ? 'text-destructive' : 'text-success')}>
                {isOut ? '−' : '+'}{formatAmount(t.amount, decimals)}
              </span>
              {/* Link to ledger statements */}
              <BankReconcileButton assetId={activeAssetId} transferId={t.id} amount={t.amount} decimals={decimals} />
              {/* Delete */}
              <button
                onClick={() => handleRemoveTransfer(t.id)}
                aria-label={`Delete transfer ${t.id}`}
                className="flex-none text-subtle-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>
      )}

      {/* MINTING QUEUE - deposit-to-mint with maker-checker approval. A reserve
          deposit raises a request; a second approver settles it, issuing the
          matching units on-chain. */}
      {mintRequests.length > 0 && (() => {
        const ticker = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'
        return (
          <>
            <div className="mb-[10px] mt-[22px] flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase">
                Minting queue · maker-checker
              </p>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                pendingMintTotal > freeToMint ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
                {pendingMintTotal > freeToMint && <AlertTriangle className="size-3" />}
                Free reserves to mint: <span className="tabular font-semibold text-foreground">{formatAmount(freeToMint, decimals)} {ticker}</span>
              </span>
            </div>
            {pendingMintTotal > freeToMint && (
              <div className="mb-[10px] rounded-md bg-warning/[0.08] px-[13px] py-[9px] text-[11.5px] font-medium leading-[1.4] text-warning">
                Queued mints total {formatAmount(pendingMintTotal, decimals)} {ticker} but only {formatAmount(freeToMint, decimals)} {ticker} of reserves are free. Record more reserve deposits before approving the rest.
              </div>
            )}
            <div className="bg-card border border-border rounded-md overflow-hidden">
              {mintRequests.map((r, idx) => {
                const pending = r.status === 'pending'
                const settled = r.status === 'settled'
                const busy = approvingId === r.id
                const approvable = recon != null && r.amount <= recon.drift
                return (
                  <div key={r.id} className={cn('flex flex-wrap items-center gap-3 px-[18px] py-[14px]', idx > 0 && 'border-t border-separator')}>
                    <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', settled ? 'bg-success/10 text-success' : r.status === 'rejected' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
                      <CirclePlus className="size-4.5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="tabular text-[14px] font-semibold text-foreground">{formatAmount(r.amount, decimals)} {ticker}</span>
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                          settled ? 'bg-success/10 text-success' : r.status === 'rejected' ? 'bg-muted text-muted-foreground' : 'bg-warning/10 text-warning')}>
                          {settled ? 'Minted' : r.status === 'rejected' ? 'Rejected' : 'Awaiting approval'}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-subtle-foreground">
                        From {r.originator} · {r.reference}
                      </div>
                      <div className="mt-0.5 text-[11px] text-faint-foreground">
                        {settled ? `Approved by ${r.approvedBy}` : r.status === 'rejected' ? `Rejected by ${r.approvedBy}` : `Requested by ${r.requestedBy}`}
                      </div>
                    </div>
                    {pending ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {!approvable && (
                          <span className="hidden items-center gap-1 text-[11px] font-medium text-warning sm:inline-flex" title="This mint exceeds your free reserves. Record reserve deposits first.">
                            <AlertTriangle className="size-3" /> Needs reserves
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void approveMint(r)}
                          disabled={busy || asset == null || !approvable}
                          title={!approvable ? 'This mint exceeds your free reserves. Record reserve deposits first.' : undefined}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {busy ? <Spinner size="sm" tone="current" /> : <Signature className="size-3.5" />}
                          {busy ? 'Signing…' : 'Approve & sign'}
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectMintRequest(r.id, { approvedBy: approverName })}
                          disabled={busy}
                          aria-label="Reject mint request"
                          className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        {settled && r.txid != null && (
                          <a href={`https://whatsonchain.com/tx/${r.txid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                            <ExternalLink className="size-3.5" /> {r.txid.slice(0, 10)}…
                          </a>
                        )}
                        <button type="button" onClick={() => removeMintRequest(r.id)} aria-label="Dismiss" className="grid size-8 place-items-center rounded-md text-subtle-foreground transition-colors hover:bg-muted hover:text-destructive">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      })()}

      {/* RECONCILIATION */}
      {recon != null && (() => {
        const hasDrift = recon.drift !== 0
        return (
          <>
            <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase mb-[10px] mt-[22px]">
              Reconciliation
            </p>
            <div className="bg-card border border-border rounded-md px-[18px] pt-[6px] pb-[14px]">
              {/* Bank balance */}
              <div className="flex justify-between items-center border-b border-separator py-3">
                <span className="text-[13px] text-muted-foreground">Bank balance</span>
                <span className="text-[14px] font-semibold tabular-nums">{formatAmount(recon.bankBalance, decimals)}</span>
              </div>
              {/* Net supply */}
              <div className="flex justify-between items-center border-b border-separator py-3">
                <span className="text-[13px] text-muted-foreground">Net supply · issued − redeemed</span>
                <span className="text-[14px] font-semibold tabular-nums">{formatAmount(recon.netSupply, decimals)}</span>
              </div>
              {/* Variance (reconciling difference) */}
              <div className={`flex justify-between items-center ${hasDrift ? 'py-3' : 'pt-3'} ${hasDrift ? 'text-warning' : 'text-success'}`}>
                <span className="text-[13px] font-semibold">Variance · bank balance − net supply</span>
                <span className="text-[14px] font-semibold tabular-nums">
                  {recon.drift > 0 ? '+' : ''}{formatAmount(recon.drift, decimals)}
                </span>
              </div>
              {/* Amber callout - how to close the gap, with a link straight to
                  the Issuance & redemption tab where the action is taken. */}
              {hasDrift && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-warning/[0.08] px-[13px] py-[10px] text-[11.5px] leading-[1.4] text-warning">
                  <span className="min-w-0 flex-1 font-semibold">
                    {recon.drift > 0
                      ? 'Bank reserves exceed on-chain supply - issue tokens to match.'
                      : 'On-chain supply exceeds bank reserves - redeem tokens (or add deposits) to match.'}
                  </span>
                  <button
                    type="button"
                    onClick={goToIssuance}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/50 px-2.5 py-1 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Go to Issuance &amp; redemption <ArrowRight size={12} />
                  </button>
                </div>
              )}
              {/* Reconciled callout */}
              {!hasDrift && (
                <div className="text-success text-[11.5px] font-medium pt-1 pb-1">
                  Reconciled - 100%
                </div>
              )}
            </div>
          </>
        )
      })()}
    </div>
  )
}
