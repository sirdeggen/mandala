import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import IssuerDashboard from './issuer/IssuerDashboard'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import ReceiveTokens from './ReceiveTokens'
import ContactsPage from './holder/ContactsPage'
import type { HolderAction } from './holder/HolderHome'

type HolderTab = 'home' | 'send' | 'receive' | 'contacts'

// ─── Main component ───────────────────────────────────────────────────────────

export default function TokenDemo() {
  const { isInitialized, error, isIssuer, identityKey } = useWallet()
  const [holderTab, setHolderTab] = useState<HolderTab>('home')
  // assetId locked in the current send flow (set when user taps Send from home)
  const [sendAssetId, setSendAssetId] = useState<string | undefined>(undefined)

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

  // ── Holder: Meridian single-account home + bottom tab bar ──
  // The tab bar is hidden when in the send flow (Direction 3: no bottom bar in send).
  const handleAction = (action: HolderAction, assetId?: string) => {
    if (action === 'send') {
      setSendAssetId(assetId)
      setHolderTab('send')
    } else if (action === 'receive') {
      setHolderTab('receive')
    } else if (action === 'contacts') {
      setHolderTab('contacts')
    }
  }

  const goHome = () => setHolderTab('home')

  return (
    <div className="relative mx-auto flex min-h-screen max-w-[430px] flex-col bg-background">
      {/* Scrollable content area — no bottom bar (nav lives in the home quick actions) */}
      <div className="flex-1 overflow-y-auto">
        {holderTab === 'home' && (
          <TokenWallet
            identityKey={identityKey}
            onAction={handleAction}
          />
        )}

        {holderTab === 'send' && (
          /* Full-screen send wizard — no bottom tab bar (Direction 3) */
          <div className="flex min-h-screen flex-col px-5 pt-8">
            {/* Back-to-home header */}
            <div className="mb-6 flex items-center gap-3">
              <button
                type="button"
                onClick={goHome}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Back to home"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Send</h2>
            </div>
            <SendTokens lockedAssetId={sendAssetId} />
          </div>
        )}

        {holderTab === 'receive' && (
          <div className="px-5 pt-8">
            <div className="mb-6 flex items-center gap-3">
              <button
                type="button"
                onClick={goHome}
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

        {holderTab === 'contacts' && (
          <ContactsPage onBack={goHome} />
        )}
      </div>
    </div>
  )
}
