import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useIdentitySearch } from '@bsv/identity-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select } from '../ui/select'
import { Label } from '../ui/label'
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

  if (assets.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-[13px] text-muted-foreground">Register an asset first.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
            <ShieldCheck className="h-[19px] w-[19px]" />
          </div>
          <div>
            <CardTitle>Regulatory controls</CardTitle>
            <CardDescription>Pause, freeze, block, and manage access</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Asset selector */}
        <div>
          <Label htmlFor="rc-asset">Asset</Label>
          <Select
            id="rc-asset"
            value={selectedAssetId}
            onChange={e => { setSelectedAssetId(e.target.value) }}
          >
            <option value="">Select asset…</option>
            {assets.map(a => (
              <option key={a.assetId} value={a.assetId}>{a.label}</option>
            ))}
          </Select>
        </div>

        {asset == null ? null : (
          <>
            {/* Current state summary */}
            {state != null && (
              <div className="rounded-[--radius-md] bg-muted/60 px-4 py-3 text-[13px] space-y-1">
                <div><span className="font-semibold">Status:</span> {state.isPaused ? 'Paused' : 'Active'}</div>
                <div><span className="font-semibold">Access mode:</span> {state.accessMode}</div>
                <div><span className="font-semibold">Frozen outputs:</span> {state.frozenOutpoints.length}</div>
                <div><span className="font-semibold">Blocked identities:</span> {state.blockedIdentities.length}</div>
                <div><span className="font-semibold">Allowed identities:</span> {state.allowedIdentities.length}</div>
              </div>
            )}

            {/* Pause / Unpause */}
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Pause / Unpause</h3>
              <Button
                onClick={handlePauseToggle}
                disabled={busy}
                variant={state?.isPaused ? 'default' : 'destructive'}
                className="w-full"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {state?.isPaused ? 'Unpause transfers' : 'Pause transfers'}
              </Button>
            </section>

            {/* Freeze / Unfreeze */}
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Freeze / Unfreeze output</h3>
              <Label htmlFor="rc-freeze-op">Outpoint</Label>
              <Input
                id="rc-freeze-op"
                value={freezeOutpoint}
                onChange={e => setFreezeOutpoint(e.target.value)}
                placeholder="txid.outputIndex"
                className="tabular mb-2"
              />
              <div className="flex gap-2">
                <Button onClick={handleFreeze} disabled={busy || freezeOutpoint.trim() === ''} className="flex-1">
                  Freeze
                </Button>
                <Button onClick={handleUnfreeze} disabled={busy || (freezeOutpoint.trim() === '' && selectedFreezeRef === '')} variant="ghost" className="flex-1">
                  Unfreeze
                </Button>
              </div>
              {(state?.frozenOutpoints.length ?? 0) > 0 && (
                <div className="mt-3">
                  <Label htmlFor="rc-frozen-list">Frozen outputs (pick to unfreeze / reissue)</Label>
                  <Select
                    id="rc-frozen-list"
                    value={selectedFreezeRef}
                    onChange={e => {
                      setSelectedFreezeRef(e.target.value)
                      setFreezeOutpoint(e.target.value)
                    }}
                  >
                    <option value="">Select frozen output…</option>
                    {state!.frozenOutpoints.map(r => (
                      <option key={r.outpoint} value={r.outpoint}>
                        {r.outpoint.slice(0, 20)}… — {formatAmount(r.amount, decimals)} — {r.owner.slice(0, 10)}…
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </section>

            {/* Block / Allow identity */}
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Block / Allow identity</h3>
              <Label htmlFor="rc-id-search">Search identity</Label>
              <Input
                id="rc-id-search"
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
              <div className="mt-2">
                <Label htmlFor="rc-id-pk">Or paste identity key</Label>
                <Input
                  id="rc-id-pk"
                  value={publicKeyInput}
                  onChange={e => {
                    setPublicKeyInput(e.target.value.trim())
                    setResolvedIdentityKey(e.target.value.trim())
                    identitySearch.handleSelect(null as any, null)
                  }}
                  disabled={!!identitySearch.selectedIdentity}
                  placeholder="02abc…"
                  className="tabular"
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button onClick={() => handleIdentityAction('blockIdentity')} disabled={busy || (resolvedIdentityKey === '' && publicKeyInput.trim() === '')} variant="destructive">
                  Block
                </Button>
                <Button onClick={() => handleIdentityAction('unblockIdentity')} disabled={busy || (resolvedIdentityKey === '' && publicKeyInput.trim() === '')} variant="ghost">
                  Unblock
                </Button>
                <Button onClick={() => handleIdentityAction('allowIdentity')} disabled={busy || (resolvedIdentityKey === '' && publicKeyInput.trim() === '')}>
                  Allow
                </Button>
                <Button onClick={() => handleIdentityAction('unallowIdentity')} disabled={busy || (resolvedIdentityKey === '' && publicKeyInput.trim() === '')} variant="ghost">
                  Unallow
                </Button>
              </div>
            </section>

            {/* Set access mode */}
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Set access mode</h3>
              <p className="mb-2 text-[12px] text-muted-foreground">
                Denylist = anyone except blocked identities. Allowlist = only allowed identities.
              </p>
              <Select
                id="rc-access-mode"
                value={newAccessMode}
                onChange={e => setNewAccessMode(e.target.value as 'denylist' | 'allowlist')}
              >
                <option value="denylist">Denylist</option>
                <option value="allowlist">Allowlist</option>
              </Select>
              <Button onClick={handleSetAccessMode} disabled={busy} className="mt-2 w-full">
                Apply access mode
              </Button>
            </section>

            {/* Reissue */}
            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Reissue from frozen output</h3>
              {(state?.frozenOutpoints.length ?? 0) === 0 ? (
                <p className="text-[12px] text-subtle-foreground">No frozen outputs available.</p>
              ) : (
                <>
                  <Label htmlFor="rc-reissue-op">Frozen output</Label>
                  <Select
                    id="rc-reissue-op"
                    value={reissueOutpoint}
                    onChange={e => setReissueOutpoint(e.target.value)}
                  >
                    <option value="">Select frozen output…</option>
                    {state!.frozenOutpoints.map(r => (
                      <option key={r.outpoint} value={r.outpoint}>
                        {r.outpoint.slice(0, 20)}… — {formatAmount(r.amount, decimals)} — {r.owner.slice(0, 10)}…
                      </option>
                    ))}
                  </Select>
                  <div className="mt-2">
                    <Label htmlFor="rc-reissue-amount">Amount (prefilled from frozen output)</Label>
                    <Input
                      id="rc-reissue-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={reissueAmount}
                      onChange={e => setReissueAmount(e.target.value)}
                      className="tabular"
                    />
                  </div>
                  <div className="mt-2">
                    <Label htmlFor="rc-reissue-search">Recipient (search)</Label>
                    <Input
                      id="rc-reissue-search"
                      icon={<Search className="h-[18px] w-[18px]" />}
                      value={reissueIdentitySearch.inputValue}
                      onChange={e => reissueIdentitySearch.handleInputChange(e, e.target.value, 'input')}
                      placeholder="Search by name…"
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
                  <div className="mt-2">
                    <Label htmlFor="rc-reissue-pk">Or paste recipient identity key</Label>
                    <Input
                      id="rc-reissue-pk"
                      value={reissuePublicKeyInput}
                      onChange={e => {
                        setReissuePublicKeyInput(e.target.value.trim())
                        setReissueRecipient(e.target.value.trim())
                        setReissueRecipientPublicKey(e.target.value.trim())
                        reissueIdentitySearch.handleSelect(null as any, null)
                      }}
                      disabled={!!reissueIdentitySearch.selectedIdentity}
                      placeholder="02abc…"
                      className="tabular"
                    />
                  </div>
                  <Button
                    onClick={handleReissue}
                    disabled={busy || reissueOutpoint === '' || reissueAmount === '' || (reissueRecipient === '' && reissuePublicKeyInput.trim() === '')}
                    className="mt-3 w-full"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Reissue tokens
                  </Button>
                </>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}
