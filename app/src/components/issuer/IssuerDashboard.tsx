import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, ShieldCheck, Banknote, Wallet, Activity, ChevronDown
} from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminAssets, useInvalidateAdminAssets } from '../../hooks/useAdminAssets'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarRail, SidebarInset, SidebarTrigger
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import IssuerPanel from '../IssuerPanel'
import InstrumentsHome from './InstrumentsHome'
import RegulatoryControls from './RegulatoryControls'
import BankingMock from './BankingMock'
import OverlayActivity from './OverlayActivity'
import TreasurySection from './TreasurySection'

type Section = 'overview' | 'treasury' | 'operations' | 'activity' | 'banking'

const NAV_ITEMS: Array<{
  id: Section
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
  { id: 'overview',    label: 'Instruments', icon: LayoutDashboard },
  { id: 'treasury',    label: 'Treasury',    icon: Wallet },
  { id: 'operations',  label: 'Operations',  icon: ShieldCheck },
  { id: 'activity',    label: 'Activity',    icon: Activity },
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
      <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-[12px] text-foreground">
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
      <div className="inline-flex items-center rounded-lg border border-border bg-card px-[10px] py-[6px]">
        <AssetBadge asset={current} />
      </div>
    ) : (
      <div className="inline-flex items-center rounded-lg border border-border bg-card px-[12px] py-[8px] text-[13px] text-muted-foreground">
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
        className="appearance-none cursor-pointer inline-flex items-center rounded-lg border border-border bg-card px-[12px] py-[8px] pr-[32px] text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
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
  const { identityKey } = useWallet()
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: assetsData } = useAdminAssets()
  const invalidateAdminAssets = useInvalidateAdminAssets()
  const assets: AdminAsset[] = assetsData ?? []

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

  // Normalise an unknown /issuer/:section, keeping ?asset. The old standalone
  // /issuer/regulatory page now lives inside Operations.
  useEffect(() => {
    if (params.section != null && !SECTION_IDS.includes(params.section)) {
      const qs = searchParams.toString()
      const target = params.section === 'regulatory' ? 'operations' : 'overview'
      navigate(`/issuer/${target}${qs ? `?${qs}` : ''}`, { replace: true })
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
  const sectionLabel = NAV_ITEMS.find(n => n.id === section)?.label ?? 'Overview'

  // Derive issuer initials for the footer chip from identityKey.
  const initials = identityKey != null && identityKey.length >= 4
    ? identityKey.slice(2, 4).toUpperCase()
    : 'IS'

  return (
    <SidebarProvider className="h-screen overflow-hidden bg-sidebar">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5">
            <img src="/icon-192.png" alt="" aria-hidden="true" className="size-8 shrink-0 rounded-md object-contain" />
            <div className="grid group-data-[collapsible=icon]:hidden">
              <span className="font-heading text-[15px] font-semibold leading-none tracking-[-0.2px]">Underwrite</span>
              <span className="mt-[3px] text-[9px] font-medium leading-none tracking-[1px] text-sidebar-foreground/60">
                ISSUER CONSOLE
              </span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Console</SidebarGroupLabel>
            <SidebarMenu>
              {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={section === id}
                    tooltip={label}
                    onClick={() => goSection(id)}
                  >
                    <Icon strokeWidth={1.9} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-2.5 rounded-md border border-sidebar-border bg-card px-2.5 py-2 group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-[11px] font-semibold text-sidebar-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-[12px] font-semibold leading-tight">
                {identityKey != null ? `${identityKey.slice(0, 12)}…` : 'Issuer'}
              </div>
              <div className="mt-[2px] text-[10px] leading-none text-sidebar-foreground/60">
                Verified issuer
              </div>
            </div>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">{sectionLabel}</h1>
          <div className="ml-auto flex items-center gap-3">
            <AssetSwitcher
              assets={assets}
              currentAssetId={currentAssetId}
              onChange={selectAsset}
            />
          </div>
        </header>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-5 lg:p-8">
            {section === 'overview' && (
              <InstrumentsHome
                assets={assets}
                onReload={() => void invalidateAdminAssets()}
                onSelectAsset={selectAsset}
                goSection={goSection}
              />
            )}
            {section === 'treasury' && (
              <TreasurySection assetId={currentAssetId} asset={currentAsset} />
            )}
            {section === 'operations' && (
              assets.length === 0 ? (
                assetsData != null && (
                  <div className="rounded-lg border border-border bg-card p-[24px_20px] text-center">
                    <p className="text-[13px] text-subtle-foreground">
                      Register an asset first — you can do that from the Overview page.
                    </p>
                  </div>
                )
              ) : (
                <div className="space-y-[26px]">
                  <IssuerPanel assetId={currentAssetId} />
                  <RegulatoryControls
                    embedded
                    assets={assets}
                    assetId={currentAssetId}
                    onActionComplete={() => void invalidateAdminAssets()}
                  />
                </div>
              )
            )}
            {section === 'activity' && (
              <OverlayActivity
                assetId={currentAssetId}
                decimals={Number(currentAsset?.metadata?.decimals) || 0}
                standalone
              />
            )}
            {section === 'banking' && (
              <BankingMock assetId={currentAssetId} />
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
