import { useState, useEffect } from 'react'
import { Transaction, Beef, LockingScript, PublicKey } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { toast } from 'sonner'
import { useIdentitySearch } from '@bsv/identity-react'
import { useWallet } from '../context/WalletContext'
import { Send, Loader2 } from 'lucide-react'
import { BASKET, FT_PROTOCOL, MESSAGEBOX } from '../lib/mandala/constants'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import { revealLinkage } from '../lib/mandala/tokens'
import { submitToOverlay } from '../lib/mandala/overlay'
import { encodeLinkagePayload } from '../lib/mandala/encoding'

interface TokenBalance {
  assetId: string
  amount: number
}

export default function SendTokens() {
  const { wallet, messageBoxClient, identityKey } = useWallet()
  const [assetId, setAssetId] = useState('')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [publicKeyInput, setPublicKeyInput] = useState('')
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [isLoadingBalances, setIsLoadingBalances] = useState(true)

  useEffect(() => {
    void loadBalances()
  }, [wallet])

  const loadBalances = async () => {
    if (wallet == null) return
    setIsLoadingBalances(true)
    try {
      const res = await wallet.listOutputs({
        basket: BASKET,
        include: 'entire transactions',
        limit: 1000,
        includeCustomInstructions: true
      })

      const totals = new Map<string, number>()
      for (const o of res.outputs) {
        try {
          const decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
          totals.set(decoded.assetId, (totals.get(decoded.assetId) ?? 0) + decoded.amount)
        } catch { /* not a mandala FT */ }
      }
      setBalances([...totals.entries()].map(([assetId, amount]) => ({ assetId, amount })))
    } catch (e) {
      console.error('Error loading balances:', e)
    } finally {
      setIsLoadingBalances(false)
    }
  }

  const identitySearch = useIdentitySearch({
    originator: 'mandala',
    wallet: wallet as any,
    onIdentitySelected: (identity) => {
      if (identity) {
        setRecipient(identity.identityKey)
        setPublicKeyInput(identity.identityKey)
      }
    }
  })

  const getInitials = (name: string, key: string): string => {
    if (!name || name.trim() === '') return key.slice(0, 2).toUpperCase()
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  const transfer = async (selectedAssetId: string, sendAmount: number, recipientKey: string) => {
    if (wallet == null || messageBoxClient == null || identityKey == null) return

    const res = await wallet.listOutputs({
      basket: BASKET,
      include: 'entire transactions',
      limit: 1000,
      includeCustomInstructions: true
    })

    // Pick FT inputs of this asset until gathered >= sendAmount
    const beef = new Beef()
    beef.mergeBeef(res.BEEF as number[])
    const inputs: Array<{ outpoint: string, unlockingScriptLength: number, inputDescription: string }> = []
    const spendInfo: Array<{ keyID: string, counterparty: string }> = []
    let gathered = 0

    for (const o of res.outputs) {
      if (gathered >= sendAmount) break
      let decoded
      try {
        decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
      } catch { continue }
      if (decoded.assetId !== selectedAssetId) continue
      const ci = JSON.parse((o.customInstructions as string) ?? '{}')
      inputs.push({ outpoint: o.outpoint as string, unlockingScriptLength: 108, inputDescription: 'spend FT' })
      spendInfo.push({ keyID: ci.keyID, counterparty: ci.counterparty })
      gathered += decoded.amount
    }

    if (gathered < sendAmount) throw new Error('insufficient token balance')
    const change = gathered - sendAmount

    const keyIDOut = 'xfer-' + Date.now()
    const ftOut = await new MandalaToken(wallet as any).lockBRC29(selectedAssetId, sendAmount, FT_PROTOCOL, keyIDOut, recipientKey)
    const outputs: any[] = [{ satoshis: 1, lockingScript: ftOut.toHex(), outputDescription: 'FT to recipient' }]

    let keyIDChange = ''
    if (change > 0) {
      keyIDChange = 'change-' + Date.now()
      const ftChange = await new MandalaToken(wallet as any).lockBRC29(selectedAssetId, change, FT_PROTOCOL, keyIDChange, 'self')
      outputs.push({
        satoshis: 1,
        lockingScript: ftChange.toHex(),
        outputDescription: 'FT change',
        basket: BASKET,
        customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: 'self' })
      })
    }

    const created = await wallet.createAction({
      description: `Send ${sendAmount} of ${selectedAssetId}`,
      inputBEEF: beef.toBinary(),
      inputs,
      outputs,
      options: { randomizeOutputs: false }
    })

    if (!created.signableTransaction) throw new Error('createAction returned no signableTransaction')

    const tx = Transaction.fromBEEF(created.signableTransaction.tx as number[])
    for (let i = 0; i < spendInfo.length; i++) {
      tx.inputs[i].unlockingScriptTemplate = walletMandalaUnlock(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty)
    }
    await tx.sign()

    const spends: Record<string, { unlockingScript: string }> = {}
    for (let i = 0; i < spendInfo.length; i++) {
      const hex = tx.inputs[i].unlockingScript?.toHex()
      if (!hex) throw new Error(`Missing unlocking script for input ${i}`)
      spends[String(i)] = { unlockingScript: hex }
    }

    const signed = await wallet.signAction({
      reference: created.signableTransaction.reference,
      spends
    })

    // Build offChain linkage payload
    const linkOut = await revealLinkage(wallet as any, keyIDOut, recipientKey)
    const outLinks: Array<{ index: number, linkage: any }> = [{ index: 0, linkage: linkOut }]
    if (change > 0) {
      outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, 'self') })
    }
    const offChainValues = encodeLinkagePayload({ inputs: [], outputs: outLinks })
    await submitToOverlay(signed.tx as number[], offChainValues)

    await messageBoxClient.sendMessage({
      recipient: recipientKey,
      messageBox: MESSAGEBOX,
      body: {
        assetId: selectedAssetId,
        amount: sendAmount,
        transaction: signed.tx,
        keyID: keyIDOut,
        protocolID: FT_PROTOCOL,
        sender: identityKey
      }
    })
  }

  const handleSend = async () => {
    if (!assetId.trim()) {
      toast.error('Select a token', { duration: 3000 })
      return
    }
    const sendAmount = Number(amount)
    if (!amount || isNaN(sendAmount) || sendAmount <= 0) {
      toast.error('Enter a valid amount', { duration: 3000 })
      return
    }
    const bal = balances.find(b => b.assetId === assetId)
    if (!bal || bal.amount < sendAmount) {
      toast.error('Insufficient balance', {
        description: `Available: ${bal?.amount.toLocaleString() ?? 0}`,
        duration: 4000
      })
      return
    }
    if (!recipient.trim()) {
      toast.error('Select a recipient', { duration: 3000 })
      return
    }
    if (!messageBoxClient) {
      toast.error('Message box client not initialized', { duration: 4000 })
      return
    }

    setIsSending(true)
    try {
      await transfer(assetId, sendAmount, recipient)
      toast.success('Tokens sent!', {
        description: `${sendAmount.toLocaleString()} tokens sent to ${recipient.slice(0, 12)}…`,
        duration: 6000
      })
      setAssetId('')
      setAmount('')
      setRecipient('')
      setPublicKeyInput('')
      identitySearch.handleSelect(null as any, null)
      await loadBalances()
    } catch (e) {
      console.error('Send error:', e)
      toast.error('Failed to send tokens', {
        description: e instanceof Error ? e.message : 'Unexpected error',
        duration: 5000
      })
    } finally {
      setIsSending(false)
    }
  }

  const selectedBalance = balances.find(b => b.assetId === assetId)

  return (
    <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm relative">
      {isSending && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 rounded-lg flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 rounded-full blur-xl opacity-30 animate-pulse"></div>
              <Loader2 className="h-16 w-16 text-blue-600 animate-spin relative mx-auto" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-gray-900">Sending Tokens...</h3>
              <p className="text-sm text-gray-600">Please wait while we process your transfer</p>
            </div>
          </div>
        </div>
      )}

      <CardHeader className="space-y-3 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg">
            <Send className="h-5 w-5 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl">Send Tokens</CardTitle>
            <CardDescription className="text-base">
              Transfer tokens to another user by specifying their identity key
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-5">

          {/* Asset selector */}
          <div className="space-y-2">
            <Label htmlFor="sendAsset">Token</Label>
            {isLoadingBalances ? (
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
                Loading tokens...
              </div>
            ) : balances.length > 0 ? (
              <select
                id="sendAsset"
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">Select a token</option>
                {balances.map(b => (
                  <option key={b.assetId} value={b.assetId}>
                    {b.assetId.slice(0, 20)}… ({b.amount.toLocaleString()} available)
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500">
                No tokens available. Receive tokens first.
              </div>
            )}
            {assetId && selectedBalance && (
              <p className="text-xs text-gray-600">
                Available: <span className="font-semibold text-purple-600">{selectedBalance.amount.toLocaleString()}</span>
              </p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="sendAmount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount *
            </label>
            <div className="relative">
              <input
                id="sendAmount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="e.g., 100"
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 pr-16"
              />
              {assetId && selectedBalance && (
                <button
                  type="button"
                  onClick={() => setAmount(String(selectedBalance.amount))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded transition-colors"
                >
                  Max
                </button>
              )}
            </div>
          </div>

          {/* Recipient identity search */}
          <div>
            <label htmlFor="recipient-search" className="block text-sm font-medium text-gray-700 mb-2">
              Search for Recipient
            </label>
            <div className="relative">
              <input
                id="recipient-search"
                type="text"
                value={identitySearch.inputValue}
                onChange={e => identitySearch.handleInputChange(e, e.target.value, 'input')}
                placeholder="Search by name, email, etc."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={!!publicKeyInput && !!recipient}
              />
              {identitySearch.isLoading && (
                <div className="absolute right-3 top-2.5">
                  <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full"></div>
                </div>
              )}
            </div>

            {identitySearch.inputValue && identitySearch.identities.length > 0 && !identitySearch.selectedIdentity && (
              <div className="mt-1 max-h-60 overflow-auto border border-gray-300 rounded-md bg-white shadow-lg">
                {identitySearch.identities.map(identity => {
                  if (typeof identity === 'string') return null
                  return (
                    <div
                      key={identity.identityKey}
                      onClick={() => {
                        identitySearch.handleSelect(null as any, identity)
                        setRecipient(identity.identityKey)
                        setPublicKeyInput(identity.identityKey)
                      }}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      {identity.avatarURL ? (
                        <img src={identity.avatarURL} alt={identity.name} className="w-10 h-10 rounded-full" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-semibold">
                          {getInitials(identity.name || '', identity.identityKey)}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{identity.name || 'Unknown'}</div>
                        <div className="text-xs text-gray-500 font-mono">{identity.identityKey.slice(0, 20)}...</div>
                      </div>
                      {identity.badgeLabel && (
                        <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                          {identity.badgeLabel}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {identitySearch.inputValue && identitySearch.identities.length === 0 && !identitySearch.isLoading && (
              <p className="text-xs text-gray-500 mt-1">No identities found</p>
            )}
          </div>

          {/* Direct public key entry */}
          <div>
            <label htmlFor="publicKey" className="block text-sm font-medium text-gray-700 mb-1">
              {identitySearch.selectedIdentity ? 'Selected Recipient Identity Key' : 'Or Enter Recipient Public Key'}
            </label>
            <input
              id="publicKey"
              type="text"
              value={publicKeyInput}
              onChange={e => {
                const val = e.target.value.trim()
                setPublicKeyInput(val)
                if (val) {
                  try {
                    PublicKey.fromString(val)
                    setRecipient(val)
                    identitySearch.handleSelect(null as any, null)
                  } catch {
                    setRecipient('')
                  }
                } else {
                  setRecipient('')
                }
              }}
              disabled={!!identitySearch.selectedIdentity}
              placeholder="Enter public key directly"
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                publicKeyInput && !recipient && !identitySearch.selectedIdentity
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300'
              } ${identitySearch.selectedIdentity ? 'bg-gray-50' : ''}`}
            />
            {publicKeyInput && !recipient && !identitySearch.selectedIdentity && (
              <p className="text-xs text-red-600 mt-1">Invalid public key</p>
            )}
          </div>
        </div>

        <Button
          onClick={() => void handleSend()}
          disabled={isSending || wallet == null}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white"
        >
          {isSending ? 'Sending...' : 'Send Tokens'}
        </Button>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-2">How it works</h4>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Select the token and enter the amount to send</li>
            <li>Search for or enter the recipient's identity key</li>
            <li>The transaction is submitted to the overlay and notified via message box</li>
            <li>The recipient can claim the tokens in the "Receive Tokens" tab</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
