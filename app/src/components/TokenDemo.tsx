import { useState } from 'react'
import { Send, Download, AlertTriangle, Home } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import IssuerDashboard from './issuer/IssuerDashboard'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import ReceiveTokens from './ReceiveTokens'
import { cn } from '@/lib/utils'
import type { HolderAction } from './holder/HolderHome'

// ─── Meridian tab-bar for the holder view ────────────────────────────────────

type HolderTab = 'home' | 'send' | 'receive'

function HolderTabBar({
  active,
  onChange,
}: {
  active: HolderTab
  onChange: (tab: HolderTab) => void
}) {
  const item = (tab: HolderTab, icon: React.ReactNode, label: string) => {
    const isActive = active === tab
    return (
      <button
        key={tab}
        type="button"
        onClick={() => onChange(tab)}
        aria-label={label}
        className={cn(
          'flex flex-col items-center gap-[4px] rounded-[10px] px-3 py-2',
          'text-[10px] font-medium leading-none transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        {tab === 'send' ? (
          /* Send gets the raised FAB-style button from the comp */
          <div
            className={cn(
              'flex h-[46px] w-[46px] items-center justify-center rounded-full',
              'shadow-[0_8px_18px_-4px_rgba(35,64,94,0.5)]',
              'bg-primary text-primary-foreground',
              '-mt-[18px]'
            )}
          >
            {icon}
          </div>
        ) : (
          icon
        )}
        <span className={tab === 'send' ? 'mt-[2px]' : ''}>{label}</span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-around px-[26px] pb-[16px] pt-[10px]',
        'border-t border-separator bg-background/92 backdrop-blur-[14px]'
      )}
    >
      {item('home',    <Home    className="h-[22px] w-[22px]" strokeWidth={1.9} />, 'Home'   )}
      {item('send',    <Send    className="h-[20px] w-[20px]" strokeWidth={2}   />, 'Send'   )}
      {item('receive', <Download className="h-[22px] w-[22px]" strokeWidth={1.9} />, 'Receive')}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TokenDemo() {
  const { isInitialized, error, isIssuer, identityKey } = useWallet()
  const [holderTab, setHolderTab] = useState<HolderTab>('home')

  // ── Loading state ──
  if (!isInitialized) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4 animate-in">
          <div className="relative h-9 w-9">
            <div className="absolute inset-0 rounded-full border-[2.5px] border-primary/15" />
            <div
              className="absolute inset-0 animate-spin rounded-full border-[2.5px] border-solid"
              style={{ borderColor: 'var(--brass)', borderRightColor: 'transparent' }}
            />
          </div>
          <p className="text-[14px] font-medium text-muted-foreground">Connecting your wallet…</p>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (error != null) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center animate-in">
          <div className="grid h-12 w-12 place-items-center rounded-[13px] bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Couldn't connect</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  // ── Issuer: full-viewport console shell ──
  if (isIssuer) {
    return <IssuerDashboard />
  }

  // ── Holder: Meridian accounts-first home + bottom tab bar ──
  const handleAction = (action: HolderAction) => {
    if (action === 'send') setHolderTab('send')
    else if (action === 'receive') setHolderTab('receive')
    // 'request' has no dedicated tab yet — could open receive or a future screen
    else if (action === 'request') setHolderTab('receive')
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-[430px] flex-col bg-background">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto pb-[82px]">
        {holderTab === 'home' && (
          <TokenWallet
            identityKey={identityKey}
            onAction={handleAction}
          />
        )}

        {holderTab === 'send' && (
          <div className="px-5 pt-8">
            {/* Back-to-home header */}
            <div className="mb-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHolderTab('home')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Back to home"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Send</h2>
            </div>
            <SendTokens />
          </div>
        )}

        {holderTab === 'receive' && (
          <div className="px-5 pt-8">
            <div className="mb-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHolderTab('home')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Back to home"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Receive</h2>
            </div>
            <ReceiveTokens />
          </div>
        )}
      </div>

      {/* Meridian bottom tab bar — fixed at bottom */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-[430px] -translate-x-1/2">
        <HolderTabBar active={holderTab} onChange={setHolderTab} />
      </div>
    </div>
  )
}
