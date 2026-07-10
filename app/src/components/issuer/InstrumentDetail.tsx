import { useSearchParams } from 'react-router-dom'
import { AdminAsset } from '@bsv/mandala/assets'
import { EditableInstrumentIcon } from '@/components/ui/instrument-icon'
import { assetImage } from '@/lib/instrumentCategory'
import TreasurySection from './TreasurySection'
import ReserveAttestations from './ReserveAttestations'
import RedemptionRequests from './RedemptionRequests'
import HolderScreening from './HolderScreening'
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

type Tab = 'reserves' | 'attestations' | 'banking' | 'operations' | 'ledger' | 'sanctions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'reserves', label: 'Reserves' },
  { id: 'attestations', label: 'Attestations' },
  { id: 'banking', label: 'Banking' },
  { id: 'operations', label: 'Issuance & redemption' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'sanctions', label: 'Restrictions' },
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/35" />
        <div className="relative flex items-center gap-4 px-5 py-6 lg:px-8">
          <EditableInstrumentIcon
            assetId={assetId}
            size={52}
            image={assetImage(asset)}
            className="rounded-xl shadow-lg ring-2 ring-white/40"
          />
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold leading-snug text-white">{asset?.label ?? 'Instrument'}</h1>
            {ticker != null && <div className="text-[12.5px] font-medium text-white/70">{ticker}</div>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-5 overflow-x-auto border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-[1.5px] pb-3 pt-2 text-[14px] font-medium transition-colors',
              tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
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
            title="Banking reserves"
            description="Connect the bank or asset account holding the reserves that back this instrument, and reconcile it against circulation."
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
    </div>
  )
}
