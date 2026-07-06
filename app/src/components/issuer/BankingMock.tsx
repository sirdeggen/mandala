import { useCallback, useMemo, useState } from 'react'
import { ArrowDownLeft, PlusCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '../ui/select'
import { Input } from '../ui/input'
import { AdminAsset } from '../../lib/mandala/assets'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminHistory } from '../../hooks/useAdminHistory'
import { useWallet } from '../../context/WalletContext'
import { reconcile, makeDeposit } from '../../lib/mandala/banking'
import { useMockDeposits, addMockDeposit, clearMockDeposits } from '../../lib/mandala/mockBankStore'
import { formatAmount, parseAmount } from '../../lib/mandala/amount'

interface BankingMockProps {
  /** Controlled mode: when set, use this assetId and hide the header asset selector. */
  assetId?: string
}

/**
 * Demo bank feed + reserve reconciliation. Deposits here are fake (persisted
 * in localStorage, clearable); issuance happens on the Operations page — this
 * page only shows how the bank balance reconciles against on-chain supply.
 */
export default function BankingMock({ assetId: controlledAssetId }: BankingMockProps = {}) {
  const { wallet } = useWallet()
  const { data: assetsData } = useAdminAssets()
  const assets: AdminAsset[] = assetsData ?? []
  const [selectedAssetId, setSelectedAssetId] = useState('')
  // Shared with the Overview reserve-ratio KPI (mockBankStore) so both reflect
  // the same feed; starts blank — nothing to reconcile until a deposit is added.
  const deposits = useMockDeposits()
  const [depositAmount, setDepositAmount] = useState('')

  // In controlled mode the active asset id comes from the prop
  const activeAssetId = controlledAssetId ?? selectedAssetId

  const asset = assets.find(a => a.assetId === activeAssetId) ?? null
  const decimals = Number(asset?.metadata?.decimals) || 0

  // Admin history from the shared query cache — reconciliation derives from it.
  const historyQuery = useAdminHistory(wallet != null ? activeAssetId : '')
  const history = historyQuery.data

  const recon = useMemo((): { bankBalance: number, netSupply: number, drift: number } | null => {
    if (history == null) return null
    let totalIssued = 0
    let totalRedeemed = 0
    for (const row of history) {
      if (row.actionDetails.kind === 'issue') totalIssued += (row.actionDetails.amount as number) ?? 0
      if (row.actionDetails.kind === 'redeem') totalRedeemed += (row.actionDetails.amount as number) ?? 0
    }
    return reconcile({
      deposits: deposits.map(d => d.amount),
      withdrawals: [],
      issued: totalIssued,
      redeemed: totalRedeemed
    })
  }, [history, deposits])

  // Add a demo incoming deposit — the counterparty is always a synthetic
  // "Company {letter}" (see makeDeposit); only the amount is admin-supplied.
  const handleAddDeposit = useCallback(() => {
    const amount = parseAmount(depositAmount, decimals)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid deposit amount')
      return
    }
    const dep = makeDeposit(amount)
    addMockDeposit(dep)
    setDepositAmount('')
    toast.success(`Added incoming deposit: ${dep.originator} · ${formatAmount(amount, decimals)}`)
  }, [depositAmount, decimals])

  const handleClearAll = useCallback(() => {
    clearMockDeposits()
    toast.success('Cleared all demo deposits')
  }, [])

  return (
    <div>
      {/* Page heading row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[27px] font-semibold tracking-[-0.5px] leading-tight">Banking</h1>
          <p className="text-[13px] text-muted-foreground mt-[3px]">Demo deposit feed &amp; reserve reconciliation — issuance lives on Operations</p>
        </div>
        {controlledAssetId == null && (
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
        )}
      </div>

      {/* ADD DEMO DEPOSIT — the counterparty is always a synthetic "Company
          {letter}"; only the amount is admin-supplied. This is a sandbox feed
          standing in for a real bank connection, so it starts empty rather
          than pre-seeded with fake history. */}
      <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase mb-[10px] mt-[22px]">
        Simulate an Incoming Deposit
      </p>
      <div className="bg-card border border-border rounded-[14px] px-[18px] py-[15px] flex items-center gap-3">
        <Input
          type="number"
          min="0"
          step="any"
          value={depositAmount}
          onChange={e => setDepositAmount(e.target.value)}
          placeholder="Amount"
          className="flex-1"
          aria-label="Deposit amount"
        />
        <button
          onClick={handleAddDeposit}
          disabled={depositAmount.trim() === '' || activeAssetId === ''}
          className="flex items-center gap-2 whitespace-nowrap rounded-[10px] bg-primary text-primary-foreground px-4 py-[11px] text-[13px] font-semibold disabled:opacity-50"
        >
          <PlusCircle size={16} />
          Add deposit
        </button>
      </div>

      {/* INCOMING DEPOSITS */}
      <div className="flex items-center justify-between mb-[10px] mt-[22px]">
        <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase">
          Incoming Deposits
        </p>
        {deposits.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center gap-[5px] text-[12px] font-medium text-subtle-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <Trash2 size={13} />
            Clear all
          </button>
        )}
      </div>
      {deposits.length === 0 ? (
        <div className="bg-card border border-border rounded-[14px] px-[18px] py-[26px] text-center text-[13px] text-muted-foreground">
          No incoming deposits yet — add one above to see it flow through reconciliation.
        </div>
      ) : (
      <div className="bg-card border border-border rounded-[14px] overflow-hidden">
        {deposits.map((dep, idx) => {
          const dateStr = new Date(dep.timestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
          return (
            <div
              key={dep.id}
              className={`flex items-center gap-[14px] px-[18px] py-[15px]${idx > 0 ? ' border-t border-separator' : ''}`}
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-[11px] bg-[rgba(35,64,94,.1)] text-primary grid place-items-center flex-none">
                <ArrowDownLeft size={18} />
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold">{dep.originator}</div>
                <div className="text-[11.5px] text-subtle-foreground mt-[3px]">
                  {dep.id} · {dep.currency} · {dateStr}
                </div>
              </div>
              {/* Amount */}
              <span className="text-[15px] font-semibold tabular-nums">
                {dep.currency}{formatAmount(dep.amount, decimals)}
              </span>
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
            <div className="bg-card border border-border rounded-[14px] px-[18px] pt-[6px] pb-[14px]">
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
              {/* Amber callout — how to close the gap */}
              {hasDrift && (
                <div className="bg-warning/[0.08] rounded-[10px] px-[13px] py-[10px] text-[11.5px] text-warning leading-[1.4]">
                  <span className="font-semibold">
                    {recon.drift > 0
                      ? 'Bank reserves exceed on-chain supply — issue tokens from the Operations page to match.'
                      : 'On-chain supply exceeds bank reserves — redeem tokens from the Operations page (or add deposits) to match.'}
                  </span>
                </div>
              )}
              {/* Reconciled callout */}
              {!hasDrift && (
                <div className="text-success text-[11.5px] font-medium pt-1 pb-1">
                  Reconciled — 100%
                </div>
              )}
            </div>
          </>
        )
      })()}
    </div>
  )
}
