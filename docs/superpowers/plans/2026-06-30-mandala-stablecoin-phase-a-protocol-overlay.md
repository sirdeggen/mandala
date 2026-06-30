# Mandala Stablecoin — Phase A: Protocol & Overlay Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-chain admin controls (pause, freeze, block/allow, reissue) to the Mandala token, enforced by the overlay via derived per-asset state, in the `@bsv/templates` and `@bsv/overlay-topics` packages.

**Architecture:** New action kinds extend the existing `MandalaAdmin` auth chain (token outputs untouched). A pure reducer folds admitted admin actions into a per-asset `AssetAdminState` persisted by the lookup service (single writer); the topic manager reads that state to gate transfers. Ordering for deterministic replay comes from the tx merkle path, obtained by switching the lookup service to `whole-tx` admission mode.

**Tech Stack:** TypeScript (ESM), `@bsv/sdk`, `@bsv/overlay@2.1`, MongoDB, Jest (ESM via `node --experimental-vm-modules`).

**Spec:** `docs/superpowers/specs/2026-06-30-mandala-stablecoin-admin-ux-design.md` (Phase A = §A0–A7).

## Global Constraints

- **North-star:** new controls ride the admin-auth chain only; no new bytes on token outputs; no marker. Derived state is off-chain.
- **No backward compatibility** — free to change template/state shapes; no migration.
- **Single writer:** the lookup service is the only writer of `AssetAdminState`; the topic manager only reads it.
- **Enforcement is on-admission with a one-submit lag** (Engine admits in Phase 1, indexes in Phase 3). Document, don't fight it.
- **reissue conservation is off-chain only** — the mint inflates on-chain supply; net-zero holds only in the overlay's evicted-filtered balance view. A reissue tx MUST have zero FT inputs of the reissued asset.
- **Eviction = query-time filter:** token row retained; outpoint added to `evictedOutpoints`; balance/holdings reads exclude it. State stays a pure function of folded history.
- **Sanctions screening stays universal** (all parties, incl. admin actions); **access-mode screening applies to peer transfers only** and exempts admin actions. Do not merge them.
- **Ordering key:** `(height, offset, admitSeq)`; unconfirmed → `height = Number.MAX_SAFE_INTEGER`, `offset = 0`, tiebreak by monotonic `admitSeq`.
- Test runner (ts-stack): `npm test` in `packages/overlays/topics` and `packages/helpers/ts-templates`. Tests live in `src/**/__tests/*.test.ts`. Lint: `ts-standard`.

**Paths** (absolute):
- templates: `/Users/personal/git/ts-stack/packages/helpers/ts-templates`
- overlay-topics: `/Users/personal/git/ts-stack/packages/overlays/topics`
- demo overlay: `/Users/personal/git/demos/mandala/overlay`

---

### Task 1: Extend the admin action union (`@bsv/templates`)

**Files:**
- Modify: `packages/helpers/ts-templates/src/MandalaAdmin.ts` (the `MandalaActionKind` type ~line 11 and `MandalaActionDetails` interface ~lines 13–19)
- Test: `packages/helpers/ts-templates/src/__tests/MandalaAdmin.test.ts` (add cases; create file if absent)

**Interfaces:**
- Produces: widened `MandalaActionKind` and `MandalaActionDetails` (new optional fields `identityKey`, `outpoint`, `recipient`, `mode`, `bankRef`). `MandalaAdmin.commitment(details)` and `canonicalize(details)` unchanged in logic.

- [ ] **Step 1: Write the failing test** — commitment is stable and distinct per new kind, and covers `bankRef`.

```ts
// packages/helpers/ts-templates/src/__tests/MandalaAdmin.test.ts
import { MandalaAdmin, MandalaActionDetails } from '../MandalaAdmin'

describe('MandalaAdmin new action kinds', () => {
  it('commitment is deterministic and field-order independent for new kinds', () => {
    const a: MandalaActionDetails = { kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 5, recipient: '02ab', bankRef: 'BR-1', priorOutpoint: 'z.0' }
    const b: MandalaActionDetails = { priorOutpoint: 'z.0', bankRef: 'BR-1', recipient: '02ab', amount: 5, outpoint: 'y.1', assetId: 'x.0', kind: 'reissue' }
    expect(MandalaAdmin.commitment(a)).toBe(MandalaAdmin.commitment(b))
  })

  it('distinct kinds and params yield distinct commitments', () => {
    const pause: MandalaActionDetails = { kind: 'pause', assetId: 'x.0', priorOutpoint: 'z.0' }
    const unpause: MandalaActionDetails = { kind: 'unpause', assetId: 'x.0', priorOutpoint: 'z.0' }
    const blockA: MandalaActionDetails = { kind: 'blockIdentity', assetId: 'x.0', identityKey: '02aa', priorOutpoint: 'z.0' }
    const blockB: MandalaActionDetails = { kind: 'blockIdentity', assetId: 'x.0', identityKey: '02bb', priorOutpoint: 'z.0' }
    const set = new Set([pause, unpause, blockA, blockB].map(d => MandalaAdmin.commitment(d)))
    expect(set.size).toBe(4)
  })

  it('bankRef participates in the commitment (dropping it changes the key)', () => {
    const withRef: MandalaActionDetails = { kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 5, recipient: '02ab', bankRef: 'BR-1', priorOutpoint: 'z.0' }
    const withoutRef: MandalaActionDetails = { kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 5, recipient: '02ab', priorOutpoint: 'z.0' }
    expect(MandalaAdmin.commitment(withRef)).not.toBe(MandalaAdmin.commitment(withoutRef))
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `cd /Users/personal/git/ts-stack/packages/helpers/ts-templates && npm test -- MandalaAdmin` → FAIL (TypeScript rejects `kind: 'pause'`/`'reissue'`/new fields; type error).

- [ ] **Step 3: Widen the type** — replace the `MandalaActionKind` type and `MandalaActionDetails` interface in `MandalaAdmin.ts`:

```ts
export type MandalaActionKind =
  | 'register' | 'issue' | 'redeem' | 'recover'
  | 'pause' | 'unpause'
  | 'blockIdentity' | 'unblockIdentity'
  | 'allowIdentity' | 'unallowIdentity'
  | 'setAccessMode'
  | 'freezeOutput' | 'unfreezeOutput'
  | 'reissue'

export interface MandalaActionDetails {
  kind: MandalaActionKind
  assetId?: string
  amount?: number
  priorOutpoint?: string
  identityKey?: string
  outpoint?: string
  recipient?: string
  mode?: 'denylist' | 'allowlist'
  bankRef?: string
  [k: string]: unknown
}
```

`canonicalize`/`commitment` need no change — `canon` already recurses over sorted keys and serialises primitives.

- [ ] **Step 4: Run tests** — `npm test -- MandalaAdmin` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/helpers/ts-templates/src/MandalaAdmin.ts packages/helpers/ts-templates/src/__tests/MandalaAdmin.test.ts
git commit -m "feat(templates): extend MandalaAdmin action union with stablecoin control kinds"
```

---

### Task 2: Pure state reducer (`AssetStateReducer`)

**Files:**
- Create: `packages/overlays/topics/src/mandala/AssetStateReducer.ts`
- Test: `packages/overlays/topics/src/mandala/__tests/AssetStateReducer.test.ts`

**Interfaces:**
- Consumes: `MandalaActionDetails` from `@bsv/templates`.
- Produces:
  - `interface FrozenRef { outpoint: string, amount: number, owner: string }`
  - `interface AssetAdminState { assetId, issuerIdentityKey, isPaused, accessMode, blockedIdentities, allowedIdentities, frozenOutpoints: FrozenRef[], evictedOutpoints: string[], lastProcessedHeight, lastProcessedOffset, lastAdmitSeq }`
  - `function defaultAssetState(assetId: string): AssetAdminState`
  - `function foldAction(state, details, ctx?: { frozenAmount?, frozenOwner?, issuer? }): AssetAdminState`

- [ ] **Step 1: Write the failing test**

```ts
// packages/overlays/topics/src/mandala/__tests/AssetStateReducer.test.ts
import { defaultAssetState, foldAction, AssetAdminState } from '../AssetStateReducer'
import { MandalaActionDetails } from '@bsv/templates'

const S = (over: Partial<AssetAdminState> = {}): AssetAdminState => ({ ...defaultAssetState('x.0'), ...over })
const d = (o: Partial<MandalaActionDetails>): MandalaActionDetails => ({ kind: 'pause', assetId: 'x.0', ...o } as MandalaActionDetails)

describe('foldAction', () => {
  it('register sets issuerIdentityKey from ctx', () => {
    const s = foldAction(S(), d({ kind: 'register' }), { issuer: '02issuer' })
    expect(s.issuerIdentityKey).toBe('02issuer')
  })
  it('pause/unpause toggle isPaused', () => {
    expect(foldAction(S(), d({ kind: 'pause' })).isPaused).toBe(true)
    expect(foldAction(S({ isPaused: true }), d({ kind: 'unpause' })).isPaused).toBe(false)
  })
  it('block/unblock identity is idempotent on the denylist', () => {
    let s = foldAction(S(), d({ kind: 'blockIdentity', identityKey: '02aa' }))
    s = foldAction(s, d({ kind: 'blockIdentity', identityKey: '02aa' })) // dup
    expect(s.blockedIdentities).toEqual(['02aa'])
    s = foldAction(s, d({ kind: 'unblockIdentity', identityKey: '02aa' }))
    expect(s.blockedIdentities).toEqual([])
  })
  it('allow/unallow identity targets the allowlist only', () => {
    const s = foldAction(S(), d({ kind: 'allowIdentity', identityKey: '02bb' }))
    expect(s.allowedIdentities).toEqual(['02bb'])
    expect(s.blockedIdentities).toEqual([])
  })
  it('setAccessMode switches mode', () => {
    expect(foldAction(S(), d({ kind: 'setAccessMode', mode: 'allowlist' })).accessMode).toBe('allowlist')
  })
  it('freezeOutput records {outpoint, amount, owner} from ctx; unfreeze removes by outpoint', () => {
    let s = foldAction(S(), d({ kind: 'freezeOutput', outpoint: 'tt.2' }), { frozenAmount: 30, frozenOwner: '02own' })
    expect(s.frozenOutpoints).toEqual([{ outpoint: 'tt.2', amount: 30, owner: '02own' }])
    s = foldAction(s, d({ kind: 'unfreezeOutput', outpoint: 'tt.2' }))
    expect(s.frozenOutpoints).toEqual([])
  })
  it('reissue moves outpoint from frozen to evicted', () => {
    const frozen = S({ frozenOutpoints: [{ outpoint: 'tt.2', amount: 30, owner: '02own' }] })
    const s = foldAction(frozen, d({ kind: 'reissue', outpoint: 'tt.2', amount: 30, recipient: '02new' }))
    expect(s.frozenOutpoints).toEqual([])
    expect(s.evictedOutpoints).toEqual(['tt.2'])
  })
  it('issue/redeem/recover do not change control state', () => {
    const base = S({ isPaused: true })
    for (const kind of ['issue', 'redeem', 'recover'] as const) {
      expect(foldAction(base, d({ kind, amount: 1 }))).toEqual(base)
    }
  })
  it('unknown kind is a no-op', () => {
    const base = S()
    expect(foldAction(base, d({ kind: 'bogus' as any }))).toEqual(base)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `cd /Users/personal/git/ts-stack/packages/overlays/topics && npm test -- AssetStateReducer` → FAIL (module not found).

- [ ] **Step 3: Implement the reducer**

```ts
// packages/overlays/topics/src/mandala/AssetStateReducer.ts
import { MandalaActionDetails } from '@bsv/templates'

export interface FrozenRef { outpoint: string, amount: number, owner: string }

export interface AssetAdminState {
  assetId: string
  issuerIdentityKey: string
  isPaused: boolean
  accessMode: 'denylist' | 'allowlist'
  blockedIdentities: string[]
  allowedIdentities: string[]
  frozenOutpoints: FrozenRef[]
  evictedOutpoints: string[]
  lastProcessedHeight: number
  lastProcessedOffset: number
  lastAdmitSeq: number
}

export interface FoldContext { frozenAmount?: number, frozenOwner?: string, issuer?: string }

export const defaultAssetState = (assetId: string): AssetAdminState => ({
  assetId,
  issuerIdentityKey: '',
  isPaused: false,
  accessMode: 'denylist',
  blockedIdentities: [],
  allowedIdentities: [],
  frozenOutpoints: [],
  evictedOutpoints: [],
  lastProcessedHeight: 0,
  lastProcessedOffset: 0,
  lastAdmitSeq: 0
})

const addUnique = (xs: string[], x: string): string[] => xs.includes(x) ? xs : [...xs, x]
const remove = (xs: string[], x: string): string[] => xs.filter(v => v !== x)

export function foldAction (
  state: AssetAdminState,
  details: MandalaActionDetails,
  ctx: FoldContext = {}
): AssetAdminState {
  const s = { ...state }
  switch (details.kind) {
    case 'register':
      if (typeof ctx.issuer === 'string') s.issuerIdentityKey = ctx.issuer
      return s
    case 'pause': s.isPaused = true; return s
    case 'unpause': s.isPaused = false; return s
    case 'blockIdentity':
      if (typeof details.identityKey === 'string') s.blockedIdentities = addUnique(s.blockedIdentities, details.identityKey)
      return s
    case 'unblockIdentity':
      if (typeof details.identityKey === 'string') s.blockedIdentities = remove(s.blockedIdentities, details.identityKey)
      return s
    case 'allowIdentity':
      if (typeof details.identityKey === 'string') s.allowedIdentities = addUnique(s.allowedIdentities, details.identityKey)
      return s
    case 'unallowIdentity':
      if (typeof details.identityKey === 'string') s.allowedIdentities = remove(s.allowedIdentities, details.identityKey)
      return s
    case 'setAccessMode':
      if (details.mode === 'denylist' || details.mode === 'allowlist') s.accessMode = details.mode
      return s
    case 'freezeOutput':
      if (typeof details.outpoint === 'string') {
        s.frozenOutpoints = [
          ...s.frozenOutpoints.filter(f => f.outpoint !== details.outpoint),
          { outpoint: details.outpoint, amount: ctx.frozenAmount ?? 0, owner: ctx.frozenOwner ?? '' }
        ]
      }
      return s
    case 'unfreezeOutput':
      if (typeof details.outpoint === 'string') s.frozenOutpoints = s.frozenOutpoints.filter(f => f.outpoint !== details.outpoint)
      return s
    case 'reissue':
      if (typeof details.outpoint === 'string') {
        s.frozenOutpoints = s.frozenOutpoints.filter(f => f.outpoint !== details.outpoint)
        s.evictedOutpoints = addUnique(s.evictedOutpoints, details.outpoint)
      }
      return s
    default:
      return s // issue/redeem/recover and unknown kinds: no control-state change
  }
}
```

- [ ] **Step 4: Run tests** — `npm test -- AssetStateReducer` → PASS (10 assertions).

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/overlays/topics/src/mandala/AssetStateReducer.ts packages/overlays/topics/src/mandala/__tests/AssetStateReducer.test.ts
git commit -m "feat(overlay-topics): pure AssetStateReducer for admin control state"
```

---

### Task 3: Storage — `assetState` + `adminHistory` collections

**Files:**
- Modify: `packages/overlays/topics/src/mandala/types.ts` (add `AdminHistoryEntry`, re-export reducer types)
- Modify: `packages/overlays/topics/src/mandala/MandalaStorageManager.ts`
- Test: `packages/overlays/topics/src/mandala/__tests/MandalaStorageManager.test.ts` (extend; uses the existing in-memory Mongo harness already present in that file)

**Interfaces:**
- Consumes: `AssetAdminState`, `FrozenRef` (Task 2).
- Produces on `MandalaStorageManager`:
  - `getAssetState(assetId): Promise<AssetAdminState>` (defaults if absent)
  - `putAssetState(state: AssetAdminState): Promise<void>`
  - `appendAdminHistory(entry: AdminHistoryEntry): Promise<void>`
  - `findAdminHistoryByAssetId(assetId): Promise<AdminHistoryEntry[]>` (sorted by height, offset, admitSeq)
  - `nextAdmitSeq(): Promise<number>` (monotonic counter via a `counters` doc)
  - `findStateByAssetId(assetId): Promise<AssetAdminState[]>` (array form for the lookup formula)
- `AdminHistoryEntry`: `{ assetId, txid, outputIndex, height, offset, admitSeq, actionDetails, createdAt }`

- [ ] **Step 1: Write the failing test** — open `MandalaStorageManager.test.ts`, reuse its existing `Db` setup (`mongodb-memory-server` or the existing mock — match the file's current pattern), and add:

```ts
import { defaultAssetState } from '../AssetStateReducer'

describe('MandalaStorageManager admin state + history', () => {
  it('getAssetState returns defaults when absent, then round-trips putAssetState', async () => {
    const mgr = new MandalaStorageManager(db) // db from the existing harness
    expect(await mgr.getAssetState('x.0')).toEqual(defaultAssetState('x.0'))
    const next = { ...defaultAssetState('x.0'), isPaused: true, blockedIdentities: ['02aa'] }
    await mgr.putAssetState(next)
    expect(await mgr.getAssetState('x.0')).toEqual(next)
  })

  it('nextAdmitSeq is monotonic', async () => {
    const mgr = new MandalaStorageManager(db)
    const a = await mgr.nextAdmitSeq()
    const b = await mgr.nextAdmitSeq()
    expect(b).toBe(a + 1)
  })

  it('admin history is returned ordered by (height, offset, admitSeq)', async () => {
    const mgr = new MandalaStorageManager(db)
    const base = { assetId: 'a.0', outputIndex: 1, actionDetails: { kind: 'pause' as const, assetId: 'a.0' }, createdAt: new Date() }
    await mgr.appendAdminHistory({ ...base, txid: 't3', height: 100, offset: 2, admitSeq: 5 })
    await mgr.appendAdminHistory({ ...base, txid: 't1', height: 100, offset: 1, admitSeq: 9 })
    await mgr.appendAdminHistory({ ...base, txid: 't4', height: Number.MAX_SAFE_INTEGER, offset: 0, admitSeq: 3 })
    await mgr.appendAdminHistory({ ...base, txid: 't2', height: 99, offset: 9, admitSeq: 1 })
    const got = (await mgr.findAdminHistoryByAssetId('a.0')).map(e => e.txid)
    expect(got).toEqual(['t2', 't1', 't3', 't4'])
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npm test -- MandalaStorageManager` → FAIL (methods undefined).

- [ ] **Step 3: Add the types** to `types.ts`:

```ts
import { AssetAdminState } from './AssetStateReducer.js'
export type { AssetAdminState, FrozenRef } from './AssetStateReducer.js'

export interface AdminHistoryEntry {
  assetId: string
  txid: string
  outputIndex: number
  height: number
  offset: number
  admitSeq: number
  actionDetails: MandalaActionDetails
  createdAt: Date
}
```

- [ ] **Step 4: Implement storage methods** — in `MandalaStorageManager.ts` add the collections and methods:

```ts
// add imports
import { AssetAdminState, AdminHistoryEntry } from './types.js'
import { defaultAssetState } from './AssetStateReducer.js'

// in the class: new collections
private readonly assetStates: Collection<AssetAdminState>
private readonly adminHistory: Collection<AdminHistoryEntry>
private readonly counters: Collection<{ _id: string, seq: number }>

// in constructor
this.assetStates = db.collection<AssetAdminState>('mandalaAssetStates')
this.adminHistory = db.collection<AdminHistoryEntry>('mandalaAdminHistory')
this.counters = db.collection<{ _id: string, seq: number }>('mandalaCounters')

// in ensureIndexes Promise.all([...]) add:
this.assetStates.createIndex({ assetId: 1 }, { unique: true }),
this.adminHistory.createIndex({ assetId: 1, height: 1, offset: 1, admitSeq: 1 }),

// new methods
async getAssetState (assetId: string): Promise<AssetAdminState> {
  await this.ensureIndexes()
  const doc = await this.assetStates.findOne({ assetId }, { projection: { _id: 0 } })
  return doc ?? defaultAssetState(assetId)
}

async putAssetState (state: AssetAdminState): Promise<void> {
  await this.ensureIndexes()
  await this.assetStates.updateOne({ assetId: state.assetId }, { $set: state }, { upsert: true })
}

async appendAdminHistory (entry: AdminHistoryEntry): Promise<void> {
  await this.ensureIndexes()
  await this.adminHistory.insertOne(entry)
}

async findAdminHistoryByAssetId (assetId: string): Promise<AdminHistoryEntry[]> {
  await this.ensureIndexes()
  return await this.adminHistory.find({ assetId }, { projection: { _id: 0 } })
    .sort({ height: 1, offset: 1, admitSeq: 1 }).toArray()
}

async nextAdmitSeq (): Promise<number> {
  await this.ensureIndexes()
  const r = await this.counters.findOneAndUpdate(
    { _id: 'admitSeq' }, { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  )
  return (r as { seq: number } | null)?.seq ?? 1
}

async findStateByAssetId (assetId: string): Promise<AssetAdminState[]> {
  const s = await this.getAssetState(assetId)
  return [s]
}
```

Note: `getAssetState` strips `_id`; if `putAssetState` re-reads include `_id`, the round-trip test would fail — the `projection: { _id: 0 }` on read handles it.

- [ ] **Step 5: Run tests** — `npm test -- MandalaStorageManager` → PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/overlays/topics/src/mandala/MandalaStorageManager.ts packages/overlays/topics/src/mandala/types.ts packages/overlays/topics/src/mandala/__tests/MandalaStorageManager.test.ts
git commit -m "feat(overlay-topics): persist AssetAdminState + admin history with ordered reads"
```

---

### Task 4: Ordering helper from a transaction (whole-tx prerequisite)

**Files:**
- Create: `packages/overlays/topics/src/mandala/ordering.ts`
- Test: `packages/overlays/topics/src/mandala/__tests/ordering.test.ts`

**Interfaces:**
- Produces: `function txOrdering(tx: Transaction): { height: number, offset: number }` — reads `tx.merklePath` for block height and this tx's leaf offset; returns `{ height: Number.MAX_SAFE_INTEGER, offset: 0 }` when unconfirmed (no merkle path). Used by the lookup service (Task 5) to stamp admin-history ordering.

- [ ] **Step 1: Write the failing test**

```ts
// packages/overlays/topics/src/mandala/__tests/ordering.test.ts
import { Transaction, MerklePath } from '@bsv/sdk'
import { txOrdering } from '../ordering'

describe('txOrdering', () => {
  it('returns sentinel for an unconfirmed tx (no merkle path)', () => {
    const tx = new Transaction()
    expect(txOrdering(tx)).toEqual({ height: Number.MAX_SAFE_INTEGER, offset: 0 })
  })

  it('reads height and this txid leaf offset from the merkle path', () => {
    const tx = new Transaction()
    const txid = tx.id('hex')
    tx.merklePath = new MerklePath(840000, [[{ offset: 7, hash: txid, txid: true }]])
    expect(txOrdering(tx)).toEqual({ height: 840000, offset: 7 })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npm test -- ordering` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/overlays/topics/src/mandala/ordering.ts
import { Transaction } from '@bsv/sdk'

export function txOrdering (tx: Transaction): { height: number, offset: number } {
  const mp = tx.merklePath
  if (mp == null) return { height: Number.MAX_SAFE_INTEGER, offset: 0 }
  const txid = tx.id('hex')
  const leaf = mp.path[0]?.find(l => l.hash === txid && l.txid === true)
  return { height: mp.blockHeight, offset: leaf?.offset ?? 0 }
}
```

- [ ] **Step 4: Run tests** — `npm test -- ordering` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/overlays/topics/src/mandala/ordering.ts packages/overlays/topics/src/mandala/__tests/ordering.test.ts
git commit -m "feat(overlay-topics): txOrdering helper (merkle-path height + leaf offset)"
```

---

### Task 5: Lookup service — whole-tx mode, admin fold, history, queries, rebuild

**Files:**
- Modify: `packages/overlays/topics/src/mandala/MandalaLookupService.ts`
- Modify: `packages/overlays/topics/src/mandala/MandalaStorageManager.ts` (evicted-aware balance read — see Step 5)
- Test: `packages/overlays/topics/src/mandala/__tests/MandalaLookupService.test.ts` (extend)

**Interfaces:**
- Consumes: `foldAction`, `defaultAssetState`, `AssetAdminState` (Task 2); storage methods (Task 3); `txOrdering` (Task 4); `decodeLinkagePayload` (types.ts).
- Produces: `admissionMode = 'whole-tx'`; new `lookup` queries `{ assetStateAssetId }`, `{ adminHistoryAssetId }`; `rebuildState(assetId): Promise<AssetAdminState>`. `createMandalaLookupService(verifierWallet, storage?)` now accepts an optional shared `MandalaStorageManager`.

- [ ] **Step 1: Write the failing test** — folding admin actions on admit and the new queries. Use the test file's existing payload/tx fixtures; add:

```ts
// in MandalaLookupService.test.ts
import { defaultAssetState } from '../AssetStateReducer'

it('folds a pause admin action into AssetAdminState on admit and serves it via lookup', async () => {
  const storage = new MandalaStorageManager(db)
  const svc = new MandalaLookupService({ storage, verifierWallet })
  const assetId = `${ADMIN_TXID}.0`
  // adminLockingScript + payload built by the test helpers already in this file:
  const payload = encodeLinkagePayload({ inputs: [], outputs: [], admin: [{ index: 0, actionDetails: { kind: 'pause', assetId, priorOutpoint: 'p.0' } }] })
  await svc.outputAdmittedByTopic({
    mode: 'whole-tx', topic: 'tm_mandala', txid: ADMIN_TXID, outputIndex: 0,
    atomicBEEF: ADMIN_TX.toAtomicBEEF(), offChainValues: payload
  } as any)
  const state = (await svc.lookup({ service: 'ls_mandala', query: { assetStateAssetId: assetId } } as any)) as any
  expect(state[0].isPaused).toBe(true)
  const hist = (await svc.lookup({ service: 'ls_mandala', query: { adminHistoryAssetId: assetId } } as any)) as any
  expect(hist).toHaveLength(1)
  expect(hist[0].actionDetails.kind).toBe('pause')
})

it('rebuildState folds history deterministically regardless of insert order', async () => {
  const storage = new MandalaStorageManager(db)
  const svc = new MandalaLookupService({ storage, verifierWallet })
  const assetId = 'r.0'
  const mk = (txid, h, off, kind, extra = {}) => ({ assetId, txid, outputIndex: 0, height: h, offset: off, admitSeq: 0, actionDetails: { kind, assetId, ...extra }, createdAt: new Date() })
  await storage.appendAdminHistory(mk('t2', 101, 0, 'unpause'))
  await storage.appendAdminHistory(mk('t1', 100, 0, 'pause'))
  const state = await svc.rebuildState(assetId)
  expect(state.isPaused).toBe(false) // pause@100 then unpause@101
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npm test -- MandalaLookupService` → FAIL.

- [ ] **Step 3: Switch admission mode + decode from atomicBEEF.** In `MandalaLookupService.ts`:
  - Change `readonly admissionMode: AdmissionMode = 'locking-script'` → `'whole-tx'`.
  - At the top of `outputAdmittedByTopic`, replace the `payload.lockingScript` usage with a decode from the atomic BEEF:

```ts
import { Transaction } from '@bsv/sdk'
import { foldAction, defaultAssetState, AssetAdminState } from './AssetStateReducer.js'
import { txOrdering } from './ordering.js'
import { MandalaAdmin, MandalaToken } from '@bsv/templates'

async outputAdmittedByTopic (payload: OutputAdmittedByTopic): Promise<void> {
  if (payload.mode !== 'whole-tx') return
  if (payload.topic !== 'tm_mandala') return
  const tx = Transaction.fromBEEF((payload as any).atomicBEEF)
  const ls = tx.outputs[payload.outputIndex].lockingScript
  // ... use `ls` everywhere the old code used payload.lockingScript ...
```

- [ ] **Step 4: Add the admin-fold + history path.** After the FT-decode branch (or in the admin branch), when the output decodes as admin and the payload carries this index's actionDetails:

```ts
  // inside outputAdmittedByTopic, admin branch:
  let admin
  try { admin = MandalaAdmin.decode(ls) } catch { admin = null }
  if (admin != null) {
    // existing metadata behaviour (register's publicData) stays:
    if (admin.publicData != null) {
      await this.deps.storage.storeMetadata({ txid: payload.txid, outputIndex: payload.outputIndex, assetId: `${payload.txid}.${payload.outputIndex}` })
    }
    // NEW: fold the action into AssetAdminState + record history
    const parsed = payload.offChainValues != null ? decodeLinkagePayload(payload.offChainValues) : { inputs: [], outputs: [], admin: [] as any[] }
    const entry = (parsed.admin ?? []).find((a: any) => a.index === payload.outputIndex)
    if (entry != null) {
      const details = entry.actionDetails
      const assetId = typeof details.assetId === 'string' && details.assetId !== '' ? details.assetId : `${payload.txid}.${payload.outputIndex}`
      const { height, offset } = txOrdering(tx)
      const admitSeq = await this.deps.storage.nextAdmitSeq()
      await this.deps.storage.appendAdminHistory({ assetId, txid: payload.txid, outputIndex: payload.outputIndex, height, offset, admitSeq, actionDetails: details, createdAt: new Date() })
      // ctx for fold
      const ctx: { frozenAmount?: number, frozenOwner?: string, issuer?: string } = {}
      if (details.kind === 'register' && admin.publicData != null && typeof (admin.publicData as any).issuer === 'string') ctx.issuer = (admin.publicData as any).issuer
      if (details.kind === 'freezeOutput' && typeof details.outpoint === 'string') {
        const [ftxid, fvoutStr] = details.outpoint.split('.')
        const row = await this.deps.storage.getTokenRow(ftxid, Number(fvoutStr))
        if (row != null) { ctx.frozenAmount = row.amount; ctx.frozenOwner = row.identityKey }
      }
      const prev = await this.deps.storage.getAssetState(assetId)
      const next = foldAction(prev, details, ctx)
      next.lastProcessedHeight = height; next.lastProcessedOffset = offset; next.lastAdmitSeq = admitSeq
      await this.deps.storage.putAssetState(next)
    }
    return
  }
```

- [ ] **Step 5: Add `rebuildState` + evicted-aware balances.** In `MandalaLookupService.ts`:

```ts
async rebuildState (assetId: string): Promise<AssetAdminState> {
  const history = await this.deps.storage.findAdminHistoryByAssetId(assetId)
  let state = defaultAssetState(assetId)
  for (const e of history) {
    const ctx: { frozenAmount?: number, frozenOwner?: string, issuer?: string } = {}
    if (e.actionDetails.kind === 'freezeOutput' && typeof e.actionDetails.outpoint === 'string') {
      const [ft, fv] = e.actionDetails.outpoint.split('.')
      const row = await this.deps.storage.getTokenRow(ft, Number(fv))
      if (row != null) { ctx.frozenAmount = row.amount; ctx.frozenOwner = row.identityKey }
    }
    if (e.actionDetails.kind === 'register' && typeof (e.actionDetails as any).issuer === 'string') ctx.issuer = (e.actionDetails as any).issuer
    state = foldAction(state, e.actionDetails, ctx)
  }
  await this.deps.storage.putAssetState(state)
  return state
}
```

In `MandalaStorageManager.ts`, make `findByAssetId` exclude evicted outpoints by reading the asset state first:

```ts
async findByAssetId (assetId: string): Promise<UTXOReference[]> {
  await this.ensureIndexes()
  const state = await this.getAssetState(assetId)
  const evicted = new Set(state.evictedOutpoints)
  const rows = await this.tokens.find({ assetId }).project<UTXOReference>({ txid: 1, outputIndex: 1, _id: 0 }).toArray()
  return rows.filter(r => !evicted.has(`${r.txid}.${r.outputIndex}`))
}
```

- [ ] **Step 6: Add the new lookup queries** in `lookup`:

```ts
if (typeof query.assetStateAssetId === 'string') return await this.deps.storage.findStateByAssetId(query.assetStateAssetId) as unknown as LookupFormula
if (typeof query.adminHistoryAssetId === 'string') return await this.deps.storage.findAdminHistoryByAssetId(query.adminHistoryAssetId) as unknown as LookupFormula
```

- [ ] **Step 7: Update the factory** to accept a shared storage:

```ts
export function createMandalaLookupService (verifierWallet: WalletInterface, storage?: MandalaStorageManager) {
  return (db: Db): MandalaLookupService => new MandalaLookupService({
    storage: storage ?? new MandalaStorageManager(db),
    verifierWallet
  })
}
```

- [ ] **Step 8: Run tests** — `npm test -- MandalaLookupService` → PASS. Also run the whole mandala suite: `npm test -- mandala` → all PASS (FT-indexing tests still green after the atomicBEEF decode change; fix any that referenced `payload.lockingScript` to build a whole-tx payload instead).

- [ ] **Step 9: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/overlays/topics/src/mandala/MandalaLookupService.ts packages/overlays/topics/src/mandala/MandalaStorageManager.ts packages/overlays/topics/src/mandala/__tests/MandalaLookupService.test.ts
git commit -m "feat(overlay-topics): whole-tx admit, admin-state fold, history + state queries, rebuildState"
```

---

### Task 6: Topic manager — control gate + reissue guards

**Files:**
- Modify: `packages/overlays/topics/src/mandala/MandalaTopicManager.ts`
- Test: `packages/overlays/topics/src/mandala/__tests/MandalaTopicManager.test.ts` (extend)

**Interfaces:**
- Consumes: `AssetAdminState`, `getAssetState`/`getTokenRow` via a new `deps.stateStore`.
- Produces: `MandalaTopicManagerDeps` gains `stateStore: { getAssetState(assetId): Promise<AssetAdminState>, getTokenRow(txid, outputIndex): Promise<MandalaTokenRecord | null> }`. New private `controlGate(...)` applied in `identifyAdmissibleOutputs`. `reissue` issuance handled in `verifyAdminOutput`.

- [ ] **Step 1: Write the failing tests** — use a stub `stateStore`:

```ts
// in MandalaTopicManager.test.ts
const stubStore = (state, rows = {}) => ({
  getAssetState: async () => state,
  getTokenRow: async (t, i) => rows[`${t}.${i}`] ?? null
})

it('rejects a peer transfer of a paused asset but admits an admin action', async () => { /* paused state; a transfer tx -> outputsToAdmit=[]; an admin pause tx -> admitted */ })
it('rejects any tx that spends a frozen outpoint (incl. would-be recover/redeem)', async () => { /* input outpoint in frozenOutpoints -> [] */ })
it('denylist rejects a transfer whose recipient is blocked; allowlist rejects a non-listed recipient', async () => { /* */ })
it('admin reissue is exempt from access-mode and mints to a non-allowlisted recipient', async () => { /* allowlist mode, recipient not listed, reissue verified -> admitted */ })
it('reissue rejected unless target outpoint is frozen, amount matches the frozen row, and the tx has zero FT inputs of the asset', async () => { /* three negative cases + one positive */ })
it('a sanctioned identity is rejected even for an admin action', async () => { /* */ })
```

(Write each with the file's existing tx/payload builders; assert on `identifyAdmissibleOutputs(...).outputsToAdmit`.)

- [ ] **Step 2: Run it to confirm it fails** — `npm test -- MandalaTopicManager` → FAIL.

- [ ] **Step 3: Add the dep + control gate.** In `MandalaTopicManager.ts`:

```ts
import { AssetAdminState } from './AssetStateReducer.js'
import { MandalaTokenRecord } from './types.js'

export interface MandalaTopicManagerDeps {
  verifierWallet: WalletInterface
  screeningProvider: ScreeningProvider
  adminWallet: WalletInterface
  adminProtocolID: WalletProtocol
  stateStore: { getAssetState: (assetId: string) => Promise<AssetAdminState>, getTokenRow: (txid: string, outputIndex: number) => Promise<MandalaTokenRecord | null> }
}
```

Add a `controlGate` run after conservation + sanctions, before returning admitted outputs. It needs: the set of assets touched, which assets have a verified admin action (from `classifyOutputs`/`adminDetails`), the admitted FT outputs (recipients), the FT input identity keys (from `payload.inputs` linkage), and the tx inputs' outpoints.

```ts
private async controlGate (
  tx: Transaction,
  admittedFt: AdmittedFt[],
  adminAssetKinds: Map<string, MandalaActionDetails>, // assetId -> the admin action on it, if any
  payload: ReturnType<typeof decodeLinkagePayload>
): Promise<boolean> {
  const assets = new Set<string>(admittedFt.map(f => f.assetId))
  // include assets of spent FT inputs
  for (const ci of tx.inputs) {
    const src = ci.sourceTransaction?.outputs[ci.sourceOutputIndex]
    if (src == null) continue
    try { assets.add(MandalaToken.decode(src.lockingScript).assetId) } catch {}
  }
  const inputOutpoints = tx.inputs.map(i => `${i.sourceTXID ?? i.sourceTransaction?.id('hex') ?? ''}.${i.sourceOutputIndex}`)
  for (const assetId of assets) {
    const state = await this.deps.stateStore.getAssetState(assetId)
    const frozen = new Set([...state.frozenOutpoints.map(f => f.outpoint), ...state.evictedOutpoints])
    // Gate 1: frozen/evicted input spend — applies to ALL txs
    if (inputOutpoints.some(op => frozen.has(op))) return false
    const adminAction = adminAssetKinds.get(assetId)
    const isAdmin = adminAction != null
    // Gate 2: paused — peer transfers only
    if (state.isPaused && !isAdmin) return false
    // Gate 3: access mode — peer transfers only, admin exempt
    if (!isAdmin) {
      const recipients = admittedFt.filter(f => f.assetId === assetId).map(f => f.identityKey)
      const senders: string[] = []
      for (const inp of payload.inputs) {
        try { senders.push((await verifyKeyLinkage(inp.linkage, this.deps.verifierWallet)).identityKey) } catch {}
      }
      const parties = [...recipients, ...senders].filter(k => k !== state.issuerIdentityKey)
      if (state.accessMode === 'denylist') { if (parties.some(k => state.blockedIdentities.includes(k))) return false }
      else { if (parties.some(k => !state.allowedIdentities.includes(k))) return false }
    }
    // reissue guards
    if (adminAction?.kind === 'reissue') {
      const op = adminAction.outpoint as string
      const ref = state.frozenOutpoints.find(f => f.outpoint === op)
      if (ref == null) return false                                   // (a) must be frozen
      if (ref.amount !== adminAction.amount) return false             // (b) amount matches
      const ftInOfAsset = tx.inputs.some(i => { const s = i.sourceTransaction?.outputs[i.sourceOutputIndex]; if (s == null) return false; try { return MandalaToken.decode(s.lockingScript).assetId === assetId } catch { return false } })
      if (ftInOfAsset) return false                                   // (c) zero FT inputs of asset
    }
  }
  return true
}
```

- [ ] **Step 4: Wire `verifyAdminOutput` for reissue issuance** — add to the issuance branch (alongside issue/recover):

```ts
if ((details.kind === 'issue' || details.kind === 'recover' || details.kind === 'reissue') && typeof details.assetId === 'string') {
  return { admitted: true, issuance: { assetId: details.assetId, amount: details.amount ?? 0 } }
}
```

- [ ] **Step 5: Call the gate** in `identifyAdmissibleOutputs` after the sanctions check, building `adminAssetKinds` from the admin payload:

```ts
const adminAssetKinds = new Map<string, MandalaActionDetails>()
for (const a of (payload as any).admin ?? []) { if (typeof a.actionDetails?.assetId === 'string') adminAssetKinds.set(a.actionDetails.assetId, a.actionDetails) }
if (!(await this.controlGate(tx, admittedFt, adminAssetKinds, payload))) {
  return { outputsToAdmit: [], coinsToRetain: [] }
}
```

Keep `anySanctioned` exactly as-is (sanctions stays universal and separate — do NOT fold access-mode into it).

- [ ] **Step 6: Run tests** — `npm test -- MandalaTopicManager` → PASS; then `npm test -- mandala` → all PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/personal/git/ts-stack
git add packages/overlays/topics/src/mandala/MandalaTopicManager.ts packages/overlays/topics/src/mandala/__tests/MandalaTopicManager.test.ts
git commit -m "feat(overlay-topics): control gate (pause/freeze/access-mode/reissue) + reissue issuance"
```

---

### Task 7: Wire shared storage into the demo overlay + publish

**Files:**
- Modify: `/Users/personal/git/demos/mandala/overlay/src/index.ts`
- Modify: `packages/helpers/ts-templates/CHANGELOG.md`, `packages/overlays/topics/CHANGELOG.md`
- Modify: version bumps in both package.json files

**Interfaces:**
- Consumes: `createMandalaLookupService(wallet, storage?)` (Task 5), `MandalaTopicManager` `stateStore` dep (Task 6), `MandalaStorageManager`.

- [ ] **Step 1: Export `MandalaStorageManager`** from the overlay-topics package index (`packages/overlays/topics/src/index.ts`) if not already exported:

```ts
export { MandalaStorageManager } from './mandala/MandalaStorageManager.js'
```

- [ ] **Step 2: Build one shared storage and inject into both services** in the demo `overlay/src/index.ts`. Add a Mongo connection for the shared storage (OverlayExpress also connects, but the topic manager needs a handle now):

```ts
import { MongoClient } from 'mongodb'
import { MandalaStorageManager } from '@bsv/overlay-topics'

// after configureMongo(MONGO_URL):
const mongoClient = new MongoClient(MONGO_URL)
await mongoClient.connect()
const sharedStorage = new MandalaStorageManager(mongoClient.db())

server.configureTopicManager('tm_mandala', new MandalaTopicManager({
  verifierWallet: mandalaWallet,
  screeningProvider: new InMemoryScreeningProvider([]),
  adminWallet: mandalaWallet,
  adminProtocolID: [2, 'mandala admin'] as [2, string],
  stateStore: sharedStorage
}))
server.configureLookupServiceWithMongo('ls_mandala', createMandalaLookupService(mandalaWallet, sharedStorage))
```

(Use the same database name OverlayExpress uses, so both write the same collections. If `mongoClient.db()` defaults differ from OverlayExpress's, pass the explicit db name from `MONGO_URL`.)

- [ ] **Step 3: Verify the overlay builds + boots** — `cd /Users/personal/git/demos/mandala/overlay && docker compose up -d --build` then check logs show `mandala overlay listening`. (No automated test; this is the integration boot.)

- [ ] **Step 4: CHANGELOG + version bump** — add entries to both CHANGELOGs under a new minor version describing the new action kinds + derived-state enforcement; bump `packages/helpers/ts-templates/package.json` and `packages/overlays/topics/package.json` versions (minor bump). Build both: `cd /Users/personal/git/ts-stack && npm run build` (or per-package `npm run build`).

- [ ] **Step 5: Commit + publish**

```bash
cd /Users/personal/git/ts-stack
git add packages/helpers/ts-templates packages/overlays/topics
git commit -m "chore(templates,overlay-topics): bump + changelog for stablecoin admin controls"
# publish per repo convention (e.g. npm publish in each package), then in the demo:
cd /Users/personal/git/demos/mandala/overlay && git add src/index.ts package.json && git commit -m "feat(overlay): inject shared MandalaStorageManager into tm + ls for derived-state enforcement"
```

---

## Self-Review (Phase A)

- **Spec coverage:** A0→Task 4; A1→Task 1; A2/A3 reducer→Task 2; A2 storage→Task 3; A4 rebuild→Task 5; A5 lookup→Task 5; A6 topic manager→Task 6; wiring/publish→Task 7. ✓
- **Placeholder scan:** every code step carries full code; test stubs in Task 6 Step 1 are enumerated cases the implementer fleshes out with the file's existing builders (acceptable — the gate logic they test is fully specified in Step 3). ✓
- **Type consistency:** `AssetAdminState`/`FrozenRef`/`AdminHistoryEntry` defined once (Tasks 2–3) and consumed by 5–6; `foldAction(state, details, ctx)`, `txOrdering(tx)`, `controlGate(...)` signatures consistent across tasks. ✓
- **DRY/YAGNI:** reducer is the single source of fold semantics; the gate reuses `verifyKeyLinkage`/`MandalaToken.decode`; no speculative fields. ✓
