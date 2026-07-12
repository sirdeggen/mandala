/**
 * Issuer control for an instrument's public transparency page: publish or
 * unpublish it, copy/open its public URL, and preview exactly what the world
 * sees before turning it on.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Check, ExternalLink, Eye, Globe, FileSignature, ShieldCheck } from 'lucide-react'
import type { AdminAsset } from '@bsv/mandala/assets'
import { useWallet } from '../../context/WalletContext'
import { signStatement } from '../../lib/complianceSignature'
import { anchorOnChain } from '../../lib/onchainAnchor'
import { useTransparencyPublished, setTransparencyPublished } from '../../lib/transparencySettings'
import { InstrumentTransparencyView } from '../transparency/InstrumentTransparencyView'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import TabHeader from './TabHeader'
import { cn } from '@/lib/utils'

export default function InstrumentTransparencyTab({ assetId, asset }: { assetId: string; asset: AdminAsset | null }) {
  const { wallet, identityKey } = useWallet()
  const published = useTransparencyPublished(assetId)
  const [copied, setCopied] = useState(false)
  const [signing, setSigning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const relPath = `/transparency/${encodeURIComponent(identityKey ?? '')}/${encodeURIComponent(assetId)}`
  const url = typeof window !== 'undefined' ? `${window.location.origin}${relPath}` : relPath
  const next = !published

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast.error('Could not copy the link.') }
  }

  // Publishing / unpublishing is a controlled action: the issuer confirms in a
  // sheet, then signs with their wallet; the authorisation is anchored on-chain,
  // like a signed report download.
  const authorize = async () => {
    if (signing) return
    if (wallet == null || identityKey == null) { toast.error('Connect a wallet to authorise this change.'); return }
    setSigning(true)
    try {
      const at = new Date().toISOString()
      const message = JSON.stringify({ kind: 'transparency-publish', assetId, published: next, signerKey: identityKey, at })
      const signature = await signStatement(wallet, `transparency:${assetId}:${at}`, message)
      await anchorOnChain(wallet, `transparency:${assetId}:${at}`, { message, signature, signerKey: identityKey }, `transparency ${next ? 'publish' : 'unpublish'}`)
      setTransparencyPublished(assetId, next)
      setConfirmOpen(false)
      toast.success(next ? 'Transparency page published and anchored on-chain' : 'Transparency page unpublished and anchored on-chain')
    } catch {
      toast.error('Could not authorise the change')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <TabHeader
        title="Transparency page"
        description="Publish a public proof-of-reserves page for this instrument. Anyone can open it to verify supply and backing, no wallet needed."
      />

      {/* Publish control */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg', published ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
              <Globe className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-foreground">
                {published ? 'Published' : 'Not published'}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                {published
                  ? 'The public page is live. Preview it below or share the link.'
                  : 'Publishing is signed with your wallet and anchored on-chain. Preview below, then publish when ready.'}
              </p>
            </div>
          </div>
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                role="switch"
                aria-checked={published}
                aria-label="Toggle public transparency page"
                className={cn(
                  'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  published ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              >
                <span className={cn('inline-block size-5 transform rounded-full bg-white shadow transition-transform', published ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-foreground">{next ? 'Publish transparency page' : 'Unpublish transparency page'}</div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {next
                      ? 'Making this page public is a controlled action. Sign with your wallet to authorise it.'
                      : 'Taking this page down is a controlled action. Sign with your wallet to authorise it.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={authorize}
                disabled={signing}
                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <FileSignature className="size-3.5" /> {signing ? 'Signing…' : next ? 'Sign & publish' : 'Sign & unpublish'}
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Public URL */}
        <div className="mt-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-[12px] text-muted-foreground">{url}</code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {copied ? <Check className="size-3.5 text-success" strokeWidth={3} /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={relPath}
            target="_blank"
            rel="noreferrer"
            className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[12.5px] font-medium transition-colors',
              published ? 'border-border text-foreground hover:bg-muted' : 'pointer-events-none border-border text-faint-foreground opacity-50')}
            aria-disabled={!published}
          >
            <ExternalLink className="size-3.5" /> Open
          </a>
        </div>
      </div>

      {/* Preview */}
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
          <Eye className="size-3.5" /> Preview
        </div>
        <InstrumentTransparencyView assetId={assetId} asset={asset} />
      </div>
    </div>
  )
}
