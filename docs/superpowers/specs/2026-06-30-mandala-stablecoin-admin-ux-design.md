# Mandala Stablecoin Admin & UX — Design Spec

**Date:** 2026-06-30
**Branch:** extends `mandala-p2pkh-no-marker`
**Source requirements:** `~/Downloads/Mandala-Stablecoin-Admin-UX-Requirements.md`
**Companion context:** `docs/PROJECT-STATE.md` (current architecture)

> This spec was hardened against an adversarial multi-lens review that read the
> actual `@bsv/overlay@2.1`, `@bsv/templates`, and app source. Findings are
> folded in; the seams that review proved false (height/offset availability,
> enforcement timing, reissue conservation, identity-API shape, history
> data-sources) are now resolved concretely rather than deferred.

## Goal

Turn the Mandala demo into a regulator-friendly **stablecoin issuance platform**:
on-chain admin controls (pause, freeze, block/allow, reissue) enforced by the
overlay, a professional issuer dashboard with a mock banking integration, and a
neobanking-style holder experience. All new admin powers live in the existing
`MandalaAdmin` auth chain — token outputs are untouched.

## Non-Goals / Explicit Decisions

- **No backward compatibility.** New system; pre-existing assets and the old
  action set will never be used. Phase A freely changes template/state shapes
  with no migration path. *(This knowingly overrides Requirements §6's
  "maintain backward compatibility" line — a conscious call, justified by the
  spike nature and the simplest-token north-star.)*
- **North-star preserved.** New controls ride the admin-auth chain only (spend
  prior auth UTXO → produce next). No new on-chain bytes on token outputs, no
  marker. Derived enforcement state lives off-chain in the overlay.
- **No real banking.** The banking/liquidity integration is a **front-end-only
  mock** — no backend, no real Plaid, no persistence beyond wallet + overlay.

## Decisions Locked During Brainstorming (+ review hardening)

1. **Enforcement timing: on admission, with a documented one-submit lag.** The
   overlay folds an admin action into derived state when the (still
   unconfirmed) admin tx is admitted **and indexed**. Because `@bsv/overlay`'s
   Engine runs every `identifyAdmissibleOutputs` (Phase 1, admittance) before
   any `outputAdmittedByTopic` (Phase 3, post-broadcast indexing), an admin
   action admitted in submit *N* gates transfers in submit *N+1* onward — **not**
   the same submit. This is sub-second (next submit), still vastly ahead of
   confirmation (minutes), and honors the "immediate, not confirmation-gated"
   choice. The lookup service is the **single writer** of derived state (no
   dual-writer drift); the topic manager only reads it.
2. **`reissue` = evict-frozen + mint-replacement, off-chain net-zero.** Targets
   an already-frozen outpoint; overlay stops admitting any spend of it and
   authorizes minting an equal amount to the rightful owner. **Net circulating
   supply is unchanged only in the overlay's derived balance view** — it is
   *not* an on-chain conservation invariant (see A6). Eviction is modeled as a
   **query-time filter** (the token row is retained, the outpoint is added to
   `evictedOutpoints`, and balance/holdings queries exclude it) so state is a
   pure function of the folded action history and replays deterministically.
3. **Access mode = two separate lists.** Each asset keeps distinct
   `allowedIdentities` and `blockedIdentities` lists; an `accessMode` flag
   selects which the overlay enforces. New kinds `allowIdentity`/`unallowIdentity`
   manage the allowlist; `blockIdentity`/`unblockIdentity` manage the denylist.
4. **Audit log = chain-derived + a reproducible proof artifact.** A new
   `ls_mandala` query returns the ordered admin-action history per asset; the
   export carries enough to let a third party re-derive and verify each action
   (see B4).
5. **Ordering source: whole-tx admission mode.** `MandalaLookupService` switches
   `admissionMode` to `'whole-tx'` so its callback receives `atomicBEEF`, from
   which block height + in-block leaf offset are parsed (`Transaction.fromBEEF
   (atomicBEEF).merklePath`). This is the only mechanism that delivers the
   requirement's height+offset ordering; the `'locking-script'` mode the service
   uses today does not carry it. (See A4 for the FT-indexing adaptation this
   forces.)
6. **One combined spec, phased A→B→C** with a small shared app prelude.

---

# Phase A — Protocol & Overlay Foundation (`~/git/ts-stack`)

## A0. Admission-mode + ordering spike (gating task — do first)

Before any other Phase A work, prove the ordering data source:

- Switch `MandalaLookupService.admissionMode` from `'locking-script'` to
  `'whole-tx'`. In whole-tx mode the `OutputAdmittedByTopic` payload carries
  `atomicBEEF` (and `outputIndex`) but **not** a `lockingScript` field — so the
  existing FT/admin decode paths must change to `const tx = Transaction.fromBEEF
  (payload.atomicBEEF); const ls = tx.outputs[payload.outputIndex].lockingScript`
  before `MandalaToken.decode` / `MandalaAdmin.decode`.
- From the same `tx`, read ordering: `height = tx.merklePath?.blockHeight ??
  SENTINEL` and `offset = tx.merklePath?.path[0].find(l => l.hash ===
  tx.id('hex'))?.offset ?? 0` (mirrors `Engine.ts` leaf-offset extraction).
  `merklePath` is undefined for still-unconfirmed txs → use `SENTINEL =
  Number.MAX_SAFE_INTEGER` so unconfirmed actions sort after all confirmed ones;
  a monotonic `admitSeq` (storage counter) is the deterministic tiebreak among
  unconfirmed entries.
- Acceptance: a unit/integration test confirming the whole-tx callback yields a
  decodable locking script and a height/offset (or sentinel) for both a
  confirmed and an unconfirmed tx fixture. **The rest of Phase A is gated on
  this passing.**

## A1. New action kinds

Extend `MandalaActionKind` and `MandalaActionDetails` in
`packages/helpers/ts-templates/src/MandalaAdmin.ts`.

```ts
export type MandalaActionKind =
  | 'register' | 'issue' | 'redeem' | 'recover'      // existing
  | 'pause' | 'unpause'
  | 'blockIdentity' | 'unblockIdentity'
  | 'allowIdentity' | 'unallowIdentity'
  | 'setAccessMode'
  | 'freezeOutput' | 'unfreezeOutput'
  | 'reissue'

export interface MandalaActionDetails {
  kind: MandalaActionKind
  assetId?: string          // present on every non-register action
  amount?: number           // issue / redeem / recover / reissue
  priorOutpoint?: string    // the auth UTXO this action spends
  identityKey?: string      // block/unblock/allow/unallow
  outpoint?: string         // freeze/unfreeze/reissue target
  recipient?: string        // reissue: rightful owner identity key
  mode?: 'denylist' | 'allowlist'  // setAccessMode
  bankRef?: string          // banking metadata (see note below)
  [k: string]: unknown
}
```

Field usage per kind:

| kind | required fields (besides `kind`, `priorOutpoint`) |
|---|---|
| `pause` / `unpause` | `assetId` |
| `blockIdentity` / `unblockIdentity` | `assetId`, `identityKey` |
| `allowIdentity` / `unallowIdentity` | `assetId`, `identityKey` |
| `setAccessMode` | `assetId`, `mode` |
| `freezeOutput` / `unfreezeOutput` | `assetId`, `outpoint` |
| `reissue` | `assetId`, `outpoint`, `amount`, `recipient` (optional `bankRef`) |

**`assetId` is always concrete** on per-asset actions. The requirements'
"optional assetId, null = global" is reconciled as a **UX convenience**: a
"global block" builds **one tx with N admin inputs/outputs** (one per asset the
issuer controls), each carrying a `blockIdentity` record naming its own
`assetId`. There is no `assetId: null` in the data model. Global blocks are
**not** aggregated into a first-class rollup; the dashboard fans the same
`identityKey` across the issuer's assets and displays per-asset status (see B2).

**`bankRef` is committed-to and overlay-visible, not secret.** It travels inside
`actionDetails` in the off-chain `admin[]` payload submitted to the overlay
(required: the topic manager re-derives the locking key from
`commitment(canonicalize(details))`, so omitting `bankRef` would break the pkh
match) and in the issuer's wallet-basket `customInstructions`. "Private" means
**only "not in the public on-chain script"** — the overlay operator sees it in
plaintext, and it appears in the audit log (B4).

**`MandalaAdmin.lock` / `unlock`** are already generic over `data`; the only
change is the wider type. **`canonicalize`** recurses over sorted keys and
already serialises arbitrary primitive fields, so the new string/number fields
are covered with no logic change — confirmed by a new round-trip + commitment
test per kind. `keyID = commitment(data)` continues to bind each auth output to
its exact action and parameters.

**App-side mirror (cross-phase note).** The app does **not** import this union;
`app/src/lib/mandala/encoding.ts` re-declares its own `MandalaActionKind` /
`MandalaActionDetails`. A Phase-B prerequisite (B0) replaces those local
declarations with a re-export of the `@bsv/templates` union so the two cannot
drift. `docs/PROJECT-STATE.md` §8's "re-exports MandalaActionDetails" wording is
inaccurate and is corrected as part of the docs update.

## A2. Derived state store

Single source of derived enforcement state, written by the lookup service and
read by the topic manager. Add to `MandalaStorageManager.ts` two collections:

```ts
interface FrozenRef { outpoint: string, amount: number, owner: string }

interface AssetAdminState {
  assetId: string
  issuerIdentityKey: string      // from register publicData.issuer; the key
                                 // exempt from access-mode screening
  isPaused: boolean
  accessMode: 'denylist' | 'allowlist'
  blockedIdentities: string[]
  allowedIdentities: string[]
  frozenOutpoints: FrozenRef[]   // {outpoint, amount, owner} — amount lets the
                                 // topic manager verify reissue net-zero
  evictedOutpoints: string[]     // reissued: excluded from balance/holdings
  lastProcessedHeight: number
  lastProcessedOffset: number
  lastAdmitSeq: number
}
```

`frozenOutpoints` stores `{outpoint, amount, owner}` (not bare strings) so the
topic manager can verify a reissue's amount and so the holder-side frozen-balance
banner (C2) can be computed. Storage methods: `getAssetState(assetId)` (returns
defaults if absent), `putAssetState(state)`, `appendAdminHistory(entry)`,
`findAdminHistoryByAssetId(assetId)` (sorted by `height`, then `offset`, then
`admitSeq`), `findStateByAssetId(assetId)` (lookup-formula form),
`nextAdmitSeq()` (monotonic counter).

**Default state**: `issuerIdentityKey:''`, `isPaused:false`,
`accessMode:'denylist'`, empty lists/arrays. A newly registered asset behaves
normally with no control history. `issuerIdentityKey` is populated when the
register action is folded (its `publicData.issuer`).

**No "other fields as needed"** (Requirements §3 placeholder) are added beyond
the above — no supply cap, no metadata-version — none are needed for the locked
action set.

## A3. Pure state reducer

New file `packages/overlays/topics/src/mandala/AssetStateReducer.ts`. Pure, no
I/O — the unit-testable core:

```ts
export function foldAction(
  state: AssetAdminState,
  details: MandalaActionDetails,
  ctx?: { frozenAmount?: number, frozenOwner?: string, issuer?: string }
): AssetAdminState
```

Semantics (returns new state; idempotent set ops):

- `register` → set `issuerIdentityKey = ctx.issuer` (from publicData). No other
  control change.
- `pause`/`unpause` → toggle `isPaused`.
- `blockIdentity`/`unblockIdentity` → add/remove `identityKey` in
  `blockedIdentities`.
- `allowIdentity`/`unallowIdentity` → add/remove in `allowedIdentities`.
- `setAccessMode` → `accessMode = mode`.
- `freezeOutput` → push `{outpoint, amount: ctx.frozenAmount, owner:
  ctx.frozenOwner}` to `frozenOutpoints`; `unfreezeOutput` → remove by outpoint.
- `reissue` → remove the `FrozenRef` for `outpoint` from `frozenOutpoints` and
  add `outpoint` to `evictedOutpoints`.
- `issue`/`redeem`/`recover` → no control-state change (supply tracked by token
  rows + the evicted filter).

`ctx` supplies the values the reducer can't derive from `details` alone
(`freezeOutput` needs the target row's amount/owner; `register` needs the
issuer). The lookup service supplies `ctx` from storage at fold time; for replay
it is re-derived from the same stored rows. The reducer is total: unknown kind →
state unchanged.

**Per-kind → list mapping (anti-miswire note):** `block*` ⇒ `blockedIdentities`;
`allow*` ⇒ `allowedIdentities`. All four carry the same `identityKey` field; the
kind alone selects the list.

## A4. Ordered bootstrap replay

`MandalaLookupService.rebuildState(assetId)`:

1. `findAdminHistoryByAssetId(assetId)` → entries sorted by
   `(height, offset, admitSeq)`.
2. Fold from default state via `foldAction`, supplying `ctx` from the stored
   token rows referenced by each `freezeOutput`/`register`.
3. `putAssetState` the result.

Because eviction is a **query-time filter** (Decision 2) and balances are derived
by excluding `evictedOutpoints` from token-row sums, **replay reproduces both the
control state and the effective balances purely from the folded history** — no
imperative balance mutations to replay, no desync. Live enforcement does not call
`rebuildState`; it reads the incrementally maintained `AssetAdminState`.
Determinism is guaranteed by the total order `(height, offset, admitSeq)` (offset
from the merkle path per A0) and the pure reducer.

## A5. Lookup-service indexing (`ls_mandala`)

This is **entirely new code** in `outputAdmittedByTopic` — the service currently
inspects only FT decode and admin-with-publicData (metadata); it does not read
`offChainValues.admin` at all today.

After the A0 whole-tx adaptation (decode locking script from `atomicBEEF`):

- If the admitted output decodes as an admin output **and**
  `decodeLinkagePayload(offChainValues).admin` has an entry for this
  `outputIndex`: take its `actionDetails`, `appendAdminHistory({ assetId, txid,
  outputIndex, height, offset, admitSeq: nextAdmitSeq(), actionDetails })`, then
  fold it into the asset state (`getAssetState` → `foldAction(state, details,
  ctx)` → `putAssetState`), advancing `lastProcessedHeight/Offset/AdmitSeq`.
  **`register` is included** (it carries `publicData` *and* an `admin[]`
  actionDetails) so the audit history starts at genesis and `issuerIdentityKey`
  is captured — verify the register path reaches the fold and does not early-return
  after `storeMetadata`.
- `ctx` for the fold: for `freezeOutput`, look up the target outpoint's token
  row for `amount`/`owner`; for `register`, read `publicData.issuer`.
- FT-output indexing (token rows, balances, linkage) is unchanged in intent but
  is rewritten to source the locking script from `atomicBEEF` (A0).
- **Balances exclude evicted/ effective view:** `adjustBalance` and
  `findByAssetId`/balance reads filter out `state.evictedOutpoints`. `reissue`
  itself does **not** delete the evicted token row; it relies on the filter.

`outputSpent`: spending an admin auth output is normal chain progression — **not**
a state reversal; do not undo folded actions. Token-row spend handling unchanged.

`outputEvicted`: unchanged for tokens/metadata (overlay-operator eviction is out
of scope).

New `lookup` queries:

```ts
if (typeof query.assetStateAssetId === 'string')
  return await storage.findStateByAssetId(query.assetStateAssetId)
if (typeof query.adminHistoryAssetId === 'string')
  return await storage.findAdminHistoryByAssetId(query.adminHistoryAssetId)
```

(Existing `metadataAssetId` / `assetId` / `{txid,outputIndex}` queries remain.)

## A6. Topic-manager enforcement (`tm_mandala`)

`MandalaTopicManager` gains a read-only dependency `deps.stateStore` exposing
**both** `getAssetState(assetId)` **and** `getTokenRow(txid, outputIndex)` (the
reissue amount-check needs a per-outpoint amount that `AssetAdminState` does not
carry for arbitrary outpoints). Wiring: the same `MandalaStorageManager` instance
(or a shared db handle) is passed to both services at construction.

In `identifyAdmissibleOutputs`, after the existing gates (admin-pkh verify →
linkage → conservation → sanctions), add a **control gate** per asset touched.
Define a tx as an **issuer admin action for asset X** iff it contains a verified
admin output whose `actionDetails.assetId === X`; otherwise its movement of X is
a **peer transfer**.

For each asset `X` with FT inputs or outputs, load `state = getAssetState(X)`:

1. **Frozen/evicted input spend (applies to ALL txs):** reject if any tx input's
   outpoint ∈ `state.frozenOutpoints` (by `.outpoint`) ∪ `state.evictedOutpoints`.
   **Consequence (documented constraint):** once an outpoint is frozen, the
   issuer's only resolutions are `unfreeze` (then a normal action) or `reissue`
   (evict + mint). `recover`/`redeem` of a frozen coin are blocked by this gate
   because they would *spend* the input — this is by design and matches the
   regulator workflow (you remediate a frozen coin via reissue, not by spending
   it).
2. **Paused (admin actions exempt):** if `state.isPaused` and the tx is a peer
   transfer of X → reject. Admin actions on X remain admitted (so the issuer can
   unpause/reissue/etc.).
3. **Access mode (admin actions exempt):** for **peer transfers only**, collect
   the identity keys of X's FT outputs (recipients, from `admittedFt[]`) **and**
   FT inputs (senders, from `payload.inputs` linkage — see app contract below).
   - `denylist`: reject if any key ∈ `state.blockedIdentities`.
   - `allowlist`: reject if any key ∉ `state.allowedIdentities`.
   `state.issuerIdentityKey` is always treated as authorized. **Admin actions
   (issue/recover/reissue) are exempt from this gate** — their FT recipient may
   legitimately be a blocked/non-allowlisted party (the whole point of reissuing
   a bad actor's frozen coin to a rightful owner, or recovering to a named key).

**App contract for the "from sender" half of gate 3.** The app today always
submits `inputs: []` in the linkage payload, so the overlay has no sender key to
screen. Phase C (C3) changes peer transfers to **reveal input linkage**
(populate `payload.inputs` via `revealLinkage` for each spent FT input, using the
`keyID`/`counterparty` already stored in each input's `customInstructions`). Until
that lands, the from-sender screen has no data; the spec treats input-linkage
reveal as a required C3 work item, not optional.

**`reissue` admission & conservation.** `verifyAdminOutput` returns `issuance`
of `+amount` for `reissue` (as for `issue`), so the minted FT output satisfies
the existing `conservationHolds()` (`out == in + issued`). Additional guards the
manager enforces for `reissue`:

- **(a)** `details.outpoint` ∈ `state.frozenOutpoints`; else reject.
- **(b)** `details.amount === state.frozenOutpoints[outpoint].amount` (verified
  against the stored `FrozenRef.amount`, which is why A2 stores amounts); else
  reject.
- **(c)** the reissue tx has **zero FT inputs of asset X** (enforce `in == 0`,
  do not merely assume it) — otherwise `out == in + amount` would let the issuer
  mint on top of moved inputs and silently inflate supply.

**Conservation is off-chain only (documented, intentional asymmetry).**
`conservationHolds()` sums admitted FT outputs vs token inputs per asset; it has
**no notion of evicted supply**. So a reissue's `+amount` mint inflates the
on-chain FT total by `amount`; "net supply unchanged" holds **only** in the
overlay's derived balance view, where the evicted outpoint is filtered out
(Decision 2 / A5). This depends on the evicted outpoint being permanently
un-admittable by **this** overlay (gate 1). It is **not** an on-chain invariant:
a different overlay, or a re-sync lacking the eviction history, that admitted the
evicted coin's spend would double-count. This trade-off is accepted for the spike
and called out so no one "fixes" gate-1/the off-chain filter and reintroduces the
inflation.

**Screening stays two distinct, non-conflated checks.** Sanctions
(`screeningProvider.isSanctioned`) remain a **universal** gate over *every*
identity key the tx touches — including admin-action parties (you cannot reissue
or recover to a sanctioned key; that is a hard block with no issuer override).
Access mode is a **separate** gate (#3) that applies to **peer transfers only**
and exempts admin actions. Do **not** merge the two into one
`isAuthorizedForAsset` that would apply access-mode screening universally — that
would re-break the admin-action exemption. The access-list logic lives in the
topic manager beside the existing sanctions gate; the `ScreeningProvider`
interface is unchanged (`isSanctioned`).

## A7. Phase A testing

- **Reducer:** one test per kind; idempotent add/remove; `register` sets issuer;
  `freezeOutput` records `{amount,owner}` from ctx; `reissue` frozen→evicted;
  unknown-kind no-op.
- **Canonicalization:** round-trip + commitment stability per new kind incl.
  `bankRef`.
- **Ordered replay:** a shuffled history folds to the same state as sorted order;
  unconfirmed (sentinel height) sorts last; evicted-as-filter yields correct
  balances on rebuild.
- **A0 ordering:** whole-tx callback decodes locking script + yields height/offset
  (confirmed) or sentinel (unconfirmed).
- **Enforcement gates (topic manager, stub stateStore):** frozen/evicted input
  rejected (incl. recover/redeem of a frozen coin); paused rejects transfer but
  admits admin action; denylist/allowlist accept/reject peer transfers and exempt
  admin actions + issuer key; reissue accepts only when frozen + amount matches +
  zero FT inputs, rejects otherwise; conservation still holds for the reissue mint.
- **Lookup queries:** `assetStateAssetId` and `adminHistoryAssetId` shapes;
  register reaches the admin-history fold.

---

# Phase B — Issuer Dashboard (`~/git/demos/mandala/app`)

## B0. App prerequisites (do first in Phase B; some unblock Phase C too)

1. **Union single-source:** replace the local `MandalaActionKind`/
   `MandalaActionDetails` in `app/src/lib/mandala/encoding.ts` with a re-export
   of the `@bsv/templates` union (bump `@bsv/templates`/`@bsv/overlay-topics` to
   the Phase-A-published versions; clear `app/node_modules/.vite` after).
2. **Action labels:** tag **every** mandala-producing `createAction` and the
   receive `internalizeAction` with stable `labels: ['mandala', kind]` (issue,
   redeem, recover, transfer, receive, register + each new admin kind). Required
   so `wallet.listActions({ labels })` can recover history (C3); `listActions`
   has no basket filter and `labels` is mandatory.
3. **Outbound counterparty capture:** on a peer transfer, attach the recipient
   identity key to the **outgoing FT output** via `customInstructions`/`tags`
   (today only the self-change output carries `customInstructions`). Without
   this, sent-side counterparty/contacts/"Pay again" cannot be reconstructed from
   wallet state — required for C3/C4.

## B1. Admin-action builder (lib)

Generalise the issuer-action tx pattern in `app/src/lib/mandala/assets.ts`:

```ts
async function submitAdminAction(params: {
  wallet, asset: AdminAsset, details: MandalaActionDetails,
  ftOutput?: { recipient: string, amount: number },   // reissue only
  messageBoxClient?, identityKey
}): Promise<{ txid: string, nextAuthOutpoint: string }>

async function submitGlobalAdminAction(params: {
  wallet, assets: AdminAsset[], detailsFor: (a: AdminAsset) => MandalaActionDetails,
  identityKey
}): Promise<{ txid: string }>
```

`submitAdminAction`: fetch BEEF for `asset.authOutpoint`; `createAction` with the
prior-auth input + a next-auth output (`MandalaAdmin.lock({ wallet, data: details
})`, with `adminCustomInstructions` + the B0 label) + optional FT output (reissue,
`lockBRC29` to `recipient`); sign the prior-auth input with `MandalaAdmin.unlock
({ wallet, data: asset.authDetails })`; `signAction`; reveal FT linkage when
present; `encodeLinkagePayload({ admin:[{index, actionDetails}], outputs:[...] })`;
`submitToOverlay`; for reissue, message-box the recipient (reuse the recover
handoff). Existing issue/redeem/recover refactor onto this helper.

`submitGlobalAdminAction` takes an explicit `assets: AdminAsset[]` (the
single-asset shape can't address the per-asset fan-out): one `createAction` with
N prior-auth inputs + N next-auth outputs, each input signed with its own
`asset.authDetails`, each output carrying its own `adminCustomInstructions`. Used
for global block/allow.

**Off-wallet targets:** `freezeOutput`/`reissue` reference a holder's FT outpoint
by **string only** in `details.outpoint` — never as a tx input, never a BEEF
fetch (the issuer's wallet can't see it). The reissue amount-check (A6 b) is
performed overlay-side against the stored `FrozenRef`, not the issuer's wallet.

## B2. Dashboard shell + components (`app/src/components/issuer/`)

- `IssuerDashboard.tsx` — shell, asset switcher, section nav; replaces the flat
  `IssuerPanel.tsx` layout.
- `AssetOverview.tsx` — issuer assets with live state badges (paused?, access
  mode, # frozen, # blocked/allowed) via `resolveAssetState(assetId)` (shared
  prelude, below).
- `RegulatoryControls.tsx` — per-asset: pause/unpause; freeze/unfreeze (outpoint
  input or pick from a holder lookup); block/allow identity (identity search);
  set access mode; reissue (frozen outpoint + recipient + amount, prefilled from
  the `FrozenRef`). Each calls a B1 builder. **Footgun guard:** switching
  `accessMode` to `allowlist` while `allowedIdentities` is empty locks out all
  non-issuer transfers — the control must warn and require a non-empty allowlist
  first.
- `BankingMock.tsx` — see B3.
- `AuditLog.tsx` — see B4.
- Register/Issue/Redeem/Recover become dashboard cards (existing logic refactored
  onto B1). **Register adds a `ticker` input** (e.g. `USD`) written into both
  `publicData` and the register `actionDetails` — without it C1's currency symbol
  has no data source (see C1).

## B3. Banking / liquidity mock (front-end only)

`app/src/lib/mandala/banking.ts` holds seeded, in-memory + wallet-derived mock
state (no backend; no `Math.random`/`Date.now` in pure helpers — seed/inject
timestamps so the demo is repeatable). `BankingMock.tsx` (Plaid-sandbox-styled):

- Mock "linked accounts" + a feed of simulated deposits (ACH/wire) with realistic
  shapes (amount, currency, originator, timestamps).
- "Receive deposit" → generate a mock bank TX id/UUID → call `issue` with
  `bankRef = that id` and `amount = deposit`, minting to the issuer treasury.
- **Reconciliation view:** define the identity precisely — *bank balance* (sum of
  deposits net withdrawals) vs *net circulating supply* (`issued − redeemed`, with
  `reissue` net-zero). Redeem reduces supply with no bank-side change, so the view
  models a withdrawal/redemption leg; otherwise it would always flag drift after a
  burn. Flag genuine drift only.

## B4. Audit log + reproducible proof export

`app/src/lib/mandala/adminHistory.ts`: `resolveAdminHistory(assetId)` via
`LookupResolver` `{ adminHistoryAssetId }` → ordered entries. `AuditLog.tsx`
renders each as a human-readable line ("Paused USD", "Blocked 02ab… for USD",
"Reissued $30.00 to 03cd… (bankRef BR-…)") with the on-chain txid shown.

**Proof artifact (satisfies "provable via on-chain signatures and derived
keys").** `exportAdminHistoryCsv(entries)` emits, per row: `txid`, `outputIndex`,
`priorOutpoint`, the **canonical action-details JSON**, the derived
`keyID = commitment(data)`, height/offset, and a human description. The export
header documents the verification recipe: *re-derive `commitment(canonicalize
(actionDetails))` → expected admin pubkey-hash → compare to the on-chain admin
output's `pubKeyHash`; follow `priorOutpoint` to verify the chain order; SPV-verify
each `txid`.* This makes each row independently checkable by a third party.
Print-friendly view reuses the same rows.

## B5. Phase B testing

- `submitAdminAction`/`submitGlobalAdminAction` build correct inputs/outputs per
  kind (fake-wallet unit tests asserting `createAction` args, incl. per-asset
  fan-out authDetails/customInstructions).
- Human-readable description formatting per kind.
- Proof-export shape (headers, canonical JSON, commitment column, escaping,
  ordering) + the documented verification recipe recomputes the pkh.
- Reconciliation math incl. a redeem leg (no false drift).

---

# Shared App Prelude (built before the B/C split, consumed by both)

`app/src/lib/mandala/adminState.ts`: `resolveAssetState(assetId)` via
`LookupResolver` `{ assetStateAssetId }` (memoised, short TTL). Returns the
`AssetAdminState` shape. B2 (`AssetOverview`) and C2 (alert banners) both depend
on it; it is built once here so the "B and C independent" claim holds.

---

# Phase C — Holder Neobanking UX (`~/git/demos/mandala/app`)

## C1. Per-asset accounts

`app/src/components/holder/`:

- `AccountsOverview.tsx` — one card per stablecoin the holder has **held**
  (including assets now at zero balance, discovered from `listActions` history —
  *not* all assets in existence; this is the explicit interpretation of
  "show zero-balance assets"). Currency-formatted balance ($1,245.75 USD) via
  `formatAmount` + a symbol from `currencySymbol(ticker)`.
- `AssetAccount.tsx` — single-asset view: balance header, alert banners (C2),
  Send/Receive/History tabs.

`currencySymbol(ticker)` maps USD/EUR/CHF/GBP → `$/€/CHF/£`, falling back to the
ticker string, then to `label`. **Depends on B2 surfacing `ticker` at
registration** — otherwise every asset falls back to label and the $/€ goal is
unmet.

## C2. Alert banners

`AlertBanners.tsx` reads `resolveAssetState(assetId)` (shared prelude):

- Paused → "Transfers temporarily disabled by the issuer."
- Frozen balance → intersect the holder's FT outpoints (`listOutputs`) with
  `state.frozenOutpoints[].outpoint`, sum the matching decoded amounts →
  "$30.00 of your balance has been frozen. Please contact support to dispute."

## C3. Send / Receive / History

- **Send** (`SendTokens.tsx`): keep identity lookup + return-to-issuer; add a
  **recent contacts** row (from C4) and **"Pay again"** from a history row;
  disable Send when the asset is paused (banner explains). **Reveal input
  linkage** for the spent FT inputs (populate `payload.inputs`) so the overlay can
  screen the sender under access mode (A6 gate 3 contract). Attach recipient
  identity key to the outgoing FT output (B0.3).
- **Receive** (`ReceivePanel.tsx` / `ReceiveTokens.tsx`): show the holder's
  identity key as a **QR code** + copy button alongside the accept/reject list.
  New dependency **`qrcode`** (pure client-side encoder rendering to canvas/SVG,
  no network/CDN); added to `app/package.json`.
- **Transaction history** (`TransactionHistory.tsx`, backed by new
  `app/src/lib/mandala/history.ts`): per asset, derived from `wallet.listActions
  ({ labels: ['mandala', …] })` (B0.2) joined with each action's stored
  `customInstructions` (counterparty/keyID, incl. B0.3 outbound recipient) — **no
  localStorage**. Each row: date/time, sent/received, currency-formatted amount,
  counterparty enriched via `@bsv/identity-react`. `exportTransactionsCsv(rows)`.

**Identity enrichment is scoped to what the API yields.** `resolveByIdentityKey`
returns `DisplayableIdentity` (`name`, `badgeLabel`, `avatarURL`,
`abbreviatedKey`, `identityKey`) — there is **no flat email/X-handle field**.
History/contacts therefore show **name + badge (issuing certifier, e.g. an X or
email cert) + avatar**, not raw email/handle strings. Requirements §5's
"X handle, name, email" is met to the extent the resolver exposes it (name +
certifier badge); raw handle/email are explicitly out of scope unless a specific
certificate-field read is added later.

## C4. Contacts derivation

`app/src/lib/mandala/contacts.ts`: `deriveContacts(history)` → unique
counterparties ordered by recency/frequency, enriched lazily via the identity
client. No separate persistence; recomputed from history. Depends on B0.3 for
outbound counterparties (inbound come from the received action's stored sender).

## C5. Phase C testing

- Currency formatting + `currencySymbol` per ticker (incl. fallbacks).
- Frozen-amount computation (holder outpoints ∩ `frozenOutpoints`).
- History derivation from `listActions` fixtures (sent/received classification,
  counterparty extraction incl. outbound recipient from customInstructions).
- Contacts dedup/ordering.
- CSV export shape.

---

# Cross-Cutting

## Files touched (summary)

**ts-stack:**
- `packages/helpers/ts-templates/src/MandalaAdmin.ts` — action union + fields.
- `packages/overlays/topics/src/mandala/AssetStateReducer.ts` — **new**, pure fold.
- `.../MandalaStorageManager.ts` — `assetState` + `adminHistory` collections,
  `getTokenRow`, `nextAdmitSeq`, evicted-aware balance reads.
- `.../MandalaLookupService.ts` — `admissionMode:'whole-tx'`, atomicBEEF decode,
  admin-fold + history + new queries, `rebuildState`.
- `.../MandalaTopicManager.ts` — control gate, `stateStore` dep (state +
  getTokenRow), reissue guards, generalised screening.
- `.../types.ts` — **no change** (`admin[]` already typed; widened automatically
  by the union change).
- CHANGELOGs both packages; publish; bump app + overlay deps.

**app:**
- `src/lib/mandala/encoding.ts` — re-export the `@bsv/templates` union (B0.1).
- `src/lib/mandala/assets.ts` — `submitAdminAction` + `submitGlobalAdminAction`;
  labels + outbound-counterparty instrumentation of existing actions.
- `src/lib/mandala/adminState.ts` (shared), `adminHistory.ts`, `banking.ts`,
  `history.ts`, `contacts.ts` — **new**.
- `src/components/issuer/*`, `src/components/holder/*` — new.
- Refactor `IssuerPanel.tsx`, `SendTokens.tsx`, `ReceiveTokens.tsx`,
  `TokenWallet.tsx` into the new structure; add input-linkage reveal + labels.
- `package.json` — add `qrcode`.
- `docs/PROJECT-STATE.md` update (incl. fixing the "re-exports MandalaActionDetails"
  wording) + a new stablecoin-admin doc.

## Dependency / sequencing

A → (B0 + shared prelude) → B and C in parallel. A ships as published
`@bsv/templates` + `@bsv/overlay-topics` versions; app/overlay bump to consume
them (clear `.vite` after — PROJECT-STATE §7). B0 and `adminState.ts` land before
the B/C split so neither phase blocks the other.

## Risks (post-hardening)

1. **Whole-tx FT-indexing rewrite (A0).** Switching admission mode changes how
   every decode in the lookup service sources its locking script; A0 is the
   gating task and must pass its test before the rest of A.
2. **One-submit enforcement lag (Decision 1).** Documented and accepted; verify
   the deployed overlay-express processes submits serially (if concurrent, the
   single-writer fold must tolerate concurrent stale reads — paused/blocked do;
   reissue is protected by gate 1 since freeze already took effect earlier).
3. **Off-chain-only reissue conservation (A6).** Accepted trade-off, documented
   so it isn't "fixed" into re-inflation.
4. **Identity enrichment scope (C3).** Raw email/handle not available from the
   resolver; UX shows name + certifier badge.

## Success criteria / E2E

1. Register USD (ticker `USD`, decimals 2) via a banking-mock deposit → issued
   supply reconciles with mock bank balance (incl. a redeem leg without false
   drift).
2. Pause USD → holder transfer rejected with banner (next submit); unpause →
   transfer works.
3. Freeze a holder outpoint → that holder sees the frozen-balance banner; spend
   attempt rejected; the issuer cannot recover/redeem it (only reissue/unfreeze).
4. Block an identity (denylist) → peer transfers to/from it rejected (requires
   input-linkage reveal); switch to allowlist (non-empty) → only allowed
   identities transact; admin reissue to a blocked rightful owner still succeeds.
5. Freeze → reissue to rightful owner → net circulating supply unchanged in the
   overlay view; evicted outpoint permanently unspendable via the overlay.
6. Audit log shows the full ordered history; CSV export's commitment column
   recomputes to the on-chain admin pubKeyHash and each txid SPV-verifies.
7. Holder app: per-asset accounts with $/€ symbols, formatted balances, QR
   receive, tx history with name+badge counterparties + CSV.
