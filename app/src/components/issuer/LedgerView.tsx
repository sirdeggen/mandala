/**
 * Accounting ledger for an instrument. A double-entry view derived from the
 * events the platform already records: reserve deposits/withdrawals (bank feed),
 * mint requests (issuance) and redemptions (burns). It presents the issuer's
 * balance sheet at a glance (reserve cash as an asset, tokens in circulation as
 * a liability), the funds in transit between a deposit and its mint, the reserve
 * sub-accounts by bank, and the journal. On-chain supply is authoritative; this
 * is the off-chain accounting mirror finance teams reconcile against.
 */
import { useMemo } from 'react'
import { ArrowDownLeft, ArrowUpRight, CirclePlus, CircleMinus, Landmark } from 'lucide-react'
import { formatAmount } from '@bsv/mandala/amount'
import { AdminAsset } from '@bsv/mandala/assets'
import { useAdminSummary } from '../../hooks/useAdminHistory'
import { useWallet } from '../../context/WalletContext'
import { useMockTransfers } from '../../lib/mandala/mockBankStore'
import { useMintRequests } from '../../lib/orchestration'
import { useRedemptionRequests } from '../../lib/compliance'
import { bankForRef } from '@/content/banks'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { cn } from '@/lib/utils'

const ACCT_RESERVE = 'Reserve · Cash'
const ACCT_TRANSIT = 'Customer funds · in transit'
const ACCT_CIRC = 'Tokens in circulation'

interface JournalLine {
  id: string
  at: number
  description: string
  dr: string
  cr: string
  amount: number
  status: 'settled' | 'pending'
  Icon: typeof CirclePlus
}

export default function LedgerView({ assetId, asset, decimals }: { assetId: string; asset: AdminAsset | null; decimals: number }) {
  const { wallet } = useWallet()
  const ticker = asset?.metadata?.ticker != null ? String(asset.metadata.ticker).toUpperCase() : ''
  const transfers = useMockTransfers(assetId)
  const mints = useMintRequests(assetId)
  const redemptions = useRedemptionRequests(assetId)
  const summary = useAdminSummary(wallet != null ? assetId : '').data

  const fmt = (n: number) => formatAmount(n, decimals)

  const balances = useMemo(() => {
    const deposits = transfers.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0)
    const withdrawals = transfers.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0)
    const reserveCash = deposits - withdrawals
    const circulation = summary != null ? summary.totalIssued - summary.totalRedeemed : 0
    const inTransit = mints.filter(m => m.status === 'pending').reduce((s, m) => s + m.amount, 0)
    return { reserveCash, circulation, inTransit }
  }, [transfers, summary, mints])

  const subAccounts = useMemo(() => {
    const byBank = new Map<string, { name: string; short: string; color: string; balance: number }>()
    for (const t of transfers) {
      const bank = bankForRef(t.id)
      const cur = byBank.get(bank.name) ?? { name: bank.name, short: bank.short, color: bank.color, balance: 0 }
      cur.balance += t.direction === 'in' ? t.amount : -t.amount
      byBank.set(bank.name, cur)
    }
    return [...byBank.values()].filter(b => b.balance !== 0).sort((a, b) => b.balance - a.balance)
  }, [transfers])

  const journal = useMemo(() => {
    const lines: JournalLine[] = []
    for (const t of transfers) {
      const bank = bankForRef(t.id)
      lines.push(t.direction === 'in'
        ? { id: `dep-${t.id}`, at: t.timestamp, description: `Reserve deposit · ${t.originator}`, dr: ACCT_RESERVE, cr: ACCT_TRANSIT, amount: t.amount, status: 'settled', Icon: ArrowDownLeft }
        : { id: `wd-${t.id}`, at: t.timestamp, description: `Reserve withdrawal · ${bank.name}`, dr: ACCT_TRANSIT, cr: ACCT_RESERVE, amount: t.amount, status: 'settled', Icon: ArrowUpRight })
    }
    for (const m of mints) {
      if (m.status === 'rejected') continue
      lines.push({
        id: `mint-${m.id}`,
        at: new Date(m.settledAt ?? m.requestedAt).getTime(),
        description: m.status === 'settled' ? `Issued ${ticker}` : 'Mint pending approval',
        dr: ACCT_TRANSIT, cr: ACCT_CIRC, amount: m.amount, status: m.status === 'settled' ? 'settled' : 'pending', Icon: CirclePlus,
      })
    }
    for (const r of redemptions) {
      if (r.status === 'rejected') continue
      lines.push({
        id: `rdm-${r.id}`,
        at: new Date(r.processedAt ?? r.requestedAt).getTime(),
        description: r.status === 'settled' ? `Redeemed ${ticker} · ${r.holderName || 'holder'}` : 'Redemption pending settlement',
        dr: ACCT_CIRC, cr: ACCT_RESERVE, amount: r.amount, status: r.status === 'settled' ? 'settled' : 'pending', Icon: CircleMinus,
      })
    }
    return lines.sort((a, b) => b.at - a.at)
  }, [transfers, mints, redemptions, ticker])

  const balanced = balances.reserveCash === balances.circulation

  return (
    <div className="space-y-6">
      {/* Balance sheet summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BalanceCard label="Reserve cash (assets)" value={fmt(balances.reserveCash)} suffix={ticker} />
        <BalanceCard label="Tokens in circulation (liabilities)" value={fmt(balances.circulation)} suffix={ticker} />
        <BalanceCard label="Funds in transit" value={fmt(balances.inTransit)} suffix={ticker} muted />
      </div>

      <div className={cn('flex items-center justify-between rounded-lg border px-4 py-2.5 text-[13px]',
        balanced ? 'border-success/30 bg-success/[0.06] text-success' : 'border-warning/30 bg-warning/[0.06] text-warning')}>
        <span className="font-medium">Assets vs liabilities</span>
        <span className="tabular font-semibold">
          {balanced ? 'Balanced · 1:1' : `Variance ${fmt(balances.reserveCash - balances.circulation)} ${ticker}`}
        </span>
      </div>

      {/* Reserve sub-accounts */}
      {subAccounts.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Reserve sub-accounts</div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {subAccounts.map((b, i) => (
              <div key={b.name} className={cn('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-separator')}>
                <CompanyAvatar name={b.name} size={32} className="rounded-lg" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{b.name}</span>
                <span className="tabular text-[13px] font-semibold">{fmt(b.balance)} {ticker}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journal */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Journal</div>
        {journal.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
            No entries yet. Reserve deposits, issuance and redemptions post here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[1.6fr_1fr_1fr_120px_90px] gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wide text-subtle-foreground sm:grid">
              <div>Entry</div><div>Debit</div><div>Credit</div><div className="text-right">Amount</div><div className="text-right">Status</div>
            </div>
            {journal.map((l, i) => (
              <div key={l.id} className={cn('grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[1.6fr_1fr_1fr_120px_90px] sm:items-center sm:gap-2', i > 0 && 'border-t border-separator')}>
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <l.Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="truncate">{l.description}</span>
                </div>
                <div className="text-[12px] text-muted-foreground"><span className="sm:hidden">Dr </span>{l.dr}</div>
                <div className="text-[12px] text-muted-foreground"><span className="sm:hidden">Cr </span>{l.cr}</div>
                <div className="tabular text-[13px] font-semibold sm:text-right">{fmt(l.amount)} {ticker}</div>
                <div className="sm:text-right">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                    l.status === 'settled' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {l.status === 'settled' ? 'Posted' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="flex items-start gap-2 text-[11.5px] leading-snug text-subtle-foreground">
        <Landmark className="mt-0.5 size-3.5 shrink-0" />
        On-chain supply is authoritative. This accounting ledger mirrors it off-chain from the reserve
        feed, issuance and redemptions, so finance can reconcile the balance sheet.
      </p>
    </div>
  )
}

function BalanceCard({ label, value, suffix, muted }: { label: string; value: string; suffix: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className={cn('mt-1.5 tabular text-[22px] font-semibold leading-none', muted ? 'text-muted-foreground' : 'text-foreground')}>
        {value}{suffix !== '' && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}
