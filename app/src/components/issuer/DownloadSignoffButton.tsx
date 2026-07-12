import { useState } from 'react'
import { toast } from 'sonner'
import { Download, ShieldCheck, FileSignature } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useWallet } from '../../context/WalletContext'
import { signStatement } from '../../lib/complianceSignature'
import { anchorOnChain } from '../../lib/onchainAnchor'
import { recordDownloadAuth, type ExportRecord } from '../../lib/exportHistory'
import { FORMAT_LABEL } from '../../lib/exports'

const fmtEvent = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Signed download events for a record, shown as sub-rows under it in the
 *  recent-exports list - each authorisation is a distinct, on-chain-anchored
 *  audit event. */
export function DownloadEventRows({ record }: { record: ExportRecord }) {
  if (record.downloads == null || record.downloads.length === 0) return null
  return (
    <>
      {record.downloads.map((d, i) => (
        <div key={`${d.txid}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-separator/60 bg-muted/20 px-3 py-1.5 pl-7 text-[11px] text-subtle-foreground">
          <FileSignature className="size-3 shrink-0 text-success" />
          <span className="font-medium text-foreground">Signed download</span>
          <span>· {fmtEvent(d.at)}</span>
          <a
            href={`https://whatsonchain.com/tx/${d.txid}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ShieldCheck className="size-3" /> anchored · {d.txid.slice(0, 10)}…
          </a>
        </div>
      ))}
    </>
  )
}

/**
 * Download control for a recent export. Downloading exported compliance records
 * is itself a controlled action: the user must sign off with their wallet, which
 * anchors the authorisation on-chain (an audit trail of who took the data out
 * and when). The popover explains this and issues the signing request; only on a
 * successful signature does the file generation run.
 */
export function DownloadSignoffButton({ record, onDownload }: {
  record: ExportRecord
  /** Generate the actual file(s) - run only after a signed authorisation. */
  onDownload: () => void
}) {
  const { wallet, identityKey } = useWallet()
  const [open, setOpen] = useState(false)
  const [signing, setSigning] = useState(false)

  const authorizeAndDownload = async () => {
    if (wallet == null || identityKey == null) { toast.error('Connect a wallet to authorise the download.'); return }
    setSigning(true)
    try {
      const at = new Date().toISOString()
      const message = JSON.stringify({
        kind: 'export-download',
        recordId: record.id,
        report: record.reportName,
        formats: record.formats,
        rowCount: record.rowCount,
        signerKey: identityKey,
        at,
      })
      // Wallet signature over the authorisation, then anchor it on-chain.
      const signature = await signStatement(wallet, `download:${record.id}:${at}`, message)
      const txid = await anchorOnChain(wallet, `download:${record.id}:${at}`, { message, signature, signerKey: identityKey }, `export download ${record.reportName}`)
      recordDownloadAuth(record.id, txid)
      onDownload()
      setOpen(false)
      toast.success('Download authorised and anchored on-chain')
    } catch {
      toast.error('Could not authorise the download')
    } finally {
      setSigning(false)
    }
  }

  const lastAuth = record.downloads?.[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Download"
        className="grid size-7 place-items-center rounded border border-border text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Download className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-foreground">Sign off to download</div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
              Taking compliance records out is a controlled action. Sign with your wallet to authorise this download.
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-subtle-foreground">
          {record.reportName} · {record.formats.map(f => FORMAT_LABEL[f]).join(', ')}
        </p>
        <button
          type="button"
          onClick={authorizeAndDownload}
          disabled={signing}
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <FileSignature className="size-3.5" /> {signing ? 'Signing…' : 'Sign & download'}
        </button>
        {lastAuth != null && (
          <a
            href={`https://whatsonchain.com/tx/${lastAuth.txid}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-[10.5px] text-primary hover:underline"
          >
            Last authorised on-chain · {lastAuth.txid.slice(0, 10)}…
          </a>
        )}
      </PopoverContent>
    </Popover>
  )
}
