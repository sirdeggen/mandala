import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AdminAsset } from '../../lib/mandala/assets'
import { resolveAssetState, AssetAdminStateView } from '../../lib/mandala/adminState'
import { resolveAdminHistory } from '../../lib/mandala/adminHistory'
import { reconcile, seedDeposits } from '../../lib/mandala/banking'
import { formatAmount } from '../../lib/mandala/amount'
import { cn } from '@/lib/utils'
import AuditLog from './AuditLog'

interface Props {
  assetId: string
  asset: AdminAsset | null
  onReload?: () => void
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

// ── Status / reserve pill ──────────────────────────────────────────────────────

function StatusPill({ state }: { state: AssetAdminStateView | null }) {
  if (state === null) {
    return (
      <span className="inline-flex items-center gap-[5px] rounded-full bg-muted px-[10px] py-[5px] text-[11.5px] font-medium text-muted-foreground">
        <span className="h-[6px] w-[6px] rounded-full bg-muted-foreground" />
        Unavailable
      </span>
    )
  }
  return state.isPaused ? (
    <span className="inline-flex items-center gap-[5px] rounded-full bg-warning/14 px-[10px] py-[5px] text-[11.5px] font-medium text-warning">
      <span className="h-[6px] w-[6px] rounded-full bg-warning" />
      Paused
    </span>
  ) : (
    <span className="inline-flex items-center gap-[5px] rounded-full bg-success/12 px-[10px] py-[5px] text-[11.5px] font-medium text-success">
      <span className="h-[6px] w-[6px] rounded-full bg-success" />
      Active
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OverviewSection({ assetId, asset, onReload }: Props) {
  const [state, setState] = useState<AssetAdminStateView | null>(null)
  const [inCirculation, setInCirculation] = useState(0)
  const [netIssued, setNetIssued] = useState(0)
  const [reserveRatioPct, setReserveRatioPct] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const decimals = Number(asset?.metadata?.decimals) || 0

  const load = useCallback(async () => {
    if (assetId === '') return
    setLoading(true)
    const deposits = seedDeposits()
    const bankDepositAmounts = deposits.map(d => d.amount)
    try {
      const [assetState, history] = await Promise.all([
        resolveAssetState(assetId),
        resolveAdminHistory(assetId),
      ])
      setState(assetState)

      let totalIssued = 0
      let totalRedeemed = 0
      for (const row of history) {
        if (row.actionDetails.kind === 'issue')
          totalIssued += (row.actionDetails.amount as number) ?? 0
        if (row.actionDetails.kind === 'redeem')
          totalRedeemed += (row.actionDetails.amount as number) ?? 0
      }
      const circulation = totalIssued - totalRedeemed
      setInCirculation(circulation)
      setNetIssued(circulation)

      const recon = reconcile({
        deposits: bankDepositAmounts,
        withdrawals: [],
        issued: totalIssued,
        redeemed: totalRedeemed,
      })
      const ratio =
        circulation === 0
          ? null
          : Math.min(100, (recon.bankBalance / circulation) * 100)
      setReserveRatioPct(ratio)
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => { void load() }, [load])

  // Restrictions tile: read from assetAdminState
  const blockedCount = state?.blockedIdentities.length ?? 0
  const frozenCount = state?.frozenOutpoints.length ?? 0

  // Reserve ratio display
  const reserveValue =
    reserveRatioPct == null
      ? '—'
      : `${reserveRatioPct.toFixed(1)}%`
  const reserveColor = reserveRatioPct != null && reserveRatioPct < 100 ? 'text-warning' : undefined

  const ticker = String(asset?.metadata?.ticker ?? asset?.label?.slice(0, 3) ?? '').toUpperCase()

  return (
    <div>
      {/* ── Page title row ── */}
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <h1 className="text-[27px] font-semibold leading-none tracking-[-0.5px]">Overview</h1>
          <div className="mt-2 text-[13px] text-subtle-foreground">
            {asset != null
              ? `${asset.label}${ticker ? ` (${ticker})` : ''} stablecoin · live state & admin history`
              : 'Live state & admin history'}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <StatusPill state={state} />
          <button
            type="button"
            onClick={() => { onReload?.(); void load() }}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── 4 KPI tiles ── */}
      <div className="flex gap-[14px]">
        <StatTile
          label="In circulation"
          value={loading ? '…' : assetId === '' ? '—' : formatAmount(inCirculation, decimals)}
          sub={ticker ? ticker : 'issued − redeemed'}
        />
        <StatTile
          label="Net issued"
          value={
            loading
              ? '…'
              : assetId === ''
              ? '—'
              : (netIssued >= 0 ? '+' : '') + formatAmount(netIssued, decimals)
          }
          sub="all history"
          valueColor={netIssued > 0 ? 'text-success' : undefined}
        />
        <StatTile
          label="Reserve ratio (demo)"
          value={loading ? '…' : reserveValue}
          sub="bank ↔ supply"
          valueColor={reserveColor}
        />
        <StatTile
          label="Restrictions"
          value={loading ? '…' : assetId === '' ? '—' : `${blockedCount} · ${frozenCount}`}
          sub={`blocked · frozen`}
          valueColor={(blockedCount > 0 || frozenCount > 0) ? 'text-warning' : undefined}
        />
      </div>

      {/* ── Audit log as the default dashboard ── */}
      <div className="mt-[28px]">
        <div className="mb-[14px]">
          <div className="text-[11px] font-medium tracking-[1.2px] text-subtle-foreground uppercase">
            Admin history
          </div>
        </div>
        <AuditLog assetId={assetId} />
      </div>
    </div>
  )
}
