import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AdminAsset } from '../../lib/mandala/assets'
import { resolveAssetState, AssetAdminStateView } from '../../lib/mandala/adminState'
import { resolveAdminHistory } from '../../lib/mandala/adminHistory'
import { reconcile, seedDeposits } from '../../lib/mandala/banking'
import { formatAmount } from '../../lib/mandala/amount'
import { cn } from '@/lib/utils'

interface Props {
  assets: AdminAsset[]
  onReload: () => void
}

interface AssetMetrics {
  asset: AdminAsset
  state: AssetAdminStateView | null
  netSupply: number
  drift: number
  decimals: number
  bankBalance: number
}

// ── Stat tile ──────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub: string
  valueColor?: string
}) {
  return (
    <div className="flex-1 rounded-[13px] border border-border bg-card px-4 py-[15px]">
      <div className="text-[11px] leading-none text-subtle-foreground">{label}</div>
      <div
        className={cn(
          'mt-[10px] text-[24px] font-semibold leading-none tracking-[-0.3px]',
          valueColor ?? 'text-foreground'
        )}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      <div className="mt-[6px] text-[10.5px] leading-none text-faint-foreground">{sub}</div>
    </div>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ paused }: { paused: boolean }) {
  return paused ? (
    <span className="inline-flex items-center rounded-[6px] bg-warning/14 px-[9px] py-1 text-[11px] font-medium text-warning">
      Paused
    </span>
  ) : (
    <span className="inline-flex items-center rounded-[6px] bg-success/12 px-[9px] py-1 text-[11px] font-medium text-success">
      Active
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OverviewSection({ assets, onReload }: Props) {
  const [rows, setRows] = useState<AssetMetrics[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (assets.length === 0) { setRows([]); return }
    setLoading(true)
    const deposits = seedDeposits()
    const bankDepositAmounts = deposits.map(d => d.amount)
    try {
      const metrics = await Promise.all(
        assets.map(async (asset): Promise<AssetMetrics> => {
          const decimals = Number(asset.metadata?.decimals) || 0
          const [state, history] = await Promise.all([
            resolveAssetState(asset.assetId),
            resolveAdminHistory(asset.assetId),
          ])
          let totalIssued = 0
          let totalRedeemed = 0
          for (const row of history) {
            if (row.actionDetails.kind === 'issue')
              totalIssued += (row.actionDetails.amount as number) ?? 0
            if (row.actionDetails.kind === 'redeem')
              totalRedeemed += (row.actionDetails.amount as number) ?? 0
          }
          const netSupply = totalIssued - totalRedeemed
          const recon = reconcile({
            deposits: bankDepositAmounts,
            withdrawals: [],
            issued: totalIssued,
            redeemed: totalRedeemed,
          })
          return { asset, state, netSupply, drift: recon.drift, decimals, bankBalance: recon.bankBalance }
        })
      )
      setRows(metrics)
    } finally {
      setLoading(false)
    }
  }, [assets])

  useEffect(() => { void load() }, [load])

  // ── Derived KPIs ─────────────────────────────────────────────────────────────

  const totalSupply = rows.reduce((s, r) => s + r.netSupply, 0)
  const totalDrift = rows.reduce((s, r) => s + r.drift, 0)
  const needsAttention = rows.filter(r => (r.state?.isPaused ?? false) || r.drift !== 0).length

  // Reserve ratio: sum per-asset bank balances from reconcile outputs
  const totalBankBal = rows.reduce((s, r) => s + r.bankBalance, 0)
  const reserveRatioPct =
    totalSupply === 0
      ? null
      : Math.min(100, (totalBankBal / totalSupply) * 100)

  const reserveValue =
    reserveRatioPct == null
      ? '—'
      : totalDrift !== 0
      ? 'Has drift'
      : `${reserveRatioPct.toFixed(1)}%`
  const reserveColor =
    reserveRatioPct == null || totalDrift === 0 ? undefined : 'text-warning'

  const hasAnyDrift = rows.some(r => r.drift !== 0)
  const allReserved = !hasAnyDrift && rows.length > 0

  return (
    <div>
      {/* ── Page title row ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-[27px] font-semibold leading-none tracking-[-0.5px]"
          >
            Overview
          </h1>
          <div className="mt-2 text-[13px] text-subtle-foreground">
            Live regulatory &amp; reserve state across {assets.length} asset{assets.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          {allReserved && (
            <span className="inline-flex items-center gap-[6px] rounded-full bg-success/10 px-3 py-2 text-[12px] font-medium text-success">
              <span className="h-[7px] w-[7px] rounded-full bg-success" />
              Reserves 100% backed
            </span>
          )}
          <button
            type="button"
            onClick={() => { onReload(); void load() }}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── KPI stat tiles ── */}
      <div className="mt-[22px] flex gap-[14px]">
        <StatTile
          label="In circulation"
          value={
            loading
              ? '…'
              : rows.length === 0
              ? '—'
              : formatAmount(totalSupply, 0)
          }
          sub="total base units across all assets"
        />
        <StatTile
          label="Net issued"
          value={
            loading
              ? '…'
              : rows.length === 0
              ? '—'
              : (totalSupply >= 0 ? '+' : '') + formatAmount(totalSupply, 0)
          }
          sub="all history · issued − redeemed"
          valueColor={totalSupply > 0 ? 'text-success' : undefined}
        />
        <StatTile
          label="Reserve ratio"
          value={loading ? '…' : reserveValue}
          sub="bank ↔ supply"
          valueColor={reserveColor}
        />
        <StatTile
          label="Needs attention"
          value={loading ? '…' : String(needsAttention)}
          sub={
            needsAttention === 0
              ? 'all clear'
              : `${rows.filter(r => r.state?.isPaused).length} paused · ${rows.filter(r => r.drift !== 0).length} drift`
          }
          valueColor={needsAttention > 0 ? 'text-warning' : undefined}
        />
      </div>

      {/* ── Assets table ── */}
      <div className="mt-5 overflow-hidden rounded-[14px] border border-border bg-card">
        {/* Table header */}
        <div
          className="grid items-center gap-3 border-b border-separator bg-muted px-[18px] py-[11px]"
          style={{ gridTemplateColumns: '1.6fr 1fr 0.9fr 0.9fr 1fr' }}
        >
          {['ASSET', 'SUPPLY', 'STATUS', 'ACCESS', 'RESERVE'].map((col, i) => (
            <div
              key={col}
              className={cn(
                'text-[10px] font-medium tracking-[1px] text-faint-foreground',
                i === 1 || i === 4 ? 'text-right' : ''
              )}
            >
              {col}
            </div>
          ))}
        </div>

        {/* Loading / empty */}
        {loading && rows.length === 0 && (
          <div className="px-[18px] py-5 text-[13px] text-muted-foreground animate-pulse">
            Loading assets…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-[18px] py-5 text-[13px] text-muted-foreground">
            No assets registered yet.
          </div>
        )}

        {/* Rows */}
        {rows.map(({ asset, state, netSupply, drift, decimals }) => {
          const isPaused = state?.isPaused ?? false
          const accessMode = state?.accessMode ?? '—'
          const hasDrift = drift !== 0

          // Build a 1-2 letter badge from label (e.g. "US Dollar" → "$" or first letter)
          const ticker = String(asset.metadata?.ticker ?? asset.label.slice(0, 2)).toUpperCase()
          const symbol = { USD: '$', EUR: '€', GBP: '£', CHF: 'Fr' }[ticker] ?? ticker.slice(0, 2)

          return (
            <div
              key={asset.assetId}
              className={cn(
                'grid items-center gap-3 border-t border-separator px-[18px] py-[13px]',
                isPaused ? 'bg-warning/[0.04]' : ''
              )}
              style={{ gridTemplateColumns: '1.6fr 1fr 0.9fr 0.9fr 1fr' }}
            >
              {/* ASSET */}
              <div className="flex items-center gap-[10px]">
                <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-accent font-bold text-[13px] text-accent-foreground">
                  {symbol}
                </div>
                <div>
                  <div className="text-[13px] font-semibold leading-[1.1]">{asset.label}</div>
                  <div className="mt-[2px] text-[10.5px] leading-[1.1] text-subtle-foreground">
                    {String(asset.metadata?.ticker ?? asset.assetId.slice(0, 8) + '…')}
                  </div>
                </div>
              </div>

              {/* SUPPLY */}
              <div
                className="text-right text-[13px] font-medium"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatAmount(netSupply, decimals)}
              </div>

              {/* STATUS */}
              <div>
                <StatusPill paused={isPaused} />
              </div>

              {/* ACCESS */}
              <div className="text-[12px] text-muted-foreground capitalize">
                {accessMode === '—' ? '—' : accessMode === 'allowlist' ? 'Allowlist' : 'Denylist'}
              </div>

              {/* RESERVE */}
              <div
                className={cn(
                  'text-right text-[12px] font-medium',
                  hasDrift ? 'text-warning' : 'text-success'
                )}
              >
                {hasDrift
                  ? `${drift > 0 ? '+' : ''}${formatAmount(drift, decimals)} drift`
                  : '100%'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
