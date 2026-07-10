import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ArrowDownLeft, Coins, Plus } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset } from '@bsv/mandala/assets'
import { formatCurrency } from '@bsv/mandala/amount'
import { useHolderData } from '../../hooks/useHolderData'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
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

  const formattedBalance = balance != null
    ? formatCurrency(balance, decimals, ticker)
    : '-'

  const isEmpty = balance === 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex max-w-3xl flex-col gap-[26px]">
      <TabHeader
        title="Treasury holdings"
        description="The units this issuer holds in treasury, ready to send or receive."
        guide="/help/for-issuers/backing-instruments-with-reserves"
      />

      {/* Balance card */}
      <div className="rounded-lg border border-separator bg-card px-[24px] py-[20px] shadow-[var(--shadow-card)]">
        <div className="text-[11px] font-medium uppercase tracking-[1.2px] text-subtle-foreground mb-[10px]">
          Treasury balance
        </div>
        {loading ? (
          <div className="animate-pulse h-[44px] w-[180px] rounded-sm bg-muted" />
        ) : (
          <div
            className={cn(
              'tabular text-[44px] font-semibold leading-none tracking-[-1.5px]',
              isEmpty ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {formattedBalance}
          </div>
        )}
        <div className="mt-[10px] flex flex-wrap items-center gap-1.5 text-[12px] text-subtle-foreground">
          <span>Held by this issuer</span>
          {identityKey != null && (
            <>
              <span aria-hidden>&middot;</span>
              <IdentitySigil value={identityKey} size={16} className="rounded" />
              {issuerName.trim() !== '' && (
                <span className="font-medium text-foreground">{issuerName.trim()}</span>
              )}
              <span className="tabular font-mono">{keyAbbr}</span>
            </>
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
            <SendTokens lockedAssetId={assetId} initialRecipient={initialRecipient} bare />
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
