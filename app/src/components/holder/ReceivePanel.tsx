import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { toQrDataUrl } from '../../lib/mandala/qr'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

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
    <div className="flex flex-col items-center gap-6 py-4">
      <div>
        <h3 className="text-center text-[15px] font-semibold">Your receive address</h3>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          Share your identity key or QR code to receive tokens.
        </p>
      </div>

      {qrDataUrl ? (
        <div className="rounded-[--radius-lg] border border-separator bg-white p-3 shadow-[var(--shadow-card)]">
          <img
            src={qrDataUrl}
            alt="QR code for your identity key"
            className="h-[220px] w-[220px]"
          />
        </div>
      ) : (
        <div className="flex h-[220px] w-[220px] animate-pulse items-center justify-center rounded-[--radius-lg] bg-muted">
          <Spinner size="lg" tone="brand" />
        </div>
      )}

      <div className="w-full max-w-sm space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Identity key</p>
        <div className="flex items-center gap-2 rounded-[--radius] border border-input-border bg-input px-3.5 py-2.5">
          <p className="tabular flex-1 truncate text-[12px] text-foreground">{identityKey}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCopy()}
            className="h-8 shrink-0 px-2"
            title="Copy identity key"
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
