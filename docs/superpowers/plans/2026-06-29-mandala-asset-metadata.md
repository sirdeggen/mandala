# Mandala Asset Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry a public JSON metadata blob (label, etc.) in the genesis output's locking script so any recipient can resolve and SPV-verify an asset's label from its assetId.

**Architecture:** `MandalaAdmin.lock` gains an optional `publicData` arg that prepends `<push JSON> OP_DROP` before the P2PKH. The genesis output uses it; the overlay lookup service indexes such outputs by their own outpoint (= assetId) and serves them by assetId, retaining the record past spend (but not past eviction). The app resolves assetId → genesis BEEF → SPV verify → decode publicData.

**Tech Stack:** TypeScript, `@bsv/sdk`, `@bsv/templates`, `@bsv/overlay-topics`, MongoDB (overlay storage), React (app), Jest (packages), Vitest (app).

## Global Constraints

- `@bsv/templates`: bump `1.7.0` → `1.7.1` (patch; additive).
- `@bsv/overlay-topics`: bump `1.3.0` → `1.3.1` (patch; additive).
- App templates dep floor: `^1.7.1`; overlay deps floor: `@bsv/templates@^1.7.1`, `@bsv/overlay-topics@^1.3.1`.
- `publicData` is an open object; only `label: string` is required by convention.
- Metadata record retention: survive `outputSpent`; delete on `outputEvicted`.
- Genesis output script is produced by `MandalaAdmin.lock` with `publicData`; `assetId = genesisTxid.0` (unchanged).
- Packages source: `~/git/ts-stack/packages/helpers/ts-templates`, `~/git/ts-stack/packages/overlays/topics`. App: `/Users/personal/git/demos/mandala/app`. Overlay server: `/Users/personal/git/demos/mandala/overlay`.

---

### Task 1: `MandalaAdmin.lock` publicData + decode

**Files:**
- Modify: `~/git/ts-stack/packages/helpers/ts-templates/src/MandalaAdmin.ts`
- Modify: `~/git/ts-stack/packages/helpers/ts-templates/mod.ts`
- Test: `~/git/ts-stack/packages/helpers/ts-templates/src/__tests/MandalaAdmin.script.test.ts`
- Test: `~/git/ts-stack/packages/helpers/ts-templates/src/__tests/MandalaAdmin.spend.test.ts`

**Interfaces:**
- Produces:
  - `MandalaAdminLockParams` gains `publicData?: Record<string, unknown>`
  - `MandalaAdminDecoded` gains `publicData?: Record<string, unknown>`
  - `export interface AssetMetadata { label: string; ticker?: string; decimals?: number; [k: string]: unknown }`
  - `MandalaAdmin.lock(params)` unchanged signature shape; `MandalaAdmin.decode(script): { pubKeyHash, publicData? }`

- [ ] **Step 1: Write failing tests** (append to `MandalaAdmin.script.test.ts`)

```ts
import { Utils } from '@bsv/sdk'

it('embeds publicData as <push JSON> OP_DROP before the P2PKH', async () => {
  const script = await MandalaAdmin.lock({ wallet: wallet as any, data, publicData: { label: 'Gold' } })
  const ops = script.chunks.map(c => c.op)
  expect(ops.slice(1)).toEqual([OP.OP_DROP, OP.OP_DUP, OP.OP_HASH160, 20, OP.OP_EQUALVERIFY, OP.OP_CHECKSIG])
  expect(JSON.parse(Utils.toUTF8(script.chunks[0].data as number[]))).toEqual({ label: 'Gold' })
})

it('decode round-trips publicData and pubKeyHash (7-chunk)', async () => {
  const script = await MandalaAdmin.lock({ wallet: wallet as any, data, publicData: { label: 'Gold', ticker: 'GLD' } })
  const decoded = MandalaAdmin.decode(script)
  expect(decoded.pubKeyHash).toEqual(script.chunks[4].data)
  expect(decoded.publicData).toEqual({ label: 'Gold', ticker: 'GLD' })
})

it('decode returns no publicData for a plain 5-chunk admin script', async () => {
  const script = await MandalaAdmin.lock({ wallet: wallet as any, data })
  const decoded = MandalaAdmin.decode(script)
  expect(decoded.pubKeyHash).toEqual(script.chunks[2].data)
  expect(decoded.publicData).toBeUndefined()
})

it('decode rejects a 7-chunk script whose second op is not OP_DROP', async () => {
  const script = await MandalaAdmin.lock({ wallet: wallet as any, data, publicData: { label: 'X' } })
  script.chunks[1] = { op: OP.OP_DUP }
  expect(() => MandalaAdmin.decode(script)).toThrow()
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd ~/git/ts-stack/packages/helpers/ts-templates && npx jest MandalaAdmin.script`
Expected: FAIL (publicData not supported / decode shape).

- [ ] **Step 3: Implement publicData in `MandalaAdmin.ts`**

Add `AssetMetadata` + extend params/decoded interfaces:

```ts
export interface AssetMetadata { label: string, ticker?: string, decimals?: number, [k: string]: unknown }

export interface MandalaAdminLockParams {
  wallet: WalletInterface
  data: MandalaActionDetails
  counterparty?: WalletCounterparty
  originator?: string
  publicData?: Record<string, unknown>
}

export interface MandalaAdminDecoded {
  pubKeyHash: number[]
  publicData?: Record<string, unknown>
}
```

In `lock`, after computing `pubKeyHash`, build the chunk list with the optional prefix:

```ts
static async lock (params: MandalaAdminLockParams): Promise<LockingScript> {
  const { wallet, data, counterparty = 'self', originator, publicData } = params
  const keyID = MandalaAdmin.commitment(data)
  const { publicKey } = await wallet.getPublicKey({ protocolID: ADMIN_PROTOCOL, keyID, counterparty }, originator)
  const pubKeyHash = Hash.hash160(Utils.toArray(publicKey, 'hex'))
  const p2pkh = [
    { op: OP.OP_DUP },
    { op: OP.OP_HASH160 },
    { op: pubKeyHash.length, data: pubKeyHash },
    { op: OP.OP_EQUALVERIFY },
    { op: OP.OP_CHECKSIG }
  ]
  if (publicData == null) return new LockingScript(p2pkh)
  // Public metadata: pushed then dropped — purely informational, no spend effect.
  const blob = Utils.toArray(JSON.stringify(publicData), 'utf8')
  return new LockingScript([
    createMinimallyEncodedScriptChunk(blob),
    { op: OP.OP_DROP },
    ...p2pkh
  ])
}
```

Add the import for `createMinimallyEncodedScriptChunk`:

```ts
import { createMinimallyEncodedScriptChunk } from './mandala-encoding.js'
```

Replace `decode`:

```ts
static decode (script: LockingScript): MandalaAdminDecoded {
  const c = script.chunks
  // Optional <push JSON> OP_DROP metadata prefix (7 chunks) vs plain P2PKH (5).
  let publicData: Record<string, unknown> | undefined
  let p2pkh = c
  if (c.length === 7) {
    if (c[1].op !== OP.OP_DROP) throw new Error('not a MandalaAdmin script: bad publicData prefix')
    const data = c[0].data
    if (data == null) throw new Error('not a MandalaAdmin script: empty publicData push')
    publicData = JSON.parse(Utils.toUTF8(data))
    p2pkh = c.slice(2)
  } else if (c.length !== 5) {
    throw new Error('not a MandalaAdmin script: wrong chunk count')
  }
  if (p2pkh[0].op !== OP.OP_DUP || p2pkh[1].op !== OP.OP_HASH160 || p2pkh[3].op !== OP.OP_EQUALVERIFY || p2pkh[4].op !== OP.OP_CHECKSIG) {
    throw new Error('not a MandalaAdmin script: bad P2PKH shape')
  }
  const pubKeyHash = p2pkh[2].data
  if (pubKeyHash?.length !== 20) throw new Error('not a MandalaAdmin script: bad pubKeyHash')
  return { pubKeyHash, publicData }
}
```

- [ ] **Step 4: Export `AssetMetadata`** (`mod.ts`)

```ts
export type {
  MandalaAdminDecoded, MandalaActionDetails, MandalaActionKind,
  MandalaAdminLockParams, MandalaAdminUnlockParams, AssetMetadata
} from './src/MandalaAdmin.js'
```

- [ ] **Step 5: Add a spend test for publicData** (append to `MandalaAdmin.spend.test.ts`)

```ts
it('CHECKSIG verifies a publicData admin output (prefix is dropped)', async () => {
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  const lock = await MandalaAdmin.lock({ wallet: wallet as any, data, publicData: { label: 'Gold' } })

  const srcTx = new Transaction()
  srcTx.addOutput({ lockingScript: lock, satoshis: 1 })
  const spendTx = new Transaction()
  spendTx.addInput({ sourceTransaction: srcTx, sourceOutputIndex: 0, sequence: 0xffffffff })
  spendTx.addOutput({ lockingScript: new LockingScript([{ op: OP.OP_TRUE }]), satoshis: 1 })

  spendTx.inputs[0].unlockingScriptTemplate = MandalaAdmin.unlock({ wallet: wallet as any, data })
  await spendTx.sign()

  expect(buildSpend(lock, spendTx.inputs[0].unlockingScript!, spendTx, srcTx).validate()).toBe(true)
})
```

- [ ] **Step 6: Run full templates suite, verify pass**

Run: `cd ~/git/ts-stack/packages/helpers/ts-templates && npm test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
cd ~/git/ts-stack
git add packages/helpers/ts-templates/src/MandalaAdmin.ts packages/helpers/ts-templates/mod.ts packages/helpers/ts-templates/src/__tests/MandalaAdmin.script.test.ts packages/helpers/ts-templates/src/__tests/MandalaAdmin.spend.test.ts
git commit -m "feat(templates): MandalaAdmin.lock publicData metadata prefix"
```

---

### Task 2: Bump + publish `@bsv/templates` 1.7.1

**Files:**
- Modify: `~/git/ts-stack/packages/helpers/ts-templates/package.json:3`

**Interfaces:**
- Produces: published `@bsv/templates@1.7.1` on npm.

- [ ] **Step 1: Bump version**

Edit `package.json`: `"version": "1.7.0"` → `"version": "1.7.1"`.

- [ ] **Step 2: Build + test**

Run: `cd ~/git/ts-stack/packages/helpers/ts-templates && npm test`
Expected: PASS.

- [ ] **Step 3: Publish** (requires npm auth)

Run: `cd ~/git/ts-stack/packages/helpers/ts-templates && npm publish`
Expected: `+ @bsv/templates@1.7.1`.

- [ ] **Step 4: Commit**

```bash
cd ~/git/ts-stack
git add packages/helpers/ts-templates/package.json
git commit -m "chore(templates): 1.7.1"
```

---

### Task 3: StorageManager metadata collection

**Files:**
- Modify: `~/git/ts-stack/packages/overlays/topics/src/mandala/MandalaStorageManager.ts`
- Test: `~/git/ts-stack/packages/overlays/topics/src/__tests__/mandala.storage.metadata.test.ts` (create)

**Interfaces:**
- Consumes: `UTXOReference` from `./types.js` (`{ txid: string, outputIndex: number }`).
- Produces:
  - `storeMetadata(record: { txid: string, outputIndex: number, assetId: string }): Promise<void>`
  - `findMetadataByAssetId(assetId: string): Promise<UTXOReference[]>`
  - `deleteMetadata(txid: string, outputIndex: number): Promise<void>`

- [ ] **Step 1: Write failing test** (create `mandala.storage.metadata.test.ts`)

```ts
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { MandalaStorageManager } from '../mandala/MandalaStorageManager.js'

describe('MandalaStorageManager metadata', () => {
  let mongod: MongoMemoryServer, client: MongoClient, storage: MandalaStorageManager

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    storage = new MandalaStorageManager(client.db('test'))
  })
  afterAll(async () => { await client.close(); await mongod.stop() })

  it('stores and finds metadata by assetId, deletes by outpoint', async () => {
    await storage.storeMetadata({ txid: 'a'.repeat(64), outputIndex: 0, assetId: `${'a'.repeat(64)}.0` })
    const found = await storage.findMetadataByAssetId(`${'a'.repeat(64)}.0`)
    expect(found).toEqual([{ txid: 'a'.repeat(64), outputIndex: 0 }])
    await storage.deleteMetadata('a'.repeat(64), 0)
    expect(await storage.findMetadataByAssetId(`${'a'.repeat(64)}.0`)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test, verify fail**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npx jest mandala.storage.metadata`
Expected: FAIL (`storeMetadata` is not a function).

- [ ] **Step 3: Implement metadata collection** (`MandalaStorageManager.ts`)

Add a field + index + methods:

```ts
interface MetadataRecord { txid: string, outputIndex: number, assetId: string }
```

In the class:

```ts
private readonly metadata: Collection<MetadataRecord>
```

In the constructor:

```ts
this.metadata = db.collection<MetadataRecord>('mandalaMetadata')
```

In `ensureIndexes`, add to the `Promise.all`:

```ts
this.metadata.createIndex({ txid: 1, outputIndex: 1 }, { unique: true }),
this.metadata.createIndex({ assetId: 1 }),
```

Add methods:

```ts
async storeMetadata (record: { txid: string, outputIndex: number, assetId: string }): Promise<void> {
  await this.ensureIndexes()
  await this.metadata.updateOne(
    { txid: record.txid, outputIndex: record.outputIndex },
    { $set: record },
    { upsert: true }
  )
}

async findMetadataByAssetId (assetId: string): Promise<UTXOReference[]> {
  await this.ensureIndexes()
  return await this.metadata.find({ assetId })
    .project<UTXOReference>({ txid: 1, outputIndex: 1, _id: 0 }).toArray()
}

async deleteMetadata (txid: string, outputIndex: number): Promise<void> {
  await this.ensureIndexes()
  await this.metadata.deleteOne({ txid, outputIndex })
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npx jest mandala.storage.metadata`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/git/ts-stack
git add packages/overlays/topics/src/mandala/MandalaStorageManager.ts packages/overlays/topics/src/__tests__/mandala.storage.metadata.test.ts
git commit -m "feat(overlay-topics): metadata storage for mandala genesis"
```

---

### Task 4: LookupService indexes + serves + retains metadata

**Files:**
- Modify: `~/git/ts-stack/packages/overlays/topics/src/mandala/MandalaLookupService.ts`
- Test: `~/git/ts-stack/packages/overlays/topics/src/__tests__/mandala.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `MandalaStorageManager.storeMetadata / findMetadataByAssetId / deleteMetadata` (Task 3); `MandalaAdmin.decode` returning `{ pubKeyHash, publicData? }` (Task 1).
- Produces: lookup `query.metadataAssetId` → `UTXOReference[]`; `outputAdmittedByTopic` indexes admin outputs with publicData; `outputSpent` keeps metadata; `outputEvicted` deletes it.

- [ ] **Step 1: Write failing tests** (append to `mandala.test.ts`)

```ts
import { MandalaStorageManager } from '../mandala/MandalaStorageManager.js'
import { MandalaLookupService } from '../mandala/MandalaLookupService.js'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

describe('MandalaLookupService metadata', () => {
  let mongod: MongoMemoryServer, client: MongoClient, ls: MandalaLookupService, storage: MandalaStorageManager
  const overlay = new ProtoWallet(PrivateKey.fromRandom())
  const txid = 'd'.repeat(64)

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri()); await client.connect()
    storage = new MandalaStorageManager(client.db('test'))
    ls = new MandalaLookupService({ storage, verifierWallet: overlay as any })
  })
  afterAll(async () => { await client.close(); await mongod.stop() })

  it('indexes an admin output with publicData and serves it by assetId', async () => {
    const lock = await MandalaAdmin.lock({ wallet: overlay as any, data: { kind: 'register' }, publicData: { label: 'Gold' } })
    await ls.outputAdmittedByTopic({ mode: 'locking-script', topic: 'tm_mandala', txid, outputIndex: 0, lockingScript: lock } as any)
    const formula = await ls.lookup({ service: 'ls_mandala', query: { metadataAssetId: `${txid}.0` } } as any)
    expect(formula).toEqual([{ txid, outputIndex: 0 }])
  })

  it('keeps metadata on spend but removes it on evict', async () => {
    await ls.outputSpent({ topic: 'tm_mandala', txid, outputIndex: 0 } as any)
    expect(await ls.lookup({ service: 'ls_mandala', query: { metadataAssetId: `${txid}.0` } } as any)).toEqual([{ txid, outputIndex: 0 }])
    await ls.outputEvicted(txid, 0)
    expect(await ls.lookup({ service: 'ls_mandala', query: { metadataAssetId: `${txid}.0` } } as any)).toEqual([])
  })

  it('does not index an admin output without publicData', async () => {
    const lock = await MandalaAdmin.lock({ wallet: overlay as any, data: { kind: 'register' } })
    const t2 = 'e'.repeat(64)
    await ls.outputAdmittedByTopic({ mode: 'locking-script', topic: 'tm_mandala', txid: t2, outputIndex: 0, lockingScript: lock } as any)
    expect(await ls.lookup({ service: 'ls_mandala', query: { metadataAssetId: `${t2}.0` } } as any)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, verify fail**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npx jest "MandalaLookupService metadata"`
Expected: FAIL (metadataAssetId unsupported / not indexed).

- [ ] **Step 3: Implement in `MandalaLookupService.ts`**

Add the import:

```ts
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
```

In `outputAdmittedByTopic`, replace the `catch { return }` of the token decode with an admin-metadata fallback:

```ts
let decoded
try {
  decoded = MandalaToken.decode(payload.lockingScript)
} catch {
  // Not an FT. If it is an admin output carrying publicData, index it as metadata
  // keyed by its own outpoint (= assetId). Anchored on-chain; served by assetId.
  try {
    const admin = MandalaAdmin.decode(payload.lockingScript)
    if (admin.publicData != null) {
      await this.deps.storage.storeMetadata({
        txid: payload.txid,
        outputIndex: payload.outputIndex,
        assetId: `${payload.txid}.${payload.outputIndex}`
      })
    }
  } catch { /* not a mandala admin output */ }
  return
}
```

In `outputSpent`, leave the token-deletion logic as-is — **do not** touch metadata (it must survive spend). (No code change; the existing body only deletes from `tokens`.)

In `outputEvicted`, also delete metadata:

```ts
async outputEvicted (txid: string, outputIndex: number): Promise<void> {
  await this.deps.storage.deleteToken(txid, outputIndex)
  await this.deps.storage.deleteMetadata(txid, outputIndex)
}
```

In `lookup`, add the metadata query before the generic ones:

```ts
if (typeof query.metadataAssetId === 'string') {
  return await this.deps.storage.findMetadataByAssetId(query.metadataAssetId)
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npx jest mandala`
Expected: PASS (metadata describe + existing mandala suites).

- [ ] **Step 5: Full suite + build**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npm test && npm run build`
Expected: PASS, clean `tsc`.

- [ ] **Step 6: Commit**

```bash
cd ~/git/ts-stack
git add packages/overlays/topics/src/mandala/MandalaLookupService.ts packages/overlays/topics/src/__tests__/mandala.test.ts
git commit -m "feat(overlay-topics): index + serve genesis metadata by assetId"
```

---

### Task 5: Bump + publish `@bsv/overlay-topics` 1.3.1

**Files:**
- Modify: `~/git/ts-stack/packages/overlays/topics/package.json:3`

**Interfaces:**
- Produces: published `@bsv/overlay-topics@1.3.1`.

- [ ] **Step 1: Bump version**

Edit `package.json`: `"version": "1.3.0"` → `"version": "1.3.1"`.

- [ ] **Step 2: Build + test**

Run: `cd ~/git/ts-stack/packages/overlays/topics && npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Publish** (requires npm auth)

Run: `cd ~/git/ts-stack/packages/overlays/topics && npm publish`
Expected: `+ @bsv/overlay-topics@1.3.1`.

- [ ] **Step 4: Commit**

```bash
cd ~/git/ts-stack
git add packages/overlays/topics/package.json
git commit -m "chore(overlay-topics): 1.3.1"
```

---

### Task 6: Bump app + overlay deps

**Files:**
- Modify: `/Users/personal/git/demos/mandala/app/package.json`
- Modify: `/Users/personal/git/demos/mandala/overlay/package.json`

**Interfaces:**
- Produces: app on `@bsv/templates@^1.7.1`; overlay on `@bsv/templates@^1.7.1` + `@bsv/overlay-topics@^1.3.1`.

- [ ] **Step 1: Install in app**

Run: `cd /Users/personal/git/demos/mandala/app && npm install @bsv/templates@^1.7.1`
Expected: `@bsv/templates@1.7.1` resolved.

- [ ] **Step 2: Install in overlay**

Run: `cd /Users/personal/git/demos/mandala/overlay && npm install @bsv/templates@^1.7.1 @bsv/overlay-topics@^1.3.1`
Expected: both resolved.

- [ ] **Step 3: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/package.json app/package-lock.json overlay/package.json overlay/package-lock.json
git commit -m "chore(app,overlay): bump templates 1.7.1 + overlay-topics 1.3.1"
```

---

### Task 7: Register writes genesis publicData + submits genesis

**Files:**
- Modify: `/Users/personal/git/demos/mandala/app/src/components/IssuerPanel.tsx` (registerAsset, lines ~49-113)

**Interfaces:**
- Consumes: `MandalaAdmin.lock` with `publicData` (Task 1); `submitToOverlay` from `../lib/mandala/overlay`; `encodeLinkagePayload` from `../lib/mandala/encoding`.
- Produces: genesis tx carries `MandalaAdmin.lock({ data:{kind:'register'}, publicData:{label} })` at output 0 and is submitted to `tm_mandala`.

- [ ] **Step 1: Replace the genesis (phase 1) lock + add submission**

In `registerAsset`, replace the phase-1 block (the `genesisKeyId` / `P2PKH().lock` / `phase1 = createAction`) with:

```ts
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
```

Remove the now-unused `genesisKeyId` / `genesisPub` / `P2PKH` / `Hash` / `Utils` references **only if** no longer used elsewhere in the file (verify with grep in Step 3).

- [ ] **Step 2: Store metadata in the asset record** — defer to Task 8 (assets.ts). For now, keep the existing phase-2 register flow that builds `regDetails` and the admin auth output; in Task 8 its customInstructions will include `metadata`.

- [ ] **Step 3: Verify imports + build**

Run:
```bash
cd /Users/personal/git/demos/mandala/app
grep -n "P2PKH\|genesisKeyId\|Hash\.\|Utils\." src/components/IssuerPanel.tsx
npm run build
```
Expected: no dangling references to removed symbols (remove unused imports from line 2 if `P2PKH`/`Hash`/`Utils` are now unused); build PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/IssuerPanel.tsx
git commit -m "feat(app): genesis carries publicData metadata + submit to overlay"
```

---

### Task 8: Asset bookkeeping carries metadata

**Files:**
- Modify: `/Users/personal/git/demos/mandala/app/src/lib/mandala/assets.ts`
- Modify: `/Users/personal/git/demos/mandala/app/src/components/IssuerPanel.tsx` (register save + issue/redeem/recover lock calls)

**Interfaces:**
- Consumes: `AssetMetadata` from `@bsv/templates`.
- Produces:
  - `AdminAsset` gains `metadata?: Record<string, unknown>`
  - `adminCustomInstructions(assetId, label, authDetails, metadata?)` — appends `metadata`
  - `adminAssetFromOutput` / `listAdminAssets` surface `metadata`

- [ ] **Step 1: Extend `assets.ts`**

Update the CI shape + helpers:

```ts
interface AdminCI {
  type: typeof ADMIN_CI_TYPE
  assetId: string
  label: string
  authDetails: MandalaActionDetails
  metadata?: Record<string, unknown>
}

export interface AdminAsset {
  assetId: string
  label: string
  authOutpoint: string
  authDetails: MandalaActionDetails
  metadata?: Record<string, unknown>
}

export function adminCustomInstructions (
  assetId: string, label: string, authDetails: MandalaActionDetails, metadata?: Record<string, unknown>
): string {
  return JSON.stringify({ type: ADMIN_CI_TYPE, assetId, label, authDetails, metadata } satisfies AdminCI)
}
```

In `adminAssetFromOutput`, include metadata:

```ts
return { assetId: ci.assetId, label: ci.label, authOutpoint: o.outpoint, authDetails: ci.authDetails, metadata: ci.metadata }
```

- [ ] **Step 2: Thread metadata through IssuerPanel admin outputs**

In `registerAsset` (phase-2 admin output), pass metadata to `adminCustomInstructions`:

```ts
customInstructions: adminCustomInstructions(assetId, label.trim(), regDetails, metadata)
```

(`metadata` is the object created in Task 7 Step 1.)

In `issue`, `redeem`, `recover`, when building the next-auth `customInstructions`, pass `asset.metadata`:

```ts
customInstructions: adminCustomInstructions(asset.assetId, asset.label, issueDetails, asset.metadata)
```
```ts
customInstructions: adminCustomInstructions(redeemAsset, asset.label, redeemDetails, asset.metadata)
```
```ts
customInstructions: adminCustomInstructions(recoverAsset, asset.label, recoverDetails, asset.metadata)
```

- [ ] **Step 3: Build**

Run: `cd /Users/personal/git/demos/mandala/app && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/assets.ts app/src/components/IssuerPanel.tsx
git commit -m "feat(app): carry asset metadata in admin customInstructions"
```

---

### Task 9: Metadata resolver (lookup + SPV verify + decode)

**Files:**
- Create: `/Users/personal/git/demos/mandala/app/src/lib/mandala/metadata.ts`
- Test: `/Users/personal/git/demos/mandala/app/src/lib/mandala/metadata.test.ts`

**Interfaces:**
- Consumes: `LookupResolver` from `@bsv/sdk`; `WhatsOnChain` chain tracker from `@bsv/sdk`; `MandalaAdmin.decode` (Task 1); `OVERLAY_URL`, `LOOKUP` from `../lib/mandala/constants`.
- Produces: `resolveAssetMetadata(assetId: string): Promise<AssetMetadata | null>`

- [ ] **Step 1: Write failing test** (`metadata.test.ts`)

Use a self-contained genesis BEEF built in-test and a stub resolver via dependency injection. Define `resolveAssetMetadata` to accept an injectable lookup fn + chain tracker for testability:

```ts
import { describe, it, expect } from 'vitest'
import { ProtoWallet, PrivateKey, Transaction } from '@bsv/sdk'
import { MandalaAdmin } from '@bsv/templates'
import { parseMetadataFromBeef } from './metadata'

describe('parseMetadataFromBeef', () => {
  it('decodes publicData from output 0 of a genesis tx', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromRandom())
    const lock = await MandalaAdmin.lock({ wallet: wallet as any, data: { kind: 'register' }, publicData: { label: 'Gold', ticker: 'GLD' } })
    const tx = new Transaction()
    tx.addOutput({ lockingScript: lock, satoshis: 1 })
    const meta = parseMetadataFromBeef(tx.toBEEF(), 0)
    expect(meta).toEqual({ label: 'Gold', ticker: 'GLD' })
  })

  it('returns null when output has no publicData', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromRandom())
    const lock = await MandalaAdmin.lock({ wallet: wallet as any, data: { kind: 'register' } })
    const tx = new Transaction()
    tx.addOutput({ lockingScript: lock, satoshis: 1 })
    expect(parseMetadataFromBeef(tx.toBEEF(), 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify fail**

Run: `cd /Users/personal/git/demos/mandala/app && npx vitest run src/lib/mandala/metadata.test.ts`
Expected: FAIL (`parseMetadataFromBeef` not exported).

- [ ] **Step 3: Implement `metadata.ts`**

```ts
import { LookupResolver, Transaction, WhatsOnChain } from '@bsv/sdk'
import { MandalaAdmin, AssetMetadata } from '@bsv/templates'
import { OVERLAY_URL, LOOKUP } from './constants'

const cache = new Map<string, AssetMetadata | null>()

// Pure decode helper (unit-testable without network): read output `index`'s
// locking script from a BEEF and return its MandalaAdmin publicData, or null.
export function parseMetadataFromBeef (beef: number[], index: number): AssetMetadata | null {
  try {
    const tx = Transaction.fromBEEF(beef)
    const ls = tx.outputs[index]?.lockingScript
    if (ls == null) return null
    const decoded = MandalaAdmin.decode(ls)
    if (decoded.publicData == null || typeof (decoded.publicData as any).label !== 'string') return null
    return decoded.publicData as AssetMetadata
  } catch {
    return null
  }
}

// Resolve an asset's on-chain metadata by assetId: query the overlay lookup for
// the genesis output, SPV-verify the genesis tx, then decode publicData. Memoized.
export async function resolveAssetMetadata (assetId: string): Promise<AssetMetadata | null> {
  if (cache.has(assetId)) return cache.get(assetId) ?? null
  let result: AssetMetadata | null = null
  try {
    const resolver = new LookupResolver({ networkPreset: 'mainnet', hostOverrides: { [LOOKUP]: [OVERLAY_URL] } })
    const answer = await resolver.query({ service: LOOKUP, query: { metadataAssetId: assetId } })
    const dotIndex = assetId.lastIndexOf('.')
    const vout = Number(assetId.slice(dotIndex + 1))
    for (const out of answer.outputs) {
      const tx = Transaction.fromBEEF(out.beef)
      if (!(await tx.verify(new WhatsOnChain('main')))) continue
      const meta = parseMetadataFromBeef(out.beef, vout)
      if (meta != null) { result = meta; break }
    }
  } catch {
    result = null
  }
  cache.set(assetId, result)
  return result
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd /Users/personal/git/demos/mandala/app && npx vitest run src/lib/mandala/metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `cd /Users/personal/git/demos/mandala/app && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/metadata.ts app/src/lib/mandala/metadata.test.ts
git commit -m "feat(app): resolveAssetMetadata via overlay lookup + SPV verify"
```

---

### Task 10: ReceiveTokens shows label; Wallet/Send fall back to resolver

**Files:**
- Modify: `/Users/personal/git/demos/mandala/app/src/components/ReceiveTokens.tsx`
- Modify: `/Users/personal/git/demos/mandala/app/src/components/TokenWallet.tsx`
- Modify: `/Users/personal/git/demos/mandala/app/src/components/SendTokens.tsx`

**Interfaces:**
- Consumes: `resolveAssetMetadata` (Task 9).
- Produces: label shown for pending receives and for non-issuer balances.

- [ ] **Step 1: ReceiveTokens — resolve + display label per pending token**

Add state + effect after the existing pending state:

```ts
const [labels, setLabels] = useState<Record<string, string>>({})
useEffect(() => {
  void (async () => {
    const next: Record<string, string> = {}
    for (const p of pending) {
      const meta = await resolveAssetMetadata(p.assetId)
      if (meta != null) next[p.assetId] = meta.label
    }
    setLabels(next)
  })()
}, [pending])
```

Import: `import { resolveAssetMetadata } from '../lib/mandala/metadata'`.

In the row that renders `pending.assetId`, show the label when known, e.g.:

```tsx
<p className="text-[15px] font-semibold">{labels[pending.assetId] ?? `${pending.assetId.slice(0, 20)}…`}</p>
<p className="tabular text-[12px] text-subtle-foreground">{pending.assetId}</p>
```

- [ ] **Step 2: ReceiveTokens — persist label into FT CI on accept**

In the accept handler's `internalizeAction` output (the `tags`/customInstructions for the received basket output), add the resolved label so Wallet/Send show it without re-resolving. Where the received output is internalized into `BASKET`, set its `customInstructions` to include the label:

```ts
customInstructions: JSON.stringify({
  protocolID: pendingToken.protocolID,
  keyID: pendingToken.keyID,
  counterparty: pendingToken.sender,
  label: labels[pendingToken.assetId]
})
```

(Match the existing internalize call shape — add `label` to whatever customInstructions object it already passes; if it passes none, add this object on the basket insertion.)

- [ ] **Step 3: TokenWallet + SendTokens — resolver fallback for unknown labels**

In `TokenWallet.refresh` and `SendTokens.loadBalances`, after building the admin-CI label map, fill gaps from the resolver:

```ts
for (const b of [...totals.keys()]) {
  if (labelMap[b] == null) {
    const meta = await resolveAssetMetadata(b)
    if (meta != null) labelMap[b] = meta.label
  }
}
```

(Use the existing `labels`/`labelFor` map variable name in each file; `totals` is the per-asset balance map already built in that function.)

Import in both: `import { resolveAssetMetadata } from '../lib/mandala/metadata'`.

- [ ] **Step 4: Build**

Run: `cd /Users/personal/git/demos/mandala/app && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/ReceiveTokens.tsx app/src/components/TokenWallet.tsx app/src/components/SendTokens.tsx
git commit -m "feat(app): show SPV-resolved asset labels on receive + wallet/send"
```

---

### Task 11: Rebuild overlay container + E2E

**Files:** none (deploy + manual verification).

- [ ] **Step 1: Rebuild + restart overlay** (picks up published overlay-topics 1.3.1 + templates 1.7.1)

```bash
cd /Users/personal/git/demos/mandala/overlay
docker compose build --no-cache
docker compose up -d
docker compose exec -T overlay sh -c 'cat node_modules/@bsv/templates/package.json node_modules/@bsv/overlay-topics/package.json | grep version'
```
Expected: `1.7.1` and `1.3.1`.

- [ ] **Step 2: E2E**

1. As issuer: register an asset with a label (genesis carries publicData; genesis submitted).
2. Issue tokens; send to a second wallet's identity.
3. Switch to the second wallet → Receive tab → the pending token shows the **label** (SPV-resolved), not just the assetId.
4. Accept → Wallet/Send show the label.

Expected: label visible end-to-end on a wallet that never registered the asset.

---

## Self-Review

**Spec coverage:** templates publicData lock/decode (Task 1) ✓; bumps (2,5) ✓; storage metadata (3) ✓; lookup index/serve/retain spend-keep/evict-delete (4) ✓; register genesis publicData + submit (7) ✓; issuer CI metadata (8) ✓; resolver lookup+SPV+decode (9) ✓; ReceiveTokens display+persist, Wallet/Send fallback (10) ✓; rebuild + E2E (11) ✓. AssetMetadata type exported (1) ✓.

**Placeholder scan:** Task 10 steps reference "the existing internalize call shape" / "existing map variable name" — these are intentional adaptation points where exact surrounding code must be read at execution; the code to add is given verbatim. All other steps contain complete code.

**Type consistency:** `resolveAssetMetadata(assetId): Promise<AssetMetadata|null>` and `parseMetadataFromBeef(beef, index)` consistent across Tasks 9–10; `adminCustomInstructions(assetId,label,authDetails,metadata?)` consistent across Tasks 8 call sites; `storeMetadata/findMetadataByAssetId/deleteMetadata` consistent across Tasks 3–4; `MandalaAdminDecoded.publicData` consistent across Tasks 1,4,9.
