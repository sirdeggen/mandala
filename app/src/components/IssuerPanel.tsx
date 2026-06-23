import { useCallback, useEffect, useState } from 'react'
import { Transaction, P2PKH, Hash, Utils } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { ADMIN_PROTOCOL, FT_PROTOCOL, BASKET } from '../lib/mandala/constants'
import { encodeLinkagePayload, MandalaActionDetails } from '../lib/mandala/encoding'
import { submitToOverlay } from '../lib/mandala/overlay'
import { outpoint, revealLinkage } from '../lib/mandala/tokens'
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
    </div>
  )
}
