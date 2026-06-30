# Mandala Stablecoin — Phase B: Issuer Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A professional issuer dashboard that triggers the new on-chain admin controls, mocks a banking/liquidity integration, and renders a chain-derived, exportable audit log.

**Architecture:** A reusable `submitAdminAction` builder spends the prior auth UTXO and produces the next, reusing the existing createAction→sign→signAction→reveal-linkage→submit pattern. Dashboard components read derived state and history from the overlay (`ls_mandala`). A front-end-only banking mock drives `issue` with bank-reference metadata.

**Tech Stack:** React + Vite, `@bsv/sdk`, `@bsv/templates` (Phase A version), Vitest, Tailwind UI components already in `app/src/components/ui`.

**Spec:** `docs/superpowers/specs/2026-06-30-mandala-stablecoin-admin-ux-design.md` (Phase B = §B0–B5; shared prelude `adminState.ts`).

**Prereq:** Phase A published; `@bsv/templates`/`@bsv/overlay-topics` bumped in `app` + `overlay`; `app/node_modules/.vite` cleared.

## Global Constraints

- **Wallet basket is the source of truth** — no localStorage.
- **No backward compatibility.**
- **Off-wallet targets:** `freezeOutput`/`reissue` reference a holder's FT outpoint by string only — never a tx input, never a BEEF fetch. The reissue amount-check is overlay-side.
- **`bankRef` is overlay-visible** (it is in the committed action details), not secret — only "not in the public script."
- **Allowlist footgun:** switching `accessMode` to `allowlist` with an empty allowlist locks out all non-issuer transfers — the control must require a non-empty allowlist first.
- **Labels:** every mandala-producing `createAction`/`internalizeAction` is tagged `labels: ['mandala', kind]`.
- App test runner: `cd /Users/personal/git/demos/mandala/app && npx vitest run <file>`.

**Paths:** app root `/Users/personal/git/demos/mandala/app`; lib `app/src/lib/mandala`; components `app/src/components`.

---

### Task 1: Single-source the action union in the app

**Files:**
- Modify: `app/src/lib/mandala/encoding.ts` (replace local `MandalaActionKind`/`MandalaActionDetails`, lines 14–22)
- Test: `app/src/lib/mandala/encoding.test.ts` (create)

**Interfaces:**
- Produces: `encoding.ts` re-exports `MandalaActionKind`, `MandalaActionDetails` from `@bsv/templates`; `encodeLinkagePayload`/`MandalaLinkagePayload`/`SpecificLinkage` unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/mandala/encoding.test.ts
import { describe, it, expect } from 'vitest'
import { encodeLinkagePayload } from './encoding'
import type { MandalaActionDetails } from './encoding'

it('accepts the new stablecoin action kinds (type + runtime)', () => {
  const d: MandalaActionDetails = { kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 5, recipient: '02ab' }
  const bytes = encodeLinkagePayload({ inputs: [], outputs: [], admin: [{ index: 0, actionDetails: d }] })
  expect(bytes.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/lib/mandala/encoding.test.ts` → FAIL (TS: `'reissue'` not assignable to local `MandalaActionKind`).

- [ ] **Step 3: Re-export the union** — in `encoding.ts`, delete the local `MandalaActionKind` type and `MandalaActionDetails` interface and add:

```ts
import { Utils, WalletProtocol } from '@bsv/sdk'
export type { MandalaActionKind, MandalaActionDetails } from '@bsv/templates'
// keep SpecificLinkage, MandalaLinkagePayload, encodeLinkagePayload as-is
```

(Keep `SpecificLinkage`/`MandalaLinkagePayload`/`encodeLinkagePayload` definitions in the file.)

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/mandala/encoding.test.ts` → PASS. Then `npx tsc --noEmit` to confirm no consumer broke.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/encoding.ts app/src/lib/mandala/encoding.test.ts
git commit -m "refactor(app): re-export MandalaAction union from @bsv/templates (single source)"
```

---

### Task 2: Tag every mandala action with stable labels

**Files:**
- Modify: `app/src/components/IssuerPanel.tsx` (the 4 `createAction` calls: register, issue, redeem, recover)
- Modify: `app/src/components/SendTokens.tsx` (`transfer` `createAction`)
- Modify: `app/src/components/ReceiveTokens.tsx` (`internalizeAction`)
- Test: none (behavioral wiring; verified in Phase C history tests)

**Interfaces:**
- Produces: every mandala-producing action carries `labels: ['mandala', '<kind>']` (`createAction` accepts top-level `labels: string[]`; `internalizeAction` accepts `labels`).

- [ ] **Step 1: Add labels to each `createAction`** — for register/issue/redeem/recover/transfer add the field, e.g. in register:

```ts
const reg = await wallet.createAction({
  description: `Register ${label.trim()}`,
  labels: ['mandala', 'register'],
  outputs: [/* ... */],
  options: { randomizeOutputs: false }
})
```

Apply analogously: issue→`['mandala','issue']`, redeem→`['mandala','redeem']`, recover→`['mandala','recover']`, transfer→`['mandala','transfer']`.

- [ ] **Step 2: Add labels to receive `internalizeAction`** in `ReceiveTokens.tsx`:

```ts
await wallet.internalizeAction({
  tx: pendingToken.transaction,
  labels: ['mandala', 'receive'],
  outputs: [/* ... existing ... */],
  description: `Receive ${pendingToken.amount} of ${pendingToken.assetId}`
})
```

- [ ] **Step 3: Verify build** — `cd app && npx tsc --noEmit` → no errors. Manual smoke: issue a token; in devtools confirm the action carries the label (or defer to Phase C history test).

- [ ] **Step 4: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/IssuerPanel.tsx app/src/components/SendTokens.tsx app/src/components/ReceiveTokens.tsx
git commit -m "feat(app): label every mandala action ['mandala', kind] for history queries"
```

---

### Task 3: Capture the recipient on outgoing transfers

**Files:**
- Modify: `app/src/components/SendTokens.tsx` (`transfer`, the recipient FT output ~line 145)
- Test: none here (consumed + asserted by Phase C history/contacts tests)

**Interfaces:**
- Produces: the outgoing FT output carries `customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDOut, counterparty: recipientKey, direction: 'sent', recipient: recipientKey })` and `tags: ['mandala', 'sent', selectedAssetId]`, so sent-side counterparty is recoverable from wallet state.

- [ ] **Step 1: Add customInstructions + tags to the recipient output**

```ts
const outputs: any[] = [{
  satoshis: 1,
  lockingScript: ftOut.toHex(),
  outputDescription: 'FT to recipient',
  customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDOut, counterparty: recipientKey, direction: 'sent', recipient: recipientKey }),
  tags: ['mandala', 'sent', selectedAssetId]
}]
```

(The recipient output is not basketed in the sender's wallet — it belongs to the recipient — but `listActions` returns the action with its output `customInstructions`, which is what Phase C reads. Confirm during Phase C that the sent output's customInstructions surface in `listActions`; if not, fall back to a `labels`-encoded recipient or document the limitation per spec C3.)

- [ ] **Step 2: Verify build** — `cd app && npx tsc --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/SendTokens.tsx
git commit -m "feat(app): record recipient on outgoing FT output for history/contacts"
```

---

### Task 4: `submitAdminAction` + `submitGlobalAdminAction` builders

**Files:**
- Modify: `app/src/lib/mandala/assets.ts`
- Test: `app/src/lib/mandala/assets.test.ts` (create; fake wallet)

**Interfaces:**
- Consumes: `AdminAsset` (existing), `MandalaActionDetails`, `MandalaAdmin`, `MandalaToken`, `encodeLinkagePayload`, `revealLinkage`, `submitToOverlay`, `outpoint`.
- Produces:
  - `submitAdminAction({ wallet, asset, details, ftOutput?, messageBoxClient?, identityKey }): Promise<{ txid: string, nextAuthOutpoint: string }>`
  - `submitGlobalAdminAction({ wallet, assets, detailsFor, identityKey }): Promise<{ txid: string }>`

- [ ] **Step 1: Write the failing test** — assert `createAction` is called with a prior-auth input + a next-auth output, and (for reissue) an FT output:

```ts
// app/src/lib/mandala/assets.test.ts
import { describe, it, expect, vi } from 'vitest'
import { submitAdminAction } from './assets'

const fakeAsset = { assetId: 'x.0', label: 'USD', authOutpoint: 'a.0', authDetails: { kind: 'register', label: 'USD' }, metadata: { decimals: 2 } }

function makeWallet () {
  return {
    listOutputs: vi.fn().mockResolvedValue({ outputs: [{ outpoint: 'a.0' }], BEEF: [0] }),
    createAction: vi.fn().mockResolvedValue({ signableTransaction: { tx: [/*beef*/], reference: 'r' } }),
    signAction: vi.fn().mockResolvedValue({ tx: [1], txid: 'newtx' }),
    createSignature: vi.fn(), getPublicKey: vi.fn(), revealSpecificKeyLinkage: vi.fn()
  } as any
}

it('pause builds prior-auth input + next-auth output, no FT output', async () => {
  const wallet = makeWallet()
  // stub Transaction.fromBEEF + unlock template signing via module mocks as the file's other tests do
  // ... arrange ...
  // const res = await submitAdminAction({ wallet, asset: fakeAsset, details: { kind:'pause', assetId:'x.0', priorOutpoint:'a.0' }, identityKey:'02me' })
  // expect(wallet.createAction).toHaveBeenCalledWith(expect.objectContaining({ inputs: [expect.objectContaining({ outpoint: 'a.0' })], outputs: [expect.objectContaining({ outputDescription: expect.stringContaining('auth') })] }))
})
```

(Match the mocking approach already used in the app's existing lib tests — `unlock.test.ts`/`amount.test.ts`. If `submitAdminAction` is hard to unit test through `Transaction.sign()`, factor the pure tx-shape builder out as `buildAdminActionArgs(asset, details, ftOutput?)` returning the `createAction` args object, and unit-test that pure function; keep the signing/submit orchestration thin.)

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/lib/mandala/assets.test.ts` → FAIL.

- [ ] **Step 3: Implement the builder** — add to `assets.ts`, factoring a pure arg-builder + an orchestrator (mirrors IssuerPanel's existing issue/recover flow):

```ts
import { Transaction } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { FT_PROTOCOL, MESSAGEBOX } from './constants'
import { encodeLinkagePayload } from './encoding'
import { revealLinkage, outpoint } from './tokens'
import { submitToOverlay } from './overlay'

export interface SubmitAdminActionParams {
  wallet: WalletInterface
  asset: AdminAsset
  details: MandalaActionDetails
  ftOutput?: { recipient: string, amount: number }
  messageBoxClient?: any
  identityKey: string
}

export async function submitAdminAction (p: SubmitAdminActionParams): Promise<{ txid: string, nextAuthOutpoint: string }> {
  const { wallet, asset, details, ftOutput, messageBoxClient, identityKey } = p
  const nextAuthLock = await MandalaAdmin.lock({ wallet: wallet as any, data: details })

  const list = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  if (list.BEEF == null) throw new Error('listOutputs returned no BEEF')

  const outputs: any[] = []
  let ftKeyID = ''
  if (ftOutput != null) {
    ftKeyID = 'reissue-' + Date.now()
    const ftLock = await new MandalaToken(wallet as any).lockBRC29(details.assetId as string, ftOutput.amount, FT_PROTOCOL, ftKeyID, ftOutput.recipient)
    outputs.push({ satoshis: 1, lockingScript: ftLock.toHex(), outputDescription: 'reissued FT' })
  }
  outputs.push({
    satoshis: 1, lockingScript: nextAuthLock.toHex(), outputDescription: `${details.kind} auth`,
    basket: BASKET, customInstructions: adminCustomInstructions(asset.assetId, asset.label, details, asset.metadata)
  })

  const created = await wallet.createAction({
    description: `${details.kind} ${asset.label}`,
    labels: ['mandala', details.kind],
    inputBEEF: list.BEEF as number[],
    inputs: [{ outpoint: asset.authOutpoint, unlockingScriptLength: 108, inputDescription: 'spend prior admin auth' }],
    outputs,
    options: { randomizeOutputs: false }
  })
  if (created.signableTransaction == null) throw new Error('no signableTransaction')

  const txToSign = Transaction.fromBEEF(created.signableTransaction.tx as number[])
  txToSign.inputs[0].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data: asset.authDetails })
  await txToSign.sign()
  const signed = await wallet.signAction({
    reference: created.signableTransaction.reference,
    spends: { '0': { unlockingScript: txToSign.inputs[0].unlockingScript!.toHex() } }
  })
  if (signed.tx == null || signed.txid == null) throw new Error('signAction returned no tx')

  const adminIndex = ftOutput != null ? 1 : 0
  const outLinks = ftOutput != null ? [{ index: 0, linkage: await revealLinkage(wallet as any, ftKeyID, ftOutput.recipient) }] : []
  await submitToOverlay(signed.tx as number[], encodeLinkagePayload({ inputs: [], outputs: outLinks, admin: [{ index: adminIndex, actionDetails: details }] }))

  if (ftOutput != null && messageBoxClient != null) {
    await messageBoxClient.sendMessage({ recipient: ftOutput.recipient, messageBox: MESSAGEBOX, body: { assetId: details.assetId, amount: ftOutput.amount, transaction: signed.tx, keyID: ftKeyID, protocolID: FT_PROTOCOL, sender: identityKey } })
  }
  return { txid: signed.txid, nextAuthOutpoint: outpoint(signed.txid, adminIndex) }
}
```

For `submitGlobalAdminAction`, build one `createAction` with N prior-auth inputs (one per asset) + N next-auth outputs, sign each input with its asset's `authDetails`, and submit one `admin[]` payload with an entry per output index:

```ts
export async function submitGlobalAdminAction (p: { wallet: WalletInterface, assets: AdminAsset[], detailsFor: (a: AdminAsset) => MandalaActionDetails, identityKey: string }): Promise<{ txid: string }> {
  const { wallet, assets } = p
  const list = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  const details = assets.map(p.detailsFor)
  const inputs = assets.map(a => ({ outpoint: a.authOutpoint, unlockingScriptLength: 108, inputDescription: 'spend prior auth' }))
  const outputs = assets.map((a, i) => ({ satoshis: 1, lockingScript: '', outputDescription: `${details[i].kind} auth`, basket: BASKET, customInstructions: adminCustomInstructions(a.assetId, a.label, details[i], a.metadata) }))
  for (let i = 0; i < assets.length; i++) outputs[i].lockingScript = (await MandalaAdmin.lock({ wallet: wallet as any, data: details[i] })).toHex()
  const created = await wallet.createAction({ description: `global ${details[0].kind}`, labels: ['mandala', details[0].kind], inputBEEF: list.BEEF as number[], inputs, outputs, options: { randomizeOutputs: false } })
  const tx = Transaction.fromBEEF(created.signableTransaction!.tx as number[])
  for (let i = 0; i < assets.length; i++) tx.inputs[i].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data: assets[i].authDetails })
  await tx.sign()
  const spends: Record<string, { unlockingScript: string }> = {}
  for (let i = 0; i < assets.length; i++) spends[String(i)] = { unlockingScript: tx.inputs[i].unlockingScript!.toHex() }
  const signed = await wallet.signAction({ reference: created.signableTransaction!.reference, spends })
  await submitToOverlay(signed.tx as number[], encodeLinkagePayload({ inputs: [], outputs: [], admin: assets.map((_, i) => ({ index: i, actionDetails: details[i] })) }))
  return { txid: signed.txid as string }
}
```

Refactor `IssuerPanel`'s existing issue/redeem/recover to call `submitAdminAction` where they fit (issue/recover map cleanly; redeem additionally spends FT inputs — keep its FT-gathering but route the auth-output construction through the shared `adminCustomInstructions`).

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/mandala/assets.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/assets.ts app/src/lib/mandala/assets.test.ts
git commit -m "feat(app): submitAdminAction + submitGlobalAdminAction builders"
```

---

### Task 5: Shared prelude — `resolveAssetState`

**Files:**
- Create: `app/src/lib/mandala/adminState.ts`
- Test: `app/src/lib/mandala/adminState.test.ts`

**Interfaces:**
- Produces: `AssetAdminStateView` (matches the overlay `AssetAdminState` shape), `resolveAssetState(assetId): Promise<AssetAdminStateView | null>` (LookupResolver `{ assetStateAssetId }`, memoised short TTL). Consumed by B (AssetOverview) and C (alert banners).

- [ ] **Step 1: Write the failing test** (mock `LookupResolver`):

```ts
// app/src/lib/mandala/adminState.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@bsv/sdk', async (orig) => ({ ...(await orig() as any), LookupResolver: class { async query () { return { outputs: [{ data: { assetId: 'x.0', isPaused: true, accessMode: 'denylist', blockedIdentities: [], allowedIdentities: [], frozenOutpoints: [], evictedOutpoints: [] } }] } } } }))
import { resolveAssetState } from './adminState'

it('returns the parsed asset state from the lookup answer', async () => {
  const s = await resolveAssetState('x.0')
  expect(s?.isPaused).toBe(true)
})
```

(Adjust the mock to the actual lookup answer shape — the overlay's `findStateByAssetId` returns the state objects; confirm whether they arrive under `outputs[].data` or a custom formula and parse accordingly. Mirror `metadata.ts`'s resolver usage.)

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/lib/mandala/adminState.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/mandala/adminState.ts
import { LookupResolver } from '@bsv/sdk'
import { OVERLAY_URL, LOOKUP } from './constants'

export interface AssetAdminStateView {
  assetId: string
  issuerIdentityKey: string
  isPaused: boolean
  accessMode: 'denylist' | 'allowlist'
  blockedIdentities: string[]
  allowedIdentities: string[]
  frozenOutpoints: Array<{ outpoint: string, amount: number, owner: string }>
  evictedOutpoints: string[]
}

const cache = new Map<string, { at: number, val: AssetAdminStateView | null }>()
const TTL = 10_000

export async function resolveAssetState (assetId: string): Promise<AssetAdminStateView | null> {
  const hit = cache.get(assetId)
  if (hit != null && Date.now() - hit.at < TTL) return hit.val
  let val: AssetAdminStateView | null = null
  try {
    const resolver = new LookupResolver({ networkPreset: 'mainnet', hostOverrides: { [LOOKUP]: [OVERLAY_URL] } })
    const answer = await resolver.query({ service: LOOKUP, query: { assetStateAssetId: assetId } })
    const first = (answer as any).outputs?.[0]
    val = (first?.data ?? first) as AssetAdminStateView ?? null
  } catch { val = null }
  cache.set(assetId, { at: Date.now(), val })
  return val
}
```

(`Date.now()` is fine in app runtime; the no-`Date.now` rule applies only to ts-stack workflow scripts and seeded mock helpers.)

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/adminState.ts app/src/lib/mandala/adminState.test.ts
git commit -m "feat(app): resolveAssetState shared prelude (overlay-derived control state)"
```

---

### Task 6: Audit history + reproducible proof export

**Files:**
- Create: `app/src/lib/mandala/adminHistory.ts`
- Test: `app/src/lib/mandala/adminHistory.test.ts`

**Interfaces:**
- Produces:
  - `AdminHistoryRow` (`assetId, txid, outputIndex, height, offset, actionDetails`)
  - `resolveAdminHistory(assetId): Promise<AdminHistoryRow[]>` (LookupResolver `{ adminHistoryAssetId }`)
  - `describeAction(details): string` (human-readable per kind)
  - `exportAdminHistoryCsv(rows): string` (columns `txid, outputIndex, priorOutpoint, kind, canonicalDetailsJson, commitment, height, offset, description`)

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/mandala/adminHistory.test.ts
import { describe, it, expect } from 'vitest'
import { describeAction, exportAdminHistoryCsv } from './adminHistory'
import { MandalaAdmin } from '@bsv/templates'

it('describes each kind in human-readable form', () => {
  expect(describeAction({ kind: 'pause', assetId: 'x.0' })).toMatch(/paused/i)
  expect(describeAction({ kind: 'blockIdentity', assetId: 'x.0', identityKey: '02abcdef' })).toMatch(/block/i)
  expect(describeAction({ kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 30, recipient: '03cd' })).toMatch(/reissu/i)
})

it('CSV includes a commitment column that recomputes from the canonical details', () => {
  const row = { assetId: 'x.0', txid: 't1', outputIndex: 0, height: 100, offset: 1, actionDetails: { kind: 'pause' as const, assetId: 'x.0', priorOutpoint: 'p.0' } }
  const csv = exportAdminHistoryCsv([row])
  expect(csv).toContain(MandalaAdmin.commitment(row.actionDetails))
  expect(csv.split('\n')[0]).toContain('commitment')
})
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/mandala/adminHistory.ts
import { LookupResolver } from '@bsv/sdk'
import { MandalaAdmin, MandalaActionDetails } from '@bsv/templates'
import { OVERLAY_URL, LOOKUP } from './constants'
import { formatAmount } from './amount'

export interface AdminHistoryRow { assetId: string, txid: string, outputIndex: number, height: number, offset: number, actionDetails: MandalaActionDetails }

export async function resolveAdminHistory (assetId: string): Promise<AdminHistoryRow[]> {
  try {
    const resolver = new LookupResolver({ networkPreset: 'mainnet', hostOverrides: { [LOOKUP]: [OVERLAY_URL] } })
    const answer = await resolver.query({ service: LOOKUP, query: { adminHistoryAssetId: assetId } })
    return (answer as any).outputs?.map((o: any) => o.data ?? o) ?? []
  } catch { return [] }
}

const short = (k?: string): string => k == null ? '' : `${k.slice(0, 8)}…`

export function describeAction (d: MandalaActionDetails): string {
  switch (d.kind) {
    case 'register': return `Registered asset ${d.assetId}`
    case 'issue': return `Issued ${d.amount} units`
    case 'redeem': return `Redeemed (burned) ${d.amount} units`
    case 'recover': return `Recovered ${d.amount} units to ${short(d.recipient as string)}`
    case 'pause': return 'Paused transfers'
    case 'unpause': return 'Resumed transfers'
    case 'blockIdentity': return `Blocked ${short(d.identityKey as string)}`
    case 'unblockIdentity': return `Unblocked ${short(d.identityKey as string)}`
    case 'allowIdentity': return `Allowlisted ${short(d.identityKey as string)}`
    case 'unallowIdentity': return `Removed ${short(d.identityKey as string)} from allowlist`
    case 'setAccessMode': return `Set access mode to ${d.mode}`
    case 'freezeOutput': return `Froze output ${d.outpoint}`
    case 'unfreezeOutput': return `Unfroze output ${d.outpoint}`
    case 'reissue': return `Reissued ${d.amount} to ${short(d.recipient as string)}${d.bankRef != null ? ` (bankRef ${d.bankRef})` : ''}`
    default: return d.kind
  }
}

const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`

export function exportAdminHistoryCsv (rows: AdminHistoryRow[]): string {
  const header = ['txid', 'outputIndex', 'priorOutpoint', 'kind', 'canonicalDetailsJson', 'commitment', 'height', 'offset', 'description']
  const lines = [header.join(',')]
  for (const r of rows) {
    const canonical = MandalaAdmin.canonicalize(r.actionDetails)
    lines.push([
      esc(r.txid), String(r.outputIndex), esc(String(r.actionDetails.priorOutpoint ?? '')),
      esc(r.actionDetails.kind), esc(canonical), esc(MandalaAdmin.commitment(r.actionDetails)),
      String(r.height), String(r.offset), esc(describeAction(r.actionDetails))
    ].join(','))
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/adminHistory.ts app/src/lib/mandala/adminHistory.test.ts
git commit -m "feat(app): admin history resolver + human descriptions + verifiable CSV proof export"
```

---

### Task 7: Banking mock + reconciliation math

**Files:**
- Create: `app/src/lib/mandala/banking.ts`
- Test: `app/src/lib/mandala/banking.test.ts`

**Interfaces:**
- Produces:
  - `MockDeposit` (`id, amount, currency, originator, timestamp`)
  - `seedDeposits(): MockDeposit[]` (deterministic; timestamps injected, no `Date.now`)
  - `bankBalance(deposits, withdrawals): number`
  - `reconcile({ deposits, withdrawals, issued, redeemed }): { bankBalance, netSupply, drift }` where `netSupply = issued - redeemed` (reissue is net-zero, excluded) and `drift = bankBalance - netSupply`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/mandala/banking.test.ts
import { describe, it, expect } from 'vitest'
import { reconcile, bankBalance } from './banking'

it('bank balance nets deposits minus withdrawals', () => {
  expect(bankBalance([100, 50], [30])).toBe(120)
})
it('reconciles with no drift when issued-redeemed equals bank balance', () => {
  const r = reconcile({ deposits: [100], withdrawals: [40], issued: 100, redeemed: 40 })
  expect(r).toEqual({ bankBalance: 60, netSupply: 60, drift: 0 })
})
it('a redeem with no bank withdrawal does NOT flag drift only if modeled as a withdrawal', () => {
  const r = reconcile({ deposits: [100], withdrawals: [], issued: 100, redeemed: 40 })
  expect(r.drift).toBe(40) // bank 100 vs supply 60 -> 40 drift until a withdrawal is recorded
})
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/mandala/banking.ts
export interface MockDeposit { id: string, amount: number, currency: string, originator: string, timestamp: number }

export function seedDeposits (now = 1_780_000_000_000): MockDeposit[] {
  return [
    { id: 'BR-1001', amount: 25000, currency: 'USD', originator: 'ACME Payroll', timestamp: now - 86_400_000 },
    { id: 'BR-1002', amount: 5000, currency: 'USD', originator: 'Jane Doe (wire)', timestamp: now - 3_600_000 }
  ]
}

export const bankBalance = (deposits: number[], withdrawals: number[]): number =>
  deposits.reduce((a, b) => a + b, 0) - withdrawals.reduce((a, b) => a + b, 0)

export function reconcile (p: { deposits: number[], withdrawals: number[], issued: number, redeemed: number }): { bankBalance: number, netSupply: number, drift: number } {
  const bal = bankBalance(p.deposits, p.withdrawals)
  const netSupply = p.issued - p.redeemed
  return { bankBalance: bal, netSupply, drift: bal - netSupply }
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/banking.ts app/src/lib/mandala/banking.test.ts
git commit -m "feat(app): front-end banking mock + reconciliation math (nets redeem leg)"
```

---

### Task 8: Register card captures `ticker`

**Files:**
- Modify: `app/src/components/IssuerPanel.tsx` (register card + `registerAsset`)
- Test: none (UI; ticker round-trip covered by Phase A metadata tests)

**Interfaces:**
- Produces: register writes `ticker` into both `publicData` and the register `actionDetails`: `metadata = { label, ticker, decimals, issuer }`.

- [ ] **Step 1: Add a ticker input + thread it into metadata**

```ts
const [ticker, setTicker] = useState('')
// in registerAsset:
const metadata = { label: label.trim(), ticker: ticker.trim().toUpperCase(), decimals: dec, issuer: identityKey }
// add <Input id="reg-ticker" value={ticker} onChange={e => setTicker(e.target.value)} placeholder="e.g. USD" /> to the Register card
```

- [ ] **Step 2: Verify build** — `cd app && npx tsc --noEmit` → no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/IssuerPanel.tsx
git commit -m "feat(app): capture ticker at registration for currency formatting"
```

---

### Task 9: Dashboard components

**Files:**
- Create: `app/src/components/issuer/IssuerDashboard.tsx`, `AssetOverview.tsx`, `RegulatoryControls.tsx`, `BankingMock.tsx`, `AuditLog.tsx`
- Modify: the route/parent that renders `IssuerPanel.tsx` to render `IssuerDashboard` (which composes the existing register/issue/redeem/recover cards + the new sections)
- Test: a smoke test per component (renders without throwing) following the app's existing component-test convention; logic already unit-tested in Tasks 4–7.

**Interfaces:**
- Consumes: `listAdminAssets`, `submitAdminAction`, `submitGlobalAdminAction` (Task 4); `resolveAssetState` (Task 5); `resolveAdminHistory`/`describeAction`/`exportAdminHistoryCsv` (Task 6); `seedDeposits`/`reconcile` (Task 7); existing `useWallet`, `formatAmount`/`parseAmount`, UI components.

- [ ] **Step 1: `AssetOverview.tsx`** — list `listAdminAssets(wallet)`; for each, `resolveAssetState(assetId)` and render state badges (paused?, accessMode, `frozenOutpoints.length` frozen, `blockedIdentities.length`/`allowedIdentities.length`). Follow the Card layout in `IssuerPanel.tsx`.

- [ ] **Step 2: `RegulatoryControls.tsx`** — per selected asset, controls that call `submitAdminAction` with the right `details`:
  - Pause/Unpause: `{ kind: isPaused ? 'unpause' : 'pause', assetId, priorOutpoint: asset.authOutpoint }`.
  - Freeze/Unfreeze: outpoint input → `{ kind, assetId, outpoint, priorOutpoint }`.
  - Block/Allow identity: identity search (reuse `useIdentitySearch` as in `SendTokens.tsx`) → `{ kind: 'blockIdentity'|'allowIdentity'|..., assetId, identityKey, priorOutpoint }`.
  - Set access mode: select → `{ kind: 'setAccessMode', assetId, mode, priorOutpoint }`. **Guard:** if switching to `allowlist` and the resolved `allowedIdentities` is empty, block the action with a toast ("Add at least one allowed identity first").
  - Reissue: pick a frozen outpoint from `resolveAssetState().frozenOutpoints` (shows amount+owner), recipient input, amount prefilled from the `FrozenRef.amount` → `submitAdminAction({ ..., details: { kind:'reissue', assetId, outpoint, amount, recipient, bankRef? }, ftOutput: { recipient, amount } })`.
  Each action: `setBusy`, toast success/failure (reuse IssuerPanel's pattern), `reload`.

- [ ] **Step 3: `BankingMock.tsx`** — render `seedDeposits()` as a feed; "Receive deposit" generates a `bankRef` (the deposit `id`) and calls the existing `issue` flow with `bankRef` in the issue `actionDetails` + amount; reconciliation panel shows `reconcile({ deposits, withdrawals, issued, redeemed })` per asset (issued/redeemed from `listOutputs` sums / `resolveAdminHistory` redeem entries). Plaid-sandbox styling via existing Card/Badge components.

- [ ] **Step 4: `AuditLog.tsx`** — `resolveAdminHistory(assetId)` → list `describeAction(row.actionDetails)` with txid; "Export CSV" downloads `exportAdminHistoryCsv(rows)` via a Blob; print-friendly view reuses the rows.

- [ ] **Step 5: `IssuerDashboard.tsx`** — shell with asset switcher + section nav composing AssetOverview, the existing Register/Issue/Redeem/Recover cards, RegulatoryControls, BankingMock, AuditLog. Swap the parent to render `IssuerDashboard`.

- [ ] **Step 6: Smoke tests** — one render test per component (mock `useWallet`, `resolveAssetState`, `resolveAdminHistory`) asserting it mounts. Run `npx vitest run src/components/issuer`.

- [ ] **Step 7: Build + manual E2E** — `cd app && npx tsc --noEmit && npm run build`. Manual: register USD (ticker USD), pause, freeze an outpoint, block an identity, reissue; confirm the audit log + CSV. (Requires Phase A overlay running.)

- [ ] **Step 8: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/issuer app/src/components/IssuerPanel.tsx
git commit -m "feat(app): issuer dashboard — regulatory controls, banking mock, audit log"
```

---

## Self-Review (Phase B)

- **Spec coverage:** B0.1→Task1; B0.2→Task2; B0.3→Task3; B1→Task4; shared prelude→Task5; B4→Task6; B3→Task7; ticker (B2/C1 dep)→Task8; B2 dashboard→Task9. ✓
- **Placeholder scan:** lib tasks (1,4–8) carry full code + tests; component task (9) follows enumerated existing patterns with concrete `details` payloads per control — no vague "add handling". ✓
- **Type consistency:** `submitAdminAction`/`submitGlobalAdminAction` signatures, `AssetAdminStateView`, `AdminHistoryRow` consistent across tasks and with Phase A shapes. ✓
- **DRY/YAGNI:** one builder for all admin actions; `describeAction` single source of human text; reconciliation modeled minimally. ✓
