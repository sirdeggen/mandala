import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ArrowDownLeft, Coins, Plus, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '@bsv/mandala/assets'
import { formatAmount } from '@bsv/mandala/amount'
import { useHolderData } from '../../hooks/useHolderData'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useReserveBucket, reservesTotalOf } from '../../lib/compliance'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { useInstrumentColor, securityPattern } from '../../lib/instrumentIcons'
import SendTokens from '../SendTokens'
import ReceivePanel from '../holder/ReceivePanel'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import TabHeader from './TabHeader'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  assetId: string
  asset: AdminAsset | null
}

// ── TreasurySection ───────────────────────────────────────────────────────────

type Tab = 'send' | 'receive'

export default function TreasurySection({ assetId, asset }: Props) {
  const { identityKey } = useWallet()
  const { name: issuerName, role } = useOnboarding()
  const isAuditor = isReviewerRole(role)
  const [searchParams, setSearchParams] = useSearchParams()

  // A "Send" launched from a contact arrives with ?send=<key>&sendName=<name>.
  // Capture it once, land on the Send tab, and clear the params so switching
  // tabs or reloading doesn't keep re-injecting the recipient.
  const [initialRecipient] = useState(() => {
    const key = searchParams.get('send') ?? ''
    return key !== '' ? { identityKey: key, name: searchParams.get('sendName') ?? '' } : undefined
  })
  const [tab, setTab] = useState<Tab>('send')

  useEffect(() => {
    if (searchParams.get('send') == null) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('send')
      next.delete('sendName')
      return next
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ticker = asset?.metadata?.ticker != null ? String(asset.metadata.ticker) : undefined
  const decimals = asset?.metadata?.decimals != null ? Number(asset.metadata.decimals) : 0

  // ── Issuer's held balance for this asset - from the shared holder-data cache
  //    so navigating here renders instantly with a background refetch. ────────

  const { data: holderData } = useHolderData()
  const balance: number | null = holderData == null || !assetId
    ? null
    : holderData.assets.find(a => a.assetId === assetId)?.balance ?? 0
  // Skeleton only while the query has no cached data yet.
  const loading = balance == null

  // ── Balance card ────────────────────────────────────────────────────────────

  const keyAbbr = identityKey != null
    ? `${identityKey.slice(0, 8)}…${identityKey.slice(-4)}`
    : '-'

  const balanceNumber = balance != null ? formatAmount(balance, decimals) : '-'

  const isEmpty = balance === 0

  // ── Card theming + auditor context ──────────────────────────────────────────
  // Themed, textured summary card: a subtle guilloché security texture under a
  // semi-transparent matte in the instrument's theme colour, white text on top.
  const themeColor = useInstrumentColor(assetId)
  const texture = securityPattern(assetId)

  // Whole-history totals let us show what share of circulation sits in treasury -
  // context an issuer/auditor wants next to the raw balance.
  const { data: summary } = useAdminSummary(assetId)
  const circulation = summary != null ? summary.totalIssued - summary.totalRedeemed : null
  const treasuryShare = circulation != null && circulation > 0 && balance != null
    ? Math.round((balance / circulation) * 100)
    : null
  // Stats that don't already appear in the instrument header (which shows
  // circulation, total issued, total redeemed): what share sits in treasury vs
  // out with holders, and how many on-chain actions the instrument has seen.
  const heldByOthersLabel = circulation != null && balance != null
    ? formatAmount(Math.max(0, circulation - balance), decimals)
    : null
  const actionCount = summary?.actionCount ?? null

  // ── Reserve backing (full-reserve gate for sending) ──────────────────────────
  // Free supply = units in public hands (circulation minus treasury); free
  // reserves must cover it. Sending treasury units increases free supply, so we
  // only allow sending while reserves >= free supply.
  const reserves = reservesTotalOf(useReserveBucket(assetId))
  const circHuman = circulation != null ? circulation / 10 ** decimals : 0
  const treasuryHuman = balance != null ? balance / 10 ** decimals : 0
  const freeSupply = Math.max(0, circHuman - treasuryHuman)
  const fullyBacked = circHuman <= 0 ? true : reserves >= circHuman
  const canSend = reserves >= freeSupply

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex max-w-3xl flex-col gap-[26px]">
      <TabHeader
        title="Treasury holdings"
        description="The units this issuer holds in treasury, ready to send or receive."
        guide="/help/for-issuers/backing-instruments-with-reserves"
      />

      {/* Balance card - themed security-textured surface, white text. */}
      <div className="relative overflow-hidden rounded-lg border border-black/10 bg-neutral-950 px-6 py-5 shadow-[var(--shadow-card)]">
        {/* Layers: guilloché texture (kept visible), a lighter theme-colour
            matte, and a soft vignette for text contrast. */}
        <img src={texture} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: themeColor, opacity: 0.34 }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/40 via-transparent to-black/40" />

        <div className="relative">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[1.2px] text-white/70">
              Treasury balance
            </span>
            {fullyBacked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white ring-1 ring-inset ring-white/25">
                <ShieldCheck className="size-3" strokeWidth={2.5} />
                Reserve-backed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/25 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-warning ring-1 ring-inset ring-warning/40">
                <AlertTriangle className="size-3" strokeWidth={2.5} />
                Under-reserved
              </span>
            )}
          </div>

          {loading ? (
            <div className="h-[44px] w-[180px] animate-pulse rounded-sm bg-white/20" />
          ) : (
            <div className={cn('tabular text-[44px] font-semibold leading-none tracking-[-1.5px]', isEmpty ? 'text-white/55' : 'text-white')}>
              {balanceNumber}
              {ticker != null && <span className="ml-2 align-baseline text-[24px] font-light tracking-tight text-white/70">{ticker}</span>}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-white/70">
            <span>Held by this issuer</span>
            {identityKey != null && (
              <>
                <span aria-hidden>&middot;</span>
                <IdentitySigil value={identityKey} size={16} className="rounded ring-1 ring-white/30" />
                {issuerName.trim() !== '' && (
                  <span className="font-medium text-white">{issuerName.trim()}</span>
                )}
                <span className="tabular font-mono text-white/80">{keyAbbr}</span>
              </>
            )}
          </div>

          {/* Auditor context - stats not already in the instrument header. */}
          {(treasuryShare != null || heldByOthersLabel != null || actionCount != null) && (
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-white/15 pt-3">
              {treasuryShare != null && (
                <div>
                  <div className="tabular text-[15px] font-semibold text-white">{treasuryShare}%</div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-white/55">Held in treasury</div>
                </div>
              )}
              {heldByOthersLabel != null && (
                <div>
                  <div className="tabular text-[15px] font-semibold text-white">
                    {heldByOthersLabel}{ticker != null && <span className="ml-1 text-[12px] font-medium text-white/70">{ticker}</span>}
                  </div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-white/55">Held by holders</div>
                </div>
              )}
              {actionCount != null && (
                <div>
                  <div className="tabular text-[15px] font-semibold text-white">{actionCount.toLocaleString()}</div>
                  <div className="text-[11px] font-medium uppercase tracking-wide text-white/55">On-chain actions</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!loading && isEmpty && !isAuditor && (
        <div className="flex flex-col items-center gap-5 rounded-lg border border-separator bg-card py-12 text-center shadow-[var(--shadow-card)]">
          {/* Ghost balance illustration */}
          <div className="relative w-[240px] rounded-xl border border-border bg-background p-4 text-left shadow-[var(--shadow-card)]">
            <div className="text-[8px] font-bold uppercase tracking-wide text-faint-foreground">Treasury balance</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="grid size-8 place-items-center rounded-lg bg-muted"><Coins className="size-4 text-faint-foreground" /></div>
              <div className="h-6 w-24 rounded bg-muted" />
            </div>
            <div className="mt-3 h-2 w-32 rounded bg-muted" />
          </div>
          <div className="max-w-sm space-y-1 px-4">
            <p className="text-[16px] font-medium text-foreground">No units in circulation yet</p>
            <p className="text-balance text-[14px] text-muted-foreground">
              Issue reserve-backed units of {asset?.label ?? 'this instrument'} to put them into circulation.
            </p>
          </div>
          <Button
            onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('tab', 'operations'); return n }, { replace: true })}
            className="gap-2"
          >
            <Plus className="size-4" /> Issue units
          </Button>
        </div>
      )}

      {/* Send / Receive - manila-folder tabs, issuer-only (auditors are read-only) */}
      {!isAuditor && (
      <div>
        {/* Folder tabs */}
        <div className="flex gap-1">
          {(['send', 'receive'] as const).map(t => {
            const active = tab === t
            const Icon = t === 'send' ? ArrowUpRight : ArrowDownLeft
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'z-10 border-border bg-card text-foreground'
                    : 'border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} />
                {t === 'send' ? 'Send tokens' : 'Receive'}
              </button>
            )
          })}
        </div>

        {/* Folder body */}
        <div className="relative overflow-hidden rounded-lg rounded-tl-none border border-border bg-card shadow-[var(--shadow-card)]">
          {tab === 'send' && (
            canSend ? (
              <SendTokens lockedAssetId={assetId} initialRecipient={initialRecipient} bare />
            ) : (
              <div className="flex items-start gap-3 px-6 py-6">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                  <AlertTriangle className="size-4.5" />
                </div>
                <div className="space-y-1">
                  <p className="text-[14px] font-medium text-foreground">Sending is paused - free reserves below free supply</p>
                  <p className="text-balance text-[13px] text-muted-foreground">
                    Units already in holders' hands ({formatAmount(Math.max(0, (circulation ?? 0) - (balance ?? 0)), decimals)} {ticker ?? ''}) exceed the recorded reserves. Add reserves under Attestations, or redeem units, before sending more from treasury.
                  </p>
                </div>
              </div>
            )
          )}
          {tab === 'receive' && (
            <div className="px-[24px] py-[20px]">
              <ReceivePanel />
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
