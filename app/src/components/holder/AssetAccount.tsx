import { useState, useEffect } from 'react'
import { ArrowLeft, Send, Download, Clock } from 'lucide-react'
import { Button } from '../ui/button'
import { formatCurrency } from '../../lib/mandala/amount'
import { resolveAssetMetadata } from '../../lib/mandala/metadata'
import AlertBanners from './AlertBanners'
import ReceivePanel from './ReceivePanel'
import TransactionHistory from './TransactionHistory'
import SendTokens from '../SendTokens'
import { cn } from '@/lib/utils'

type Tab = 'send' | 'receive' | 'history'

interface Props {
  assetId: string
  balance: number
  decimals?: number
  ticker?: string
  label?: string
  onBack: () => void
}

export default function AssetAccount({ assetId, balance, decimals: decimalsProp = 0, ticker: tickerProp, label, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('send')
  const [decimals, setDecimals] = useState(decimalsProp)
  const [ticker, setTicker] = useState<string | undefined>(tickerProp)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const meta = await resolveAssetMetadata(assetId)
      if (cancelled) return
      setDecimals(Number(meta?.decimals) || 0)
      setTicker(typeof (meta as any)?.ticker === 'string' ? (meta as any).ticker : undefined)
    })()
    return () => { cancelled = true }
  }, [assetId])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-9 w-9 shrink-0 p-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {label ?? `${assetId.slice(0, 10)}…`}
          </h2>
          <p className="tabular text-[13px] text-muted-foreground">
            {formatCurrency(balance, decimals, ticker)}
          </p>
        </div>
      </div>

      {/* Alert banners */}
      <AlertBanners assetId={assetId} />

      {/* Tab bar */}
      <div className="flex rounded-[--radius-lg] bg-muted p-1">
        {([
          { key: 'send', icon: Send, label: 'Send' },
          { key: 'receive', icon: Download, label: 'Receive' },
          { key: 'history', icon: Clock, label: 'History' }
        ] as const).map(({ key, icon: Icon, label: tabLabel }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[--radius] px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key
                ? 'bg-card text-foreground shadow-[var(--shadow-card)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {tabLabel}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'send' && <SendTokens lockedAssetId={assetId} />}
      {tab === 'receive' && <ReceivePanel />}
      {tab === 'history' && (
        <TransactionHistory assetId={assetId} decimals={decimals} ticker={ticker} />
      )}
    </div>
  )
}
