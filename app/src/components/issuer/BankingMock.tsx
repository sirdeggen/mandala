import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, PlusCircle, Trash2, ShieldCheck, AlertTriangle, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Select } from '../ui/select'
import { Input } from '../ui/input'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useWallet } from '../../context/WalletContext'
import { reconcile, makeTransfer, TransferDirection } from '@bsv/mandala/banking'
import { useMockTransfers, addMockTransfer, removeMockTransfer, clearMockTransfers } from '../../lib/mandala/mockBankStore'
import { formatAmount, parseAmount } from '@bsv/mandala/amount'
import { bankForRef } from '@/content/banks'

interface BankingMockProps {
  /** Controlled mode: when set, use this assetId and hide the header asset selector. */
  assetId?: string
}

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
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [direction, setDirection] = useState<TransferDirection>('in')

  // In controlled mode the active asset id comes from the prop
  const activeAssetId = controlledAssetId ?? selectedAssetId

  // Shared with the Overview reserve-ratio KPI (mockBankStore) so both reflect
  // the same per-asset feed; starts blank - nothing to reconcile until a
  // transfer is added, and switching assets switches the whole feed.
  const transfers = useMockTransfers(activeAssetId)

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

  // Switch to the instrument's Issuance & redemption tab (id 'operations').
  const [, setSearchParams] = useSearchParams()
  const goToIssuance = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', 'operations')
      return next
    }, { replace: true })
  }, [setSearchParams])

  // Add a demo transfer - the counterparty is always a synthetic
  // "Company {letter}" (see makeTransfer); only amount + direction are admin-supplied.
  const handleAddTransfer = useCallback(() => {
    const amount = parseAmount(transferAmount, decimals)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid transfer amount')
      return
    }
    const t = makeTransfer(amount, direction, activeAssetId)
    addMockTransfer(t)
    setTransferAmount('')
    toast.success(`Added ${direction === 'in' ? 'incoming' : 'outgoing'} transfer: ${t.originator} · ${formatAmount(amount, decimals)}`)
  }, [transferAmount, decimals, direction, activeAssetId])

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
          'rounded-lg border p-4',
          fullyBacked ? 'border-success/30 bg-success/[0.06]' : 'border-warning/30 bg-warning/[0.06]'
        )}>
          <div className="flex items-start justify-between gap-3">
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

      {/* SIMULATE A TRANSFER - the counterparty is always a synthetic "Company
          {letter}"; only amount + direction are admin-supplied. This is a
          sandbox feed standing in for a real bank connection, so it starts
          empty rather than pre-seeded with fake history. */}
      <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase mb-[10px] mt-[22px]">
        Simulate a Bank Transfer
      </p>
      <div>
        {/* Direction - manila folder tabs */}
        <div className="flex gap-1">
          {(['in', 'out'] as const).map(d => {
            const active = direction === d
            const Icon = d === 'in' ? ArrowDownLeft : ArrowUpRight
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(
                  'relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'z-10 border-border bg-card text-foreground'
                    : 'border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} />
                {d === 'in' ? 'Incoming' : 'Outgoing'}
              </button>
            )
          })}
        </div>
        {/* Folder body */}
        <div className="flex items-center gap-3 rounded-lg rounded-tl-none border border-border bg-card p-4 shadow-[var(--shadow-card)]">
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
              {/* Bank logo with a direction badge - the institution the transfer
                  moved through, plus whether it was a deposit or withdrawal. */}
              <div className="relative flex-none">
                <div
                  className="grid size-10 place-items-center rounded-lg text-[13px] font-bold text-white shadow-sm"
                  style={{ backgroundColor: bank.color }}
                  title={bank.name}
                >
                  {bank.short}
                </div>
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
                <div className="mt-[3px] truncate text-[11.5px] text-subtle-foreground">
                  {bank.name} · {bank.account} · {dateStr}
                </div>
              </div>
              {/* Amount */}
              <span className={cn('text-[15px] font-semibold tabular-nums', isOut ? 'text-destructive' : 'text-success')}>
                {isOut ? '−' : '+'}{formatAmount(t.amount, decimals)}
              </span>
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
              {/* Drift */}
              <div className={`flex justify-between items-center ${hasDrift ? 'py-3' : 'pt-3'} ${hasDrift ? 'text-warning' : 'text-success'}`}>
                <span className="text-[13px] font-semibold">Drift</span>
                <span className="text-[14px] font-semibold tabular-nums">
                  {recon.drift > 0 ? '+' : ''}{formatAmount(recon.drift, decimals)}
                </span>
              </div>
              {/* Amber callout - how to close the gap, with a link straight to
                  the Issuance & redemption tab where the action is taken. */}
              {hasDrift && (
                <div className="bg-warning/[0.08] rounded px-[13px] py-[10px] text-[11.5px] text-warning leading-[1.4]">
                  <span className="font-semibold">
                    {recon.drift > 0
                      ? 'Bank reserves exceed on-chain supply - issue tokens to match.'
                      : 'On-chain supply exceeds bank reserves - redeem tokens (or add deposits) to match.'}
                  </span>
                  <button
                    type="button"
                    onClick={goToIssuance}
                    className="mt-1.5 inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
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
