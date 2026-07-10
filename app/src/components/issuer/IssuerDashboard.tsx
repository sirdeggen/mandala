import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Home, LayoutDashboard, ShieldCheck, Banknote, Landmark, BookText, ChevronsUpDown, Check, BadgeCheck,
  Settings, Plus, LogOut
} from 'lucide-react'
import { toast } from 'sonner'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminAssets, useInvalidateAdminAssets } from '../../hooks/useAdminAssets'
import { useOnboarding, resetOnboarding } from '../../lib/onboarding'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarSeparator,
  SidebarRail, SidebarInset, SidebarTrigger
} from '@/components/ui/sidebar'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { cn } from '@/lib/utils'
import IssuerPanel from '../IssuerPanel'
import InstrumentsHome from './InstrumentsHome'
import RegulatoryControls from './RegulatoryControls'
import BankingMock from './BankingMock'
import OverlayActivity from './OverlayActivity'
import TreasurySection from './TreasurySection'

type Section = 'overview' | 'treasury' | 'operations' | 'activity' | 'banking'

type NavItem = {
  key: string
  section: Section
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}

// Top-level navigation.
const TOP_NAV: NavItem[] = [
  { key: 'home',        section: 'overview', label: 'Home',        icon: Home },
  { key: 'instruments', section: 'overview', label: 'Instruments', icon: LayoutDashboard },
]

// Sections scoped to the instrument selected in the switcher below.
const INSTRUMENT_NAV: NavItem[] = [
  { key: 'treasury',    section: 'treasury',   label: 'Reserves',    icon: Landmark },
  { key: 'operations',  section: 'operations', label: 'Operations',  icon: ShieldCheck },
  { key: 'activity',    section: 'activity',   label: 'Ledger',      icon: BookText },
  { key: 'banking',     section: 'banking',    label: 'Banking',     icon: Banknote },
]

const ALL_NAV = [...TOP_NAV, ...INSTRUMENT_NAV]

// ── Instrument switcher (sidebar popover) ─────────────────────────────────────

function tickerOf(asset: AdminAsset): string {
  return String(asset.metadata?.ticker ?? asset.label.slice(0, 3)).toUpperCase()
}

/** Instruments are identified by a deterministic sigil derived from their assetId. */
function InstrumentSigil({ assetId, size = 28 }: { assetId?: string; size?: number }) {
  if (assetId == null || assetId === '') {
    return <div className="shrink-0 rounded-md bg-muted" style={{ width: size, height: size }} />
  }
  return <IdentitySigil value={assetId} size={size} className="rounded-md" />
}

/** Active-instrument switcher — a full-width sidebar button that opens a popover
 *  listing every registered instrument. Collapses to just the badge in icon mode. */
function InstrumentSwitcher({ assets, currentAssetId, onChange }: {
  assets: AdminAsset[]
  currentAssetId: string
  onChange: (assetId: string) => void
}) {
  const current = assets.find(a => a.assetId === currentAssetId) ?? null

  return (
    <Popover>
      <PopoverTrigger
        className="flex w-full items-center gap-2.5 rounded-md border border-sidebar-border bg-card px-2.5 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0"
        disabled={assets.length === 0}
      >
        <InstrumentSigil assetId={current?.assetId} />
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <div className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
            {current ? current.label : 'No instruments'}
          </div>
          <div className="truncate text-[10.5px] leading-tight text-subtle-foreground">
            {current ? tickerOf(current) : 'Issue one to begin'}
          </div>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-56">
        <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.6px] text-faint-foreground">
          Active instrument
        </div>
        {assets.map(a => {
          const active = a.assetId === currentAssetId
          return (
            <button
              key={a.assetId}
              type="button"
              onClick={() => onChange(a.assetId)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
                active && 'bg-accent'
              )}
            >
              <InstrumentSigil assetId={a.assetId} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{a.label}</div>
                <div className="truncate text-[11px] text-subtle-foreground">{tickerOf(a)}</div>
              </div>
              {active && <Check className="size-4 shrink-0 text-foreground" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// ── Account menu (sidebar popover) ────────────────────────────────────────────

function AccountMenuItem({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-medium transition-colors hover:bg-accent',
        danger ? 'text-destructive' : 'text-foreground'
      )}
    >
      <Icon className="size-[17px] shrink-0 text-muted-foreground" strokeWidth={2} />
      {label}
    </button>
  )
}

/** Issuer identity + account actions — the footer button opens a popover menu. */
function AccountMenu({ seed, displayName, verified }: {
  seed: string
  displayName: string
  verified: boolean
}) {
  return (
    <Popover>
      <PopoverTrigger className="flex w-full items-center gap-2.5 rounded-md border border-sidebar-border bg-card px-2.5 py-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
        <UserAvatar seed={seed} size={32} />
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <div className="truncate text-[12px] font-semibold leading-tight text-foreground">{displayName}</div>
          <div className="mt-[2px] flex items-center gap-1 text-[10px] leading-none text-sidebar-foreground/60">
            {verified && <BadgeCheck className="size-3 text-success" strokeWidth={2.4} />}
            {verified ? 'Verified issuer' : 'Issuer'}
          </div>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[--radix-popover-trigger-width] min-w-60 p-0">
        {/* Current account */}
        <div className="p-1.5">
          <div className="flex w-full items-center gap-2.5 rounded-xl bg-accent px-2.5 py-2 text-left">
            <UserAvatar seed={seed} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-foreground">{displayName}</div>
              <div className="truncate text-[12px] text-muted-foreground">{verified ? 'Verified issuer' : 'Issuer'}</div>
            </div>
            {verified && <BadgeCheck className="size-4 shrink-0 text-success" />}
          </div>
        </div>
        {/* Actions */}
        <div className="border-t border-border p-1.5">
          <AccountMenuItem icon={Settings} label="Account settings" onClick={() => resetOnboarding()} />
          <AccountMenuItem icon={Plus} label="Add account" onClick={() => toast.info('Multiple issuer accounts are coming soon.')} />
          <AccountMenuItem icon={LogOut} label="Sign out" danger onClick={() => toast.info('Disconnect in your wallet to sign out.')} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── IssuerDashboard ───────────────────────────────────────────────────────────

const SECTION_IDS = Array.from(new Set(ALL_NAV.map(n => n.section))) as string[]

export default function IssuerDashboard() {
  const { identityKey } = useWallet()
  const { name: onboardingName } = useOnboarding()
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

  // Footer identity: prefer the onboarding display name, fall back to a short key.
  const verified = identityKey != null
  const displayName = onboardingName.trim() !== ''
    ? onboardingName.trim()
    : (identityKey != null ? `${identityKey.slice(0, 10)}…` : 'Issuer')

  return (
    <SidebarProvider className="h-screen overflow-hidden bg-sidebar">
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <img
              src="/icon-192.png"
              alt=""
              aria-hidden="true"
              className="size-8 shrink-0 rounded-md object-contain group-data-[collapsible=icon]:hidden"
            />
            <div className="grid flex-1 group-data-[collapsible=icon]:hidden">
              <span className="font-handwritten text-[22px] font-bold leading-none tracking-[-0.2px]">Underwrite</span>
              <span className="mt-[3px] text-[9px] font-medium leading-none tracking-[1px] text-sidebar-foreground/60">
                ISSUER
              </span>
            </div>
            <SidebarTrigger className="size-8 shrink-0 text-muted-foreground hover:text-foreground" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Top-level */}
          <SidebarGroup className="pb-1">
            <SidebarMenu>
              {TOP_NAV.map(({ key, section: sec, label, icon: Icon }) => (
                <SidebarMenuItem key={key}>
                  <SidebarMenuButton isActive={section === sec} tooltip={label} onClick={() => goSection(sec)}>
                    <Icon strokeWidth={1.9} />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarSeparator className="my-0.5" />

          {/* Selected instrument + its contextual sections */}
          <SidebarGroup className="pt-1">
            <InstrumentSwitcher
              assets={assets}
              currentAssetId={currentAssetId}
              onChange={selectAsset}
            />
            {/* Indented: scoped to the instrument selected above */}
            <div className="mt-1 ml-3.5 border-l border-sidebar-border pl-1 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:pl-0">
              <SidebarMenu>
                {INSTRUMENT_NAV.map(({ key, section: sec, label, icon: Icon }) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton isActive={section === sec} tooltip={label} onClick={() => goSection(sec)}>
                      <Icon strokeWidth={1.9} />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </div>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {/* Issuer identity + account menu */}
          <AccountMenu seed={identityKey ?? 'issuer'} displayName={displayName} verified={verified} />
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
        {/* Mobile-only trigger (the sidebar is off-canvas on small screens) */}
        <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center border-b border-border bg-card px-3 md:hidden">
          <SidebarTrigger />
        </div>

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
