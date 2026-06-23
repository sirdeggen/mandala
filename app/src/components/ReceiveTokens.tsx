import { useState, useEffect } from 'react'
import { type AtomicBEEF } from '@bsv/sdk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { Download, Check, X, RefreshCw, Loader2 } from 'lucide-react'
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

export function ReceiveTokens() {
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

  if (isLoading) {
    return (
      <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg">
                <Download className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl">Receive Tokens</CardTitle>
                <CardDescription className="text-base">
                  Accept or reject tokens sent to you by others
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={refreshPending}
              variant="outline"
              className="w-full sm:w-auto"
              size="default"
              disabled
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Refresh</span>
              <span className="sm:hidden">Refresh Pending</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <RefreshCw className="h-8 w-8 text-purple-600 animate-spin" />
            </div>
            <p className="text-gray-600">Loading pending tokens...</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
      <CardHeader className="space-y-3 pb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg">
              <Download className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl">Receive Tokens</CardTitle>
              <CardDescription className="text-base">
                Accept or reject tokens sent to you by others
              </CardDescription>
            </div>
          </div>
          <Button
            onClick={refreshPending}
            variant="outline"
            className="w-full sm:w-auto"
            size="default"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Refresh</span>
            <span className="sm:hidden">Refresh Pending</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {pendingTokens.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-2">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No pending tokens</h3>
            <p className="text-gray-600">
              When someone sends you tokens, they will appear here for you to accept.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingTokens.map((pending) => (
              <div
                key={pending.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Incoming
                      </span>
                      <span className="text-sm text-gray-500">
                        {new Date(pending.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {pending.assetId}
                    </h3>
                    <p className="text-xl font-bold text-purple-600 mt-1">
                      +{pending.amount.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-600 mt-2">
                      From: <span className="font-mono">{pending.sender.slice(0, 20)}...</span>
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      onClick={() => handleAcceptToken(pending)}
                      disabled={acceptingTokenId === pending.id || rejectingTokenId === pending.id}
                      className="bg-green-600 hover:bg-green-700 text-white"
                      size="sm"
                    >
                      {acceptingTokenId === pending.id ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Accepting...
                        </>
                      ) : (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Accept
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => handleRejectToken(pending)}
                      disabled={acceptingTokenId === pending.id || rejectingTokenId === pending.id}
                      variant="outline"
                      className="text-red-600 border-red-600 hover:bg-red-50"
                      size="sm"
                    >
                      {rejectingTokenId === pending.id ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Rejecting...
                        </>
                      ) : (
                        <>
                          <X className="h-3 w-3 mr-1" />
                          Reject
                        </>
                      )}
                    </Button>
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
