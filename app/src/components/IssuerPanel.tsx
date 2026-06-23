import { useCallback, useEffect, useState } from 'react'
import { Transaction, Beef, LockingScript, P2PKH, Hash, Utils } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { ADMIN_PROTOCOL, FT_PROTOCOL, BASKET } from '../lib/mandala/constants'
import { encodeLinkagePayload, MandalaActionDetails } from '../lib/mandala/encoding'
import { submitToOverlay } from '../lib/mandala/overlay'
import { outpoint, revealLinkage } from '../lib/mandala/tokens'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import {
  saveAsset,
  getAsset,
  updateAuth,
  listAssets,
  RegisteredAsset
} from '../lib/mandala/assetStore'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

export default function IssuerPanel() {
  const { wallet, identityKey } = useWallet()
  const [label, setLabel] = useState('')
  const [assets, setAssets] = useState<RegisteredAsset[]>([])
  const [issueAsset, setIssueAsset] = useState('')
  const [issueAmount, setIssueAmount] = useState('')
  const [redeemAsset, setRedeemAsset] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')
  const [recoverAsset, setRecoverAsset] = useState('')
  const [recoverAmount, setRecoverAmount] = useState('')
  const [recoverRecipient, setRecoverRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    if (identityKey != null) setAssets(listAssets(identityKey))
  }, [identityKey])
  useEffect(() => { reload() }, [reload])

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
      const admin = new MandalaAdmin(wallet as any)

      // Phase 1: create a 1-sat UTXO locked to a wallet-derived P2PKH key.
      // The outpoint of this output becomes the assetId; it is never spent.
      const genesisKeyId = 'genesis-' + Date.now()
      const { publicKey: genesisPub } = await wallet.getPublicKey({ protocolID: FT_PROTOCOL, keyID: genesisKeyId, counterparty: 'self' })
      const genesisLock = new P2PKH().lock(Hash.hash160(Utils.toArray(genesisPub, 'hex')))
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

      if (phase1.tx == null) throw new Error('phase1: no tx returned')
      const genesisTx = Transaction.fromBEEF(phase1.tx as number[])
      const assetId = outpoint(genesisTx.id('hex'), 0)

      // Phase 2: register tx — produces ONE admin-auth output, no inputs to sign.
      const regDetails: MandalaActionDetails = { kind: 'register', assetId }
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, regDetails)
      const adminLock = admin.lock(boundKey)

      const reg = await wallet.createAction({
        description: `Register ${label.trim()}`,
        outputs: [{
          satoshis: 1,
          lockingScript: adminLock.toHex(),
          outputDescription: 'admin auth',
          basket: BASKET
        }],
        options: { randomizeOutputs: false }
      })

      if (reg.tx == null) throw new Error('register: no tx returned')

      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [],
        admin: [{ index: 0, actionDetails: regDetails }]
      })
      await submitToOverlay(reg.tx as number[], offChainValues)

      const regTxid = Transaction.fromBEEF(reg.tx as number[]).id('hex')
      const authOutpoint = outpoint(regTxid, 0)

      saveAsset(identityKey, {
        assetId,
        label: label.trim(),
        authOutpoint,
        authDetails: regDetails
      })

      toast.success(`Registered ${label.trim()} (${assetId})`)
      setLabel('')
      reload()
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
    const asset = getAsset(identityKey, issueAsset)
    const amount = Number(issueAmount)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    setBusy(true)
    try {
      const admin = new MandalaAdmin(wallet as any)
      const keyID = 'mint-' + Date.now()
      const counterparty = 'self'

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
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, issueDetails)
      const nextAuthLock = admin.lock(boundKey)

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
          unlockingScriptLength: 74,
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
            basket: BASKET
          }
        ],
        options: { randomizeOutputs: false }
      })

      if (created.signableTransaction == null) throw new Error('issue: no signableTransaction returned')

      // Sign the prior auth input with the stored authDetails (symmetric with how it was locked).
      const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
      txToSign.inputs[0].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, asset.authDetails)
      await txToSign.sign()

      const spends: Record<string, { unlockingScript: string }> = {
        '0': { unlockingScript: txToSign.inputs[0].unlockingScript!.toHex() }
      }

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends
      })

      if (signed.tx == null) throw new Error('signAction: no tx returned')

      // Reveal linkage for the FT output and submit to overlay.
      const linkage = await revealLinkage(wallet as any, keyID, counterparty)
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [{ index: 0, linkage }],
        admin: [{ index: 1, actionDetails: issueDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      // Persist updated auth chain state.
      const nextAuthOutpoint = outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 1)
      updateAuth(identityKey, asset.assetId, nextAuthOutpoint, issueDetails)

      toast.success(`Issued ${amount} ${asset.label}`)
      setIssueAmount('')
      reload()
    } catch (e) {
      toast.error(`Issue failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, issueAsset, issueAmount, reload])

  // ---------------------------------------------------------------------------
  // Redeem: burn FT tokens by spending FT inputs + prior auth outpoint.
  //   Output [0] = next admin auth; Output [1] = FT change (if any).
  // ---------------------------------------------------------------------------
  const redeem = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = getAsset(identityKey, redeemAsset)
    const amount = Number(redeemAmount)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    setBusy(true)
    try {
      const admin = new MandalaAdmin(wallet as any)

      // Gather FT inputs of this asset totaling >= amount (same selection as transfer).
      const res = await wallet.listOutputs({
        basket: BASKET,
        include: 'entire transactions',
        limit: 1000,
        includeCustomInstructions: true
      })

      const beef = new Beef()
      beef.mergeBeef(res.BEEF as number[])

      const ftInputs: Array<{ outpoint: string, unlockingScriptLength: number, inputDescription: string }> = []
      const ftSpend: Array<{ keyID: string, counterparty: string }> = []
      let gathered = 0

      for (const o of res.outputs) {
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
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, redeemDetails)
      const nextAuthLock = admin.lock(boundKey)

      // Also include the prior auth outpoint as an input.
      const inputs = [
        ...ftInputs,
        { outpoint: asset.authOutpoint, unlockingScriptLength: 74, inputDescription: 'spend prior auth' }
      ]

      const outputs: any[] = [
        {
          satoshis: 1,
          lockingScript: nextAuthLock.toHex(),
          outputDescription: 'redeem auth',
          basket: BASKET
        }
      ]

      let keyIDChange = ''
      if (change > 0) {
        keyIDChange = 'rchg-' + Date.now()
        const ftChange = await new MandalaToken(wallet as any).lockBRC29(redeemAsset, change, FT_PROTOCOL, keyIDChange, 'self')
        outputs.push({
          satoshis: 1,
          lockingScript: ftChange.toHex(),
          outputDescription: 'FT change',
          basket: BASKET,
          customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: 'self' })
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
      txToSign.inputs[ftSpend.length].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, asset.authDetails)
      await txToSign.sign()

      const spends: Record<string, { unlockingScript: string }> = {}
      for (let i = 0; i < inputs.length; i++) {
        spends[String(i)] = { unlockingScript: txToSign.inputs[i].unlockingScript!.toHex() }
      }

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends
      })

      if (signed.tx == null) throw new Error('signAction: no tx returned')

      // Admin auth is index 0; FT change (if any) is index 1.
      const outLinks: Array<{ index: number, linkage: any }> = []
      if (change > 0) {
        outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, 'self') })
      }
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: outLinks,
        admin: [{ index: 0, actionDetails: redeemDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      const nextAuthOutpoint = outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 0)
      updateAuth(identityKey, redeemAsset, nextAuthOutpoint, redeemDetails)

      toast.success(`Redeemed (burned) ${amount} ${asset.label}`)
      setRedeemAmount('')
      reload()
    } catch (e) {
      toast.error(`Redeem failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, redeemAsset, redeemAmount, reload])

  // ---------------------------------------------------------------------------
  // Recover: seize/re-issue tokens to a specified recipient identity key.
  //   Output [0] = FT to recipient; Output [1] = next admin auth.
  // ---------------------------------------------------------------------------
  const recover = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = getAsset(identityKey, recoverAsset)
    const amount = Number(recoverAmount)
    if (asset == null || !Number.isInteger(amount) || amount < 1 || recoverRecipient.trim() === '') return
    setBusy(true)
    try {
      const admin = new MandalaAdmin(wallet as any)
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
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, recoverDetails)
      const nextAuthLock = admin.lock(boundKey)

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
          unlockingScriptLength: 74,
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
            basket: BASKET
          }
        ],
        options: { randomizeOutputs: false }
      })

      if (created.signableTransaction == null) throw new Error('recover: no signableTransaction returned')

      // Sign the prior auth input.
      const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
      txToSign.inputs[0].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, asset.authDetails)
      await txToSign.sign()

      const signed = await wallet.signAction({
        reference: created.signableTransaction.reference,
        spends: { '0': { unlockingScript: txToSign.inputs[0].unlockingScript!.toHex() } }
      })

      if (signed.tx == null) throw new Error('signAction: no tx returned')

      // FT linkage for index 0 (recipient); admin at index 1.
      const linkage = await revealLinkage(wallet as any, keyID, recipient)
      const offChainValues = encodeLinkagePayload({
        inputs: [],
        outputs: [{ index: 0, linkage }],
        admin: [{ index: 1, actionDetails: recoverDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      const nextAuthOutpoint = outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 1)
      updateAuth(identityKey, recoverAsset, nextAuthOutpoint, recoverDetails)

      toast.success(`Recovered ${amount} ${asset.label} to ${recipient.slice(0, 12)}…`)
      setRecoverAmount('')
      setRecoverRecipient('')
      reload()
    } catch (e) {
      toast.error(`Recover failed: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [wallet, identityKey, recoverAsset, recoverAmount, recoverRecipient, reload])

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Register asset</h2>
        <Label htmlFor="reg-label">Label</Label>
        <Input
          id="reg-label"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Gold Coin"
        />
        <Button
          onClick={() => void registerAsset()}
          disabled={busy || label.trim() === ''}
        >
          Register
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Issue tokens</h2>
        <Label htmlFor="issue-asset">Asset</Label>
        <select
          id="issue-asset"
          className="border rounded p-2 w-full"
          value={issueAsset}
          onChange={e => setIssueAsset(e.target.value)}
        >
          <option value="">Select…</option>
          {assets.map(a => (
            <option key={a.assetId} value={a.assetId}>{a.label}</option>
          ))}
        </select>
        <Label htmlFor="issue-amount">Amount</Label>
        <Input
          id="issue-amount"
          type="number"
          min="1"
          value={issueAmount}
          onChange={e => setIssueAmount(e.target.value)}
        />
        <Button
          onClick={() => void issue()}
          disabled={busy || issueAsset === '' || issueAmount === ''}
        >
          Issue
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Redeem tokens (burn)</h2>
        <Label htmlFor="redeem-asset">Asset</Label>
        <select
          id="redeem-asset"
          className="border rounded p-2 w-full"
          value={redeemAsset}
          onChange={e => setRedeemAsset(e.target.value)}
        >
          <option value="">Select…</option>
          {assets.map(a => (
            <option key={a.assetId} value={a.assetId}>{a.label}</option>
          ))}
        </select>
        <Label htmlFor="redeem-amount">Amount</Label>
        <Input
          id="redeem-amount"
          type="number"
          min="1"
          value={redeemAmount}
          onChange={e => setRedeemAmount(e.target.value)}
        />
        <Button
          onClick={() => void redeem()}
          disabled={busy || redeemAsset === '' || redeemAmount === ''}
        >
          Redeem
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Recover tokens (seize/re-issue)</h2>
        <Label htmlFor="recover-asset">Asset</Label>
        <select
          id="recover-asset"
          className="border rounded p-2 w-full"
          value={recoverAsset}
          onChange={e => setRecoverAsset(e.target.value)}
        >
          <option value="">Select…</option>
          {assets.map(a => (
            <option key={a.assetId} value={a.assetId}>{a.label}</option>
          ))}
        </select>
        <Label htmlFor="recover-amount">Amount</Label>
        <Input
          id="recover-amount"
          type="number"
          min="1"
          value={recoverAmount}
          onChange={e => setRecoverAmount(e.target.value)}
        />
        <Label htmlFor="recover-recipient">Recipient Identity Key</Label>
        <Input
          id="recover-recipient"
          type="text"
          placeholder="e.g. 02abc…"
          value={recoverRecipient}
          onChange={e => setRecoverRecipient(e.target.value)}
        />
        <Button
          onClick={() => void recover()}
          disabled={busy || recoverAsset === '' || recoverAmount === '' || recoverRecipient.trim() === ''}
        >
          Recover
        </Button>
      </Card>
    </div>
  )
}
