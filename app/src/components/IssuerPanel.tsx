import { useCallback, useEffect, useState } from 'react'
import { Transaction, Beef, LockingScript } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { FT_PROTOCOL, BASKET, MESSAGEBOX } from '../lib/mandala/constants'
import { encodeLinkagePayload, MandalaActionDetails } from '../lib/mandala/encoding'
import { submitToOverlay } from '../lib/mandala/overlay'
import { outpoint, revealLinkage } from '../lib/mandala/tokens'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import {
  AdminAsset,
  listAdminAssets,
  adminCustomInstructions
} from '../lib/mandala/assets'
import { PlusCircle, Sparkles, Flame, ShieldAlert } from 'lucide-react'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

export default function IssuerPanel() {
  const { wallet, messageBoxClient, identityKey } = useWallet()
  const [label, setLabel] = useState('')
  const [assets, setAssets] = useState<AdminAsset[]>([])
  const [issueAsset, setIssueAsset] = useState('')
  const [issueAmount, setIssueAmount] = useState('')
  const [redeemAsset, setRedeemAsset] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')
  const [recoverAsset, setRecoverAsset] = useState('')
  const [recoverAmount, setRecoverAmount] = useState('')
  const [recoverRecipient, setRecoverRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (wallet != null) setAssets(await listAdminAssets(wallet as any))
  }, [wallet])
  useEffect(() => { void reload() }, [reload])

  // ---------------------------------------------------------------------------
  // Register: 2-phase approach
  //   Phase 1 — create a 1-sat UTXO into BASKET; its outpoint becomes assetId.
  //   Phase 2 — create a register tx with ONE admin-auth output; no genesis spend
  //             needed (overlay returns priorOutpointSpent=true for kind:'register').
  // ---------------------------------------------------------------------------
  const registerAsset = useCallback(async () => {
    if (wallet == null || identityKey == null || label.trim() === '') return
    setBusy(true)
    try {
      // Phase 1: genesis output carries the public metadata blob; its outpoint is the
      // assetId. Locked with MandalaAdmin so the overlay can index + serve it. Never spent.
      const metadata = { label: label.trim() }
      const genesisLock = await MandalaAdmin.lock({ wallet: wallet as any, data: { kind: 'register' }, publicData: metadata })
      const phase1 = await wallet.createAction({
        description: `Genesis for ${label.trim()}`,
        outputs: [{
          satoshis: 1,
          lockingScript: genesisLock.toHex(),
          outputDescription: 'asset genesis',
          basket: BASKET
        }],
        options: { randomizeOutputs: false }
      })

      if (phase1.txid == null || phase1.tx == null) throw new Error('phase1: no tx returned')
      const assetId = outpoint(phase1.txid, 0)

      // Submit the genesis tx so the overlay admits + indexes its metadata.
      const genesisOffChain = encodeLinkagePayload({
        inputs: [], outputs: [],
        admin: [{ index: 0, actionDetails: { kind: 'register' } }]
      })
      await submitToOverlay(phase1.tx as number[], genesisOffChain)

      // Phase 2: register tx — produces ONE admin-auth output, no inputs to sign.
      const regDetails: MandalaActionDetails = { kind: 'register', assetId }
      const adminLock = await MandalaAdmin.lock({ wallet: wallet as any, data: regDetails })

      const reg = await wallet.createAction({
        description: `Register ${label.trim()}`,
        outputs: [{
          satoshis: 1,
          lockingScript: adminLock.toHex(),
          outputDescription: 'admin auth',
          basket: BASKET,
          // Bookkeeping rides on the admin UTXO itself — the wallet basket is the
          // source of truth for the auth chain (no localStorage, no on-chain marker).
          customInstructions: adminCustomInstructions(assetId, label.trim(), regDetails)
        }],
        options: { randomizeOutputs: false }
      })

      if (reg.tx == null || reg.txid == null) throw new Error('register: no tx returned')

      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [],
        admin: [{ index: 0, actionDetails: regDetails }]
      })
      await submitToOverlay(reg.tx as number[], offChainValues)

      toast.success(`Registered ${label.trim()} (${assetId})`)
      setLabel('')
      void reload()
    } catch (e) {
      toast.error(`Register failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, label, reload])

  // ---------------------------------------------------------------------------
  // Issue: spend the current auth outpoint; mint FT + next admin-auth output.
  // ---------------------------------------------------------------------------
  const issue = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = assets.find(a => a.assetId === issueAsset)
    const amount = Number(issueAmount)
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
            customInstructions: adminCustomInstructions(asset.assetId, asset.label, issueDetails)
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

      toast.success(`Issued ${amount} ${asset.label}`)
      setIssueAmount('')
      void reload()
    } catch (e) {
      toast.error(`Issue failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, assets, issueAsset, issueAmount, reload])

  // ---------------------------------------------------------------------------
  // Redeem: burn FT tokens by spending FT inputs + prior auth outpoint.
  //   Output [0] = next admin auth; Output [1] = FT change (if any).
  // ---------------------------------------------------------------------------
  const redeem = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = assets.find(a => a.assetId === redeemAsset)
    const amount = Number(redeemAmount)
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
        if (d.assetId !== redeemAsset) continue
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
        assetId: redeemAsset,
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
          customInstructions: adminCustomInstructions(redeemAsset, asset.label, redeemDetails)
        }
      ]

      let keyIDChange = ''
      if (change > 0) {
        keyIDChange = 'rchg-' + Date.now()
        const ftChange = await new MandalaToken(wallet as any).lockBRC29(redeemAsset, change, FT_PROTOCOL, keyIDChange, identityKey)
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

      toast.success(`Redeemed (burned) ${amount} ${asset.label}`)
      setRedeemAmount('')
      void reload()
    } catch (e) {
      toast.error(`Redeem failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, assets, redeemAsset, redeemAmount, reload])

  // ---------------------------------------------------------------------------
  // Recover: seize/re-issue tokens to a specified recipient identity key.
  //   Output [0] = FT to recipient; Output [1] = next admin auth.
  // ---------------------------------------------------------------------------
  const recover = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = assets.find(a => a.assetId === recoverAsset)
    const amount = Number(recoverAmount)
    if (asset == null || !Number.isInteger(amount) || amount < 1 || recoverRecipient.trim() === '') return
    setBusy(true)
    try {
      const keyID = 'recover-' + Date.now()
      const recipient = recoverRecipient.trim()

      // Build FT locking script for the recovered tokens (to recipient).
      const ftLock = await new MandalaToken(wallet as any).lockBRC29(recoverAsset, amount, FT_PROTOCOL, keyID, recipient)

      // Build next admin-auth locking script.
      const recoverDetails: MandalaActionDetails = {
        kind: 'recover',
        assetId: recoverAsset,
        amount,
        priorOutpoint: asset.authOutpoint
      }
      const nextAuthLock = await MandalaAdmin.lock({ wallet: wallet as any, data: recoverDetails })

      // Fetch BEEF for the prior auth outpoint.
      const listResult = await wallet.listOutputs({
        basket: BASKET,
        include: 'entire transactions',
        limit: 1000
      })
      if (listResult.BEEF == null) throw new Error('listOutputs returned no BEEF')

      const created = await wallet.createAction({
        description: `Recover ${amount} ${asset.label}`,
        inputBEEF: listResult.BEEF as number[],
        inputs: [{
          outpoint: asset.authOutpoint,
          unlockingScriptLength: 108,
          inputDescription: 'spend prior auth'
        }],
        outputs: [
          {
            satoshis: 1,
            lockingScript: ftLock.toHex(),
            outputDescription: 'recovered FT'
          },
          {
            satoshis: 1,
            lockingScript: nextAuthLock.toHex(),
            outputDescription: 'recover auth',
            basket: BASKET,
            customInstructions: adminCustomInstructions(recoverAsset, asset.label, recoverDetails)
          }
        ],
        options: { randomizeOutputs: false }
      })

      if (created.signableTransaction == null) throw new Error('recover: no signableTransaction returned')

      // Sign the prior auth input.
      const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
      txToSign.inputs[0].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data: asset.authDetails })
      await txToSign.sign()

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends: { '0': { unlockingScript: txToSign.inputs[0].unlockingScript!.toHex() } }
      })

      if (signed.tx == null || signed.txid == null) throw new Error('signAction: no tx returned')

      // FT linkage for index 0 (recipient); admin at index 1.
      const linkage = await revealLinkage(wallet as any, keyID, recipient)
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [{ index: 0, linkage }],
        admin: [{ index: 1, actionDetails: recoverDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      if (messageBoxClient != null) {
        await messageBoxClient.sendMessage({
          recipient,
          messageBox: MESSAGEBOX,
          body: {
            assetId: recoverAsset,
            amount,
            transaction: signed.tx,
            keyID,
            protocolID: FT_PROTOCOL,
            sender: identityKey
          }
        })
      }

      toast.success(`Recovered ${amount} ${asset.label} to ${recipient.slice(0, 12)}…`)
      setRecoverAmount('')
      setRecoverRecipient('')
      void reload()
    } catch (e) {
      toast.error(`Recover failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, assets, recoverAsset, recoverAmount, recoverRecipient, reload])

  const assetOptions = (
    <>
      <option value="">Select…</option>
      {assets.map(a => (
        <option key={a.assetId} value={a.assetId}>{a.label}</option>
      ))}
    </>
  )

  return (
    <div className="space-y-5">
      {/* Register */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
            <PlusCircle className="h-[19px] w-[19px]" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Register asset</h2>
            <p className="text-[13px] text-muted-foreground">Create a new token class</p>
          </div>
        </div>
        <Label htmlFor="reg-label">Label</Label>
        <Input id="reg-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Gold Coin" />
        <Button onClick={() => void registerAsset()} disabled={busy || label.trim() === ''} className="mt-4 w-full">
          <PlusCircle className="h-[18px] w-[18px]" /> Register
        </Button>
      </Card>

      {/* Issue */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-accent text-accent-foreground">
            <Sparkles className="h-[19px] w-[19px]" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Issue tokens</h2>
            <p className="text-[13px] text-muted-foreground">Mint new units of an asset</p>
          </div>
        </div>
        <Label htmlFor="issue-asset">Asset</Label>
        <Select id="issue-asset" value={issueAsset} onChange={e => setIssueAsset(e.target.value)}>{assetOptions}</Select>
        <div className="mt-3">
          <Label htmlFor="issue-amount">Amount</Label>
          <Input id="issue-amount" type="number" min="1" className="tabular" value={issueAmount} onChange={e => setIssueAmount(e.target.value)} />
        </div>
        <Button onClick={() => void issue()} disabled={busy || issueAsset === '' || issueAmount === ''} className="mt-4 w-full">
          <Sparkles className="h-[18px] w-[18px]" /> Issue
        </Button>
      </Card>

      {/* Redeem / burn */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-destructive/12 text-destructive">
            <Flame className="h-[19px] w-[19px]" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Redeem tokens</h2>
            <p className="text-[13px] text-muted-foreground">Permanently burn units</p>
          </div>
        </div>
        <Label htmlFor="redeem-asset">Asset</Label>
        <Select id="redeem-asset" value={redeemAsset} onChange={e => setRedeemAsset(e.target.value)}>{assetOptions}</Select>
        <div className="mt-3">
          <Label htmlFor="redeem-amount">Amount</Label>
          <Input id="redeem-amount" type="number" min="1" className="tabular" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} />
        </div>
        <Button onClick={() => void redeem()} disabled={busy || redeemAsset === '' || redeemAmount === ''} variant="destructive" className="mt-4 w-full">
          <Flame className="h-[18px] w-[18px]" /> Redeem (burn)
        </Button>
      </Card>

      {/* Recover / seize */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-warning/15 text-warning">
            <ShieldAlert className="h-[19px] w-[19px]" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Recover tokens</h2>
            <p className="text-[13px] text-muted-foreground">Seize and re-issue to a recipient</p>
          </div>
        </div>
        <Label htmlFor="recover-asset">Asset</Label>
        <Select id="recover-asset" value={recoverAsset} onChange={e => setRecoverAsset(e.target.value)}>{assetOptions}</Select>
        <div className="mt-3">
          <Label htmlFor="recover-amount">Amount</Label>
          <Input id="recover-amount" type="number" min="1" className="tabular" value={recoverAmount} onChange={e => setRecoverAmount(e.target.value)} />
        </div>
        <div className="mt-3">
          <Label htmlFor="recover-recipient">Recipient identity key</Label>
          <Input id="recover-recipient" type="text" className="tabular" placeholder="e.g. 02abc…" value={recoverRecipient} onChange={e => setRecoverRecipient(e.target.value)} />
        </div>
        <Button onClick={() => void recover()} disabled={busy || recoverAsset === '' || recoverAmount === '' || recoverRecipient.trim() === ''} variant="warning" className="mt-4 w-full">
          <ShieldAlert className="h-[18px] w-[18px]" /> Recover
        </Button>
      </Card>
    </div>
  )
}
