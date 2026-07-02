import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Transaction, Beef, LockingScript, PublicKey, IdentityClient } from '@bsv/sdk'
import type { DisplayableIdentity } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { Button } from './ui/button'
import { Select } from './ui/select'
import { useWallet } from '../context/WalletContext'
import { ChevronLeft, Search, Loader2, CheckCircle2, Copy, Send } from 'lucide-react'
import { noAutofill } from '../lib/noAutofill'
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
import { loadFtCandidates } from '../lib/mandala/ftCandidates'
import { selectFtInputs } from '../lib/mandala/ftSelect'
import { deriveContacts, Contact } from '../lib/mandala/contacts'
import { listContacts, StoredContact } from '../lib/mandala/contactsStore'
import { resolveAssetState } from '../lib/mandala/adminState'
import { useDevMode } from '../lib/devMode'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenBalance {
  assetId: string
  amount: number
}

type Step = 'recipient' | 'amount' | 'review' | 'sent'

/** A tappable recipient row in the recipient-step shortlist. */
interface PickRow { identityKey: string; name?: string; avatarURL?: string; subtitle: string }

/** Max recipients shown in the shortlist before it's truncated (recency-first). */
const CONTACT_LIMIT = 12

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SendTokens({ lockedAssetId }: { lockedAssetId?: string } = {}) {
  const locked = lockedAssetId != null && lockedAssetId !== ''
  const { wallet, messageBoxClient, identityKey } = useWallet()
  // Dev mode bypasses the frontend pause guard so a paused transfer actually
  // reaches the overlay, proving the overlay (not the client) enforces the pause.
  const devMode = useDevMode()

  // Wizard step
  const [step, setStep] = useState<Step>('recipient')

  // Transfer fields
  const [assetId, setAssetId] = useState(lockedAssetId ?? '')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [recipient, setRecipient] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientAvatarURL, setRecipientAvatarURL] = useState('')
  const [publicKeyInput, setPublicKeyInput] = useState('')

  // Async state
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sentTxid, setSentTxid] = useState('')
  const [receiptCopied, setReceiptCopied] = useState(false)
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [metas, setMetas] = useState<Record<string, { label: string, decimals: number, issuer?: string }>>({})
  const [isLoadingBalances, setIsLoadingBalances] = useState(true)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [saved, setSaved] = useState<StoredContact[]>([])
  const [isPaused, setIsPaused] = useState(false)

  // Helpers
  const labelFor = (id: string): string => metas[id]?.label ?? `${id.slice(0, 20)}…`
  const decimalsFor = (id: string): number => metas[id]?.decimals ?? 0

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void loadBalances()
    void loadContacts()
  }, [wallet])

  // Keep the asset locked to the account this Send tab belongs to.
  useEffect(() => {
    if (locked) setAssetId(lockedAssetId as string)
  }, [lockedAssetId, locked])

  useEffect(() => {
    if (!assetId) { setIsPaused(false); return }
    void resolveAssetState(assetId).then(state => {
      setIsPaused(state?.isPaused ?? false)
    })
  }, [assetId])

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadContacts = async () => {
    if (wallet == null) return
    try {
      const history = await loadHistory(wallet as any)
      setContacts(deriveContacts(history))
    } catch (e) {
      console.error('Error loading contacts:', e)
    }
    // Saved contacts (names/avatars) are loaded independently so a store read
    // failure never blocks the recency list.
    try {
      setSaved(await listContacts(wallet as any))
    } catch (e) {
      console.error('Error loading saved contacts:', e)
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

  // ---------------------------------------------------------------------------
  // Identity search — local state replacing useIdentitySearch hook
  // ---------------------------------------------------------------------------

  const [searchInput, setSearchInput] = useState('')
  const [identities, setIdentities] = useState<DisplayableIdentity[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedIdentity, setSelectedIdentity] = useState<DisplayableIdentity | null>(null)
  const searchRequestIdRef = useRef(0)

  // Detect if input is a compressed public key (identity key)
  const isIdentityKey = useCallback((key: string): boolean => {
    return /^(02|03|04)[0-9a-fA-F]{64}$/.test(key)
  }, [])

  useEffect(() => {
    const query = searchInput.trim()
    if (!query) {
      setIdentities([])
      setIsSearching(false)
      return
    }
    if (wallet == null) return

    setIsSearching(true)
    const requestId = ++searchRequestIdRef.current
    const timer = setTimeout(async () => {
      try {
        const client = new IdentityClient(wallet as any, undefined, 'mandala')
        const results = isIdentityKey(query)
          ? await client.resolveByIdentityKey({ identityKey: query }, true)
          : await client.resolveByAttributes({ attributes: { any: query } }, true)
        if (requestId !== searchRequestIdRef.current) return // stale — discard
        setIdentities(results as DisplayableIdentity[])
      } catch (err) {
        if (requestId !== searchRequestIdRef.current) return
        console.error('Identity search failed:', err)
        setIdentities([])
      } finally {
        if (requestId === searchRequestIdRef.current) setIsSearching(false)
      }
    }, 250)

    return () => { clearTimeout(timer) }
  }, [searchInput, wallet, isIdentityKey])

  const handleIdentitySelect = useCallback((identity: DisplayableIdentity | null) => {
    setSelectedIdentity(identity)
    if (identity) {
      setIdentities([])
      setRecipient(identity.identityKey)
      setPublicKeyInput(identity.identityKey)
      setRecipientName(identity.name ?? '')
      setRecipientAvatarURL(identity.avatarURL ?? '')
    } else {
      setSelectedIdentity(null)
    }
  }, [])

  const getInitials = (name: string, key: string): string => {
    if (!name || name.trim() === '') return key.slice(0, 2).toUpperCase()
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  // ---------------------------------------------------------------------------
  // Core transfer logic — PRESERVED EXACTLY
  // ---------------------------------------------------------------------------

  const transfer = async (selectedAssetId: string, sendAmount: number, recipientKey: string): Promise<string> => {
    if (wallet == null || messageBoxClient == null || identityKey == null) throw new Error('Wallet not ready')

    // Two queries: 'locking scripts' attaches lockingScript (needed to decode the
    // FT) + customInstructions (keyID/counterparty for unlock); 'entire transactions'
    // attaches the BEEF for inputBEEF. The two modes are mutually exclusive on what
    // they return, but the outpoints line up.
    // Token-aware coin selection: confirmed-first, fewest UTXOs (see ftSelect).
    const { candidates, beef: beefBytes } = await loadFtCandidates(wallet as any, selectedAssetId)
    const { selected, total: gathered } = selectFtInputs(candidates, sendAmount) // throws if insufficient
    const beef = new Beef()
    beef.mergeBeef(beefBytes)
    const inputs = selected.map(s => ({ outpoint: s.outpoint, unlockingScriptLength: 108, inputDescription: 'spend FT' }))
    const spendInfo = selected.map(s => ({ keyID: s.keyID, counterparty: s.counterparty }))
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

    // Return the real txid for the Sent screen reference
    try {
      return Transaction.fromBEEF(signed.tx as number[]).id('hex')
    } catch {
      return ''
    }
  }

  // ---------------------------------------------------------------------------
  // Wizard actions
  // ---------------------------------------------------------------------------

  const selectedBalance = balances.find(b => b.assetId === assetId)
  const decimals = decimalsFor(assetId)
  const sendAmount = parseAmount(amountStr, decimals)

  // Recipient shortlist shown under the search field — tap to pick, no search
  // needed. History counterparties come first (most recently sent-to/received-from,
  // per deriveContacts), enriched with saved-contact names/avatars; saved contacts
  // never transacted with follow, alphabetically. Truncated to CONTACT_LIMIT, so
  // truncation drops the least-recent.
  const pickList = useMemo<PickRow[]>(() => {
    const savedByKey = new Map(saved.map(c => [c.identityKey, c]))
    const seen = new Set<string>()
    const out: PickRow[] = []
    for (const c of contacts) {
      seen.add(c.identityKey)
      const s = savedByKey.get(c.identityKey)
      out.push({
        identityKey: c.identityKey,
        name: s?.name,
        avatarURL: s?.avatarURL,
        subtitle: s?.handle ? `@${s.handle}` : s?.email ?? `${c.count} transaction${c.count !== 1 ? 's' : ''}`,
      })
    }
    for (const s of saved.filter(s => !seen.has(s.identityKey)).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ identityKey: s.identityKey, name: s.name, avatarURL: s.avatarURL, subtitle: s.handle ? `@${s.handle}` : s.email ?? 'Saved contact' })
    }
    return out.slice(0, CONTACT_LIMIT)
  }, [contacts, saved])

  // Select a recipient from the shortlist / issuer shortcut and advance the wizard.
  const pickRecipient = (identityKey: string, name = '', avatarURL = '') => {
    setRecipient(identityKey)
    setPublicKeyInput(identityKey)
    setRecipientName(name)
    setRecipientAvatarURL(avatarURL)
    setSearchInput('')
    setIdentities([])
    setSelectedIdentity(null)
    setStep('amount')
  }

  const confirmRecipient = () => {
    if (!recipient.trim()) return
    setStep('amount')
  }

  const handleKeypad = (key: string) => {
    if (key === 'backspace') {
      setAmountStr(s => s.slice(0, -1))
      return
    }
    if (key === '.') {
      if (decimals === 0) return // no decimals allowed
      if (amountStr.includes('.')) return
      setAmountStr(s => (s === '' ? '0.' : s + '.'))
      return
    }
    // digit
    const next = amountStr + key
    // Validate it won't exceed balance or have too many decimal places
    const [, frac = ''] = next.split('.')
    if (frac.length > decimals) return
    setAmountStr(next)
  }

  const handleMax = () => {
    if (!selectedBalance) return
    setAmountStr(formatAmountPlain(selectedBalance.amount, decimals))
  }

  const handleConfirmAndSend = async () => {
    if (isPaused && !devMode) return // dev mode: let the overlay do the rejecting
    if (!assetId || !recipient || !sendAmount || sendAmount <= 0) return
    if (!selectedBalance || selectedBalance.amount < sendAmount) return

    setSendError('')
    setIsSending(true)
    try {
      const txid = await transfer(assetId, sendAmount, recipient)
      setSentTxid(txid)
      setStep('sent')
      void loadBalances()
    } catch (e) {
      console.error('Send error:', e)
      setSendError(e instanceof Error ? e.message : 'Send failed. Please try again.')
    } finally {
      setIsSending(false)
    }
  }

  const resetFlow = () => {
    setStep('recipient')
    setAssetId(lockedAssetId ?? '')
    setAmountStr('')
    setNote('')
    setRecipient('')
    setRecipientName('')
    setRecipientAvatarURL('')
    setPublicKeyInput('')
    setSentTxid('')
    setSendError('')
    setSearchInput('')
    setIdentities([])
    setSelectedIdentity(null)
  }

  const shareReceipt = async () => {
    if (!sentTxid) return
    try {
      await navigator.clipboard.writeText(sentTxid)
      setReceiptCopied(true)
      setTimeout(() => setReceiptCopied(false), 1400)
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const recipientInitials = getInitials(recipientName, recipient || 'XX')

  // Meridian neutral pill — small label
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] font-medium tracking-[1.2px] uppercase text-faint-foreground mb-[14px]">
      {children}
    </div>
  )

  // Back button — white circle with left chevron (faithful to 3a/3b/3c)
  const BackButton = ({ onClick }: { onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-card border border-border transition-colors hover:bg-accent active:scale-[0.97]"
      aria-label="Go back"
    >
      <ChevronLeft className="h-[17px] w-[17px]" />
    </button>
  )

  // Recipient avatar bubble
  const RecipientAvatar = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const sz = size === 'lg' ? 'h-[90px] w-[90px] text-[30px]' : size === 'md' ? 'h-11 w-11 text-[15px]' : 'h-7 w-7 text-[11px]'
    return recipientAvatarURL ? (
      <img src={recipientAvatarURL} alt={recipientName} className={cn('rounded-full object-cover', sz)} />
    ) : (
      <div className={cn('flex flex-none items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold', sz)}>
        {recipientInitials}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Step: Recipient
  // ---------------------------------------------------------------------------

  const renderRecipient = () => (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-0">
        <div className="text-[19px] font-semibold">Send money</div>
      </div>

      {/* Search bar */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-2.5 rounded-[14px] border border-border bg-card px-3.5 py-3">
          <Search className="h-[17px] w-[17px] flex-none text-subtle-foreground" />
          <input
            {...noAutofill}
            name="mandala-recipient-search"
            type="text"
            value={searchInput}
            onChange={e => { setSearchInput(e.target.value); setSelectedIdentity(null) }}
            placeholder="Name, @handle or email"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground placeholder:text-subtle-foreground outline-none"
          />
          {isSearching && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </div>

        {/* Search results dropdown */}
        {searchInput && identities.length > 0 && !selectedIdentity && (
          <div className="mt-2 rounded-[--radius-md] bg-popover shadow-[var(--shadow-pop)] overflow-hidden">
            {identities.map(identity => (
              <div
                key={identity.identityKey}
                onClick={() => handleIdentitySelect(identity)}
                className="flex cursor-pointer items-center gap-3 border-b border-separator p-3 transition-colors last:border-b-0 hover:bg-muted active:bg-accent"
              >
                {identity.avatarURL ? (
                  <img src={identity.avatarURL} alt={identity.name} className="h-10 w-10 rounded-full flex-none" />
                ) : (
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
                    {getInitials(identity.name || '', identity.identityKey)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{identity.name || 'Unknown'}</div>
                  <div className="tabular truncate text-[11.5px] text-subtle-foreground mt-0.5">@{identity.identityKey.slice(0, 16)}…</div>
                </div>
                {identity.badgeLabel && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                    {identity.badgeLabel}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {searchInput && identities.length === 0 && !isSearching && (
          <p className="mt-2 text-[13px] text-subtle-foreground">No identities found</p>
        )}
      </div>

      {/* Contacts shortlist — recency-first, tap to select (no search needed).
          Truncated to CONTACT_LIMIT so the most recent stay on screen. */}
      {pickList.length > 0 && (
        <div className="px-5 pt-6">
          <SectionLabel>Contacts</SectionLabel>
          <div className="divide-y divide-separator">
            {pickList.map(c => (
              <button
                key={c.identityKey}
                type="button"
                onClick={() => pickRecipient(c.identityKey, c.name ?? '', c.avatarURL ?? '')}
                className="flex w-full items-center gap-3 py-[11px] hover:bg-muted/60 active:bg-accent transition-colors -mx-1 px-1 rounded-[--radius]"
              >
                {c.avatarURL ? (
                  <img src={c.avatarURL} alt={c.name ?? ''} className="h-10 w-10 flex-none rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 flex-none flex items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-[13px]">
                    {getInitials(c.name ?? '', c.identityKey)}
                  </div>
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[14px] font-semibold truncate">
                    {c.name || `${c.identityKey.slice(0, 16)}…`}
                  </div>
                  <div className="text-[11.5px] text-subtle-foreground mt-0.5 truncate">
                    {c.subtitle}
                  </div>
                </div>
                <ChevronLeft className="h-[17px] w-[17px] text-border rotate-180 flex-none" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Return to issuer shortcut — shown when token is locked */}
      {assetId && metas[assetId]?.issuer && (
        <div className="px-5 pt-4">
          <button
            type="button"
            onClick={() => {
              const iss = metas[assetId].issuer as string
              setRecipient(iss)
              setPublicKeyInput(iss)
              setRecipientName('Issuer')
              setRecipientAvatarURL('')
              setSearchInput('')
              setIdentities([])
              setSelectedIdentity(null)
              setStep('amount')
            }}
            className="flex w-full items-center justify-center gap-2 rounded-[--radius-md] border border-border bg-card px-3.5 py-2.5 text-[14px] font-medium text-foreground transition-colors hover:bg-accent active:scale-[0.97]"
          >
            <Send className="h-[15px] w-[15px]" /> Return to issuer
          </button>
        </div>
      )}

      {/* Identity key paste — de-emphasised, at the bottom per 3a design */}
      <div className="mt-auto px-5 pb-6 pt-4">
        <button
          type="button"
          onClick={() => {
            // Expand to reveal the raw key entry field inline — toggle a local input
          }}
          className="sr-only"
        />
        {/* Dashed "Send to identity key" area */}
        <div className="relative">
          <div className="flex items-center justify-center gap-2.5 rounded-[13px] border border-dashed border-border/60 px-4 py-[13px] text-subtle-foreground">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 14h3v3M20 20v.01M17 20v.01M20 17v.01" strokeLinecap="round"/>
            </svg>
            <span className="text-[12.5px] font-medium">Send to an identity key</span>
          </div>
          {/* Actual input overlaid — always present but styled softly */}
          <input
            type="text"
            value={publicKeyInput}
            onChange={e => {
              const val = e.target.value.trim()
              setPublicKeyInput(val)
              if (val) {
                try {
                  PublicKey.fromString(val)
                  setRecipient(val)
                  setRecipientName('')
                  setRecipientAvatarURL('')
                  setSearchInput('')
                  setIdentities([])
                  setSelectedIdentity(null)
                } catch {
                  setRecipient('')
                }
              } else {
                setRecipient('')
              }
            }}
            onKeyDown={e => { if (e.key === 'Enter' && recipient) confirmRecipient() }}
            placeholder="Paste identity key…"
            className="absolute inset-0 w-full h-full rounded-[13px] bg-transparent px-4 py-[13px] text-[12.5px] text-foreground placeholder:text-transparent opacity-0 focus:opacity-100 focus:bg-card focus:border focus:border-primary focus:placeholder:text-subtle-foreground outline-none transition-opacity"
            autoComplete="off"
          />
        </div>
        {publicKeyInput && !recipient && (
          <p className="mt-1.5 text-[12px] text-destructive">Invalid public key</p>
        )}
        {recipient && publicKeyInput && (
          <Button
            onClick={confirmRecipient}
            className="mt-3 w-full"
            size="lg"
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Step: Amount
  // ---------------------------------------------------------------------------

  // Format the display value with a blinking cursor
  const amountDisplay = amountStr === '' ? '0' : amountStr

  const renderAmount = () => (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header with back + recipient chip */}
      <div className="flex items-center gap-3 px-5 pt-4">
        <BackButton onClick={() => setStep('recipient')} />
        <div className="flex items-center gap-2.5">
          <RecipientAvatar size="sm" />
          <div>
            <div className="text-[10.5px] text-subtle-foreground leading-none">To</div>
            <div className="text-[14px] font-semibold leading-tight mt-0.5">
              {recipientName || (recipient.slice(0, 12) + '…')}
            </div>
          </div>
        </div>
      </div>

      {/* Token selector (only when not locked) */}
      {!locked && (
        <div className="px-5 pt-4">
          {isLoadingBalances ? (
            <div className="text-[13px] text-subtle-foreground">Loading tokens…</div>
          ) : balances.length > 0 ? (
            <Select value={assetId} onChange={e => { setAssetId(e.target.value); setAmountStr('') }}>
              <option value="">Select a token</option>
              {balances.map(b => (
                <option key={b.assetId} value={b.assetId}>
                  {labelFor(b.assetId)} ({formatAmount(b.amount, decimalsFor(b.assetId))} available)
                </option>
              ))}
            </Select>
          ) : (
            <div className="text-[13px] text-subtle-foreground">No tokens — receive some first.</div>
          )}
        </div>
      )}

      {/* Big amount display */}
      <div className="px-6 pt-9 text-center">
        <div className="text-[11px] font-medium tracking-[1.6px] uppercase text-subtle-foreground">
          Sending · {assetId ? labelFor(assetId) : 'Select token'}
        </div>
        <div className="mt-3.5 font-semibold text-[56px] leading-none tracking-[-2px] tabular">
          {amountDisplay}
          <span className="inline-block w-[3px] h-[46px] bg-primary rounded-[2px] align-[-7px] ml-[3px] animate-pulse" />
        </div>
        {selectedBalance && assetId && (
          <div className="mt-[18px] inline-flex items-center gap-2.5">
            <span className="text-[12px] text-subtle-foreground">
              {formatAmount(selectedBalance.amount, decimals)} available
            </span>
            <button
              type="button"
              onClick={handleMax}
              className="text-[11px] font-semibold text-primary border border-primary/30 rounded-full px-2.5 py-[5px] hover:bg-primary/10 active:scale-[0.97] transition-all"
            >
              Max
            </button>
          </div>
        )}
      </div>

      {/* Note field */}
      <div className="px-5 pt-[22px]">
        <div className="flex items-center gap-2.5 rounded-[12px] border border-border bg-card px-3.5 py-3">
          <svg className="text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-subtle-foreground outline-none"
          />
        </div>
      </div>

      {/* Numeric keypad */}
      <div className="mt-auto px-[30px] pb-6 pt-3">
        <div className="grid grid-cols-3 text-center text-foreground">
          {['1','2','3','4','5','6','7','8','9','.','0','backspace'].map(key => (
            <button
              key={key}
              type="button"
              onClick={() => handleKeypad(key)}
              disabled={key === '.' && decimals === 0}
              className={cn(
                'py-[11px] font-medium text-[23px] flex items-center justify-center transition-transform active:scale-[0.97] select-none min-h-[44px]',
                key === '.' && decimals === 0 && 'opacity-20 cursor-not-allowed'
              )}
            >
              {key === 'backspace' ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 5H8l-6 7 6 7h13a1 1 0 001-1V6a1 1 0 00-1-1z" strokeLinejoin="round"/>
                  <path d="M15 9l-4 6M11 9l4 6" strokeLinecap="round"/>
                </svg>
              ) : key}
            </button>
          ))}
        </div>

        <Button
          onClick={() => {
            if (!assetId || !sendAmount || sendAmount <= 0) return
            if (!selectedBalance || selectedBalance.amount < sendAmount) return
            setStep('review')
          }}
          disabled={!assetId || !sendAmount || sendAmount <= 0 || !selectedBalance || selectedBalance.amount < sendAmount}
          size="lg"
          className="mt-3 w-full"
        >
          Review
        </Button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Step: Review
  // ---------------------------------------------------------------------------

  const renderReview = () => (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4">
        <BackButton onClick={() => setStep('amount')} />
        <div className="text-[19px] font-semibold">Review</div>
      </div>

      {/* Review card */}
      <div className="px-5 pt-[22px]">
        <div className="rounded-[18px] border border-border bg-card overflow-hidden shadow-[var(--shadow-card)]">
          {/* Recipient row */}
          <div className="flex items-center gap-3 px-[18px] py-4">
            <RecipientAvatar size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold truncate">
                {recipientName || 'Unknown'}
              </div>
              <div className="tabular text-[12px] text-subtle-foreground mt-[3px] truncate">
                {recipient.slice(0, 24)}…
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-success bg-success/10 px-2 py-1 rounded-[6px]">
              <CheckCircle2 className="h-[11px] w-[11px]" />
              Verified
            </span>
          </div>

          {/* Detail rows */}
          <div className="px-[18px] pb-2.5">
            <div className="flex items-center justify-between py-3 border-t border-separator">
              <span className="text-[12.5px] text-subtle-foreground">Amount</span>
              <span className="tabular text-[17px] font-semibold">
                {formatAmount(sendAmount, decimals)} {labelFor(assetId)}
              </span>
            </div>
            <div className="flex items-center justify-between py-3 border-t border-separator">
              <span className="text-[12.5px] text-subtle-foreground">From</span>
              <span className="text-[13.5px] font-semibold">{labelFor(assetId)} account</span>
            </div>
            {note && (
              <div className="flex items-center justify-between py-3 border-t border-separator">
                <span className="text-[12.5px] text-subtle-foreground">Note</span>
                <span className="text-[13.5px] font-semibold truncate max-w-[60%] text-right">{note}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-3 border-t border-separator">
              <span className="text-[12.5px] text-subtle-foreground">Fee</span>
              <span className="text-[13.5px] font-semibold text-success">Free · Instant</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pause guard */}
      {isPaused && !devMode && (
        <div className="mx-5 mt-4 rounded-[--radius-md] bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          Transfers are temporarily disabled by the issuer.
        </div>
      )}
      {isPaused && devMode && (
        <div className="mx-5 mt-4 rounded-[--radius-md] bg-warning/10 px-4 py-3 text-[13px] text-warning">
          <span className="font-semibold">Developer mode:</span> frontend pause guard bypassed. This
          asset is paused, so the overlay should reject the transfer server-side — send to verify.
        </div>
      )}

      {/* Send failure surface */}
      {sendError && (
        <div className="mx-5 mt-4 rounded-[--radius-md] bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          {sendError}
        </div>
      )}

      {/* Confirm CTA */}
      <div className="mt-auto px-5 pb-6 pt-4">
        <Button
          onClick={() => void handleConfirmAndSend()}
          disabled={isSending || (isPaused && !devMode) || wallet == null}
          size="lg"
          className="w-full"
        >
          {isSending ? (
            <>
              <Loader2 className="h-[17px] w-[17px] animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="h-[17px] w-[17px]" />
              Send {formatAmount(sendAmount, decimals)} {labelFor(assetId)}
            </>
          )}
        </Button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Step: Sent
  // ---------------------------------------------------------------------------

  const renderSent = () => (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Calm success centre */}
      <div className="flex flex-1 flex-col items-center justify-center px-[34px] pb-[210px] text-center">
        {/* Glow + check mark */}
        <div className="relative mb-7 flex justify-center">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[190px] w-[190px] rounded-full bg-[radial-gradient(circle,rgba(35,64,94,.16),rgba(35,64,94,0)_68%)]" />
          <div className="relative flex h-[90px] w-[90px] items-center justify-center rounded-full bg-primary shadow-[0_16px_34px_-10px_rgba(35,64,94,.55)]">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="var(--brass)" strokeWidth="2.4">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        <div className="text-[11px] font-medium tracking-[2px] uppercase text-subtle-foreground">Sent</div>
        <div className="tabular mt-3 text-[44px] font-semibold leading-none tracking-[-1.5px]">
          {formatAmount(sendAmount, decimals)}
        </div>
        <div className="text-[14px] text-muted-foreground mt-2.5 leading-snug">
          {labelFor(assetId)} to {recipientName || (recipient.slice(0, 12) + '…')}
        </div>
        {sentTxid && (
          <div className="mt-4 text-[12px] text-subtle-foreground">
            Ref {sentTxid.slice(0, 8)}…{sentTxid.slice(-4)}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-5 pb-6 flex flex-col gap-2.5">
        <Button size="lg" className="w-full" onClick={resetFlow}>
          Make another payment
        </Button>
        <button
          type="button"
          onClick={() => void shareReceipt()}
          disabled={!sentTxid}
          className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-[15px] text-[14px] font-semibold text-primary transition-colors hover:bg-accent active:scale-[0.97] disabled:opacity-40"
        >
          {receiptCopied
            ? <><CheckCircle2 className="h-[15px] w-[15px] text-success" />Txid copied</>
            : <><Copy className="h-[15px] w-[15px]" />Share receipt</>}
        </button>
      </div>
    </div>
  )

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col rounded-[--radius-lg] bg-background shadow-[var(--shadow-card)] border border-border overflow-hidden min-h-[520px]">
      {step === 'recipient' && renderRecipient()}
      {step === 'amount' && renderAmount()}
      {step === 'review' && renderReview()}
      {step === 'sent' && renderSent()}
    </div>
  )
}
