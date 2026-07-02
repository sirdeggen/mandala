import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ArrowDownLeft, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '../ui/select'
import { Input } from '../ui/input'
import { Spinner } from '../ui/spinner'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset, listAdminAssets, submitAdminAction } from '../../lib/mandala/assets'
import { resolveAdminHistory } from '../../lib/mandala/adminHistory'
import { reconcile, unissuedSum, makeDeposit, MockDeposit } from '../../lib/mandala/banking'
import { useMockDeposits, addMockDeposit } from '../../lib/mandala/mockBankStore'
import { formatAmount, parseAmount } from '../../lib/mandala/amount'

interface IssuedDeposit {
  depositId: string
  amount: number
  issuedAt: number
}

interface BankingMockProps {
  /** Controlled mode: when set, use this assetId and hide the header asset selector. */
  assetId?: string
}

export default function BankingMock({ assetId: controlledAssetId }: BankingMockProps = {}) {
  const { wallet, messageBoxClient, identityKey } = useWallet()
  const [assets, setAssets] = useState<AdminAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')
  // Shared with the Overview reserve-ratio KPI (mockBankStore) so both reflect
  // the same feed; starts blank — nothing to reconcile until a deposit is added.
  const deposits = useMockDeposits()
  const [depositAmount, setDepositAmount] = useState('')
  const [receivedDeposits, setReceivedDeposits] = useState<IssuedDeposit[]>([])
  const [recon, setRecon] = useState<{ bankBalance: number, netSupply: number, drift: number } | null>(null)
  // Tracks WHICH deposit's issue is in flight, so only that row's button shows
  // its spinner while every other "Receive & issue" button is just disabled.
  const [busyDepositId, setBusyDepositId] = useState<string | null>(null)
  const busy = busyDepositId !== null

  // In controlled mode the active asset id comes from the prop
  const activeAssetId = controlledAssetId ?? selectedAssetId

  const asset = assets.find(a => a.assetId === activeAssetId) ?? null
  const decimals = Number(asset?.metadata?.decimals) || 0

  const loadAssets = useCallback(async () => {
    if (wallet == null) return
    const list = await listAdminAssets(wallet as any)
    setAssets(list)
  }, [wallet])

  useEffect(() => { void loadAssets() }, [loadAssets])

  const computeReconciliation = useCallback(async () => {
    if (wallet == null || activeAssetId === '') { setRecon(null); return }
    try {
      // Sum amounts from received deposits (proxy for on-chain issue via bank)
      const bankDepositAmounts = deposits.map(d => d.amount)
      const bankWithdrawAmounts: number[] = []

      // Sum issued and redeemed from admin history
      const history = await resolveAdminHistory(activeAssetId)
      let totalIssued = 0
      let totalRedeemed = 0
      for (const row of history) {
        if (row.actionDetails.kind === 'issue') totalIssued += (row.actionDetails.amount as number) ?? 0
        if (row.actionDetails.kind === 'redeem') totalRedeemed += (row.actionDetails.amount as number) ?? 0
      }

      const result = reconcile({
        deposits: bankDepositAmounts,
        withdrawals: bankWithdrawAmounts,
        issued: totalIssued,
        redeemed: totalRedeemed
      })
      setRecon(result)
    } catch {
      setRecon(null)
    }
  }, [wallet, activeAssetId, deposits])

  useEffect(() => { void computeReconciliation() }, [computeReconciliation])

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

  // "Receive deposit" — issue tokens against a bank deposit
  const handleReceiveDeposit = useCallback(async (deposit: MockDeposit) => {
    if (wallet == null || identityKey == null || asset == null) {
      toast.error('Select an asset first')
      return
    }
    setBusyDepositId(deposit.id)
    try {
      await submitAdminAction({
        wallet: wallet as any,
        asset,
        details: {
          kind: 'issue',
          assetId: asset.assetId,
          amount: deposit.amount,
          priorOutpoint: asset.authOutpoint
        },
        ftOutput: { recipient: identityKey, amount: deposit.amount },
        identityKey,
        messageBoxClient: messageBoxClient ?? undefined
      })
      setReceivedDeposits(prev => [
        ...prev,
        { depositId: deposit.id, amount: deposit.amount, issuedAt: Date.now() }
      ])
      toast.success(`Issued ${formatAmount(deposit.amount, decimals)} ${asset.label} for deposit ${deposit.id}`)
      await computeReconciliation()
      await loadAssets()
    } catch (e) {
      toast.error(`Issue failed: ${String(e)}`)
    } finally {
      setBusyDepositId(null)
    }
  }, [wallet, identityKey, asset, decimals, messageBoxClient, computeReconciliation, loadAssets])

  const alreadyIssued = (depositId: string) => receivedDeposits.some(r => r.depositId === depositId)

  return (
    <div>
      {/* Page heading row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[27px] font-semibold tracking-[-0.5px] leading-tight">Banking</h1>
          <p className="text-[13px] text-muted-foreground mt-[3px]">Plaid-sandbox deposit feed &amp; reserve reconciliation</p>
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
      <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase mb-[10px] mt-[22px]">
        Incoming Deposits
      </p>
      {deposits.length === 0 ? (
        <div className="bg-card border border-border rounded-[14px] px-[18px] py-[26px] text-center text-[13px] text-muted-foreground">
          No incoming deposits yet — add one above to see it flow through reconciliation.
        </div>
      ) : (
      <div className="bg-card border border-border rounded-[14px] overflow-hidden">
        {deposits.map((dep, idx) => {
          const issued = alreadyIssued(dep.id)
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
              {/* Action */}
              {issued ? (
                <div className="flex items-center gap-1 text-[12px] text-success">
                  <CheckCircle2 size={14} /> Issued
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 bg-primary text-primary-foreground rounded-[10px] px-4 py-[10px] text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-50"
                  onClick={() => void handleReceiveDeposit(dep)}
                  disabled={busy || activeAssetId === ''}
                >
                  {busyDepositId === dep.id && <Spinner size="sm" tone="current" />}
                  {busyDepositId === dep.id ? 'Issuing…' : 'Receive & issue'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* RECONCILIATION */}
      {recon != null && (() => {
        const issuedIdSet = new Set(receivedDeposits.map(r => r.depositId))
        const pendingDeposits = deposits.filter(d => !issuedIdSet.has(d.id))
        const pendingSum = unissuedSum(deposits, issuedIdSet)
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
              {/* Amber callout — ties drift to unissued deposits */}
              {hasDrift && (
                <div className="bg-warning/[0.08] rounded-[10px] px-[13px] py-[10px] text-[11.5px] text-warning leading-[1.4]">
                  <div className="font-semibold mb-[6px]">
                    Drift {recon.drift > 0 ? '+' : ''}{formatAmount(Math.abs(recon.drift), decimals)} = {pendingDeposits.length} unissued deposit{pendingDeposits.length !== 1 ? 's' : ''} ({formatAmount(pendingSum, decimals)} awaiting issuance)
                  </div>
                  {pendingDeposits.length > 0 && (
                    <div className="flex flex-col gap-[5px] mt-[4px]">
                      {pendingDeposits.map(dep => (
                        <div key={dep.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="opacity-80">{dep.originator}</span>
                          <span className="opacity-60 font-mono">{dep.id}</span>
                          <span className="font-semibold tabular-nums">{dep.currency}{formatAmount(dep.amount, decimals)}</span>
                          <span className="opacity-60 italic">awaiting issuance</span>
                        </div>
                      ))}
                    </div>
                  )}
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
