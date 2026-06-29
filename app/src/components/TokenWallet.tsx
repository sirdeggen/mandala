import { useCallback, useEffect, useState } from 'react'
import { Coins, RefreshCw, Wallet } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import { BASKET } from '../lib/mandala/constants'
import { decodeBalances, TokenBalance } from '../lib/mandala/tokens'
import { listAdminAssets } from '../lib/mandala/assets'
import { resolveAssetMetadata } from '../lib/mandala/metadata'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

// Deterministic per-asset accent (coin glyph only — chrome stays neutral).
const COIN_TINTS = [
  'bg-primary/12 text-primary',
  'bg-success/15 text-success',
  'bg-warning/15 text-warning',
  'bg-destructive/12 text-destructive',
]
const tintFor = (id: string) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COIN_TINTS[h % COIN_TINTS.length]
}

export default function TokenWallet() {
  const { wallet } = useWallet()
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const labelFor = useCallback((assetId: string): string => {
    return labels[assetId] ?? `${assetId.slice(0, 10)}…`
  }, [labels])

  const refresh = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      const res = await wallet.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 })
      const decoded = decodeBalances(res.outputs.map(o => ({ lockingScript: o.lockingScript as string })))
      setBalances(decoded)
      // Labels come from the issuer's admin outputs (only present in the issuer's
      // own wallet); holders fall back to a resolver query then truncated assetId.
      const admin = await listAdminAssets(wallet as any)
      const labelMap: Record<string, string> = Object.fromEntries(admin.map(a => [a.assetId, a.label]))
      for (const b of decoded) {
        if (labelMap[b.assetId] == null) {
          const meta = await resolveAssetMetadata(b.assetId)
          if (meta != null) labelMap[b.assetId] = meta.label
        }
      }
      setLabels(labelMap)
    } finally { setLoading(false) }
  }, [wallet])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Your tokens</h2>
          <p className="text-[13px] text-muted-foreground">
            {loading ? 'Refreshing…' : `${balances.length} ${balances.length === 1 ? 'asset' : 'assets'}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {loading && balances.length === 0 && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-4 rounded-[--radius-lg] bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-28 animate-pulse rounded-full bg-muted" />
                <div className="h-2.5 w-40 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      )}

      {!loading && balances.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[--radius-lg] bg-card px-6 py-14 text-center shadow-[var(--shadow-card)]">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
            <Wallet className="h-7 w-7 text-subtle-foreground" />
          </div>
          <h3 className="text-[15px] font-semibold">No tokens yet</h3>
          <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
            Tokens you receive or are issued will appear here.
          </p>
        </div>
      )}

      {balances.map(b => (
        <div
          key={b.assetId}
          className="flex items-center gap-4 rounded-[--radius-lg] bg-card p-4 shadow-[var(--shadow-card)] transition-transform duration-150 ease-out hover:-translate-y-px"
        >
          <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', tintFor(b.assetId))}>
            <Coins className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{labelFor(b.assetId)}</p>
            <p className="tabular truncate text-[12px] text-subtle-foreground">{b.assetId}</p>
          </div>
          <div className="text-right">
            <p className="tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">
              {b.amount.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">units</p>
          </div>
        </div>
      ))}
    </div>
  )
}
