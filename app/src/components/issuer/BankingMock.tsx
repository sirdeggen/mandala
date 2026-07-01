import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ArrowDownLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Select } from '../ui/select'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset, listAdminAssets, submitAdminAction } from '../../lib/mandala/assets'
import { resolveAdminHistory } from '../../lib/mandala/adminHistory'
import { seedDeposits, reconcile, MockDeposit } from '../../lib/mandala/banking'
import { formatAmount } from '../../lib/mandala/amount'

interface IssuedDeposit {
  depositId: string
  amount: number
  issuedAt: number
}

export default function BankingMock() {
  const { wallet, messageBoxClient, identityKey } = useWallet()
  const [assets, setAssets] = useState<AdminAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [deposits] = useState<MockDeposit[]>(() => seedDeposits())
  const [receivedDeposits, setReceivedDeposits] = useState<IssuedDeposit[]>([])
  const [recon, setRecon] = useState<{ bankBalance: number, netSupply: number, drift: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const asset = assets.find(a => a.assetId === selectedAssetId) ?? null
  const decimals = Number(asset?.metadata?.decimals) || 0

  const loadAssets = useCallback(async () => {
    if (wallet == null) return
    const list = await listAdminAssets(wallet as any)
    setAssets(list)
  }, [wallet])

  useEffect(() => { void loadAssets() }, [loadAssets])

  const computeReconciliation = useCallback(async () => {
    if (wallet == null || selectedAssetId === '') { setRecon(null); return }
    try {
      // Sum amounts from received deposits (proxy for on-chain issue via bank)
      const bankDepositAmounts = deposits.map(d => d.amount)
      const bankWithdrawAmounts: number[] = []

      // Sum issued and redeemed from admin history
      const history = await resolveAdminHistory(selectedAssetId)
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
  }, [wallet, selectedAssetId, deposits])

  useEffect(() => { void computeReconciliation() }, [computeReconciliation])

  // "Receive deposit" — issue tokens against a bank deposit
  const handleReceiveDeposit = useCallback(async (deposit: MockDeposit) => {
    if (wallet == null || identityKey == null || asset == null) {
      toast.error('Select an asset first')
      return
    }
    setBusy(true)
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
      setBusy(false)
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

      {/* INCOMING DEPOSITS */}
      <p className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase mb-[10px] mt-[22px]">
        Incoming Deposits
      </p>
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
                  className="bg-primary text-primary-foreground rounded-[10px] px-4 py-[10px] text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-50"
                  onClick={() => void handleReceiveDeposit(dep)}
                  disabled={busy || selectedAssetId === ''}
                >
                  Receive &amp; issue
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* RECONCILIATION */}
      {recon != null && (
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
            <div className={`flex justify-between items-center py-3 ${recon.drift !== 0 ? 'text-[#B4703A]' : 'text-success'}`}>
              <span className="text-[13px]">Drift</span>
              <span className="text-[14px] font-semibold tabular-nums">
                {recon.drift > 0 ? '+' : ''}{formatAmount(recon.drift, decimals)}
              </span>
            </div>
            {/* Amber callout */}
            {recon.drift !== 0 && (
              <div className="bg-[rgba(180,112,58,.08)] rounded-[10px] px-[13px] py-[10px] text-[11.5px] text-[#8A6A3B] leading-[1.4]">
                Drift = {formatAmount(Math.abs(recon.drift), decimals)} received but not yet issued. Issue deposits to bring reserves and supply back in line.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
