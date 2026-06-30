import { useCallback, useEffect, useState } from 'react'
import { LayoutDashboard, ShieldCheck, Banknote, ClipboardList, PlusCircle } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { listAdminAssets, AdminAsset } from '../../lib/mandala/assets'
import IssuerPanel from '../IssuerPanel'
import AssetOverview from './AssetOverview'
import RegulatoryControls from './RegulatoryControls'
import BankingMock from './BankingMock'
import AuditLog from './AuditLog'
import { cn } from '@/lib/utils'

type Section = 'overview' | 'operations' | 'regulatory' | 'banking' | 'audit'

const navItems: Array<{ id: Section, label: string, icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'operations', label: 'Operations', icon: PlusCircle },
  { id: 'regulatory', label: 'Regulatory', icon: ShieldCheck },
  { id: 'banking', label: 'Banking', icon: Banknote },
  { id: 'audit', label: 'Audit log', icon: ClipboardList },
]

export default function IssuerDashboard() {
  const { wallet } = useWallet()
  const [section, setSection] = useState<Section>('overview')
  const [assets, setAssets] = useState<AdminAsset[]>([])

  const reloadAssets = useCallback(async () => {
    if (wallet == null) return
    const list = await listAdminAssets(wallet as any)
    setAssets(list)
  }, [wallet])

  useEffect(() => { void reloadAssets() }, [reloadAssets])

  return (
    <div className="space-y-5">
      {/* Section nav */}
      <nav className="flex w-full gap-1 overflow-x-auto rounded-[10px] bg-[var(--segment-track)] p-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 py-1.5 whitespace-nowrap',
              'text-[13px] font-medium text-muted-foreground select-none cursor-pointer',
              'transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              section === id
                ? 'bg-[var(--segment-thumb)] text-foreground shadow-[var(--shadow-thumb)] font-semibold'
                : ''
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* Sections */}
      {section === 'overview' && (
        <AssetOverview />
      )}

      {section === 'operations' && (
        // Compose the existing register/issue/redeem/recover panel as-is — no logic changes.
        <IssuerPanel />
      )}

      {section === 'regulatory' && (
        <RegulatoryControls assets={assets} onActionComplete={() => void reloadAssets()} />
      )}

      {section === 'banking' && (
        <BankingMock />
      )}

      {section === 'audit' && (
        <AuditLog assets={assets} />
      )}
    </div>
  )
}
