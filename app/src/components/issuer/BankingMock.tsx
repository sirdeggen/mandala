import { useCallback, useEffect, useState } from 'react'
import { Banknote, RefreshCw, CheckCircle2, ArrowDownLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Label } from '../ui/label'
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
              <Banknote className="h-[19px] w-[19px]" />
            </div>
            <div>
              <CardTitle>Banking</CardTitle>
              <CardDescription>Plaid-sandbox deposit feed + reconciliation</CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void computeReconciliation()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Asset selector */}
        <div>
          <Label htmlFor="bm-asset">Issue against asset</Label>
          <Select
            id="bm-asset"
            value={selectedAssetId}
            onChange={e => setSelectedAssetId(e.target.value)}
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        </div>

        {/* Deposit feed */}
        <section>
          <h3 className="mb-2 text-[14px] font-semibold">Incoming deposits</h3>
          <div className="space-y-2">
            {deposits.map(dep => {
              const issued = alreadyIssued(dep.id)
              return (
                <div
                  key={dep.id}
                  className="flex items-center justify-between rounded-[--radius-md] border border-separator bg-muted/40 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-accent/70 text-accent-foreground">
                      <ArrowDownLeft className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-[14px] font-medium">{dep.originator}</div>
                      <div className="tabular text-[12px] text-muted-foreground">
                        {dep.id} · {new Date(dep.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-[15px] font-semibold">
                      {formatAmount(dep.amount, decimals)} {dep.currency}
                    </span>
                    {issued ? (
                      <div className="flex items-center gap-1 text-[12px] text-success">
                        <CheckCircle2 className="h-4 w-4" /> Issued
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleReceiveDeposit(dep)}
                        disabled={busy || selectedAssetId === ''}
                      >
                        Receive
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Reconciliation */}
        {recon != null && (
          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Reconciliation</h3>
            <div className="rounded-[--radius-md] border border-separator bg-muted/40 px-4 py-3 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bank balance</span>
                <span className="tabular font-semibold">{formatAmount(recon.bankBalance, decimals)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net supply (issued − redeemed)</span>
                <span className="tabular font-semibold">{formatAmount(recon.netSupply, decimals)}</span>
              </div>
              <div className={`flex justify-between font-semibold ${recon.drift !== 0 ? 'text-destructive' : 'text-success'}`}>
                <span>Drift</span>
                <span className="tabular">{recon.drift > 0 ? '+' : ''}{formatAmount(recon.drift, decimals)}</span>
              </div>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
