import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Home, Signature, Building2, ShieldCheck, ChevronsUpDown, BadgeCheck,
  Settings, Plus, LogOut, BookOpen
} from 'lucide-react'
import { toast } from 'sonner'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminAssets, useInvalidateAdminAssets } from '../../hooks/useAdminAssets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarSeparator,
  SidebarRail, SidebarInset, SidebarTrigger
} from '@/components/ui/sidebar'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import 'flag-icons/css/flag-icons.min.css'
import { InstrumentIcon } from '@/components/ui/instrument-icon'
import { iconColor } from '@/lib/instrumentIcons'
import { assetImage, stablecoinFlag } from '@/lib/instrumentCategory'
import { cn } from '@/lib/utils'
import InstrumentsHome from './InstrumentsHome'
import InstrumentDetail from './InstrumentDetail'
import IssuerHome from './IssuerHome'
import AuditorHome from './AuditorHome'
import IssueInstrumentDrawer from './IssueInstrumentDrawer'
import ComplianceOverview from './ComplianceOverview'
import AccountSettings from '../settings/AccountSettings'
import ContactsPage from '../holder/ContactsPage'

type Section = 'home' | 'overview' | 'relationships' | 'compliance' | 'instrument' | 'settings'

type NavItem = {
  key: string
  section: Section
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}

// Top-level navigation. The per-instrument sections (Reserves / Operations /
// Ledger) now live as tabs inside the instrument view, not the sidebar.
const TOP_NAV: NavItem[] = [
  { key: 'home',          section: 'home',          label: 'Home',          icon: Home },
  { key: 'instruments',   section: 'overview',      label: 'Instruments',   icon: Signature },
  { key: 'relationships', section: 'relationships', label: 'Relationships', icon: Building2 },
  { key: 'compliance',    section: 'compliance',    label: 'Compliance',    icon: ShieldCheck },
]

// ── Instrument switcher (sidebar popover) ─────────────────────────────────────

function tickerOf(asset: AdminAsset): string {
  return String(asset.metadata?.ticker ?? asset.label.slice(0, 3)).toUpperCase()
}

/** Compact unit count for a sidebar badge, e.g. 1_000 -> "1K", 100_000 -> "100K". */
function compactUnits(amount: number, decimals: number): string {
  const human = amount / 10 ** decimals
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(human)
}

/** One instrument row in the sidebar list. Renders the expanded photo row (with
 *  a circulation/issuance badge) and the collapsed icon. Fetches this
 *  instrument's whole-history totals for the badge - cached and shared with the
 *  detail views. */
function InstrumentNavItem({ asset: a, active, onOpen }: {
  asset: AdminAsset
  active: boolean
  onOpen: (assetId: string) => void
}) {
  const img = assetImage(a)
  const flag = stablecoinFlag(a)
  const decimals = Number(a.metadata?.decimals) || 0
  const { data: summary } = useAdminSummary(a.assetId)
  const issued = summary?.totalIssued ?? 0
  const circulation = summary != null ? summary.totalIssued - summary.totalRedeemed : 0
  const showBadge = summary != null && issued > 0

  return (
    <SidebarMenuItem>
      {/* Expanded: full photo row */}
      <button
        type="button"
        onClick={() => onOpen(a.assetId)}
        className={cn(
          'relative block h-12 w-full overflow-hidden rounded-lg text-left outline-none transition focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden',
          active && 'ring-2 ring-white/70'
        )}
      >
        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ backgroundColor: iconColor(a.assetId), opacity: 0.5 }} />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/15" />
        <div className="relative flex h-full items-center gap-2 px-2.5">
          {flag != null && (
            <span
              className={`fi fi-${flag} h-3.5 w-5 shrink-0 rounded-[2px] shadow-sm ring-1 ring-black/20`}
              aria-hidden="true"
              title="Reserve currency"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold leading-tight text-white">{a.label}</div>
            <div className="truncate text-[10.5px] font-medium leading-tight text-white/75">{tickerOf(a)}</div>
          </div>
          {showBadge && (
            <span
              className="tabular shrink-0 rounded-full border border-white/45 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/90"
              title={`${circulation.toLocaleString()} in circulation of ${issued.toLocaleString()} issued`}
            >
              {compactUnits(circulation, decimals)} / {compactUnits(issued, decimals)}
            </span>
          )}
        </div>
      </button>
      {/* Collapsed: premium icon */}
      <button
        type="button"
        onClick={() => onOpen(a.assetId)}
        title={a.label}
        className="hidden w-full place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:grid"
      >
        <InstrumentIcon
          assetId={a.assetId}
          size={28}
          image={img}
          className={cn('rounded-md', active && 'ring-2 ring-sidebar-ring ring-offset-2 ring-offset-sidebar')}
        />
      </button>
    </SidebarMenuItem>
  )
}

/** Vertical, scrollable list of every registered instrument - the sidebar's
 *  primary instrument navigation. A header row carries a "＋" that opens the
 *  Issue drawer; each row opens that instrument's detail view. Collapses to
 *  icon-only rows (with tooltips) in the rail's icon mode. */
function InstrumentList({ assets, currentAssetId, activeSection, onOpen, onNew }: {
  assets: AdminAsset[]
  currentAssetId: string
  activeSection: string
  onOpen: (assetId: string) => void
  onNew: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: label + new-instrument button */}
      <div className="flex items-center justify-between px-2 pb-1 group-data-[collapsible=icon]:justify-center">
        <span className="text-[10px] font-medium uppercase tracking-[0.6px] text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
          Instruments
        </span>
        <button
          type="button"
          onClick={onNew}
          title="New instrument"
          aria-label="New instrument"
          className="grid size-6 place-items-center rounded-md text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>

      {/* Scroll area - a slim, rounded scrollbar appears only on overflow */}
      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-2 pt-1 group-data-[collapsible=icon]:px-0">
        {assets.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-snug text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
            No instruments yet - add one with ＋.
          </p>
        ) : (
          <SidebarMenu className="gap-1.5">
            {assets.map(a => (
              <InstrumentNavItem
                key={a.assetId}
                asset={a}
                active={activeSection === 'instrument' && a.assetId === currentAssetId}
                onOpen={onOpen}
              />
            ))}
          </SidebarMenu>
        )}
      </div>
    </div>
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

/** Issuer identity + account actions - the footer button opens a popover menu. */
function AccountMenu({ seed, displayName, verified, onSettings }: {
  seed: string
  displayName: string
  verified: boolean
  onSettings: () => void
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
          <AccountMenuItem icon={Settings} label="Account settings" onClick={onSettings} />
          <AccountMenuItem icon={LogOut} label="Sign out" danger onClick={() => toast.info('Disconnect in your wallet to sign out.')} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── IssuerDashboard ───────────────────────────────────────────────────────────

// `home` / `overview` are nav-backed; `instrument` is reached by selecting an
// instrument; `settings` is reached from the account menu.
const VALID_SECTIONS = ['home', 'overview', 'relationships', 'compliance', 'instrument', 'settings']

export default function IssuerDashboard() {
  const { identityKey } = useWallet()
  const { name: onboardingName, role: onboardingRole } = useOnboarding()
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: assetsData } = useAdminAssets()
  const invalidateAdminAssets = useInvalidateAdminAssets()
  const assets: AdminAsset[] = assetsData ?? []
  const [issueOpen, setIssueOpen] = useState(false)

  // Section lives in the path (/issuer/:section); asset lives in ?asset - both
  // in the URL so a reload restores exactly where the operator was.
  const section: Section = VALID_SECTIONS.includes(params.section ?? '')
    ? (params.section as Section)
    : 'overview'
  const currentAssetId = searchParams.get('asset') ?? ''

  const goSection = (id: Section) => {
    const qs = searchParams.toString()
    navigate(`/issuer/${id}${qs ? `?${qs}` : ''}`)
  }
  // Select an instrument and open its detail view (Reserves tab by default) in
  // one navigation, so the ?asset lands with the section.
  const openInstrument = (assetId: string, tab?: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('asset', assetId)
    if (tab != null && tab !== '') next.set('tab', tab)
    else next.delete('tab')
    navigate(`/issuer/instrument?${next.toString()}`)
  }
  // Banking is a per-instrument tab; open it for the selected (or first) instrument.
  const goBanking = () => {
    const target = currentAssetId || (assets[0]?.assetId ?? '')
    if (target === '') { toast.info('Issue an instrument first to connect banking.'); return }
    openInstrument(target, 'banking')
  }
  const selectAsset = (assetId: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('asset', assetId)
      return next
    })
  }

  // "Send" from a contact → open the chosen instrument's Reserves tab in Send
  // state, with the contact pre-selected as recipient (?send=<key>).
  const [sendContact, setSendContact] = useState<{ identityKey: string; name: string } | null>(null)
  const sendTo = (assetId: string, contact: { identityKey: string; name: string }) => {
    const next = new URLSearchParams(searchParams)
    next.set('asset', assetId)
    next.set('tab', 'reserves')
    next.set('send', contact.identityKey)
    if (contact.name) next.set('sendName', contact.name)
    setSendContact(null)
    navigate(`/issuer/instrument?${next.toString()}`)
  }
  const handleContactSend = (contact: { identityKey: string; name: string }) => {
    if (assets.length === 0) { toast.info('Issue an instrument first, then you can send it.'); return }
    if (assets.length === 1) { sendTo(assets[0].assetId, contact); return }
    setSendContact({ identityKey: contact.identityKey, name: contact.name })
  }

  // Normalise an unknown /issuer/:section, keeping ?asset. The old standalone
  // /issuer/regulatory page now lives inside Operations.
  useEffect(() => {
    if (params.section != null && !VALID_SECTIONS.includes(params.section)) {
      const qs = searchParams.toString()
      const target = params.section === 'regulatory' ? 'instrument' : 'home'
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

        <SidebarContent className="overflow-hidden">
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

          {/* Scrollable list of instruments - selecting one opens its detail view,
              where Reserves / Operations / Ledger live as tabs. */}
          <InstrumentList
            assets={assets}
            currentAssetId={currentAssetId}
            activeSection={section}
            onOpen={openInstrument}
            onNew={() => setIssueOpen(true)}
          />
        </SidebarContent>

        <SidebarFooter>
          {/* Guides - the help centre lives at /help - sits above the account button */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Guides" onClick={() => navigate('/help/getting-started')}>
                <BookOpen strokeWidth={1.9} />
                <span>Guides</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Issuer identity + account menu */}
          <AccountMenu seed={identityKey ?? 'issuer'} displayName={displayName} verified={verified} onSettings={() => goSection('settings')} />
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
            {section === 'home' && (
              isReviewerRole(onboardingRole) ? (
                <AuditorHome assets={assets} onOpenInstrument={openInstrument} />
              ) : (
                <IssuerHome assets={assets} onReload={() => void invalidateAdminAssets()} onOpenInstrument={openInstrument} />
              )
            )}
            {section === 'overview' && (
              <InstrumentsHome
                assets={assets}
                onReload={() => void invalidateAdminAssets()}
                onSelectAsset={selectAsset}
                onOpenInstrument={openInstrument}
                onManageBanking={goBanking}
              />
            )}
            {section === 'relationships' && (
              <ContactsPage onSend={handleContactSend} />
            )}
            {section === 'compliance' && (
              <ComplianceOverview onOpenInstrument={openInstrument} />
            )}
            {section === 'instrument' && (
              <InstrumentDetail
                assetId={currentAssetId}
                asset={currentAsset}
                assets={assets}
                onReload={() => void invalidateAdminAssets()}
              />
            )}
            {section === 'settings' && (
              <AccountSettings />
            )}
          </div>
        </div>
      </SidebarInset>

      {/* Issue drawer - opened by the sidebar's "＋ New instrument" */}
      <IssueInstrumentDrawer
        open={issueOpen}
        onOpenChange={setIssueOpen}
        onIssued={(id) => { void invalidateAdminAssets(); if (id) openInstrument(id) }}
      />

      {/* Instrument picker - shown when "Send" is used with more than one instrument */}
      {sendContact != null && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 animate-in"
          role="dialog"
          aria-modal="true"
          onClick={() => setSendContact(null)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-pop)]" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-foreground">Send to {sendContact.name || 'contact'}</h2>
              <button type="button" onClick={() => setSendContact(null)} aria-label="Close" className="rounded-md px-1.5 text-[15px] text-muted-foreground hover:bg-muted hover:text-foreground">
                ✕
              </button>
            </div>
            <p className="mb-3 text-[13px] text-muted-foreground">Choose which instrument to send.</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {assets.map(a => (
                <button
                  key={a.assetId}
                  type="button"
                  onClick={() => sendTo(a.assetId, sendContact)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                >
                  <InstrumentIcon assetId={a.assetId} size={30} className="rounded-md" image={assetImage(a)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-foreground">{a.label}</div>
                    <div className="truncate text-[11.5px] text-subtle-foreground">{tickerOf(a)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </SidebarProvider>
  )
}
