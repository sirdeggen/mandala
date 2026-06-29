import { useState, useEffect } from 'react'
import { type AtomicBEEF } from '@bsv/sdk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { Download, Check, X, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MESSAGEBOX, BASKET } from '../lib/mandala/constants'

interface PendingToken {
  id: string
  assetId: string
  amount: string
  sender: string
  timestamp: number
  keyID: string
  protocolID: [0 | 1 | 2, string]
  transaction: AtomicBEEF
}

export default function ReceiveTokens() {
  const { wallet, messageBoxClient } = useWallet()
  const [pendingTokens, setPendingTokens] = useState<PendingToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [acceptingTokenId, setAcceptingTokenId] = useState<string | null>(null)
  const [rejectingTokenId, setRejectingTokenId] = useState<string | null>(null)

  useEffect(() => {
    loadPendingTokens()
  }, [messageBoxClient])

  const loadPendingTokens = async () => {
    setIsLoading(true)
    try {
      if (!messageBoxClient) {
        console.warn('MessageBoxClient not available')
        setPendingTokens([])
        return
      }

      // Fetch messages from the messageBox
      const messages = await messageBoxClient.listMessages({
        messageBox: MESSAGEBOX,
        acceptPayments: false  // Don't auto-accept, let user choose
      })

      // Parse messages into pending tokens
      const pending: PendingToken[] = messages.map((msg: { messageId: string, body: any }) => ({
        id: msg.messageId,
        assetId: msg.body.assetId,
        amount: msg.body.amount,
        sender: msg.body.sender,
        timestamp: Date.now(),
        keyID: msg.body.keyID,
        protocolID: msg.body.protocolID,
        transaction: msg.body.transaction
      }))

      setPendingTokens(pending)
    } catch (error) {
      console.error('Error loading pending tokens:', error)
      toast.error('Failed to load pending tokens', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
      setPendingTokens([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleAcceptToken = async (pendingToken: PendingToken) => {
    setAcceptingTokenId(pendingToken.id)

    try {
      if (!wallet || !messageBoxClient) {
        throw new Error('Wallet or MessageBoxClient not available')
      }

      // Internalize the token using basket insertion protocol
      await wallet.internalizeAction({
        tx: pendingToken.transaction,
        outputs: [{
          outputIndex: 0,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: BASKET,
            customInstructions: JSON.stringify({
              protocolID: pendingToken.protocolID,
              keyID: pendingToken.keyID,
              counterparty: pendingToken.sender
            }),
            tags: ['mandala', 'received', pendingToken.assetId]
          }
        }],
        description: `Receive ${pendingToken.amount} of ${pendingToken.assetId}`
      })

      // Acknowledge the message to remove it from the message box
      await messageBoxClient.acknowledgeMessage({
        messageIds: [pendingToken.id]
      })

      // Remove from pending list
      const updatedPending = pendingTokens.filter(t => t.id !== pendingToken.id)
      setPendingTokens(updatedPending)

      toast.success('Tokens accepted successfully!', {
        description: `Received ${Number(pendingToken.amount).toLocaleString()} of ${pendingToken.assetId}`,
        duration: 5000,
      })

    } catch (error) {
      console.error('Error accepting tokens:', error)
      toast.error('Failed to accept tokens', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        duration: 5000,
      })
    } finally {
      setAcceptingTokenId(null)
    }
  }

  const handleRejectToken = async (pendingToken: PendingToken) => {
    setRejectingTokenId(pendingToken.id)
    try {
      if (!messageBoxClient) {
        throw new Error('MessageBoxClient not available')
      }

      // Acknowledge the message to remove it from the message box
      await messageBoxClient.acknowledgeMessage({
        messageIds: [pendingToken.id]
      })

      // Remove from pending list
      const updatedPending = pendingTokens.filter(t => t.id !== pendingToken.id)
      setPendingTokens(updatedPending)

      toast.info('Transfer rejected', {
        description: 'The token transfer has been declined',
        duration: 3000,
      })
    } catch (error) {
      console.error('Error rejecting token:', error)
      toast.error('Failed to reject tokens', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        duration: 5000,
      })
    } finally {
      setRejectingTokenId(null)
    }
  }

  const refreshPending = () => {
    loadPendingTokens()
  }

  const header = (disabled?: boolean) => (
    <CardHeader className="pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-success/15 text-success">
            <Download className="h-[20px] w-[20px]" />
          </div>
          <div>
            <CardTitle>Receive tokens</CardTitle>
            <CardDescription>Accept or reject tokens sent to you</CardDescription>
          </div>
        </div>
        <Button onClick={refreshPending} variant="secondary" size="sm" disabled={disabled} className="sm:w-auto">
          <RefreshCw className={cn('h-4 w-4', disabled && 'animate-spin')} />
          Refresh
        </Button>
      </div>
    </CardHeader>
  )

  if (isLoading) {
    return (
      <Card>
        {header(true)}
        <CardContent className="space-y-3">
          {[0, 1].map(i => (
            <div key={i} className="rounded-[--radius-md] border border-separator p-4">
              <div className="h-3 w-20 animate-pulse rounded-full bg-muted" />
              <div className="mt-3 h-7 w-28 animate-pulse rounded-full bg-muted" />
              <div className="mt-3 h-3 w-44 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {header(false)}
      <CardContent>
        {pendingTokens.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-muted">
              <Download className="h-7 w-7 text-subtle-foreground" />
            </div>
            <h3 className="text-[15px] font-semibold">No pending tokens</h3>
            <p className="max-w-xs text-[14px] leading-relaxed text-muted-foreground">
              When someone sends you tokens, they’ll appear here for you to accept.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingTokens.map((pending) => {
              const busy = acceptingTokenId === pending.id || rejectingTokenId === pending.id
              return (
                <div
                  key={pending.id}
                  className="rounded-[--radius-md] border border-separator p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                          Incoming
                        </span>
                        <span className="text-[12px] text-subtle-foreground">
                          {new Date(pending.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="tabular text-[28px] font-semibold leading-none tracking-[-0.02em] text-success">
                        +{Number(pending.amount).toLocaleString()}
                      </p>
                      <p className="tabular mt-2 truncate text-[12px] text-subtle-foreground">{pending.assetId}</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        From <span className="tabular text-foreground">{pending.sender.slice(0, 16)}…</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        onClick={() => handleAcceptToken(pending)}
                        disabled={busy}
                        variant="success"
                        size="sm"
                      >
                        {acceptingTokenId === pending.id
                          ? <><Loader2 className="h-4 w-4 animate-spin" />Accepting…</>
                          : <><Check className="h-4 w-4" />Accept</>}
                      </Button>
                      <Button
                        onClick={() => handleRejectToken(pending)}
                        disabled={busy}
                        variant="outline"
                        size="sm"
                      >
                        {rejectingTokenId === pending.id
                          ? <><Loader2 className="h-4 w-4 animate-spin" />Rejecting…</>
                          : <><X className="h-4 w-4" />Reject</>}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
