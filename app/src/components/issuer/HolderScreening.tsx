import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Search, RefreshCw, Check, X, Trash2, ShieldAlert, Info, Plug } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import {
  useHolders, useTravelRule, screenHolder, setKyc, removeHolder, setTravelRule,
  type HolderRecord, type KycStatus, type RiskRating, type SanctionsResult,
} from '../../lib/compliance'
import { useOnboarding, isReviewerRole } from '../../lib/onboarding'
import { useActiveIntegration } from '../../lib/integrations'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { RelationshipField } from './RelationshipField'
import { IdentityKeyPopover } from './IdentityKeyPopover'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
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
  const screeningVia = useActiveIntegration('screening')
  const navigate = useNavigate()
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-muted-foreground">
                  Screen a holder against sanctions &amp; PEP lists and record their KYC status.{' '}
                  {screeningVia != null
                    ? <>Screening runs via <span className="font-medium text-foreground">{screeningVia.providerName}</span>.</>
                    : <>Screening is simulated against a sample watchlist.</>}
                </p>
                {screeningVia != null ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-medium text-success">
                    <Plug className="size-3" /> Live · {screeningVia.providerName} · {screeningVia.environment}
                  </span>
                ) : (
                  <button type="button" onClick={() => navigate('/issuer/integrations')} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                    <Plug className="size-3" /> Connect a screening provider
                  </button>
                )}
              </div>
              <Popover>
                <PopoverTrigger className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
                  <Info className="size-3.5" /> How screening works
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-2 p-3 text-[12px] leading-relaxed text-muted-foreground">
                  <p className="text-[12.5px] font-semibold text-foreground">Where these classifications come from</p>
                  <p><span className="font-medium text-foreground">Sanctions</span> — the holder's name is matched against a bundled sample watchlist, and the demo additionally flags a deterministic subset of Badge IDs so hits are visible. In production this is where real OFAC / EU / UN feeds are wired in.</p>
                  <p><span className="font-medium text-foreground">PEP</span> &amp; <span className="font-medium text-foreground">Risk</span> — derived deterministically from the Badge ID, so each holder gets a stable, realistic rating standing in for a screening provider's output.</p>
                  <p><span className="font-medium text-foreground">KYC</span> — not screened; the issuer sets it manually with the actions on each holder row.</p>
                </PopoverContent>
              </Popover>
            </div>
            {!isAuditor && (
              <form onSubmit={screen} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Holder name (optional)" className="h-10 text-[13px]" />
                <RelationshipField
                  id="hs-key"
                  value={key}
                  onChange={setKey}
                  onSelect={r => { setKey(r.identityKey); if (r.name) setName(r.name) }}
                  placeholder="Relationship or Badge ID"
                  className="h-10 font-mono text-[12px]"
                />
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

const KYC_STYLE: Record<KycStatus, { label: string; cls: string; tip: string }> = {
  unverified: { label: 'Unverified', cls: 'bg-muted text-muted-foreground', tip: 'No identity verification on file for this holder yet.' },
  pending: { label: 'KYC pending', cls: 'bg-warning/10 text-warning', tip: 'KYC documents submitted and awaiting review.' },
  verified: { label: 'KYC verified', cls: 'bg-success/10 text-success', tip: 'Identity verified to KYC/AML standard.' },
  rejected: { label: 'KYC rejected', cls: 'bg-destructive/10 text-destructive', tip: 'KYC checks failed - this holder is not verified.' },
}
const SANCTIONS_STYLE: Record<SanctionsResult, { label: string; cls: string; tip: string }> = {
  unscreened: { label: 'Unscreened', cls: 'bg-muted text-muted-foreground', tip: 'Not yet checked against the sanctions & PEP watchlist.' },
  clear: { label: 'Sanctions clear', cls: 'bg-success/10 text-success', tip: 'No match against the sanctions watchlist.' },
  hit: { label: 'Sanctions hit', cls: 'bg-destructive/10 text-destructive', tip: 'Matched a sanctions entry - review and ban before allowing activity.' },
}
const RISK_STYLE: Record<RiskRating, { label: string; cls: string; tip: string }> = {
  low: { label: 'Low risk', cls: 'bg-muted text-muted-foreground', tip: 'Low AML risk rating - standard monitoring.' },
  medium: { label: 'Medium risk', cls: 'bg-warning/10 text-warning', tip: 'Medium AML risk - keep activity under review.' },
  high: { label: 'High risk', cls: 'bg-destructive/10 text-destructive', tip: 'High AML risk - enhanced due diligence required.' },
}

const PEP_TIP = 'Politically Exposed Person - enhanced due diligence applies.'

function Pill({ label, cls, tip }: { label: string; cls: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn('cursor-default rounded-full px-2 py-0.5 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60', cls)}>{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-center">{tip}</TooltipContent>
    </Tooltip>
  )
}

function HolderRow({ holder, readOnly }: { holder: HolderRecord; readOnly: boolean }) {
  const hit = holder.sanctions === 'hit'
  return (
    <div className={cn('rounded-lg border p-3', hit ? 'border-destructive/30 bg-destructive/5' : 'border-border')}>
      <div className="flex items-center gap-3">
        <IdentitySigil value={holder.identityKey} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-foreground">{holder.name || 'Holder'}</div>
          <IdentityKeyPopover value={holder.identityKey}>
            <span className="font-mono text-[11px] text-subtle-foreground">
              {holder.identityKey.length > 12 ? `${holder.identityKey.slice(0, 5)}…${holder.identityKey.slice(-5)}` : holder.identityKey}
            </span>
          </IdentityKeyPopover>
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

      <TooltipProvider delayDuration={150}>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Pill {...KYC_STYLE[holder.kyc]} />
          <Pill {...SANCTIONS_STYLE[holder.sanctions]} />
          {holder.pep && <Pill label="PEP" cls="bg-warning/10 text-warning" tip={PEP_TIP} />}
          <Pill {...RISK_STYLE[holder.risk]} />
        </div>
      </TooltipProvider>

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
