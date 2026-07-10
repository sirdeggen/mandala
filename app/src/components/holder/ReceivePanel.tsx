import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { toQrDataUrl } from '../../lib/mandala/qr'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { IdentitySigil } from '@/components/ui/identity-sigil'

export default function ReceivePanel() {
  const { identityKey } = useWallet()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!identityKey) return
    toQrDataUrl(identityKey)
      .then(setQrDataUrl)
      .catch(e => console.error('ReceivePanel: QR generation failed', e))
  }, [identityKey])

  const handleCopy = async () => {
    if (!identityKey) return
    await navigator.clipboard.writeText(identityKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!identityKey) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Spinner size="md" tone="brand" />
        Loading wallet…
      </div>
    )
  }

  return (
    // No heading - this panel always renders under a "Receive" label, and the
    // QR + key + copy affordances speak for themselves.
    <div className="flex flex-col items-center gap-6 py-4">
      {qrDataUrl ? (
        <div className="rounded-lg border border-separator bg-white p-3 shadow-[var(--shadow-card)]">
          <img
            src={qrDataUrl}
            alt="QR code for your Badge ID"
            className="h-[220px] w-[220px]"
          />
        </div>
      ) : (
        <div className="flex h-[220px] w-[220px] animate-pulse items-center justify-center rounded-lg bg-muted">
          <Spinner size="lg" tone="brand" />
        </div>
      )}

      <div className="w-full max-w-sm space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[1.2px] text-subtle-foreground">Badge ID</p>
        <div className="flex items-center gap-2.5 rounded border border-input-border bg-input px-3 py-2">
          <IdentitySigil value={identityKey} size={24} className="rounded" />
          <code
            className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
            title={identityKey}
          >
            {identityKey.length > 12 ? `${identityKey.slice(0, 5)}…${identityKey.slice(-5)}` : identityKey}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCopy()}
            className="h-8 shrink-0 px-2"
            title="Copy Badge ID"
          >
            {copied
              ? <Check className="h-4 w-4 text-success" />
              : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        {copied && (
          <p className="text-center text-[12px] text-success">Copied to clipboard!</p>
        )}
      </div>
    </div>
  )
}
