import { AlertTriangle } from 'lucide-react'
import { Routes, Route, Navigate, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useWallet } from '../context/WalletContext'
import { Spinner } from './ui/spinner'
import IssuerDashboard from './issuer/IssuerDashboard'
import ReviewerDashboard from './reviewer/ReviewerDashboard'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import ReceiveTokens from './ReceiveTokens'
import ContactsPage from './holder/ContactsPage'
import type { HolderAction } from './holder/HolderHome'
import OnboardingWizard from './onboarding/OnboardingWizard'
import { HelpHome, HelpCollectionView, HelpArticleView } from './help/HelpCenter'
import { TransparencyOverview, TransparencyInstrument } from './TransparencyPage'
import { useOnboarding, isReviewerRole } from '../lib/onboarding'

// ─── Routing model ──────────────────────────────────────────────────────────
// The full app state lives in the URL so a browser reload restores it:
//   Holder:  /              home (selected token in ?asset=<id>)
//            /send          send flow      (?asset locks the source account)
//            /receive       receive
//            /contacts      contacts manager
//   Issuer:  /issuer/:section   (?asset=<id> selects the asset)
// Switching the token dropdown updates ?asset via the History API - no reload.

// ─── Shared bits ──────────────────────────────────────────────────────────────

/** Read the currently-selected asset id from the URL (?asset=…). */
function useAssetParam(): string {
  const [params] = useSearchParams()
  return params.get('asset') ?? ''
}

/** A "/" link that carries the current ?asset so the switcher survives round-trips. */
function homePath(asset: string): string {
  return asset ? `/?asset=${encodeURIComponent(asset)}` : '/'
}

/** Back-arrow header used by the Send / Receive drill-ins. */
function DrillHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Back to home"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
    </div>
  )
}

// ─── Holder views (route targets) ──────────────────────────────────────────────

function HolderShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex min-h-screen max-w-[430px] flex-col bg-background">
      {/* No bottom bar - nav lives in the home quick actions; drill-ins carry a back arrow */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function HomeView() {
  const { identityKey } = useWallet()
  const navigate = useNavigate()
  // Quick actions navigate to a route, carrying the current account as ?asset.
  const handleAction = (action: HolderAction, assetId?: string) => {
    const search = assetId ? `?asset=${encodeURIComponent(assetId)}` : ''
    navigate(`/${action}${search}`)
  }
  return <TokenWallet identityKey={identityKey} onAction={handleAction} />
}

function SendView() {
  const navigate = useNavigate()
  const asset = useAssetParam()
  return (
    <div className="flex min-h-screen flex-col px-5 pt-8">
      <DrillHeader title="Send" onBack={() => navigate(homePath(asset))} />
      <SendTokens lockedAssetId={asset || undefined} />
    </div>
  )
}

function ReceiveView() {
  const navigate = useNavigate()
  const asset = useAssetParam()
  return (
    <div className="px-5 pt-8">
      <DrillHeader title="Receive" onBack={() => navigate(homePath(asset))} />
      <ReceiveTokens />
    </div>
  )
}

function ContactsView() {
  const navigate = useNavigate()
  const asset = useAssetParam()
  return <ContactsPage onBack={() => navigate(homePath(asset))} />
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TokenDemo() {
  const { isInitialized, error, isIssuer } = useWallet()
  const onboarding = useOnboarding()
  const location = useLocation()

  // ── Help centre - static content, reachable from anywhere (even mid-onboarding
  //    or before the wallet connects), so it short-circuits the gates below. ──
  if (location.pathname.startsWith('/help')) {
    return (
      <Routes>
        <Route path="/help" element={<HelpHome />} />
        <Route path="/help/:collectionSlug" element={<HelpCollectionView />} />
        <Route path="/help/:collectionSlug/:articleSlug" element={<HelpArticleView />} />
        <Route path="*" element={<Navigate to="/help" replace />} />
      </Routes>
    )
  }

  // ── Public proof-of-reserves page - no wallet required, so it short-circuits
  //    the wallet/onboarding/role gates below. Anyone can verify backing. ──
  if (location.pathname.startsWith('/transparency')) {
    return (
      <Routes>
        <Route path="/transparency" element={<TransparencyOverview />} />
        <Route path="/transparency/:assetId" element={<TransparencyInstrument />} />
        <Route path="*" element={<Navigate to="/transparency" replace />} />
      </Routes>
    )
  }

  // ── Loading state ──
  if (!isInitialized) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4 animate-in">
          <Spinner size="lg" tone="brand" />
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
          <div className="grid h-12 w-12 place-items-center rounded-md bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Couldn't connect</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  // ── First run: one-time onboarding (localStorage-gated) ──
  if (!onboarding.completed) {
    return <OnboardingWizard />
  }

  // ── Reviewer (auditor / individual): dedicated console driven by public
  //    overlay data + a personal watchlist, so it works with any identity key
  //    (they sign in with a different key than the issuer). ──
  if (isReviewerRole(onboarding.role)) {
    return (
      <Routes>
        <Route path="/reviewer/:section" element={<ReviewerDashboard />} />
        <Route path="*" element={<Navigate to="/reviewer/discover" replace />} />
      </Routes>
    )
  }

  // ── Issuer: full-viewport console, section in the path ──
  if (isIssuer) {
    return (
      <Routes>
        <Route path="/issuer/:section" element={<IssuerDashboard />} />
        <Route path="*" element={<Navigate to="/issuer/home" replace />} />
      </Routes>
    )
  }

  // ── Holder: Meridian single-account home + drill-in routes ──
  return (
    <HolderShell>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/send" element={<SendView />} />
        <Route path="/receive" element={<ReceiveView />} />
        <Route path="/contacts" element={<ContactsView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HolderShell>
  )
}
