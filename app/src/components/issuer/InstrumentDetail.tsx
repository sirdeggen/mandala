import { useSearchParams } from 'react-router-dom'
import { AdminAsset } from '@bsv/mandala/assets'
import { formatAmount } from '@bsv/mandala/amount'
import { EditableInstrumentIcon } from '@/components/ui/instrument-icon'
import { useInstrumentColor } from '@/lib/instrumentIcons'
import { assetImage } from '@/lib/instrumentCategory'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import TreasurySection from './TreasurySection'
import ReserveAttestations from './ReserveAttestations'
import RedemptionRequests from './RedemptionRequests'
import HolderScreening from './HolderScreening'
import InstrumentExports from './InstrumentExports'
import TabHeader from './TabHeader'
import IssuerPanel from '../IssuerPanel'
import RegulatoryControls from './RegulatoryControls'
import OverlayActivity from './OverlayActivity'
import BankingMock from './BankingMock'
import { cn } from '@/lib/utils'

/**
 * Instrument detail - the working view for a single instrument. Its
 * Reserves / Operations / Ledger sections live in a tab bar here (they used to
 * be sidebar items). Tab selection is kept in the URL (?tab=) so a reload lands
 * on the same tab.
 */

type Tab = 'reserves' | 'attestations' | 'banking' | 'operations' | 'ledger' | 'sanctions' | 'exports'

const TABS: { id: Tab; label: string }[] = [
  { id: 'reserves', label: 'Treasury' },
  { id: 'banking', label: 'Reserves' },
  { id: 'attestations', label: 'Attestations' },
  { id: 'operations', label: 'Issuance & redemption' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'sanctions', label: 'Restrictions' },
  { id: 'exports', label: 'Exports' },
]

interface Props {
  assetId: string
  asset: AdminAsset | null
  assets: AdminAsset[]
  onReload: () => void
}

export default function InstrumentDetail({ assetId, asset, assets, onReload }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramTab = searchParams.get('tab')
  const tab: Tab = TABS.some(t => t.id === paramTab) ? (paramTab as Tab) : 'reserves'
  const setTab = (id: Tab) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('tab', id)
    return next
  }, { replace: true })

  const ticker = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : undefined
  const decimals = Number(asset?.metadata?.decimals) || 0

  // Whole-history issue/redeem totals for the header stats. Circulation is
  // issued minus redeemed - the figure an auditor reconciles against reserves.
  // A settled-but-null summary (overlay unreachable) reads as zeros rather than
  // an endless skeleton.
  const { data: summary, isPending: summaryPending } = useAdminSummary(assetId)
  const totals = summary ?? (summaryPending ? null : { totalIssued: 0, totalRedeemed: 0 })
  const stat = (n: number) => formatAmount(n, decimals)
  const circulation = totals != null ? totals.totalIssued - totals.totalRedeemed : null

  // The instrument's theme colour, laid over the banner photo as a matte.
  const themeColor = useInstrumentColor(assetId)

  if (assetId === '') {
    return (
      <div className="rounded-lg border border-border bg-card p-[24px_20px] text-center">
        <p className="text-[13px] text-subtle-foreground">Select an instrument to view its details.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Instrument header - full-bleed premium banner using the type photo. It
          escapes the page padding to sit flush with the top and side edges. */}
      <div className="relative -mx-5 -mt-5 mb-6 overflow-hidden border-b border-border shadow-[var(--shadow-card)] lg:-mx-8 lg:-mt-8">
        <img src={assetImage(asset)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {/* Theme-colour matte over the photo, then a dark gradient for legibility. */}
        <div className="absolute inset-0" style={{ backgroundColor: themeColor, opacity: 0.5 }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35" />
        <div className="relative flex items-center gap-4 px-5 py-6 lg:px-8">
          <EditableInstrumentIcon
            assetId={assetId}
            size={52}
            solid
            className="rounded-xl shadow-lg ring-2 ring-white/40"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-[22px] font-semibold leading-snug text-white">{asset?.label ?? 'Instrument'}</h1>
              {ticker != null && (
                <span className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-white ring-1 ring-inset ring-white/25">
                  {ticker}
                </span>
              )}
            </div>
            {/* Auditor stats - the figures reconciled against reserves. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
              <HeaderStat label="In circulation" value={circulation != null ? stat(circulation) : null} />
              <HeaderStat label="Total issued" value={totals != null ? stat(totals.totalIssued) : null} />
              <HeaderStat label="Total redeemed" value={totals != null ? stat(totals.totalRedeemed) : null} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs - only the active tab is underlined (black), via an ::after bar so
          no base border colour bleeds through. The strip scrolls on small
          screens with the scrollbar hidden. */}
      <div className="mb-6 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'relative whitespace-nowrap pb-3 pt-2 text-[14px] font-medium transition-colors',
              'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-foreground after:transition-opacity',
              tab === id ? 'text-foreground after:opacity-100' : 'text-muted-foreground hover:text-foreground after:opacity-0'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reserves' && (
        <TreasurySection assetId={assetId} asset={asset} />
      )}
      {tab === 'attestations' && (
        <ReserveAttestations assetId={assetId} asset={asset} />
      )}
      {tab === 'banking' && (
        <div className="max-w-3xl">
          <TabHeader
            title="Reserve accounts"
            description="Connect the bank or asset accounts holding the reserves that back this instrument, and reconcile them against circulation."
            guide="/help/for-issuers/backing-instruments-with-reserves"
          />
          <BankingMock assetId={assetId} />
        </div>
      )}
      {tab === 'operations' && (
        <div className="space-y-10">
          <IssuerPanel assetId={assetId} />
          <RedemptionRequests assetId={assetId} asset={asset} />
        </div>
      )}
      {tab === 'ledger' && (
        <OverlayActivity
          assetId={assetId}
          decimals={Number(asset?.metadata?.decimals) || 0}
          standalone
        />
      )}
      {tab === 'sanctions' && (
        <div className="max-w-3xl space-y-6">
          <TabHeader
            title="Access controls"
            description="Screen holders, ban Badge IDs, and control who can send or receive this instrument."
            guide="/help/for-issuers/compliance-controls"
          />
          <HolderScreening assetId={assetId} asset={asset} />
          <RegulatoryControls
            embedded
            assets={assets}
            assetId={assetId}
            onActionComplete={onReload}
          />
        </div>
      )}
      {tab === 'exports' && (
        <InstrumentExports assetId={assetId} asset={asset} />
      )}
    </div>
  )
}

/** One figure in the instrument header - a bold white value over a muted label,
 *  with a subtle skeleton while the overlay summary is still loading. */
function HeaderStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="leading-tight">
      {value != null
        ? <div className="tabular text-[15px] font-semibold text-white">{value}</div>
        : <div className="mt-0.5 h-[15px] w-14 animate-pulse rounded bg-white/25" />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-white/60">{label}</div>
    </div>
  )
}
