import { useCallback, useEffect, useState } from 'react'
import { Transaction, Beef, LockingScript } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { FT_PROTOCOL, BASKET } from '../lib/mandala/constants'
import { encodeLinkagePayload, MandalaActionDetails } from '../lib/mandala/encoding'
import { submitToOverlay } from '../lib/mandala/overlay'
import { outpoint, revealLinkage } from '../lib/mandala/tokens'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import { parseAmount, formatAmount } from '../lib/mandala/amount'
import {
  AdminAsset,
  listAdminAssets,
  adminCustomInstructions
} from '../lib/mandala/assets'
import { Sparkles, Flame } from 'lucide-react'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Button } from './ui/button'

interface IssuerPanelProps {
  /** When set, sync to issue/redeem asset selection and hide per-section dropdowns. */
  assetId?: string
}

export default function IssuerPanel({ assetId: controlledAssetId }: IssuerPanelProps = {}) {
  const { wallet, identityKey } = useWallet()
  const [label, setLabel] = useState('')
  const [ticker, setTicker] = useState('')
  const [decimals, setDecimals] = useState('0')
  const [assets, setAssets] = useState<AdminAsset[]>([])
  const [issueAsset, setIssueAsset] = useState('')
  const [issueAmount, setIssueAmount] = useState('')
  const [redeemAsset, setRedeemAsset] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')
  const [busy, setBusy] = useState(false)

  // UI-only state (not passed to any core function)
  const [issueRef, setIssueRef] = useState('')
  const [redeemNote, setRedeemNote] = useState('')

  const reload = useCallback(async () => {
    if (wallet != null) setAssets(await listAdminAssets(wallet as any))
  }, [wallet])
  useEffect(() => { void reload() }, [reload])

  // When controlled assetId changes, sync it into each section's selection
  useEffect(() => {
    if (controlledAssetId == null) return
    setIssueAsset(controlledAssetId)
    setRedeemAsset(controlledAssetId)
  }, [controlledAssetId])

  // Effective asset ids: controlled prop takes precedence over internal state
  const effectiveIssueAsset = controlledAssetId ?? issueAsset
  const effectiveRedeemAsset = controlledAssetId ?? redeemAsset

  // ---------------------------------------------------------------------------
  // Register: ONE tx, ONE output that both carries the public metadata blob and
  // is the first admin auth. Its outpoint is the assetId; issue spends it. The
  // overlay retains the metadata record across that spend (only eviction clears
  // it), so the label/precision stay resolvable forever.
  //   - data (keyID) = { kind:'register', label, decimals } — can't include assetId
  //     (it IS this output's outpoint, unknown until the tx exists).
  //   - publicData = { label, decimals } — the on-chain, SPV-verifiable metadata.
  // ---------------------------------------------------------------------------
  const registerAsset = useCallback(async () => {
    if (wallet == null || identityKey == null || label.trim() === '') return
    const dec = Number(decimals)
    if (!Number.isInteger(dec) || dec < 0) { toast.error('Decimals must be a non-negative integer'); return }
    setBusy(true)
    try {
      // issuer = our identity key, baked into the on-chain publicData so any holder
      // can SPV-verify it and return funds to the issuer.
      const metadata = { label: label.trim(), ticker: ticker.trim().toUpperCase(), decimals: dec, issuer: identityKey }
      const regDetails: MandalaActionDetails = { kind: 'register', ...metadata }
      const genesisLock = await MandalaAdmin.lock({ wallet: wallet as any, data: regDetails, publicData: metadata })

      const reg = await wallet.createAction({
        description: `Register ${label.trim()}`,
        labels: ['mandala', 'register'],
        outputs: [{
          satoshis: 1,
          lockingScript: genesisLock.toHex(),
          outputDescription: 'asset genesis + admin auth',
          basket: BASKET,
          // Bookkeeping rides on the admin UTXO itself — the wallet basket is the
          // source of truth for the auth chain (no localStorage, no on-chain marker).
          customInstructions: adminCustomInstructions('', label.trim(), regDetails, metadata)
        }],
        options: { randomizeOutputs: false }
      })

      if (reg.tx == null || reg.txid == null) throw new Error('register: no tx returned')
      const assetId = outpoint(reg.txid, 0)

      // The output's CI was written with an empty assetId (it IS this outpoint, which
      // didn't exist yet); adminAssetFromOutput resolves it to the outpoint on read.
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [],
        admin: [{ index: 0, actionDetails: regDetails }]
      })
      await submitToOverlay(reg.tx as number[], offChainValues)

      toast.success(`Registered ${label.trim()} (${assetId})`)
      setLabel('')
      setTicker('')
      setDecimals('0')
      void reload()
    } catch (e) {
      toast.error(`Register failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, label, ticker, decimals, reload])

  // ---------------------------------------------------------------------------
  // Issue: spend the current auth outpoint; mint FT + next admin-auth output.
  // ---------------------------------------------------------------------------
  const issue = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = assets.find(a => a.assetId === effectiveIssueAsset)
    const amount = parseAmount(issueAmount, Number(asset?.metadata?.decimals) || 0)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    setBusy(true)
    try {
      const keyID = 'mint-' + Date.now()
      // Self-mint: use our own identity key (hex) as counterparty, not the literal
      // 'self' — the revealed linkage echoes counterparty verbatim and the overlay
      // parses it as a public key. Derivation is identical ('self' normalizes to this).
      const counterparty = identityKey

      // Build FT locking script.
      const ftLock = await new MandalaToken(wallet as any).lockBRC29(
        asset.assetId, amount, FT_PROTOCOL, keyID, counterparty
      )

      // Build next admin-auth locking script.
      const priorOutpoint = asset.authOutpoint
      const issueDetails: MandalaActionDetails = {
        kind: 'issue',
        assetId: asset.assetId,
        amount,
        priorOutpoint
      }
      const nextAuthLock = await MandalaAdmin.lock({ wallet: wallet as any, data: issueDetails })

      // Fetch BEEF for the prior auth outpoint.
      const listResult = await wallet.listOutputs({
        basket: BASKET,
        include: 'entire transactions',
        limit: 1000
      })
      const priorOut = listResult.outputs.find(o => o.outpoint === priorOutpoint)
      if (priorOut == null) throw new Error('prior auth outpoint not found in wallet outputs')
      if (listResult.BEEF == null) throw new Error('listOutputs returned no BEEF')

      // Create the action: spend prior auth, produce FT + next auth.
      const created = await wallet.createAction({
        description: `Issue ${amount} ${asset.label}`,
        labels: ['mandala', 'issue'],
        inputBEEF: listResult.BEEF as number[],
        inputs: [{
          outpoint: priorOutpoint,
          unlockingScriptLength: 108,
          inputDescription: 'spend prior admin auth'
        }],
        outputs: [
          {
            satoshis: 1,
            lockingScript: ftLock.toHex(),
            outputDescription: 'minted FT',
            basket: BASKET,
            customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID, counterparty })
          },
          {
            satoshis: 1,
            lockingScript: nextAuthLock.toHex(),
            outputDescription: 'next admin auth',
            basket: BASKET,
            customInstructions: adminCustomInstructions(asset.assetId, asset.label, issueDetails, asset.metadata)
          }
        ],
        options: { randomizeOutputs: false }
      })

      if (created.signableTransaction == null) throw new Error('issue: no signableTransaction returned')

      // Sign the prior auth input with the stored authDetails (symmetric with how it was locked).
      const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
      txToSign.inputs[0].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data: asset.authDetails })
      await txToSign.sign()

      const spends: Record<string, { unlockingScript: string }> = {
        '0': { unlockingScript: txToSign.inputs[0].unlockingScript!.toHex() }
      }

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends
      })

      if (signed.tx == null || signed.txid == null) throw new Error('signAction: no tx returned')

      // Reveal linkage for the FT output and submit to overlay.
      const linkage = await revealLinkage(wallet as any, keyID, counterparty)
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [{ index: 0, linkage }],
        admin: [{ index: 1, actionDetails: issueDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      toast.success(`Issued ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`)
      setIssueAmount('')
      void reload()
    } catch (e) {
      toast.error(`Issue failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, assets, effectiveIssueAsset, issueAmount, reload])

  // ---------------------------------------------------------------------------
  // Redeem: burn FT tokens by spending FT inputs + prior auth outpoint.
  //   Output [0] = next admin auth; Output [1] = FT change (if any).
  // ---------------------------------------------------------------------------
  const redeem = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = assets.find(a => a.assetId === effectiveRedeemAsset)
    const amount = parseAmount(redeemAmount, Number(asset?.metadata?.decimals) || 0)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    setBusy(true)
    try {
      // Gather FT inputs of this asset totaling >= amount (same selection as transfer).
      // 'locking scripts' attaches lockingScript + customInstructions for selection;
      // 'entire transactions' attaches the BEEF for inputBEEF. Outpoints line up.
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

      const beef = new Beef()
      beef.mergeBeef(beefRes.BEEF as number[])

      const ftInputs: Array<{ outpoint: string, unlockingScriptLength: number, inputDescription: string }> = []
      const ftSpend: Array<{ keyID: string, counterparty: string }> = []
      let gathered = 0

      for (const o of scriptRes.outputs) {
        if (gathered >= amount) break
        let d
        try { d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string)) } catch { continue }
        if (d.assetId !== effectiveRedeemAsset) continue
        const ci = JSON.parse((o.customInstructions as string) ?? '{}')
        ftInputs.push({ outpoint: o.outpoint as string, unlockingScriptLength: 108, inputDescription: 'burn FT' })
        ftSpend.push({ keyID: ci.keyID, counterparty: ci.counterparty })
        gathered += d.amount
      }

      if (gathered < amount) throw new Error('insufficient balance to redeem')
      const change = gathered - amount

      // Build next admin-auth locking script for the redeem action.
      const redeemDetails: MandalaActionDetails = {
        kind: 'redeem',
        assetId: effectiveRedeemAsset,
        amount,
        priorOutpoint: asset.authOutpoint
      }
      const nextAuthLock = await MandalaAdmin.lock({ wallet: wallet as any, data: redeemDetails })

      // Also include the prior auth outpoint as an input.
      const inputs = [
        ...ftInputs,
        { outpoint: asset.authOutpoint, unlockingScriptLength: 108, inputDescription: 'spend prior auth' }
      ]

      const outputs: any[] = [
        {
          satoshis: 1,
          lockingScript: nextAuthLock.toHex(),
          outputDescription: 'redeem auth',
          basket: BASKET,
          customInstructions: adminCustomInstructions(effectiveRedeemAsset, asset.label, redeemDetails, asset.metadata)
        }
      ]

      let keyIDChange = ''
      if (change > 0) {
        keyIDChange = 'rchg-' + Date.now()
        const ftChange = await new MandalaToken(wallet as any).lockBRC29(effectiveRedeemAsset, change, FT_PROTOCOL, keyIDChange, identityKey)
        outputs.push({
          satoshis: 1,
          lockingScript: ftChange.toHex(),
          outputDescription: 'FT change',
          basket: BASKET,
          customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: identityKey })
        })
      }

      const created = await wallet.createAction({
        description: `Redeem ${amount} ${asset.label}`,
        labels: ['mandala', 'redeem'],
        inputBEEF: beef.toBinary(),
        inputs,
        outputs,
        options: { randomizeOutputs: false }
      })

      if (created.signableTransaction == null) throw new Error('redeem: no signableTransaction returned')

      // Sign FT inputs then the prior-auth input.
      const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
      for (let i = 0; i < ftSpend.length; i++) {
        txToSign.inputs[i].unlockingScriptTemplate = walletMandalaUnlock(wallet as any, ftSpend[i].keyID, ftSpend[i].counterparty)
      }
      txToSign.inputs[ftSpend.length].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data: asset.authDetails })
      await txToSign.sign()

      const spends: Record<string, { unlockingScript: string }> = {}
      for (let i = 0; i < inputs.length; i++) {
        spends[String(i)] = { unlockingScript: txToSign.inputs[i].unlockingScript!.toHex() }
      }

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends
      })

      if (signed.tx == null || signed.txid == null) throw new Error('signAction: no tx returned')

      // Admin auth is index 0; FT change (if any) is index 1.
      const outLinks: Array<{ index: number, linkage: any }> = []
      if (change > 0) {
        outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, identityKey) })
      }
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: outLinks,
        admin: [{ index: 0, actionDetails: redeemDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      toast.success(`Redeemed (burned) ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`)
      setRedeemAmount('')
      void reload()
    } catch (e) {
      toast.error(`Redeem failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, assets, effectiveRedeemAsset, redeemAmount, reload])

  const assetOptions = (
    <>
      <option value="">Select…</option>
      {assets.map(a => (
        <option key={a.assetId} value={a.assetId}>{a.label}</option>
      ))}
    </>
  )

  // Shared input style
  const inputCls = 'bg-muted border border-[rgba(27,30,36,.12)] rounded-[10px] px-[13px] py-[11px] text-[13px] text-subtle-foreground placeholder:text-subtle-foreground w-full'
  const labelCls = 'block text-[11px] font-medium text-subtle-foreground mb-[7px]'

  return (
    <div className="space-y-5">
      {/* Page heading */}
      <div className="mb-1">
        <h1 style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.5px', lineHeight: 1.15 }}>
          Operations
        </h1>
        <p className="text-subtle-foreground text-[13.5px] mt-1">
          Mint &amp; redeem the US Dollar stablecoin
        </p>
      </div>

      {/* Issue + Redeem: 2-col grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Issue card */}
        <div className="bg-card border border-border rounded-[14px] p-[18px] flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: 'rgba(35,64,94,.1)', color: '#23405E' }}
            >
              <Sparkles className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Issue tokens</p>
              <p className="text-[11.5px] text-subtle-foreground mt-0.5">Mint new tokens into circulation</p>
            </div>
          </div>

          <div className="space-y-3">
            {controlledAssetId == null && (
              <div>
                <label className={labelCls} htmlFor="issue-asset">Asset</label>
                <Select id="issue-asset" value={issueAsset} onChange={e => setIssueAsset(e.target.value)} className={inputCls}>
                  {assetOptions}
                </Select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="issue-amount">Amount</label>
              <Input
                id="issue-amount"
                type="number"
                min="0"
                step="any"
                value={issueAmount}
                onChange={e => setIssueAmount(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="issue-ref">Backed by (optional)</label>
              <Input
                id="issue-ref"
                type="text"
                value={issueRef}
                onChange={e => setIssueRef(e.target.value)}
                placeholder="Bank deposit ref · BR-…"
                className={inputCls}
              />
            </div>
          </div>

          <Button
            onClick={() => void issue()}
            disabled={busy || effectiveIssueAsset === '' || issueAmount === ''}
            className="w-full rounded-[11px] bg-primary text-primary-foreground mt-auto"
          >
            Issue Tokens
          </Button>
        </div>

        {/* Redeem card */}
        <div className="bg-card border border-border rounded-[14px] p-[18px] flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
              style={{ background: 'rgba(180,112,58,.12)', color: '#B4703A' }}
            >
              <Flame className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">Redeem tokens</p>
              <p className="text-[11.5px] text-subtle-foreground mt-0.5">Burn tokens out of circulation</p>
            </div>
          </div>

          <div className="space-y-3">
            {controlledAssetId == null && (
              <div>
                <label className={labelCls} htmlFor="redeem-asset">Asset</label>
                <Select id="redeem-asset" value={redeemAsset} onChange={e => setRedeemAsset(e.target.value)} className={inputCls}>
                  {assetOptions}
                </Select>
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="redeem-amount">Amount</label>
              <Input
                id="redeem-amount"
                type="number"
                min="0"
                step="any"
                value={redeemAmount}
                onChange={e => setRedeemAmount(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="redeem-note">Settlement note (optional)</label>
              <Input
                id="redeem-note"
                type="text"
                value={redeemNote}
                onChange={e => setRedeemNote(e.target.value)}
                placeholder="e.g. wire returned to holder"
                className={inputCls}
              />
            </div>
          </div>

          <button
            onClick={() => void redeem()}
            disabled={busy || effectiveRedeemAsset === '' || redeemAmount === ''}
            className="w-full rounded-[11px] mt-auto py-[10px] px-4 text-[13.5px] font-medium transition-opacity disabled:opacity-40 bg-background border border-destructive/40 text-destructive"
          >
            Redeem (burn)
          </button>
        </div>
      </div>

      {/* Recovery of a frozen output lives in Regulatory → "Reissue from frozen
          output": it ties the minted amount to the frozen row and the overlay
          enforces conservation (reissue guard), so circulation can't drift. A
          free-form "recover" mint here could not guarantee that, so it's gone. */}

      {/* Register: slim strip at bottom */}
      <div
        className="rounded-[12px] border-dashed border p-[14px_18px]"
        style={{ background: '#EFE9DD', borderColor: 'rgba(27,30,36,.18)' }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="shrink-0">
            <p className="text-[13.5px] font-semibold leading-tight">Register a new asset</p>
            <p className="text-[11.5px] text-subtle-foreground mt-0.5">
              Rare — most issuers run a single stablecoin
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2 flex-1 sm:justify-end">
            <div className="flex flex-col min-w-[110px]">
              <label className={labelCls} htmlFor="reg-label">Label</label>
              <Input
                id="reg-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Gold Coin"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
              />
            </div>
            <div className="flex flex-col min-w-[72px]">
              <label className={labelCls} htmlFor="reg-ticker">Ticker</label>
              <Input
                id="reg-ticker"
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                placeholder="USD"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
              />
            </div>
            <div className="flex flex-col min-w-[64px]">
              <label className={labelCls} htmlFor="reg-decimals">Decimals</label>
              <Input
                id="reg-decimals"
                type="number"
                min="0"
                step="1"
                value={decimals}
                onChange={e => setDecimals(e.target.value)}
                placeholder="0"
                className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground tabular-nums"
              />
            </div>
            <button
              onClick={() => void registerAsset()}
              disabled={busy || label.trim() === ''}
              className="shrink-0 rounded-[8px] border px-4 py-[8px] text-[12.5px] font-medium transition-opacity disabled:opacity-40"
              style={{ background: '#fff', borderColor: 'rgba(27,30,36,.2)', color: '#23405E' }}
            >
              Register asset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
