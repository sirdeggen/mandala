import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, PlusCircle, ShieldCheck, Banknote, Wallet, ChevronDown
} from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { listAdminAssets, AdminAsset } from '../../lib/mandala/assets'
import { BrandMark } from '../ui/BrandMark'
import { cn } from '@/lib/utils'
import IssuerPanel from '../IssuerPanel'
import OverviewSection from './OverviewSection'
import RegulatoryControls from './RegulatoryControls'
import BankingMock from './BankingMock'
import TreasurySection from './TreasurySection'

type Section = 'overview' | 'treasury' | 'operations' | 'regulatory' | 'banking'

const NAV_ITEMS: Array<{
  id: Section
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
  { id: 'overview',    label: 'Overview',    icon: LayoutDashboard },
  { id: 'treasury',    label: 'Treasury',    icon: Wallet },
  { id: 'operations',  label: 'Operations',  icon: PlusCircle },
  { id: 'regulatory',  label: 'Regulatory',  icon: ShieldCheck },
  { id: 'banking',     label: 'Banking',     icon: Banknote },
]

// ── AssetSwitcher ─────────────────────────────────────────────────────────────

interface AssetSwitcherProps {
  assets: AdminAsset[]
  currentAssetId: string
  onChange: (assetId: string) => void
}

function AssetBadge({ asset }: { asset: AdminAsset }) {
  const ticker = String(asset.metadata?.ticker ?? asset.label.slice(0, 3)).toUpperCase()
  const symbol = { USD: '$', EUR: '€', GBP: '£', CHF: 'Fr' }[ticker] ?? ticker.slice(0, 2)
  return (
    <div className="flex items-center gap-[9px]">
      <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] bg-accent font-bold text-[12px] text-accent-foreground">
        {symbol}
      </div>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold">{asset.label}</div>
        {ticker && (
          <div className="text-[10.5px] text-subtle-foreground">{ticker}</div>
        )}
      </div>
    </div>
  )
}

function AssetSwitcher({ assets, currentAssetId, onChange }: AssetSwitcherProps) {
  const current = assets.find(a => a.assetId === currentAssetId)

  // Single asset: static chip
  if (assets.length <= 1) {
    return current != null ? (
      <div className="inline-flex items-center rounded-[10px] border border-border bg-card px-[12px] py-[7px]">
        <AssetBadge asset={current} />
      </div>
    ) : (
      <div className="inline-flex items-center rounded-[10px] border border-border bg-card px-[12px] py-[7px] text-[13px] text-muted-foreground">
        No assets
      </div>
    )
  }

  // Multiple assets: dropdown
  return (
    <div className="relative inline-block">
      <select
        value={currentAssetId}
        onChange={e => onChange(e.target.value)}
        className="appearance-none cursor-pointer inline-flex items-center rounded-[10px] border border-border bg-card px-[12px] py-[7px] pr-[32px] text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Switch asset"
      >
        {assets.map(a => (
          <option key={a.assetId} value={a.assetId}>{a.label}</option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 h-[14px] w-[14px] text-subtle-foreground"
        strokeWidth={2}
      />
    </div>
  )
}

// ── IssuerDashboard ───────────────────────────────────────────────────────────

const SECTION_IDS = NAV_ITEMS.map(n => n.id) as string[]

export default function IssuerDashboard() {
  const { wallet, identityKey } = useWallet()
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [assets, setAssets] = useState<AdminAsset[]>([])

  // Section lives in the path (/issuer/:section); asset lives in ?asset — both
  // in the URL so a reload restores exactly where the operator was.
  const section: Section = SECTION_IDS.includes(params.section ?? '')
    ? (params.section as Section)
    : 'overview'
  const currentAssetId = searchParams.get('asset') ?? ''

  const goSection = (id: Section) => {
    const qs = searchParams.toString()
    navigate(`/issuer/${id}${qs ? `?${qs}` : ''}`)
  }
  const selectAsset = (assetId: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('asset', assetId)
      return next
    })
  }

  const reloadAssets = useCallback(async () => {
    if (wallet == null) return
    setAssets(await listAdminAssets(wallet as any))
  }, [wallet])

  useEffect(() => { void reloadAssets() }, [reloadAssets])

  // Normalise an unknown /issuer/:section to overview, keeping ?asset.
  useEffect(() => {
    if (params.section != null && !SECTION_IDS.includes(params.section)) {
      const qs = searchParams.toString()
      navigate(`/issuer/overview${qs ? `?${qs}` : ''}`, { replace: true })
    }
  }, [params.section, searchParams, navigate])

  // Auto-select the first asset into ?asset when the URL has no valid selection.
  useEffect(() => {
    if (assets.length === 0) return
    const valid = currentAssetId !== '' && assets.some(a => a.assetId === currentAssetId)
    if (valid) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('asset', assets[0].assetId)
      return next
    }, { replace: true })
  }, [assets, currentAssetId, setSearchParams])

  const currentAsset = assets.find(a => a.assetId === currentAssetId) ?? null

  // Derive issuer initials for the footer chip from identityKey (first 2 hex chars → uppercase)
  const initials = identityKey != null && identityKey.length >= 4
    ? identityKey.slice(2, 4).toUpperCase()
    : 'IS'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* ── LEFT SIDEBAR NAV ── */}
      <aside className="flex w-[230px] shrink-0 flex-col border-r border-separator bg-muted px-3.5 py-5">
        {/* Brand */}
        <div className="px-2 pb-5">
          <BrandMark size="md" wordmark sublabel="ISSUER CONSOLE" />
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => goSection(id)}
                className={cn(
                  'relative flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-left text-[13px] font-medium',
                  'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-card text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                style={active ? { boxShadow: '0 1px 2px var(--separator)' } : undefined}
              >
                {/* Brass left accent bar for active item */}
                {active && (
                  <span
                    className="absolute left-0 top-[9px] bottom-[9px] w-[3px] rounded-r-[3px]"
                    style={{ background: 'var(--brass)' }}
                  />
                )}
                <Icon
                  className={cn('h-[17px] w-[17px] shrink-0', active ? 'text-primary' : 'text-current')}
                  strokeWidth={1.9}
                />
                {label}
              </button>
            )
          })}
        </nav>

        {/* Footer issuer chip */}
        <div
          className="mt-auto flex items-center gap-[10px] rounded-[11px] border border-separator bg-background px-[10px] py-3"
        >
          <div
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-primary font-semibold text-[11px] text-primary-foreground"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold leading-[1.1]">
              {identityKey != null ? `${identityKey.slice(0, 12)}…` : 'Issuer'}
            </div>
            <div className="mt-[2px] text-[10px] leading-[1.1] text-subtle-foreground">
              Verified issuer
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <main className="flex-1 overflow-y-auto bg-background">
        {/* Top bar with asset switcher */}
        <div className="flex items-center justify-between border-b border-separator bg-background px-[30px] py-[14px]">
          <AssetSwitcher
            assets={assets}
            currentAssetId={currentAssetId}
            onChange={selectAsset}
          />
        </div>

        <div className="p-[26px_30px]">
          {section === 'overview' && (
            <OverviewSection
              assetId={currentAssetId}
              asset={currentAsset}
              onReload={() => void reloadAssets()}
            />
          )}
          {section === 'treasury' && (
            <TreasurySection assetId={currentAssetId} asset={currentAsset} />
          )}
          {section === 'operations' && (
            <IssuerPanel assetId={currentAssetId} />
          )}
          {section === 'regulatory' && (
            <RegulatoryControls
              assets={assets}
              assetId={currentAssetId}
              onActionComplete={() => void reloadAssets()}
            />
          )}
          {section === 'banking' && (
            <BankingMock assetId={currentAssetId} />
          )}
        </div>
      </main>
    </div>
  )
}
