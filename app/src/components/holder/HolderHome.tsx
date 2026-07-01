/**
 * HolderHome — Meridian accounts-first neobank layout.
 *
 * Sections (top → bottom):
 *   1. Brand row  — BrandMark + notification bell + avatar chip
 *   2. Hero       — greeting, labelled balance, 7-day trend pill (real data or omitted)
 *   3. Quick actions — Send | Request | Receive (wired to real tabs via onAction)
 *   4. ACCOUNTS list — per-asset rows with coloured badge, name, tabular balance
 *   5. RECENT activity — last 4 history rows, direction-coloured amount
 *
 * Hero total: shows the primary (largest non-zero) account's balance.
 * If holder has no assets, shows "—" with no trend pill.
 * Trend pill: net (received − sent) over the last 7 days for the primary asset;
 * omitted if not derivable.
 *
 * All data is real wallet data (no mocks).
 */

import { useCallback, useEffect, useState } from 'react'
import { Bell, Send, Download, Plus, RefreshCw } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { BASKET } from '../../lib/mandala/constants'
import { decodeBalances } from '../../lib/mandala/tokens'
import { resolveAssetMetadata } from '../../lib/mandala/metadata'
import { formatCurrency, currencySymbol, formatAmount } from '../../lib/mandala/amount'
import { loadHistory, HistoryRow } from '../../lib/mandala/history'
import { BrandMark } from '../ui/BrandMark'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Currency badge colour map (matches comp: USD=brass, EUR=navy-tint, GBP=lavender,
// CHF=sage; all others use a neutral brass chip)
// ---------------------------------------------------------------------------

const CURRENCY_BADGE: Record<string, { bg: string; text: string; symbol: string }> = {
  USD:  { bg: 'bg-accent',      text: 'text-accent-foreground', symbol: '$'   },
  EUR:  { bg: 'bg-navy-tint',   text: 'text-primary',           symbol: '€'   },
  GBP:  { bg: 'bg-[#E3DCEA]',   text: 'text-[#5B4B7A]',         symbol: '£'   },
  CHF:  { bg: 'bg-[#E1E7DE]',   text: 'text-[#4B6B4E]',         symbol: 'Fr'  },
}

function badgeFor(ticker?: string): { bg: string; text: string; symbol: string } {
  if (ticker) {
    const upper = ticker.toUpperCase()
    if (CURRENCY_BADGE[upper]) return CURRENCY_BADGE[upper]
  }
  // Fallback: neutral brass chip with first letter of ticker or '?'
  return {
    bg: 'bg-accent',
    text: 'text-accent-foreground',
    symbol: ticker ? ticker.slice(0, 2).toUpperCase() : '?',
  }
}

// ---------------------------------------------------------------------------
// Relative time helper (no external dep)
// ---------------------------------------------------------------------------

function relativeTime(when: number): string {
  if (when === 0) return ''
  const diff = Date.now() - when
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Counterparty display
// ---------------------------------------------------------------------------

function shortCounterparty(cp: string): string {
  if (!cp) return 'Unknown'
  if (cp.length <= 14) return cp
  return `${cp.slice(0, 6)}…${cp.slice(-4)}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TrendPill({ amount, ticker, decimals }: { amount: number; ticker?: string; decimals: number }) {
  const positive = amount >= 0
  const symbol = currencySymbol(ticker)
  const formatted = `${positive ? '+' : '−'}${symbol}${formatAmount(Math.abs(amount), decimals)}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[4px] rounded-full px-[9px] py-[5px]',
        'text-[12px] font-medium leading-none',
        positive
          ? 'bg-success/10 text-success'
          : 'bg-destructive/10 text-destructive'
      )}
    >
      {/* Up/down chevron */}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {positive
          ? <path d="M6 15l6-6 6 6" />
          : <path d="M6 9l6 6 6-6" />}
      </svg>
      {formatted} this week
    </span>
  )
}

function QuickActionButton({
  icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  primary?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-[7px] rounded-[14px] py-[13px]',
        'text-[11.5px] font-medium leading-none transition-transform duration-150 ease-out active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        primary
          ? 'bg-primary text-primary-foreground'
          : 'border border-border bg-card text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function AccountRow({
  asset,
  onClick,
}: {
  asset: AssetRow
  onClick: () => void
}) {
  const badge = badgeFor(asset.meta.ticker)
  const symbol = asset.meta.ticker ? currencySymbol(asset.meta.ticker) : ''
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[13px] border-t border-separator py-[11px] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Currency badge */}
      <div
        className={cn(
          'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]',
          'text-[15px] font-bold leading-none',
          badge.bg,
          badge.text,
        )}
        aria-hidden="true"
      >
        {badge.symbol}
      </div>

      {/* Name + sub-label */}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[14px] font-semibold leading-[1.2]">
          {asset.meta.label}
        </div>
        {asset.meta.ticker && (
          <div className="mt-[2px] truncate text-[11.5px] leading-[1.2] text-subtle-foreground">
            {asset.meta.ticker.toUpperCase()} account
          </div>
        )}
      </div>

      {/* Tabular balance */}
      <div
        className={cn(
          'tabular text-[15px] font-medium leading-[1.2]',
          asset.balance === 0 && 'text-subtle-foreground'
        )}
      >
        {asset.balance === 0
          ? `${symbol}0`
          : formatCurrency(asset.balance, asset.meta.decimals, asset.meta.ticker)}
      </div>
    </button>
  )
}

function RecentRow({ row, decimals, ticker }: { row: HistoryRow; decimals: number; ticker?: string }) {
  const isCredit = row.direction === 'received' || row.direction === 'issued'
  const symbol = currencySymbol(ticker)
  const formatted = `${isCredit ? '+' : '−'}${symbol}${formatAmount(row.amount, decimals)}`
  const cp = shortCounterparty(row.counterparty)
  const initials = cp.slice(0, 2).toUpperCase()
  const when = relativeTime(row.when)

  return (
    <div className="flex items-center gap-[12px] border-t border-separator py-[9px]">
      {/* Avatar circle */}
      <div
        className={cn(
          'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full',
          'text-[11px] font-semibold leading-none',
          isCredit ? 'bg-success/12 text-success' : 'bg-foreground/6 text-subtle-foreground'
        )}
        aria-hidden="true"
      >
        {isCredit ? (
          /* Up arrow */
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        ) : (
          initials
        )}
      </div>

      {/* Name + timestamp */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-[1.2]">{cp}</div>
        {when && (
          <div className="mt-[2px] text-[11px] leading-[1.2] text-subtle-foreground">{when}</div>
        )}
      </div>

      {/* Amount */}
      <div
        className={cn(
          'tabular text-[13.5px] font-medium leading-[1.2]',
          isCredit ? 'text-success' : 'text-foreground'
        )}
      >
        {formatted}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type HolderAction = 'send' | 'receive' | 'request'

interface Props {
  onSelect: (assetId: string, balance: number) => void
  onAction?: (action: HolderAction) => void
  identityKey?: string | null
}

export default function HolderHome({ onSelect, onAction, identityKey }: Props) {
  const { wallet } = useWallet()
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [trendAmount, setTrendAmount] = useState<number | null>(null)

  // Derive greeting from local time
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // Avatar initials from identity key
  const initials = identityKey ? identityKey.slice(2, 4).toUpperCase() : '?'

  const refresh = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      // 1. Live balances
      const res = await wallet.listOutputs({
        basket: BASKET,
        include: 'locking scripts',
        limit: 1000,
      })
      const decoded = decodeBalances(
        res.outputs.map(o => ({ lockingScript: o.lockingScript as string }))
      )
      const balanceMap = new Map<string, number>(decoded.map(b => [b.assetId, b.amount]))

      // 2. History (for zero-balance assets + recent activity + trend)
      const historyRows = await loadHistory(wallet as any)
      const allAssetIds = new Set<string>([
        ...balanceMap.keys(),
        ...historyRows.map(r => r.assetId),
      ])

      // 3. Resolve metadata
      const rows: AssetRow[] = []
      for (const assetId of allAssetIds) {
        const meta = await resolveAssetMetadata(assetId)
        rows.push({
          assetId,
          balance: balanceMap.get(assetId) ?? 0,
          meta: {
            label: meta?.label ?? `${assetId.slice(0, 10)}…`,
            decimals: Number(meta?.decimals) || 0,
            ticker:
              typeof (meta as any)?.ticker === 'string'
                ? (meta as any).ticker
                : undefined,
          },
        })
      }

      // Sort: non-zero balance first, then alphabetically by label
      rows.sort((a, b) => {
        if (a.balance > 0 && b.balance === 0) return -1
        if (a.balance === 0 && b.balance > 0) return 1
        return a.meta.label.localeCompare(b.meta.label)
      })

      setAssets(rows)
      setHistory(historyRows)

      // 4. Trend: compute net (received − sent) for primary asset over last 7 days.
      // The SDK doesn't expose wall-clock timestamps (when === 0), so we can only
      // compute an all-time net until timestamps are available. We omit the pill
      // when when===0 to avoid fabricating data.
      const primary = rows[0]
      if (primary) {
        const assetHistory = historyRows.filter(r => r.assetId === primary.assetId)
        const hasTimestamps = assetHistory.some(r => r.when > 0)
        if (hasTimestamps) {
          const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
          const weekRows = assetHistory.filter(r => r.when >= weekAgo)
          const net = weekRows.reduce((acc, r) => {
            const isCredit = r.direction === 'received' || r.direction === 'issued'
            return acc + (isCredit ? r.amount : -r.amount)
          }, 0)
          setTrendAmount(net)
        } else {
          // No timestamps available — omit pill
          setTrendAmount(null)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Primary asset: first non-zero balance row (or first row if all zero)
  const primaryAsset = assets.find(a => a.balance > 0) ?? assets[0] ?? null

  // Recent: last 4 history rows (most recent first — history comes out oldest first
  // when all when===0, so we just take the last slice)
  const recentRows = history.slice(-4).reverse()

  // Meta lookup for recent rows
  const metaFor = (assetId: string): AssetMeta => {
    const found = assets.find(a => a.assetId === assetId)
    return found?.meta ?? { label: `${assetId.slice(0, 10)}…`, decimals: 0 }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col">
      {/* ── Brand row ── */}
      <div className="flex items-center justify-between px-[22px] pt-[8px]">
        <BrandMark wordmark size="sm" />

        <div className="flex items-center gap-[9px]">
          {/* Bell */}
          <button
            type="button"
            aria-label="Notifications"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-[19px] w-[19px]" strokeWidth={1.7} />
          </button>

          {/* Avatar chip */}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground"
            aria-label="Account"
          >
            {initials}
          </div>
        </div>
      </div>

      {/* ── Hero ── */}
      <div className="px-[26px] pt-[20px]">
        {/* Greeting */}
        <p className="text-[13px] font-normal leading-none text-muted-foreground">
          {greeting}
        </p>

        {/* Tracked label */}
        <p className="mt-[16px] text-[11px] font-medium uppercase leading-none tracking-[1.4px] text-faint-foreground">
          {primaryAsset ? primaryAsset.meta.label : 'Balance'}
        </p>

        {/* Big balance number */}
        {loading && assets.length === 0 ? (
          <div className="mt-[7px] h-12 w-44 animate-pulse rounded-full bg-muted" />
        ) : primaryAsset ? (
          (() => {
            // Split into whole + fractional for muted-cents rendering
            const sym = currencySymbol(primaryAsset.meta.ticker)
            const full = formatAmount(primaryAsset.balance, primaryAsset.meta.decimals)
            const dotIdx = full.indexOf('.')
            const whole = dotIdx >= 0 ? full.slice(0, dotIdx) : full
            const frac = dotIdx >= 0 ? full.slice(dotIdx) : ''
            return (
              <div className="mt-[7px] flex items-baseline gap-[2px]">
                <span className="tabular text-[47px] font-semibold leading-[0.95] tracking-[-1.5px]">
                  {sym}{whole}
                </span>
                {frac && (
                  <span className="tabular text-[24px] font-semibold leading-none tracking-[-0.3px] text-subtle-foreground">
                    {frac}
                  </span>
                )}
              </div>
            )
          })()
        ) : (
          <div className="mt-[7px] flex items-baseline">
            <span className="text-[47px] font-semibold leading-[0.95] tracking-[-1.5px] text-subtle-foreground">—</span>
          </div>
        )}

        {/* Trend pill + account count */}
        <div className="mt-[14px] flex items-center gap-[9px]">
          {trendAmount !== null && primaryAsset && (
            <TrendPill
              amount={trendAmount}
              ticker={primaryAsset.meta.ticker}
              decimals={primaryAsset.meta.decimals}
            />
          )}
          {assets.length > 1 && (
            <span className="text-[12px] leading-none text-subtle-foreground">
              across {assets.length} accounts
            </span>
          )}
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="flex gap-[9px] px-[24px] pt-[22px]">
        <QuickActionButton
          primary
          onClick={() => onAction?.('send')}
          label="Send"
          icon={
            <Send className="h-[18px] w-[18px]" strokeWidth={1.9} />
          }
        />
        <QuickActionButton
          onClick={() => onAction?.('request')}
          label="Request"
          icon={
            <Plus className="h-[18px] w-[18px]" strokeWidth={1.9} />
          }
        />
        <QuickActionButton
          onClick={() => onAction?.('receive')}
          label="Receive"
          icon={
            <Download className="h-[18px] w-[18px]" strokeWidth={1.9} />
          }
        />
      </div>

      {/* ── Accounts ── */}
      <div className="px-[26px] pt-[24px]">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase leading-none tracking-[1.2px] text-faint-foreground">
            Accounts
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh"
            className="flex items-center gap-1 text-[11.5px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Loading skeletons */}
        {loading && assets.length === 0 && (
          <div>
            {[0, 1].map(i => (
              <div key={i} className="flex items-center gap-[13px] border-t border-separator py-[11px]">
                <div className="h-[38px] w-[38px] animate-pulse rounded-[11px] bg-muted" />
                <div className="flex-1 space-y-[6px]">
                  <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
                  <div className="h-2.5 w-20 animate-pulse rounded-full bg-muted" />
                </div>
                <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        )}

        {!loading && assets.length === 0 && (
          <div className="border-t border-separator py-8 text-center text-[14px] text-muted-foreground">
            No accounts yet — tokens you receive will appear here.
          </div>
        )}

        {assets.map(a => (
          <AccountRow
            key={a.assetId}
            asset={a}
            onClick={() => onSelect(a.assetId, a.balance)}
          />
        ))}
      </div>

      {/* ── Recent activity ── */}
      {recentRows.length > 0 && (
        <div className="px-[26px] pt-[22px] pb-[24px]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase leading-none tracking-[1.2px] text-faint-foreground">
              Recent
            </p>
            {history.length > 4 && (
              <button
                type="button"
                className="text-[11.5px] font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                See all
              </button>
            )}
          </div>

          {recentRows.map((row, i) => {
            const meta = metaFor(row.assetId)
            return (
              <RecentRow
                key={`${row.txid}-${i}`}
                row={row}
                decimals={meta.decimals}
                ticker={meta.ticker}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
