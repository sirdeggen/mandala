import { useCallback, useEffect, useState } from 'react'
import { Coins, RefreshCw, Wallet } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { BASKET } from '../../lib/mandala/constants'
import { decodeBalances } from '../../lib/mandala/tokens'
import { resolveAssetMetadata } from '../../lib/mandala/metadata'
import { formatCurrency } from '../../lib/mandala/amount'
import { loadHistory } from '../../lib/mandala/history'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

interface AssetMeta {
  label: string
  decimals: number
  ticker?: string
}

interface AssetRow {
  assetId: string
  balance: number
  meta: AssetMeta
}

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

interface Props {
  onSelect: (assetId: string, balance: number) => void
}

export default function AccountsOverview({ onSelect }: Props) {
  const { wallet } = useWallet()
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      // Current live balances
      const res = await wallet.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 })
      const decoded = decodeBalances(res.outputs.map(o => ({ lockingScript: o.lockingScript as string })))
      const balanceMap = new Map<string, number>(decoded.map(b => [b.assetId, b.amount]))

      // Zero-balance-but-held assets from history
      const historyRows = await loadHistory(wallet as any)
      const allAssetIds = new Set<string>([...balanceMap.keys(), ...historyRows.map(r => r.assetId)])

      // Resolve metadata for each asset
      const rows: AssetRow[] = []
      for (const assetId of allAssetIds) {
        const meta = await resolveAssetMetadata(assetId)
        rows.push({
          assetId,
          balance: balanceMap.get(assetId) ?? 0,
          meta: {
            label: meta?.label ?? `${assetId.slice(0, 10)}…`,
            decimals: Number(meta?.decimals) || 0,
            ticker: typeof (meta as any)?.ticker === 'string' ? (meta as any).ticker : undefined
          }
        })
      }

      // Sort: non-zero balance first, then alpha by label
      rows.sort((a, b) => {
        if (a.balance > 0 && b.balance === 0) return -1
        if (a.balance === 0 && b.balance > 0) return 1
        return a.meta.label.localeCompare(b.meta.label)
      })

      setAssets(rows)
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Your accounts</h2>
          <p className="text-[13px] text-muted-foreground">
            {loading ? 'Refreshing…' : `${assets.length} ${assets.length === 1 ? 'asset' : 'assets'}`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {loading && assets.length === 0 && (
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

      {!loading && assets.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[--radius-lg] bg-card px-6 py-14 text-center shadow-[var(--shadow-card)]">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
            <Wallet className="h-7 w-7 text-subtle-foreground" />
          </div>
          <h3 className="text-[15px] font-semibold">No accounts yet</h3>
          <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
            Tokens you receive or are issued will appear here.
          </p>
        </div>
      )}

      {assets.map(a => (
        <button
          key={a.assetId}
          type="button"
          onClick={() => onSelect(a.assetId, a.balance)}
          className="flex w-full items-center gap-4 rounded-[--radius-lg] bg-card p-4 shadow-[var(--shadow-card)] transition-transform duration-150 ease-out hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full', tintFor(a.assetId))}>
            <Coins className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{a.meta.label}</p>
            <p className="tabular truncate text-[12px] text-subtle-foreground">{a.assetId}</p>
          </div>
          <div className="text-right">
            <p className="tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">
              {formatCurrency(a.balance, a.meta.decimals, a.meta.ticker)}
            </p>
            {a.balance === 0 && (
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">no balance</p>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
