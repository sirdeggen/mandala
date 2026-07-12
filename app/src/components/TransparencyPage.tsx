/**
 * Public proof-of-reserves / transparency page. Reachable without a wallet, it
 * shows every instrument's circulating supply, recorded reserves, backing ratio,
 * latest signed attestation and redemption terms - the supply figures settle on
 * the public ledger and attestations are anchored on-chain, so anyone (holder,
 * auditor, regulator) can verify without trusting the issuer.
 */
import { Link } from 'react-router-dom'
import { ShieldCheck, TriangleAlert, ExternalLink, ArrowLeft, BadgeCheck } from 'lucide-react'
import { useAdminAssets } from '../hooks/useAdminAssets'
import { useAdminSummaries } from '../hooks/useAdminHistory'
import { useComplianceSnapshot, reservesTotalOf } from '../lib/compliance'
import { useCompanyLogo } from '../lib/companyLogo'
import { useOnboarding } from '../lib/onboarding'
import { BrandMark } from './ui/BrandMark'
import { cn } from '@/lib/utils'

const compact = (n: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)

export default function TransparencyPage() {
  const { data } = useAdminAssets()
  const assets = data ?? []
  const summaries = useAdminSummaries(assets.map(a => a.assetId))
  const snap = useComplianceSnapshot()
  const companyLogo = useCompanyLogo()
  const companyName = useOnboarding().entity?.legalName || 'Your organisation'

  const rows = assets.map(a => {
    const decimals = Number(a.metadata?.decimals) || 0
    const ticker = a.metadata?.ticker != null ? String(a.metadata.ticker).toUpperCase() : ''
    const s = summaries[a.assetId]
    const circulation = s != null ? (s.totalIssued - s.totalRedeemed) / 10 ** decimals : 0
    const reserves = reservesTotalOf(snap.buckets[a.assetId] ?? { composition: [], circulation: 0 })
    const backing = circulation > 0 ? (reserves / circulation) * 100 : (reserves > 0 ? 100 : null)
    const att = snap.attestations.filter(x => x.assetId === a.assetId).sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''))[0]
    return { asset: a, ticker, circulation, reserves, backing, att }
  })

  const fullyBackedCount = rows.filter(r => r.backing != null && r.backing >= 100).length

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            {companyLogo != null
              ? <img src={companyLogo} alt="" className="size-10 rounded-lg border border-border object-contain" />
              : <BrandMark />}
            <div>
              <div className="text-[15px] font-semibold text-foreground">{companyName}</div>
              <div className="text-[12.5px] text-muted-foreground">Live reserve transparency</div>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] text-muted-foreground">
            <ShieldCheck className="size-4 text-success" />
            Verifiable on the public ledger
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <h1 className="font-heading text-[28px] font-medium tracking-[-0.02em] text-foreground">Proof of reserves</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Every unit in circulation settles on a public blockchain and is backed by recorded reserves.
          Period attestations are cryptographically signed and anchored on-chain, so backing can be
          checked independently, not taken on trust.
        </p>

        {/* Summary strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Instruments" value={String(assets.length)} />
          <Kpi label="Fully backed" value={`${fullyBackedCount}/${assets.length}`} tone={assets.length > 0 && fullyBackedCount === assets.length ? 'success' : 'warning'} />
          <Kpi label="Signed attestations" value={String(snap.attestations.filter(a => a.status === 'signed').length)} />
          <Kpi label="Anchored on-chain" value={String(snap.attestations.filter(a => a.anchorTxid != null).length)} />
        </div>

        {/* Per-instrument */}
        <div className="mt-8 space-y-4">
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-[13.5px] text-muted-foreground">
              No instruments in circulation yet.
            </p>
          ) : rows.map(({ asset, ticker, circulation, reserves, backing, att }) => {
            const fullyBacked = backing != null && backing >= 100
            return (
              <div key={asset.assetId} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[17px] font-semibold text-foreground">{asset.label}</div>
                    {ticker !== '' && <div className="text-[12.5px] font-medium text-subtle-foreground">{ticker}</div>}
                  </div>
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
                    backing == null ? 'bg-muted text-muted-foreground' : fullyBacked ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {backing == null ? 'Not yet issued' : fullyBacked ? <><ShieldCheck className="size-3.5" /> Fully backed</> : <><TriangleAlert className="size-3.5" /> Under-reserved</>}
                  </span>
                </div>

                {/* Figures */}
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Figure label="In circulation" value={compact(circulation)} suffix={ticker} />
                  <Figure label="Reserves recorded" value={compact(reserves)} suffix={ticker} />
                  <Figure label="Backing" value={backing != null ? `${backing.toFixed(1)}%` : '—'} tone={backing == null ? undefined : fullyBacked ? 'success' : 'warning'} />
                </div>

                {/* Backing bar */}
                {backing != null && (
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', fullyBacked ? 'bg-success' : 'bg-warning')} style={{ width: `${Math.min(100, backing)}%` }} />
                  </div>
                )}

                {/* Attestation + terms */}
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-separator pt-3 text-[12.5px]">
                  {att != null && att.status === 'signed' ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <BadgeCheck className="size-4 text-success" />
                      Attested {att.period} by <span className="font-medium text-foreground">{att.auditorName ?? 'auditor'}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Attestation pending</span>
                  )}
                  {att?.anchorTxid != null && (
                    <a href={`https://whatsonchain.com/tx/${att.anchorTxid}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      <ExternalLink className="size-3.5" /> Verify attestation on-chain
                    </a>
                  )}
                  <span className="text-muted-foreground">Redeemable at par (1:1)</span>
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-8 text-[12px] leading-relaxed text-subtle-foreground">
          Supply figures are derived from the public ledger. Attestations shown as anchored carry an
          on-chain transaction you can open above. This is a demonstration deployment; reserve and
          attestation data are illustrative until connected to your production reserve and audit feeds.
        </p>

        <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to the app
        </Link>
      </main>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className={cn('tabular text-[22px] font-semibold leading-none', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground')}>{value}</div>
      <div className="mt-1 text-[12px] text-muted-foreground">{label}</div>
    </div>
  )
}

function Figure({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone?: 'success' | 'warning' }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className={cn('mt-1 tabular text-[22px] font-semibold leading-none', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground')}>
        {value}{suffix != null && suffix !== '' && value !== '—' && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}
