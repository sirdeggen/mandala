import { useEffect, useState } from 'react'
import { LockingScript } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '../../lib/mandala/assets'
import { BASKET } from '../../lib/mandala/constants'
import { formatCurrency } from '../../lib/mandala/amount'
import SendTokens from '../SendTokens'
import ReceivePanel from '../holder/ReceivePanel'
import TransactionHistory from '../holder/TransactionHistory'
import { cn } from '@/lib/utils'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  assetId: string
  asset: AdminAsset | null
}

// ── TreasurySection ───────────────────────────────────────────────────────────

type Tab = 'send' | 'receive'

export default function TreasurySection({ assetId, asset }: Props) {
  const { wallet, identityKey } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('send')

  const ticker = asset?.metadata?.ticker != null ? String(asset.metadata.ticker) : undefined
  const decimals = asset?.metadata?.decimals != null ? Number(asset.metadata.decimals) : 0

  // ── Load the issuer's held balance for this asset ──────────────────────────

  useEffect(() => {
    if (wallet == null || !assetId) return
    let cancelled = false
    setLoading(true)
    wallet.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 })
      .then(res => {
        if (cancelled) return
        let total = 0
        for (const o of res.outputs) {
          try {
            const d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
            if (d.assetId === assetId) total += d.amount
          } catch { /* not a mandala FT */ }
        }
        setBalance(total)
      })
      .catch(e => { console.error('TreasurySection: balance load failed', e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [wallet, assetId])

  // ── Balance card ────────────────────────────────────────────────────────────

  const keyAbbr = identityKey != null
    ? `${identityKey.slice(0, 8)}…${identityKey.slice(-4)}`
    : '—'

  const formattedBalance = balance != null
    ? formatCurrency(balance, decimals, ticker)
    : '—'

  const isEmpty = balance === 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-[26px]">
      {/* Section header */}
      <div>
        <div className="text-[11px] font-medium tracking-[1.4px] uppercase text-faint-foreground mb-[3px]">
          Treasury
        </div>
        <div className="text-[22px] font-semibold leading-snug">
          {asset?.label ?? 'Asset'} Holdings
        </div>
      </div>

      {/* Balance card */}
      <div className="rounded-[16px] border border-separator bg-card px-[24px] py-[20px] shadow-[var(--shadow-card)]">
        <div className="text-[10.5px] font-medium tracking-[1.4px] uppercase text-faint-foreground mb-[10px]">
          Treasury balance
        </div>
        {loading ? (
          <div className="animate-pulse h-[44px] w-[180px] rounded-[8px] bg-muted" />
        ) : (
          <div
            className={cn(
              'tabular text-[42px] font-semibold leading-none tracking-[-1.5px]',
              isEmpty ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {formattedBalance}
          </div>
        )}
        <div className="mt-[10px] text-[12px] text-subtle-foreground">
          Held by this issuer
          {identityKey != null && (
            <> &middot; <span className="tabular font-mono">{keyAbbr}</span></>
          )}
        </div>
      </div>

      {/* Empty state hint */}
      {!loading && isEmpty && (
        <div className="rounded-[14px] border border-dashed border-separator bg-muted/50 px-[20px] py-[18px] text-center">
          <div className="text-[14px] font-medium text-muted-foreground">
            No units held — issue some in Operations.
          </div>
        </div>
      )}

      {/* Send / Receive toggle — always accessible even with zero balance (issuer might receive) */}
      <div>
        <div className="text-[10.5px] font-medium tracking-[1.4px] uppercase text-faint-foreground mb-[14px]">
          Actions
        </div>
        {/* Tab bar */}
        <div className="inline-flex rounded-[11px] border border-separator bg-muted p-[3px] gap-[3px] mb-[22px]">
          {(['send', 'receive'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex items-center gap-[7px] rounded-[9px] px-[14px] py-[7px] text-[13px] font-medium transition-colors duration-150',
                tab === t
                  ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_var(--separator)]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'send'
                ? <ArrowUpRight className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />
                : <ArrowDownLeft className="h-[15px] w-[15px] shrink-0" strokeWidth={2} />}
              {t === 'send' ? 'Send tokens' : 'Receive'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'send' && (
          <SendTokens lockedAssetId={assetId} />
        )}
        {tab === 'receive' && (
          <div className="rounded-[16px] border border-separator bg-card px-[24px] py-[20px] shadow-[var(--shadow-card)]">
            <ReceivePanel />
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <div className="text-[10.5px] font-medium tracking-[1.4px] uppercase text-faint-foreground mb-[14px]">
          Recent activity
        </div>
        <TransactionHistory assetId={assetId} decimals={decimals} ticker={ticker} />
      </div>
    </div>
  )
}
