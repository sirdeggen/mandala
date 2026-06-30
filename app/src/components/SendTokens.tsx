import { useState, useEffect } from 'react'
import { Transaction, Beef, LockingScript, PublicKey } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { toast } from 'sonner'
import { useIdentitySearch } from '@bsv/identity-react'
import { useWallet } from '../context/WalletContext'
import { Send, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BASKET, FT_PROTOCOL, MESSAGEBOX } from '../lib/mandala/constants'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import { revealLinkage } from '../lib/mandala/tokens'
import { listAdminAssets } from '../lib/mandala/assets'
import { resolveAssetMetadata } from '../lib/mandala/metadata'
import { parseAmount, formatAmount, formatAmountPlain } from '../lib/mandala/amount'
import { submitToOverlay } from '../lib/mandala/overlay'
import { encodeLinkagePayload } from '../lib/mandala/encoding'
import { loadHistory } from '../lib/mandala/history'
import { deriveContacts, Contact } from '../lib/mandala/contacts'
import { resolveAssetState } from '../lib/mandala/adminState'

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
  const [metas, setMetas] = useState<Record<string, { label: string, decimals: number, issuer?: string }>>({})
  const [isLoadingBalances, setIsLoadingBalances] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [recentSends, setRecentSends] = useState<Array<{ assetId: string, amount: number, counterparty: string }>>([])
  const [isPaused, setIsPaused] = useState(false)

  const labelFor = (assetId: string): string => metas[assetId]?.label ?? `${assetId.slice(0, 20)}…`
  const decimalsFor = (assetId: string): number => metas[assetId]?.decimals ?? 0

  useEffect(() => {
    void loadBalances()
    void loadContacts()
  }, [wallet])

  useEffect(() => {
    if (!assetId) { setIsPaused(false); return }
    void resolveAssetState(assetId).then(state => {
      setIsPaused(state?.isPaused ?? false)
    })
  }, [assetId])

  const loadContacts = async () => {
    if (wallet == null) return
    try {
      const history = await loadHistory(wallet as any)
      setContacts(deriveContacts(history))
      // Derive recent sent entries for "Pay again"
      const sent = history
        .filter(r => r.direction === 'sent' && r.counterparty !== '')
        .slice(0, 5)
        .map(r => ({ assetId: r.assetId, amount: r.amount, counterparty: r.counterparty }))
      setRecentSends(sent)
    } catch (e) {
      console.error('Error loading contacts:', e)
    }
  }

  const loadBalances = async () => {
    if (wallet == null) return
    setIsLoadingBalances(true)
    try {
      const res = await wallet.listOutputs({
        basket: BASKET,
        include: 'locking scripts',
        limit: 1000
      })

      const totals = new Map<string, number>()
      for (const o of res.outputs) {
        try {
          const decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
          totals.set(decoded.assetId, (totals.get(decoded.assetId) ?? 0) + decoded.amount)
        } catch { /* not a mandala FT */ }
      }
      setBalances([...totals.entries()].map(([assetId, amount]) => ({ assetId, amount })))
      // Labels come from the issuer's admin outputs (present only in the issuer's
      // own wallet); holders fall back to a resolver query then truncated assetId.
      const admin = await listAdminAssets(wallet as any)
      const metaMap: Record<string, { label: string, decimals: number, issuer?: string }> = {}
      for (const a of admin) metaMap[a.assetId] = { label: a.label, decimals: Number(a.metadata?.decimals) || 0, issuer: typeof a.metadata?.issuer === 'string' ? a.metadata.issuer : undefined }
      for (const b of [...totals.keys()]) {
        if (metaMap[b] == null) {
          const meta = await resolveAssetMetadata(b)
          if (meta != null) metaMap[b] = { label: meta.label, decimals: Number(meta.decimals) || 0, issuer: typeof meta.issuer === 'string' ? meta.issuer : undefined }
        }
      }
      setMetas(metaMap)
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

    // Two queries: 'locking scripts' attaches lockingScript (needed to decode the
    // FT) + customInstructions (keyID/counterparty for unlock); 'entire transactions'
    // attaches the BEEF for inputBEEF. The two modes are mutually exclusive on what
    // they return, but the outpoints line up.
    const scriptRes = await wallet.listOutputs({
      basket: BASKET,
      include: 'locking scripts',
      limit: 1000,
      includeCustomInstructions: true
    })
    const beefRes = await wallet.listOutputs({
      basket: BASKET,
      include: 'entire transactions',
      limit: 1000
    })

    // Pick FT inputs of this asset until gathered >= sendAmount
    const beef = new Beef()
    beef.mergeBeef(beefRes.BEEF as number[])
    const inputs: Array<{ outpoint: string, unlockingScriptLength: number, inputDescription: string }> = []
    const spendInfo: Array<{ keyID: string, counterparty: string }> = []
    let gathered = 0

    for (const o of scriptRes.outputs) {
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
    const outputs: any[] = [{
      satoshis: 1,
      lockingScript: ftOut.toHex(),
      outputDescription: 'FT to recipient',
      customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDOut, counterparty: recipientKey, direction: 'sent', recipient: recipientKey }),
      tags: ['mandala', 'sent', selectedAssetId]
    }]

    let keyIDChange = ''
    if (change > 0) {
      keyIDChange = 'change-' + Date.now()
      // Change back to self: use our identity key (hex), not the literal 'self' —
      // the overlay parses linkage.counterparty as a public key (it echoes verbatim).
      const ftChange = await new MandalaToken(wallet as any).lockBRC29(selectedAssetId, change, FT_PROTOCOL, keyIDChange, identityKey)
      outputs.push({
        satoshis: 1,
        lockingScript: ftChange.toHex(),
        outputDescription: 'FT change',
        basket: BASKET,
        customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: identityKey })
      })
    }

    const created = await wallet.createAction({
      description: `Send ${sendAmount} of ${selectedAssetId}`,
      labels: ['mandala', 'transfer'],
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
      outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, identityKey) })
    }
    // Reveal linkage for each spent FT input so the overlay can screen senders
    // under access mode (A6 gate 3).
    const inLinks: Array<{ index: number, linkage: any }> = []
    for (let i = 0; i < spendInfo.length; i++) {
      inLinks.push({ index: i, linkage: await revealLinkage(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty) })
    }
    const offChainValues = encodeLinkagePayload({ inputs: inLinks, outputs: outLinks })
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
    const sendAmount = parseAmount(amount, decimalsFor(assetId))
    if (!amount || isNaN(sendAmount) || sendAmount <= 0) {
      toast.error('Enter a valid amount', { duration: 3000 })
      return
    }
    const bal = balances.find(b => b.assetId === assetId)
    if (!bal || bal.amount < sendAmount) {
      toast.error('Insufficient balance', {
        description: `Available: ${formatAmount(bal?.amount ?? 0, decimalsFor(assetId))}`,
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
        description: `${formatAmount(sendAmount, decimalsFor(assetId))} tokens sent to ${recipient.slice(0, 12)}…`,
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
    <Card className="relative overflow-hidden">
      {isSending && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[--radius-lg] bg-card/80 backdrop-blur-md animate-in">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <div>
              <h3 className="text-[17px] font-semibold">Sending tokens…</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Processing your transfer</p>
            </div>
          </div>
        </div>
      )}

      <CardHeader className="pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-accent text-accent-foreground">
            <Send className="h-[20px] w-[20px]" />
          </div>
          <div>
            <CardTitle>Send tokens</CardTitle>
            <CardDescription>Transfer to another user by their identity key</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Asset selector */}
        <div>
          <Label htmlFor="sendAsset">Token</Label>
          {isLoadingBalances ? (
            <div className="flex h-11 w-full items-center rounded-[--radius] border border-input-border bg-input px-3.5 text-[15px] text-subtle-foreground">
              Loading tokens…
            </div>
          ) : balances.length > 0 ? (
            <Select id="sendAsset" value={assetId} onChange={e => setAssetId(e.target.value)}>
              <option value="">Select a token</option>
              {balances.map(b => (
                <option key={b.assetId} value={b.assetId}>
                  {labelFor(b.assetId)} ({formatAmount(b.amount, decimalsFor(b.assetId))} available)
                </option>
              ))}
            </Select>
          ) : (
            <div className="flex h-11 w-full items-center rounded-[--radius] border border-input-border bg-input px-3.5 text-[15px] text-subtle-foreground">
              No tokens available — receive some first.
            </div>
          )}
          {assetId && selectedBalance && (
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              Available <span className="tabular font-semibold text-foreground">{formatAmount(selectedBalance.amount, decimalsFor(assetId))}</span>
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <Label htmlFor="sendAmount" required>Amount</Label>
          <div className="relative">
            <Input
              id="sendAmount"
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="e.g. 100"
              min="0"
              step="any"
              className="tabular pr-16"
            />
            {assetId && selectedBalance && (
              <button
                type="button"
                onClick={() => setAmount(formatAmountPlain(selectedBalance.amount, decimalsFor(assetId)))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-accent"
              >
                Max
              </button>
            )}
          </div>
        </div>

        {/* Return to issuer shortcut — fills the recipient with the asset's
            SPV-verified issuer identity from its on-chain metadata. */}
        {assetId && metas[assetId]?.issuer && (
          <button
            type="button"
            onClick={() => {
              const iss = metas[assetId].issuer as string
              setRecipient(iss)
              setPublicKeyInput(iss)
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[--radius] border border-input-border bg-input px-3.5 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Send className="h-[16px] w-[16px]" /> Return to issuer
          </button>
        )}

        {/* Recent contacts */}
        {contacts.length > 0 && (
          <div>
            <Label>Recent contacts</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {contacts.slice(0, 8).map(c => (
                <button
                  key={c.identityKey}
                  type="button"
                  onClick={() => {
                    setRecipient(c.identityKey)
                    setPublicKeyInput(c.identityKey)
                    identitySearch.handleSelect(null as any, null)
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-input-border bg-input px-3 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
                  title={c.identityKey}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {c.identityKey.slice(0, 2).toUpperCase()}
                  </span>
                  {c.identityKey.slice(0, 8)}…
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pay again — recent outgoing sends with asset + recipient pre-filled */}
        {recentSends.length > 0 && (
          <div>
            <Label>Pay again</Label>
            <div className="mt-1.5 space-y-1.5">
              {recentSends.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setAssetId(s.assetId)
                    setAmount(formatAmountPlain(s.amount, decimalsFor(s.assetId)))
                    setRecipient(s.counterparty)
                    setPublicKeyInput(s.counterparty)
                    identitySearch.handleSelect(null as any, null)
                  }}
                  className="flex w-full items-center justify-between rounded-[--radius] border border-input-border bg-input px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{formatAmount(s.amount, decimalsFor(s.assetId))} {labelFor(s.assetId)}</span>
                  <span className="tabular text-subtle-foreground">{s.counterparty.slice(0, 12)}…</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recipient identity search */}
        <div>
          <Label htmlFor="recipient-search">Search for recipient</Label>
          <Input
            id="recipient-search"
            type="text"
            icon={<Search className="h-[18px] w-[18px]" />}
            value={identitySearch.inputValue}
            onChange={e => identitySearch.handleInputChange(e, e.target.value, 'input')}
            placeholder="Search by name, email, etc."
            disabled={!!publicKeyInput && !!recipient}
          />
          {identitySearch.isLoading && (
            <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Searching…
            </div>
          )}

          {identitySearch.inputValue && identitySearch.identities.length > 0 && !identitySearch.selectedIdentity && (
            <div className="animate-pop mt-2 max-h-60 overflow-auto rounded-[--radius-md] bg-popover shadow-[var(--shadow-pop)]">
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
                    className="flex cursor-pointer items-center gap-3 border-b border-separator p-3 transition-colors last:border-b-0 hover:bg-muted"
                  >
                    {identity.avatarURL ? (
                      <img src={identity.avatarURL} alt={identity.name} className="h-10 w-10 rounded-full" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
                        {getInitials(identity.name || '', identity.identityKey)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{identity.name || 'Unknown'}</div>
                      <div className="tabular truncate text-[12px] text-subtle-foreground">{identity.identityKey.slice(0, 24)}…</div>
                    </div>
                    {identity.badgeLabel && (
                      <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                        {identity.badgeLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {identitySearch.inputValue && identitySearch.identities.length === 0 && !identitySearch.isLoading && (
            <p className="mt-1.5 text-[13px] text-subtle-foreground">No identities found</p>
          )}
        </div>

        {/* Direct public key entry */}
        <div>
          <Label htmlFor="publicKey">
            {identitySearch.selectedIdentity ? 'Selected recipient identity key' : 'Or enter recipient public key'}
          </Label>
          <Input
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
            className={cn(
              'tabular',
              publicKeyInput && !recipient && !identitySearch.selectedIdentity && 'border-destructive focus:border-destructive focus:ring-destructive/25'
            )}
          />
          {publicKeyInput && !recipient && !identitySearch.selectedIdentity && (
            <p className="mt-1.5 text-[13px] text-destructive">Invalid public key</p>
          )}
        </div>

        {isPaused && (
          <p className="rounded-[--radius-md] bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            Transfers are temporarily disabled by the issuer.
          </p>
        )}

        <Button
          onClick={() => void handleSend()}
          disabled={isSending || wallet == null || isPaused}
          size="lg"
          className="w-full"
        >
          <Send className="h-[18px] w-[18px]" />
          {isSending ? 'Sending…' : 'Send tokens'}
        </Button>

        <div className="rounded-[--radius-md] bg-muted/60 p-4">
          <h4 className="mb-2 text-[13px] font-semibold text-foreground">How it works</h4>
          <ol className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <li>1. Select the token and enter the amount to send.</li>
            <li>2. Search for or enter the recipient’s identity key.</li>
            <li>3. The transaction is submitted to the overlay and notified via message box.</li>
            <li>4. The recipient claims the tokens in the Receive tab.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
