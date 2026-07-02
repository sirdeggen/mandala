import { useEffect, useState } from 'react'
import { ArrowUpRight, ArrowDownLeft, Download } from 'lucide-react'
import { IdentityClient } from '@bsv/sdk'
import { useWallet } from '../../context/WalletContext'
import { loadHistory, exportTransactionsCsv, HistoryRow } from '../../lib/mandala/history'
import { formatCurrency } from '../../lib/mandala/amount'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

interface ResolvedIdentity {
  name?: string
  badgeLabel?: string
  avatarURL?: string
}

interface Props {
  assetId: string
  decimals: number
  ticker?: string
}

// Abbreviate a key (or any long string) to first 8 + "…"
function abbreviate(key: string): string {
  if (key.length <= 12) return key
  return `${key.slice(0, 8)}…`
}

function DirectionIcon({ direction }: { direction: HistoryRow['direction'] }) {
  const isSent = direction === 'sent' || direction === 'redeemed'
  return isSent
    ? <ArrowUpRight className="h-4 w-4 shrink-0 text-destructive" />
    : <ArrowDownLeft className="h-4 w-4 shrink-0 text-success" />
}

interface CounterpartyProps {
  identityKey: string
  wallet: import('@bsv/sdk').WalletInterface | null
}

function CounterpartyDisplay({ identityKey, wallet }: CounterpartyProps) {
  const [resolved, setResolved] = useState<ResolvedIdentity | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!identityKey || wallet == null) return
    let cancelled = false
    setLoading(true)
    const client = new IdentityClient(wallet as any)
    client.resolveByIdentityKey({ identityKey })
      .then(results => {
        if (!cancelled && results.length > 0) {
          const r = results[0]
          setResolved({
            name: r.name,
            badgeLabel: r.badgeLabel,
            avatarURL: r.avatarURL
          })
        }
      })
      .catch(() => { /* fall back to abbreviated key */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [identityKey, wallet])

  if (!identityKey) return <span className="text-subtle-foreground">—</span>
  if (loading) return <span className="animate-pulse text-subtle-foreground">{abbreviate(identityKey)}</span>

  if (resolved?.name) {
    return (
      <span className="flex items-center gap-1.5">
        {resolved.avatarURL && (
          <img src={resolved.avatarURL} alt={resolved.name} className="h-5 w-5 rounded-full" />
        )}
        <span className="font-medium">{resolved.name}</span>
        {resolved.badgeLabel && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
            {resolved.badgeLabel}
          </span>
        )}
      </span>
    )
  }

  return <span className="tabular text-subtle-foreground">{abbreviate(identityKey)}</span>
}

export default function TransactionHistory({ assetId, decimals, ticker }: Props) {
  const { wallet } = useWallet()
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (wallet == null) return
    setLoading(true)
    loadHistory(wallet as any, assetId)
      .then(setRows)
      .catch(e => console.error('TransactionHistory load error', e))
      .finally(() => setLoading(false))
  }, [wallet, assetId])

  const handleExportCsv = () => {
    const csv = exportTransactionsCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${assetId.slice(0, 12)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Spinner size="md" tone="brand" />
        Loading history…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-[13px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}
        </p>
        {rows.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        )}
      </div>

      {rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <h3 className="text-[15px] font-semibold">No transactions yet</h3>
          <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
            Transfers and receipts for this asset will appear here.
          </p>
        </div>
      )}

      {rows.map((row, i) => {
        const isSent = row.direction === 'sent' || row.direction === 'redeemed'
        return (
          <div
            key={`${row.txid}-${i}`}
            className="flex items-center gap-3 rounded-[--radius-md] border border-separator p-3 transition-colors hover:bg-muted/40"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
              <DirectionIcon direction={row.direction} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium capitalize">{row.direction}</p>
              <div className="mt-0.5 text-[12px]">
                <CounterpartyDisplay identityKey={row.counterparty} wallet={wallet} />
              </div>
            </div>
            <div className="text-right">
              <p className={`tabular text-[16px] font-semibold leading-none ${isSent ? 'text-destructive' : 'text-success'}`}>
                {isSent ? '−' : '+'}{formatCurrency(row.amount, decimals, ticker)}
              </p>
              <p className="mt-0.5 text-[11px] text-subtle-foreground">—</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
