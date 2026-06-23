import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../context/WalletContext'
import { BASKET } from '../lib/mandala/constants'
import { decodeBalances, TokenBalance } from '../lib/mandala/tokens'
import { listAssets } from '../lib/mandala/assetStore'
import { Button } from './ui/button'
import { Card } from './ui/card'

export default function TokenWallet() {
  const { wallet, identityKey } = useWallet()
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)

  const labelFor = useCallback((assetId: string): string => {
    if (identityKey == null) return assetId
    return listAssets(identityKey).find(a => a.assetId === assetId)?.label ?? `${assetId.slice(0, 10)}…`
  }, [identityKey])

  const refresh = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      const res = await wallet.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 })
      setBalances(decodeBalances(res.outputs.map(o => ({ lockingScript: o.lockingScript as string }))))
    } finally { setLoading(false) }
  }, [wallet])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Your tokens</h2>
        <Button onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {balances.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
      {balances.map(b => (
        <Card key={b.assetId} className="p-4 flex justify-between">
          <span className="font-medium">{labelFor(b.assetId)}</span>
          <span>{b.amount}</span>
        </Card>
      ))}
    </div>
  )
}
