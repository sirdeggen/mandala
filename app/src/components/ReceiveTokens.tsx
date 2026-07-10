import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from './ui/card'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { Check } from 'lucide-react'
import { receiveTokens, ReceivedTransfer } from '@bsv/mandala/receive'
import { useInvalidateHolderData } from '../hooks/useHolderData'
import { formatAmount } from '@bsv/mandala/amount'
import ReceivePanel from './holder/ReceivePanel'
import { Spinner } from './ui/spinner'

interface ReceivedToken extends ReceivedTransfer {
  at: number
}

/**
 * Incoming transfers are ACCEPTED AUTOMATICALLY — there is no manual
 * accept/reject step. On load (and on refresh) the @bsv/mandala receive
 * pipeline internalizes every pending message-box transfer into the wallet
 * basket and acknowledges it; we show a read-only confirmation. The
 * QR/identity panel lets others send to you.
 */
export default function ReceiveTokens() {
  const { wallet, messageBoxClient } = useWallet()
  const invalidateHolderData = useInvalidateHolderData()
  const [received, setReceived] = useState<ReceivedToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const processedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void autoReceive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageBoxClient, wallet])

  const autoReceive = async () => {
    setIsLoading(true)
    try {
      if (messageBoxClient == null || wallet == null) return
      const { accepted, failed } = await receiveTokens({
        wallet,
        messageBoxClient,
        processed: processedRef.current
      })
      if (accepted.length > 0) {
        // Balance + history changed — refresh the shared holder cache in the background.
        void invalidateHolderData()
        const at = Date.now()
        setReceived(prev => [...accepted.map(t => ({ ...t, at })), ...prev])
        for (const t of accepted) {
          toast.success('Tokens received', {
            description: `+${formatAmount(Number(t.amount), t.decimals)} ${t.label}`,
            duration: 4000
          })
        }
      }
      for (const f of failed) {
        // One bad transfer doesn't block the rest; it stays un-acknowledged for retry.
        console.error('Auto-receive failed for', f.messageId, f.error)
        toast.error('Could not receive a transfer', {
          description: f.error instanceof Error ? f.error.message : 'Unexpected error'
        })
      }
    } catch (error) {
      console.error('Error checking for incoming transfers:', error)
      toast.error('Failed to check for incoming transfers', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // No header — the page's top bar already says "Receive"; the QR panel is
    // the action. One quiet footnote covers the "just wait" behaviour.
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* QR / identity — how others send to you; sits directly on the card
            (no nested well) to match the Send screen's single surface. */}
        <ReceivePanel />

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
            <Spinner size="sm" tone="brand" />
            <span className="text-[13px]">Checking for incoming transfers…</span>
          </div>
        ) : received.length === 0 ? (
          <p className="text-center text-[13px] text-muted-foreground">
            Incoming transfers are accepted automatically.
          </p>
        ) : (
          <div className="space-y-3">
            {received.map((r) => (
              <div key={r.id} className="rounded-md border border-separator p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                        <Check className="h-3 w-3" /> Received
                      </span>
                      <span className="text-[12px] text-subtle-foreground">{new Date(r.at).toLocaleTimeString()}</span>
                    </div>
                    <p className="tabular text-[28px] font-semibold leading-none tracking-[-0.02em] text-success">
                      +{formatAmount(Number(r.amount), r.decimals)}
                    </p>
                    <p className="mt-2 text-[15px] font-semibold">{r.label}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      From <span className="tabular text-foreground">{r.sender.slice(0, 16)}…</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
