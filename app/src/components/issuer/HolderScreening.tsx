import { useState } from 'react'
import { toast } from 'sonner'
import { Search, RefreshCw, Check, X, Trash2, ShieldAlert } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import {
  useHolders, useTravelRule, screenHolder, setKyc, removeHolder, setTravelRule,
  type HolderRecord, type KycStatus, type RiskRating, type SanctionsResult,
} from '../../lib/compliance'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { cn } from '@/lib/utils'

/**
 * Holder screening & KYC - the AML compliance floor. Screen a holder's Badge ID
 * against a (simulated) sanctions/PEP watchlist, track KYC status and risk, and
 * configure the Travel Rule threshold. Records are global per Badge ID, so a
 * holder screened/verified once carries across every instrument.
 */
export default function HolderScreening({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const holders = useHolders()
  const travelRule = useTravelRule(assetId)
  const isAuditor = isReviewerRole(useOnboarding().role)
  const currency = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : 'units'

  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [tab, setTab] = useState<'screening' | 'travel'>('screening')

  function screen(e: React.FormEvent) {
    e.preventDefault()
    if (key.trim() === '') { toast.error('Enter the holder’s Badge ID.'); return }
    const rec = screenHolder({ identityKey: key.trim(), name: name.trim() })
    toast[rec.sanctions === 'hit' ? 'error' : 'success'](
      rec.sanctions === 'hit' ? 'Sanctions hit - review before allowing' : 'Screened - no sanctions match'
    )
    setName(''); setKey('')
  }

  const TABS = [
    { id: 'screening' as const, label: 'Screening & KYC' },
    { id: 'travel' as const, label: 'Travel Rule' },
  ]

  return (
    <div>
      {/* Folder tabs */}
      <div className="flex gap-1">
        {TABS.map(({ id, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'relative -mb-px flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-[13px] font-medium transition-colors',
                active
                  ? 'z-10 border-border bg-card text-foreground'
                  : 'border-transparent bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Folder body */}
      <div className="relative rounded-lg rounded-tl-none border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        {tab === 'screening' && (
          <div>
            <p className="text-[12px] text-muted-foreground">
              Screen a holder against sanctions &amp; PEP lists and record their KYC status. Screening is simulated against a sample watchlist.
            </p>
            {!isAuditor && (
              <form onSubmit={screen} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Holder name (optional)" className="h-10 text-[13px]" />
                <Input value={key} onChange={e => setKey(e.target.value)} placeholder="Holder Badge ID" className="h-10 font-mono text-[12px]" />
                <Button type="submit" className="h-10 gap-1.5 px-3 text-[13px]">
                  <Search className="size-4" /> Screen
                </Button>
              </form>
            )}
            {holders.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">
                No holders screened yet.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {holders.map(h => <HolderRow key={h.identityKey} holder={h} readOnly={isAuditor} />)}
              </div>
            )}
          </div>
        )}

        {tab === 'travel' && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="max-w-md text-[12px] text-muted-foreground">
                Collect originator &amp; beneficiary details on transfers at or above the threshold.
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={travelRule.enabled}
                aria-label="Enforce Travel Rule"
                disabled={isAuditor}
                onClick={() => setTravelRule(assetId, { enabled: !travelRule.enabled })}
                className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50', travelRule.enabled ? 'bg-primary' : 'bg-muted-foreground/40')}
              >
                <span className={cn('inline-block size-4 transform rounded-full bg-white shadow transition-transform', travelRule.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]')} />
              </button>
            </div>
            <div className="mt-3 max-w-xs space-y-1.5">
              <Label htmlFor="tr-threshold" className="text-[11px]">Threshold ({currency})</Label>
              <Input
                id="tr-threshold"
                type="number"
                min="0"
                step="any"
                disabled={!travelRule.enabled || isAuditor}
                value={travelRule.threshold !== 0 ? String(travelRule.threshold) : ''}
                placeholder="0"
                onChange={e => setTravelRule(assetId, { threshold: Number(e.target.value) || 0 })}
                className="tabular h-10 text-[13px]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Holder row ────────────────────────────────────────────────────────────────

const KYC_STYLE: Record<KycStatus, { label: string; cls: string }> = {
  unverified: { label: 'Unverified', cls: 'bg-muted text-muted-foreground' },
  pending: { label: 'KYC pending', cls: 'bg-warning/10 text-warning' },
  verified: { label: 'KYC verified', cls: 'bg-success/10 text-success' },
  rejected: { label: 'KYC rejected', cls: 'bg-destructive/10 text-destructive' },
}
const SANCTIONS_STYLE: Record<SanctionsResult, { label: string; cls: string }> = {
  unscreened: { label: 'Unscreened', cls: 'bg-muted text-muted-foreground' },
  clear: { label: 'Sanctions clear', cls: 'bg-success/10 text-success' },
  hit: { label: 'Sanctions hit', cls: 'bg-destructive/10 text-destructive' },
}
const RISK_STYLE: Record<RiskRating, { label: string; cls: string }> = {
  low: { label: 'Low risk', cls: 'bg-muted text-muted-foreground' },
  medium: { label: 'Medium risk', cls: 'bg-warning/10 text-warning' },
  high: { label: 'High risk', cls: 'bg-destructive/10 text-destructive' },
}

function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>{label}</span>
}

function HolderRow({ holder, readOnly }: { holder: HolderRecord; readOnly: boolean }) {
  const hit = holder.sanctions === 'hit'
  return (
    <div className={cn('rounded-lg border p-3', hit ? 'border-destructive/30 bg-destructive/5' : 'border-border')}>
      <div className="flex items-center gap-3">
        <IdentitySigil value={holder.identityKey} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-foreground">{holder.name || 'Holder'}</div>
          <div className="truncate font-mono text-[11px] text-subtle-foreground" title={holder.identityKey}>
            {holder.identityKey.length > 12 ? `${holder.identityKey.slice(0, 5)}…${holder.identityKey.slice(-5)}` : holder.identityKey}
          </div>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => { screenHolder({ identityKey: holder.identityKey, name: holder.name }); toast.success('Re-screened') }} aria-label="Re-screen" className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <RefreshCw className="size-4" />
            </button>
            <button type="button" onClick={() => { removeHolder(holder.identityKey); toast.success('Removed') }} aria-label="Remove holder" className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-destructive">
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Pill {...KYC_STYLE[holder.kyc]} />
        <Pill {...SANCTIONS_STYLE[holder.sanctions]} />
        {holder.pep && <Pill label="PEP" cls="bg-warning/10 text-warning" />}
        <Pill {...RISK_STYLE[holder.risk]} />
      </div>

      {hit && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-[12px] leading-snug text-muted-foreground">
            This Badge ID matched a sanctions entry. Ban it under <span className="font-medium text-foreground">Admin operations → Ban a Badge ID</span> below.
          </p>
        </div>
      )}

      {/* KYC actions */}
      {!readOnly && (
      <div className="mt-2.5 flex flex-wrap gap-2">
        {holder.kyc !== 'verified' && (
          <button type="button" onClick={() => { setKyc(holder.identityKey, 'verified'); toast.success('KYC verified') }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted">
            <Check className="size-3.5 text-success" /> Verify KYC
          </button>
        )}
        {holder.kyc !== 'pending' && holder.kyc !== 'verified' && (
          <button type="button" onClick={() => setKyc(holder.identityKey, 'pending')} className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted">
            Mark pending
          </button>
        )}
        {holder.kyc !== 'rejected' && (
          <button type="button" onClick={() => { setKyc(holder.identityKey, 'rejected'); toast.success('KYC rejected') }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted hover:text-destructive">
            <X className="size-3.5" /> Reject
          </button>
        )}
      </div>
      )}
    </div>
  )
}
