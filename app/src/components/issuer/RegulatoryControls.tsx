import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useIdentitySearch } from '@bsv/identity-react'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { useWallet } from '../../context/WalletContext'
import { AdminAsset, submitAdminAction } from '../../lib/mandala/assets'
import { resolveAssetState, AssetAdminStateView } from '../../lib/mandala/adminState'
import { formatAmount } from '../../lib/mandala/amount'

interface Props {
  assets: AdminAsset[]
  onActionComplete?: () => void
}

export default function RegulatoryControls({ assets, onActionComplete }: Props) {
  const { wallet, messageBoxClient, identityKey } = useWallet()

  // Selected asset
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [state, setState] = useState<AssetAdminStateView | null>(null)
  const [busy, setBusy] = useState(false)

  // Freeze/unfreeze
  const [freezeOutpoint, setFreezeOutpoint] = useState('')
  const [selectedFreezeRef, setSelectedFreezeRef] = useState('')

  // Identity search (block/allow)
  const [resolvedIdentityKey, setResolvedIdentityKey] = useState('')
  const [publicKeyInput, setPublicKeyInput] = useState('')

  // Access mode
  const [newAccessMode, setNewAccessMode] = useState<'denylist' | 'allowlist'>('denylist')

  // Reissue
  const [reissueOutpoint, setReissueOutpoint] = useState('')
  const [reissueAmount, setReissueAmount] = useState('')
  const [reissueRecipient, setReissueRecipient] = useState('')
  const [reissueRecipientPublicKey, setReissueRecipientPublicKey] = useState('')
  const [reissuePublicKeyInput, setReissuePublicKeyInput] = useState('')

  const asset = assets.find(a => a.assetId === selectedAssetId) ?? null
  const decimals = Number(asset?.metadata?.decimals) || 0

  const loadState = useCallback(async () => {
    if (selectedAssetId === '') { setState(null); return }
    const s = await resolveAssetState(selectedAssetId)
    setState(s)
    setNewAccessMode(s?.accessMode ?? 'denylist')
  }, [selectedAssetId])

  useEffect(() => { void loadState() }, [loadState])

  // Pre-fill reissue amount when a frozen outpoint is selected
  useEffect(() => {
    if (reissueOutpoint === '' || state == null) { return }
    const ref = state.frozenOutpoints.find(r => r.outpoint === reissueOutpoint)
    if (ref != null) {
      setReissueAmount(String(ref.amount))
    }
  }, [reissueOutpoint, state])

  const identitySearch = useIdentitySearch({
    originator: 'mandala',
    wallet: wallet as any,
    onIdentitySelected: (identity) => {
      if (identity) {
        setResolvedIdentityKey(identity.identityKey)
        setPublicKeyInput(identity.identityKey)
      }
    }
  })

  const reissueIdentitySearch = useIdentitySearch({
    originator: 'mandala',
    wallet: wallet as any,
    onIdentitySelected: (identity) => {
      if (identity) {
        setReissueRecipient(identity.identityKey)
        setReissueRecipientPublicKey(identity.identityKey)
        setReissuePublicKeyInput(identity.identityKey)
      }
    }
  })

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (wallet == null || identityKey == null || asset == null) return
    setBusy(true)
    try {
      await fn()
      await loadState()
      onActionComplete?.()
    } catch (e) {
      toast.error(`Action failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, asset, loadState, onActionComplete])

  // ---------------------------------------------------------------------------
  // Pause / unpause
  // ---------------------------------------------------------------------------
  const handlePauseToggle = () => void run(async () => {
    const isPaused = state?.isPaused ?? false
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: {
        kind: isPaused ? 'unpause' : 'pause',
        assetId: asset!.assetId,
        priorOutpoint: asset!.authOutpoint
      },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    toast.success(isPaused ? 'Asset unpaused' : 'Asset paused')
  })

  // ---------------------------------------------------------------------------
  // Freeze output
  // ---------------------------------------------------------------------------
  const handleFreeze = () => void run(async () => {
    const op = freezeOutpoint.trim()
    if (op === '') { toast.error('Enter an outpoint to freeze'); return }
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: { kind: 'freezeOutput', assetId: asset!.assetId, outpoint: op, priorOutpoint: asset!.authOutpoint },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    toast.success(`Output ${op.slice(0, 16)}… frozen`)
    setFreezeOutpoint('')
  })

  // ---------------------------------------------------------------------------
  // Unfreeze output (from list)
  // ---------------------------------------------------------------------------
  const handleUnfreeze = () => void run(async () => {
    const op = selectedFreezeRef || freezeOutpoint.trim()
    if (op === '') { toast.error('Select or enter an outpoint to unfreeze'); return }
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: { kind: 'unfreezeOutput', assetId: asset!.assetId, outpoint: op, priorOutpoint: asset!.authOutpoint },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    toast.success(`Output ${op.slice(0, 16)}… unfrozen`)
    setSelectedFreezeRef('')
    setFreezeOutpoint('')
  })

  // ---------------------------------------------------------------------------
  // Block / unblock / allow / unallow identity
  // ---------------------------------------------------------------------------
  const handleIdentityAction = (kind: 'blockIdentity' | 'unblockIdentity' | 'allowIdentity' | 'unallowIdentity') => void run(async () => {
    const key = resolvedIdentityKey || publicKeyInput.trim()
    if (key === '') { toast.error('Select or enter an identity key'); return }
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: { kind, assetId: asset!.assetId, identityKey: key, priorOutpoint: asset!.authOutpoint },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    const labels: Record<string, string> = { blockIdentity: 'Blocked', unblockIdentity: 'Unblocked', allowIdentity: 'Allowlisted', unallowIdentity: 'Removed from allowlist' }
    toast.success(`${labels[kind]} ${key.slice(0, 12)}…`)
    setResolvedIdentityKey('')
    setPublicKeyInput('')
    identitySearch.handleSelect(null as any, null)
  })

  // ---------------------------------------------------------------------------
  // Set access mode
  // ---------------------------------------------------------------------------
  const handleSetAccessMode = () => void run(async () => {
    if (newAccessMode === 'allowlist' && (state?.allowedIdentities.length ?? 0) === 0) {
      toast.error('Add at least one allowed identity first')
      return
    }
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: { kind: 'setAccessMode', assetId: asset!.assetId, mode: newAccessMode, priorOutpoint: asset!.authOutpoint },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    toast.success(`Access mode set to ${newAccessMode}`)
  })

  // ---------------------------------------------------------------------------
  // Reissue (from frozen outpoint)
  // ---------------------------------------------------------------------------
  const handleReissue = () => void run(async () => {
    const op = reissueOutpoint
    if (op === '') { toast.error('Select a frozen outpoint to reissue'); return }
    const recipient = reissueRecipient || reissueRecipientPublicKey.trim()
    if (recipient === '') { toast.error('Enter a recipient identity key'); return }
    const amount = Number(reissueAmount)
    if (!Number.isInteger(amount) || amount < 1) { toast.error('Enter a valid amount'); return }
    await submitAdminAction({
      wallet: wallet as any,
      asset: asset!,
      details: {
        kind: 'reissue',
        assetId: asset!.assetId,
        outpoint: op,
        amount,
        recipient,
        priorOutpoint: asset!.authOutpoint
      },
      ftOutput: { recipient, amount },
      identityKey: identityKey!,
      messageBoxClient: messageBoxClient ?? undefined
    })
    toast.success(`Reissued ${formatAmount(amount, decimals)} ${asset!.label} to ${recipient.slice(0, 12)}…`)
    setReissueOutpoint('')
    setReissueAmount('')
    setReissueRecipient('')
    setReissueRecipientPublicKey('')
    setReissuePublicKeyInput('')
    reissueIdentitySearch.handleSelect(null as any, null)
  })

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (assets.length === 0) {
    return (
      <div className="bg-card border border-border rounded-[14px] p-[24px_20px] text-center">
        <p className="text-[13px] text-subtle-foreground">Register an asset first.</p>
      </div>
    )
  }

  const isPaused = state?.isPaused ?? false
  const hasFrozen = (state?.frozenOutpoints.length ?? 0) > 0
  const identityKeyEmpty = resolvedIdentityKey === '' && publicKeyInput.trim() === ''

  return (
    <div className="space-y-[14px]">
      {/* Page heading row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.5px', lineHeight: '1.2' }}>
            Regulatory controls
          </h1>
          <p className="text-subtle-foreground text-[13px] mt-[3px]">
            Pause, freeze, block &amp; manage access
            {asset != null ? ` for ${asset.label}` : ''}
          </p>
        </div>
        {/* Asset selector chip */}
        <div className="shrink-0 flex flex-col gap-[4px]">
          <label className="text-[10.5px] text-subtle-foreground font-medium">Asset</label>
          <Select
            value={selectedAssetId}
            onChange={e => { setSelectedAssetId(e.target.value) }}
            className="bg-card border border-border rounded-[10px] px-3 py-[7px] text-[12px] font-medium"
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Live state strip */}
      <div className="bg-card border border-border rounded-[12px] px-5 py-[14px] flex items-center gap-0">
        {/* Status */}
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-subtle-foreground mb-[7px] font-medium">Status</div>
          {state == null ? (
            <div className="text-[13px] font-semibold text-foreground">—</div>
          ) : (
            <div className="flex items-center gap-[6px]">
              <div
                className={`w-[7px] h-[7px] rounded-full shrink-0 ${isPaused ? 'bg-warning' : 'bg-success'}`}
              />
              <span className="text-[13px] font-semibold">{isPaused ? 'Paused' : 'Active'}</span>
            </div>
          )}
        </div>

        <div className="w-px bg-separator self-stretch mx-4" />

        {/* Access mode */}
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-subtle-foreground mb-[7px] font-medium">Access mode</div>
          <div className="text-[13px] font-semibold capitalize">
            {state == null ? '—' : (state.accessMode ?? '—')}
          </div>
        </div>

        <div className="w-px bg-separator self-stretch mx-4" />

        {/* Frozen outputs */}
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-subtle-foreground mb-[7px] font-medium">Frozen outputs</div>
          <div className="text-[13px] font-semibold">
            {state == null ? '—' : state.frozenOutpoints.length}
          </div>
        </div>

        <div className="w-px bg-separator self-stretch mx-4" />

        {/* Blocked */}
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-subtle-foreground mb-[7px] font-medium">Blocked</div>
          <div className="text-[13px] font-semibold">
            {state == null ? '—' : state.blockedIdentities.length}
          </div>
        </div>

        <div className="w-px bg-separator self-stretch mx-4" />

        {/* Allowed */}
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] text-subtle-foreground mb-[7px] font-medium">Allowed</div>
          <div className="text-[13px] font-semibold">
            {state == null ? '—' : state.allowedIdentities.length}
          </div>
        </div>
      </div>

      {/* Control cards grid */}
      <div className="grid grid-cols-2 gap-[14px]">
        {/* Card 1 — Transfers */}
        <div className="bg-card border border-border rounded-[14px] p-[16px_18px]">
          <div className="text-[13.5px] font-semibold mb-[10px]">Transfers</div>
          <p className="text-[12px] text-subtle-foreground leading-[1.5]">
            {isPaused
              ? 'Transfers are paused. Resuming will allow all holder transfers.'
              : 'Peer transfers are currently enabled. Pausing stops all holder transfers; admin actions still work.'}
          </p>
          <button
            onClick={handlePauseToggle}
            disabled={busy || asset == null}
            className="w-full rounded-[11px] py-3 text-[13px] font-semibold mt-[14px] flex items-center justify-center gap-2 disabled:opacity-50"
            style={isPaused
              ? { background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }
              : { background: '#B4534A', color: '#fff' }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPaused ? 'Unpause transfers' : 'Pause transfers'}
          </button>
        </div>

        {/* Card 2 — Access mode */}
        <div className="bg-card border border-border rounded-[14px] p-[16px_18px]">
          <div className="text-[13.5px] font-semibold mb-[10px]">Access mode</div>
          <p className="text-[12px] text-subtle-foreground leading-[1.5]">
            Denylist = anyone except blocked. Allowlist = only allowed identities.
          </p>
          {/* Segmented control */}
          <div className="flex bg-muted rounded-[9px] p-[3px] mt-[13px]">
            <button
              onClick={() => setNewAccessMode('denylist')}
              className={
                newAccessMode === 'denylist'
                  ? 'flex-1 text-center py-2 bg-card rounded-[7px] font-semibold text-[12px] shadow-[0_1px_2px_rgba(27,30,36,.08)] text-foreground'
                  : 'flex-1 text-center py-2 font-medium text-[12px] text-subtle-foreground cursor-pointer'
              }
            >
              Denylist
            </button>
            <button
              onClick={() => setNewAccessMode('allowlist')}
              className={
                newAccessMode === 'allowlist'
                  ? 'flex-1 text-center py-2 bg-card rounded-[7px] font-semibold text-[12px] shadow-[0_1px_2px_rgba(27,30,36,.08)] text-foreground'
                  : 'flex-1 text-center py-2 font-medium text-[12px] text-subtle-foreground cursor-pointer'
              }
            >
              Allowlist
            </button>
          </div>
          <button
            onClick={handleSetAccessMode}
            disabled={busy || asset == null}
            className="w-full rounded-[11px] py-[11px] text-[13px] font-semibold mt-3 flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply access mode
          </button>
        </div>

        {/* Card 3 — Freeze output */}
        <div className="bg-card border border-border rounded-[14px] p-[16px_18px]">
          <div className="text-[13.5px] font-semibold mb-[6px]">Freeze output</div>
          <input
            value={freezeOutpoint}
            onChange={e => setFreezeOutpoint(e.target.value)}
            placeholder="txid.vout"
            className="bg-muted border border-[rgba(27,30,36,.12)] rounded-[10px] px-[13px] py-[11px] font-mono text-[12px] text-subtle-foreground placeholder:text-subtle-foreground w-full mt-3 outline-none focus:border-[rgba(27,30,36,.3)]"
          />
          {hasFrozen && (
            <Select
              value={selectedFreezeRef}
              onChange={e => {
                setSelectedFreezeRef(e.target.value)
                setFreezeOutpoint(e.target.value)
              }}
              className="w-full mt-2 text-[12px]"
            >
              <option value="">Select frozen output…</option>
              {state!.frozenOutpoints.map(r => (
                <option key={r.outpoint} value={r.outpoint}>
                  {r.outpoint.slice(0, 20)}… — {formatAmount(r.amount, decimals)} — {r.owner.slice(0, 10)}…
                </option>
              ))}
            </Select>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleFreeze}
              disabled={busy || freezeOutpoint.trim() === '' || asset == null}
              className="flex-1 rounded-[11px] py-[11px] text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Freeze
            </button>
            <button
              onClick={handleUnfreeze}
              disabled={busy || (freezeOutpoint.trim() === '' && selectedFreezeRef === '') || asset == null}
              className="flex-1 rounded-[11px] py-[11px] text-[13px] font-semibold bg-card border border-border text-foreground flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Unfreeze
            </button>
          </div>
        </div>

        {/* Card 4 — Block / allow identity */}
        <div className="bg-card border border-border rounded-[14px] p-[16px_18px]">
          <div className="text-[13.5px] font-semibold mb-[10px]">Block / allow identity</div>

          {/* Identity search */}
          <Input
            icon={<Search className="h-[18px] w-[18px]" />}
            value={identitySearch.inputValue}
            onChange={e => identitySearch.handleInputChange(e, e.target.value, 'input')}
            placeholder="Search by name, email…"
            disabled={!!(resolvedIdentityKey && publicKeyInput)}
          />
          {identitySearch.isLoading && (
            <p className="mt-1.5 text-[12px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </p>
          )}
          {identitySearch.inputValue && identitySearch.identities.length > 0 && !identitySearch.selectedIdentity && (
            <div className="mt-2 max-h-48 overflow-auto rounded-[--radius-md] bg-popover shadow-[var(--shadow-pop)]">
              {identitySearch.identities.map(identity => {
                if (typeof identity === 'string') return null
                return (
                  <div
                    key={identity.identityKey}
                    onClick={() => {
                      identitySearch.handleSelect(null as any, identity)
                      setResolvedIdentityKey(identity.identityKey)
                      setPublicKeyInput(identity.identityKey)
                    }}
                    className="flex cursor-pointer items-center gap-2 border-b border-separator p-3 text-[14px] transition-colors last:border-b-0 hover:bg-muted"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
                      {(identity.name ?? identity.identityKey).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{identity.name || 'Unknown'}</div>
                      <div className="tabular truncate text-[11px] text-subtle-foreground">{identity.identityKey.slice(0, 20)}…</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Paste key */}
          <Input
            value={publicKeyInput}
            onChange={e => {
              setPublicKeyInput(e.target.value.trim())
              setResolvedIdentityKey(e.target.value.trim())
              identitySearch.handleSelect(null as any, null)
            }}
            disabled={!!identitySearch.selectedIdentity}
            placeholder="Or paste identity key"
            className="tabular mt-2"
          />

          {/* Primary action row: Block + Allow */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleIdentityAction('blockIdentity')}
              disabled={busy || identityKeyEmpty || asset == null}
              className="flex-1 rounded-[11px] py-[11px] text-[13px] font-semibold bg-card border disabled:opacity-50"
              style={{ borderColor: 'rgba(180,83,74,.4)', color: '#B4534A' }}
            >
              Block
            </button>
            <button
              onClick={() => handleIdentityAction('allowIdentity')}
              disabled={busy || identityKeyEmpty || asset == null}
              className="flex-1 rounded-[11px] py-[11px] text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Allow
            </button>
          </div>

          {/* Secondary row: Unblock + Unallow */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => handleIdentityAction('unblockIdentity')}
              disabled={busy || identityKeyEmpty || asset == null}
              className="flex-1 rounded-[11px] py-[9px] text-[12px] font-medium text-subtle-foreground bg-muted disabled:opacity-40"
            >
              Unblock
            </button>
            <button
              onClick={() => handleIdentityAction('unallowIdentity')}
              disabled={busy || identityKeyEmpty || asset == null}
              className="flex-1 rounded-[11px] py-[9px] text-[12px] font-medium text-subtle-foreground bg-muted disabled:opacity-40"
            >
              Unallow
            </button>
          </div>
        </div>
      </div>

      {/* Reissue from frozen — slim strip */}
      <div className="bg-[#EFE9DD] border-dashed border border-[rgba(27,30,36,.18)] rounded-[12px] p-[14px_18px] mt-[14px]">
        {!hasFrozen ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold">Reissue from frozen output</div>
              <div className="text-[12px] text-subtle-foreground mt-[2px]">No frozen outputs available</div>
            </div>
            <div className="text-[12px] text-subtle-foreground">Nothing to reissue</div>
          </div>
        ) : (
          <>
            <div className="text-[13px] font-semibold mb-[12px]">Reissue from frozen output</div>

            {/* Frozen output select */}
            <Select
              value={reissueOutpoint}
              onChange={e => setReissueOutpoint(e.target.value)}
              className="w-full text-[12px]"
            >
              <option value="">Select frozen output…</option>
              {state!.frozenOutpoints.map(r => (
                <option key={r.outpoint} value={r.outpoint}>
                  {r.outpoint.slice(0, 20)}… — {formatAmount(r.amount, decimals)} — {r.owner.slice(0, 10)}…
                </option>
              ))}
            </Select>

            {/* Amount */}
            <input
              type="number"
              min="0"
              step="any"
              value={reissueAmount}
              onChange={e => setReissueAmount(e.target.value)}
              placeholder="Amount (prefilled from frozen output)"
              className="bg-white border border-[rgba(27,30,36,.12)] rounded-[10px] px-[13px] py-[11px] font-mono text-[12px] text-foreground placeholder:text-subtle-foreground w-full mt-2 outline-none focus:border-[rgba(27,30,36,.3)]"
            />

            {/* Recipient search */}
            <div className="mt-2">
              <Input
                icon={<Search className="h-[18px] w-[18px]" />}
                value={reissueIdentitySearch.inputValue}
                onChange={e => reissueIdentitySearch.handleInputChange(e, e.target.value, 'input')}
                placeholder="Search recipient by name…"
                disabled={!!(reissueRecipient && reissuePublicKeyInput)}
              />
              {reissueIdentitySearch.inputValue && reissueIdentitySearch.identities.length > 0 && !reissueIdentitySearch.selectedIdentity && (
                <div className="mt-2 max-h-48 overflow-auto rounded-[--radius-md] bg-popover shadow-[var(--shadow-pop)]">
                  {reissueIdentitySearch.identities.map(identity => {
                    if (typeof identity === 'string') return null
                    return (
                      <div
                        key={identity.identityKey}
                        onClick={() => {
                          reissueIdentitySearch.handleSelect(null as any, identity)
                          setReissueRecipient(identity.identityKey)
                          setReissueRecipientPublicKey(identity.identityKey)
                          setReissuePublicKeyInput(identity.identityKey)
                        }}
                        className="flex cursor-pointer items-center gap-2 border-b border-separator p-3 text-[14px] transition-colors last:border-b-0 hover:bg-muted"
                      >
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
                          {(identity.name ?? identity.identityKey).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{identity.name || 'Unknown'}</div>
                          <div className="tabular truncate text-[11px] text-subtle-foreground">{identity.identityKey.slice(0, 20)}…</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Paste recipient key */}
            <Input
              value={reissuePublicKeyInput}
              onChange={e => {
                setReissuePublicKeyInput(e.target.value.trim())
                setReissueRecipient(e.target.value.trim())
                setReissueRecipientPublicKey(e.target.value.trim())
                reissueIdentitySearch.handleSelect(null as any, null)
              }}
              disabled={!!reissueIdentitySearch.selectedIdentity}
              placeholder="Or paste recipient identity key"
              className="tabular mt-2"
            />

            {/* Reissue button */}
            <button
              onClick={handleReissue}
              disabled={busy || reissueOutpoint === '' || reissueAmount === '' || (reissueRecipient === '' && reissuePublicKeyInput.trim() === '') || asset == null}
              className="w-full rounded-[11px] py-[11px] text-[13px] font-semibold mt-3 flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Reissue tokens
            </button>
          </>
        )}
      </div>
    </div>
  )
}
