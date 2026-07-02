import { useState, useEffect, useRef } from 'react'
import { type AtomicBEEF } from '@bsv/sdk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { Download, Check, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MESSAGEBOX, BASKET } from '../lib/mandala/constants'
import { resolveAssetMetadata } from '../lib/mandala/metadata'
import { formatAmount } from '../lib/mandala/amount'
import ReceivePanel from './holder/ReceivePanel'
import { Spinner } from './ui/spinner'

interface ReceivedToken {
  id: string
  assetId: string
  amount: string
  sender: string
  label: string
  decimals: number
  at: number
}

interface IncomingMessage {
  id: string
  assetId: string
  amount: string
  sender: string
  keyID: string
  protocolID: [0 | 1 | 2, string]
  transaction: AtomicBEEF
}

/**
 * Incoming transfers are ACCEPTED AUTOMATICALLY — there is no manual
 * accept/reject step. On load (and on refresh) we internalize every pending
 * message-box transfer into the wallet basket, acknowledge it, and show a
 * read-only confirmation. The QR/identity panel lets others send to you.
 */
export default function ReceiveTokens() {
  const { wallet, messageBoxClient } = useWallet()
  const [received, setReceived] = useState<ReceivedToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const processedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void autoReceive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageBoxClient, wallet])

  const acceptOne = async (msg: IncomingMessage): Promise<void> => {
    if (wallet == null || messageBoxClient == null) return
    const meta = await resolveAssetMetadata(msg.assetId)
    const label = meta?.label ?? `${msg.assetId.slice(0, 20)}…`
    const decimals = Number(meta?.decimals) || 0

    await wallet.internalizeAction({
      tx: msg.transaction,
      labels: ['mandala', 'receive'],
      outputs: [{
        outputIndex: 0,
        protocol: 'basket insertion',
        insertionRemittance: {
          basket: BASKET,
          customInstructions: JSON.stringify({
            protocolID: msg.protocolID,
            keyID: msg.keyID,
            counterparty: msg.sender,
            label
          }),
          tags: ['mandala', 'received', msg.assetId]
        }
      }],
      description: `Receive ${msg.amount} of ${msg.assetId}`
    })
    await messageBoxClient.acknowledgeMessage({ messageIds: [msg.id] })

    setReceived(prev => [
      { id: msg.id, assetId: msg.assetId, amount: msg.amount, sender: msg.sender, label, decimals, at: Date.now() },
      ...prev
    ])
    toast.success('Tokens received', {
      description: `+${formatAmount(Number(msg.amount), decimals)} ${label}`,
      duration: 4000
    })
  }

  const autoReceive = async () => {
    setIsLoading(true)
    try {
      if (messageBoxClient == null || wallet == null) return
      const messages = await messageBoxClient.listMessages({ messageBox: MESSAGEBOX, acceptPayments: false })
      for (const raw of messages as Array<{ messageId: string, body: any }>) {
        if (processedRef.current.has(raw.messageId)) continue
        processedRef.current.add(raw.messageId)
        try {
          await acceptOne({
            id: raw.messageId,
            assetId: raw.body.assetId,
            amount: raw.body.amount,
            sender: raw.body.sender,
            keyID: raw.body.keyID,
            protocolID: raw.body.protocolID,
            transaction: raw.body.transaction
          })
        } catch (err) {
          // One bad transfer shouldn't block the rest; allow a later retry.
          processedRef.current.delete(raw.messageId)
          console.error('Auto-receive failed for', raw.messageId, err)
          toast.error('Could not receive a transfer', {
            description: err instanceof Error ? err.message : 'Unexpected error'
          })
        }
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
    <Card>
      <CardHeader className="pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-success/15 text-success">
              <Download className="h-[20px] w-[20px]" />
            </div>
            <div>
              <CardTitle>Receive tokens</CardTitle>
              <CardDescription>Transfers sent to you are accepted automatically</CardDescription>
            </div>
          </div>
          <Button onClick={() => void autoReceive()} variant="secondary" size="sm" disabled={isLoading} className="sm:w-auto">
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            Check now
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* QR / identity — how others send to you */}
        <div className="rounded-[--radius-lg] border border-separator bg-muted/30 p-4">
          <ReceivePanel />
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-separator" />
          <span className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            {isLoading ? 'Checking for transfers…' : 'Received'}
          </span>
          <div className="h-px flex-1 bg-separator" />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Spinner size="md" tone="brand" />
            <span className="text-[14px]">Accepting incoming transfers…</span>
          </div>
        ) : received.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
              <Download className="h-7 w-7 text-subtle-foreground" />
            </div>
            <h3 className="text-[15px] font-semibold">Nothing to receive right now</h3>
            <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
              When someone sends you tokens, they’re accepted automatically and land in your balance.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {received.map((r) => (
              <div key={r.id} className="rounded-[--radius-md] border border-separator p-4">
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
