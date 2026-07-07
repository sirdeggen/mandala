# Mandala Token — Project State

> Onboarding doc for an agent picking up new-feature work. Covers what the
> system is, the design north-star, the architecture, how the issuer gates and
> controls transfers, and the API surface (Overlay + app).

_Last updated: 2026-07-07. Branch `master`._

---

## 1. What this is

A working demo of a **regulated fungible token (FT)** on BSV. An *issuer*
registers an asset, mints (issues) units, and retains regulatory powers over
the supply: **redeem** (burn), pause, block/allow identities, **freeze**
outputs and **reissue** from a frozen output (supply-conserving recovery).
Ordinary holders **send** and **receive** units peer-to-peer. Every
state change is a real on-chain BSV transaction; an **overlay service** indexes
and polices admissible transactions; a **message box** carries the
peer-to-peer handoff so a recipient can claim what was sent.

Two repos are in play:

- **`~/git/demos/mandala`** — this repo. The demo: `app/` (Vite + React
  frontend) and `overlay/` (the deployed overlay service instance).
- **`~/git/ts-stack`** — the libraries. `@bsv/templates` (script templates:
  `MandalaToken`, `MandalaAdmin`, encoding helpers) and `@bsv/overlay-topics`
  (the `tm_mandala` topic manager + `ls_mandala` lookup service). Both are
  **published to npm**; the app and overlay consume them as versioned deps.

Current dep floor: `@bsv/templates@^1.9.0`, `@bsv/overlay-topics@^1.5.0`,
`@bsv/overlay@^2.2.0`, `@bsv/sdk@^2.1.6` (both app and overlay pinned to the same templates version —
they MUST agree on assetId encoding, see §7).

---

## 2. Design north-star — "simplest possible token"

The guiding principle (saved memory `mandala-simplest-token-principle`): build
the **bare-minimum** token. Drop any frill that overlays + peer-to-peer
delivery make unnecessary, even where that diverges from a published spec.

Two concrete consequences, both already implemented:

1. **No on-chain identifier/marker prefix.** Earlier designs prefixed scripts
   with a `!` (0x21) marker byte for global indexing. Dropped. Outputs are
   classified **off-chain** by decoding their script shape. This is a
   deliberate divergence from BRC-92.
2. **P2PKH, not P2PK, for admin auth.** The admin-auth output is a plain
   Pay-to-Public-Key-**Hash** with an optional pushed-then-dropped data prefix.

If a new feature tempts you to add on-chain bytes "for indexing" or "for
discovery," check first whether the overlay or the message-box handoff already
covers it. Usually it does.

---

## 3. The two script templates (`@bsv/templates`)

### MandalaToken (the fungible unit)

Locking script (8 chunks), built by `lock(assetId, amount, pubKeyHash)` or
`lockBRC29(assetId, amount, protocolID, keyID, counterparty)`:

```
<assetId (36 bytes)> <amount (scriptNum)> OP_2DROP   ← data, dropped
OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG   ← standard P2PKH
```

- `assetId` on-chain = **36 bytes in outpoint format**: the genesis txid in
  internal/reversed (`tx.hash()`) byte order + 4-byte little-endian vout. The
  string form stays `"<txid>.<vout>"`. (See §7 — this byte order was a recent
  fix so contracts can compare the embedded assetId directly to an outpoint.)
- `amount` is an integer in **base units**; precision/decimals is metadata
  only (§6), never on-chain.
- `MandalaToken.decode(script)` → `{ assetId, amount, pubKeyHash }`, throwing
  unless exactly the 8-chunk shape matches. This is how the overlay and the app
  classify an output as an FT.
- `unlock(privateKey, ...)` signs with a raw key; the app does **not** use this
  path — it uses `walletMandalaUnlock` (§5) so the wallet holds the key.

### MandalaAdmin (the regulatory auth output)

`MandalaAdmin.lock({ wallet, data, counterparty='self', publicData? })`:

- Plain P2PKH (5 chunks). If `publicData` is supplied, prepend
  `<push JSON> OP_DROP` → 7 chunks. The JSON is purely informational (dropped),
  used for asset metadata (§6).
- The locking **key is wallet-derived and bound to the action**:
  `keyID = commitment(data)` where `commitment` = sha256 of a canonical JSON
  encoding of the action details. So a given auth UTXO is cryptographically
  tied to one specific action (`register` / `issue` / `redeem` / etc.).
- `counterparty` defaults to `'self'` (issuer locks to itself). Passing another
  party's identity key would **transfer admin rights** to them (not surfaced in
  the UI yet — a natural feature hook).
- `MandalaAdmin.decode(script)` → `{ pubKeyHash, publicData? }`.
- `MandalaAdmin.unlock({ wallet, data, counterparty })` reproduces the sig via
  `wallet.createSignature` and pushes the `forSelf:true` derived pubkey (BRC-42
  symmetry — see §5 for why `forSelf:true` matters).

`MandalaActionDetails`: `{ kind, assetId?, amount?, priorOutpoint?, identityKey?,
outpoint?, recipient?, mode?, bankRef?, ... }`.

`kind ∈ {register, issue, redeem, pause, unpause, blockIdentity,
unblockIdentity, allowIdentity, unallowIdentity, setAccessMode, freezeOutput,
unfreezeOutput, reissue}`. (`recover` was removed as a kind — recovery is the
guarded `reissue`; legacy on-chain `recover` rows are still described
gracefully by the app.)

Field usage per kind (besides `kind` and `priorOutpoint`):

| kind | fields |
|---|---|
| `pause` / `unpause` | `assetId` |
| `blockIdentity` / `unblockIdentity` | `assetId`, `identityKey` |
| `allowIdentity` / `unallowIdentity` | `assetId`, `identityKey` |
| `setAccessMode` | `assetId`, `mode` (`'denylist'` or `'allowlist'`) |
| `freezeOutput` / `unfreezeOutput` | `assetId`, `outpoint` |
| `reissue` | `assetId`, `outpoint`, `amount`, `recipient` (+ optional `bankRef`) |

`bankRef` (optional on `reissue`) is committed to `commitment(canonicalize
(details))` and therefore appears in the audit log. It is **not** in the public
on-chain script, but the overlay operator sees it in plaintext.

---

## 4. How transfers are gated and controlled by the issuer

This is the regulatory heart of the system. Control is enforced in **two
places**, on-chain script and off-chain overlay policy, working together.

### The admin-auth chain (issuer's spine of control)

The issuer holds a single **live admin-auth UTXO** per asset. Every privileged
action **spends the current auth UTXO and produces the next one** — an unbroken
chain only the issuer can extend, because each auth output is P2PKH-locked to an
action-bound key only the issuer's wallet can derive.

- **Register** creates the genesis output: one P2PKH output that *both* carries
  the public metadata blob *and* is the first link in the auth chain. Its
  outpoint **is** the assetId.
- **Issue** spends the prior auth → outputs `[FT to a holder, next auth]`.
- **Redeem** spends FT inputs + prior auth → outputs `[next auth, FT change?]`.
- **Reissue** spends prior auth → outputs `[FT to the named recipient, next
  auth]`, minting replacement units for a frozen (now evicted) outpoint.

Each action's `priorOutpoint` records which auth UTXO it spent, so the chain is
verifiable.

### Overlay policy (the `tm_mandala` topic manager)

A transaction is only **admitted** to the overlay if it passes, in order
(`MandalaTopicManager.identifyAdmissibleOutputs`):

1. **Admin-output verification** — for each candidate admin output, re-derive
   the expected P2PKH key from the action details (`commitment(details)` +
   `adminWallet.getPublicKey`) and check its hash160 equals the on-chain
   `pubKeyHash`, **and** that `priorOutpoint` was actually spent by this tx.
   Only the genuine issuer can produce a matching key. `register` is exempt
   from the prior-outpoint check.
2. **Authorized issuance accounting** — `issue`/`reissue` credit
   `+amount` to that asset's authorized supply delta; `redeem` credits
   `-amount` (so partial burns satisfy conservation).
3. **FT key-linkage verification** — each FT output must carry a valid
   off-chain key-linkage proof binding it to a controlling identity key
   (`verifyKeyLinkage` against the verifier wallet).
4. **Conservation** — per asset: `out == in + authorizedIssuance`. A plain
   peer transfer has zero issuance, so outputs must exactly equal inputs.
   Minting only balances because the issuer's authorized `+amount` is present.
   This is what stops anyone from fabricating units.
5. **Sanctions screening** — every identity key touching the tx (FT outputs +
   linkage inputs) is run through a `ScreeningProvider.isSanctioned`. Any hit →
   whole tx rejected.

If any gate fails, the manager returns `{ outputsToAdmit: [], coinsToRetain:
[] }` and the app's `submitToOverlay` throws `overlay rejected the
transaction`.

### Derived `AssetAdminState` and control gates

In addition to the five base gates above, the topic manager reads a derived
`AssetAdminState` per asset from the overlay's state store. The lookup service is
the **single writer** of this state (no dual-writer drift); the topic manager only
reads it. The state is maintained incrementally as admin actions are admitted and
indexed, and can be deterministically rebuilt from scratch via `rebuildState`
(ordered replay — see §9).

`AssetAdminState` fields:

```ts
{
  assetId, issuerIdentityKey,
  isPaused: boolean,
  accessMode: 'denylist' | 'allowlist',
  blockedIdentities: string[],
  allowedIdentities: string[],
  frozenOutpoints: Array<{ outpoint, amount, owner }>,
  evictedOutpoints: string[]
}
```

Three additional control gates, applied per asset X for each admitted tx:

**Gate 1 — Frozen/evicted input spend (applies to ALL txs):** reject if any FT
input's outpoint is in `frozenOutpoints` or `evictedOutpoints`. This is
universal — no admin exemption. Consequence: once an outpoint is frozen, the
only valid resolutions are `unfreezeOutput` (then a normal action) or `reissue`
(evict + mint replacement). `recover` and `redeem` of a frozen coin are blocked
by Gate 1 because they spend the input — this is by design (remediate via
reissue, not by spending the frozen coin).

**Gate 2 — Paused (admin actions exempt):** if `isPaused` and the tx is a peer
transfer of X, reject. Admin actions on X remain admitted (the issuer can still
unpause, reissue, etc.).

**Gate 3 — Access mode (peer transfers only, admin exempt):** collect the
identity keys of X's FT input senders (from input linkage) and output recipients.
`denylist`: reject if any key is in `blockedIdentities`. `allowlist`: reject if
any key is not in `allowedIdentities`. `issuerIdentityKey` is always authorized
(exempt from this gate). Admin-issued actions (`issue`/`recover`/`reissue`) are
exempt — the FT recipient may legitimately be a blocked/non-allowlisted party
(e.g. reissuing a frozen coin to its rightful owner). Admin exemption is only
operative when there is a **verified** admin output in the same tx; it is not
self-declared.

**Sanctions screening is a separate, universal gate** (the existing
`screeningProvider.isSanctioned` check). It applies to all txs including admin
actions — you cannot reissue or recover to a sanctioned key. Do not conflate it
with the access-mode gate; they are distinct checks.

**`reissue` additional guards:** (a) `details.outpoint` must be in
`frozenOutpoints`; (b) `details.amount` must equal the stored `FrozenRef.amount`
(the amount was recorded when the output was frozen); (c) the reissue tx must
have zero FT inputs of asset X (`in == 0`) to prevent minting on top of moved
inputs. Conservation holds via the `+amount` authorized issuance, same as
`issue`.

**One-submit enforcement lag.** The overlay folds an admin action into derived
state when the tx is admitted *and indexed* (Phase 3, post-broadcast). Because
`@bsv/overlay`'s Engine runs `identifyAdmissibleOutputs` (Phase 1) before any
`outputAdmittedByTopic` (Phase 3), an admin action admitted in submit *N* gates
transfers from submit *N+1* onward — not the same submit. This is sub-second
(next submit), still well ahead of confirmation, and is the expected behavior.

**Off-chain-only reissue conservation.** A reissue's `+amount` mint increases
on-chain FT token count by `amount`; "net supply unchanged" holds only in the
overlay's derived balance view, where the evicted outpoint is excluded as a
query-time filter. This is not an on-chain invariant: a different overlay that
admitted the evicted coin's spend would double-count. This trade-off is
intentional and must not be "fixed" (doing so would re-introduce inflation).

> So: the **script** ensures only the issuer can extend the auth chain and only
> a key-holder can spend an FT; the **overlay** ensures supply conservation,
> issuer-authorized minting, valid linkage, sanctions compliance, and (via derived
> state) pause/freeze/access-mode controls before any output is recognized. A
> transfer the overlay won't admit is effectively invisible to other holders, even
> if it lands on-chain.

---

## 5. Key derivation — the subtle part (BRC-42/43)

A recurring source of bugs. The rule that now holds throughout:

- A locker calls `getPublicKey({ protocolID, keyID, counterparty })` with the
  **default `forSelf:false`** (the standard BRC-29 counterparty-child key).
- The spender signs with `createSignature` (= `derivePrivateKey(counterparty)`)
  and must push the matching pubkey, which is the **`forSelf:true`**
  derivation. By BRC-42 symmetry these are the same point, so OP_CHECKSIG
  passes — including across parties (tokens locked *to* you by a sender).

`walletMandalaUnlock` (`app/src/lib/mandala/unlock.ts`) and
`MandalaAdmin.unlock` both push the **`forSelf:true`** pubkey. This is the fix
that let recipients spend received tokens (commit `c129589`). If you touch
unlock paths, preserve `forSelf:true`.

One more gotcha: for self-mint / self-change, pass the issuer's **identity key
(hex)** as `counterparty`, **not** the literal string `'self'`. The revealed
linkage echoes `counterparty` verbatim and the overlay parses it as a public
key — `'self'` would crash `PublicKey.fromString`.

---

## 6. On-chain asset metadata (label / decimals / issuer)

Registration bakes a JSON blob into the genesis output via
`MandalaAdmin.lock({ publicData })`:

```json
{ "label": "Gold Coin", "decimals": 2, "issuer": "<issuer identityKey hex>" }
```

- It's pushed-then-`OP_DROP`ped — informational only, no spend effect.
- The overlay's `ls_mandala` lookup indexes admin outputs that carry
  `publicData`, keyed by their own outpoint (= assetId). Crucially, this
  metadata record **survives the genesis output being spent** (issue spends it)
  — only **eviction** clears it (`outputEvicted`). So label/decimals/issuer stay
  resolvable forever.
- A non-issuing holder resolves metadata by assetId via
  `resolveAssetMetadata(assetId)` (`app/src/lib/mandala/metadata.ts`): query
  `ls_mandala` for `{ metadataAssetId }`, **SPV-verify** the returned genesis tx
  (`Transaction.verify(new WhatsOnChain('main'))`), then decode `publicData`.
  Memoized.
- `decimals` is display precision only. `parseAmount`/`formatAmount`
  (`app/src/lib/mandala/amount.ts`) convert between display strings and integer
  base units at the UI boundary; on-chain amounts are always base-unit integers.
- `issuer` powers the **"Return to issuer"** button in the Send tab: when the
  resolved metadata for the selected asset has an `issuer`, a shortcut prefills
  the recipient with that identity key (recipient-side only).

---

## 7. assetId byte order (recent breaking change — be aware)

`encodeAssetId` writes the txid in **outpoint (internal/reversed, `tx.hash()`)
byte order** + 4-byte LE vout; `decodeAssetId` reverses it back. The display
string `"<txid>.<vout>"` is unchanged. Purpose: a smart contract can compare a
token's embedded assetId directly against the genesis transaction's outpoint as
it appears in the tx. **Tokens minted under the old (non-reversed) encoding will
not decode to the same assetId** — app and overlay must run the same templates
version. This shipped as `@bsv/templates@1.7.2` (ts-stack PR #252, merged).
Documented in the templates CHANGELOG.

Operational note: a stale Vite dep pre-bundle cache (`app/node_modules/.vite`)
can silently serve an old templates version after a dep bump, causing an
encoding mismatch → conservation failure → `overlay rejected`. Fix:
`rm -rf app/node_modules/.vite` and restart the dev server after any
`@bsv/templates` bump.

---

## 8. Application structure (`app/`)

React + Vite. Wallet access via `WalletContext` (`wallet`, `messageBoxClient`,
`identityKey`). User-facing surfaces are split into issuer and holder sides.

**Issuer surfaces (`app/src/components/issuer/`):**

| Component | Role |
|---|---|
| `IssuerDashboard.tsx` | Shell with sidebar nav: Overview / Treasury / Operations / Activity / Banking. Section in the path (`/issuer/:section`), asset in `?asset=`. The top bar holds the asset switcher and (on Overview) the register-asset strip. |
| `OverviewSection.tsx` | KPI tiles (in circulation, net issued, reserve ratio, restrictions) from the overlay's aggregated admin summary + `resolveAssetState`; embeds the audit log. |
| `RegisterAssetStrip.tsx` | Compact "Register a new asset" strip (label/ticker/decimals) rendered in the dashboard top bar on Overview. |
| `TreasurySection.tsx` | Issuer's own holdings of the asset: balance card + Send/Receive tabs (reuses the holder flows, asset-locked). |
| `IssuerPanel.tsx` | Issue + Redeem (burn) cards — the top of the Operations section. |
| `RegulatoryControls.tsx` | Per-asset: pause/unpause; freeze/unfreeze output; block/allow identity; set access mode; reissue from frozen output. Rest of Operations. |
| `OverlayActivity.tsx` | Overlay-wide transaction feed (the Activity section): semantic per-tx summaries (issue / transfer A→B / self / redeem) with linkage-proof badges; cursor-paginated + virtualized. |
| `BankingMock.tsx` | Simulated per-asset bank feed: add incoming/outgoing transfers (localStorage-persisted, per-row delete), reconciliation view (bank balance vs net supply via the admin summary). |
| `AuditLog.tsx` | Ordered admin-action history per asset — paged newest-first, virtualized rows, full-history CSV export. |

**Holder surfaces (`app/src/components/holder/`):**

| Component | Role |
|---|---|
| `AccountsOverview.tsx` | One card per stablecoin ever held (including zero-balance assets discovered from action history); currency-formatted balance (`$1,245.75`). |
| `AssetAccount.tsx` | Single-asset view: balance header, alert banners (paused/frozen), Send/Receive/History tabs. |
| `AlertBanners.tsx` | Paused and frozen-balance alert banners, driven by `resolveAssetState`. |
| `ReceivePanel.tsx` | Identity key as QR code + copy button; accept/reject incoming tokens. |
| `TransactionHistory.tsx` | Per-asset tx history with currency-formatted amounts, enriched counterparties, and CSV export. |
| `SendTokens.tsx` | Holder→holder transfer; identity search; "Return to issuer"; recent contacts; "Pay again". |
| `ReceiveTokens.tsx` | Accept/reject incoming tokens from the message box. |
| `TokenWallet.tsx` | Balance display (legacy entry point). |

### Library layer (`app/src/lib/mandala/`)

- `constants.ts` — `TOPIC=tm_mandala`, `LOOKUP=ls_mandala`,
  `FT_PROTOCOL=[2,'mandala token']`, `ADMIN_PROTOCOL=[2,'mandala admin']`,
  `BASKET=mandala-tokens`, `MESSAGEBOX=mandala-payments`, plus
  `OVERLAY_URL` / `OVERLAY_IDENTITY_KEY` / `MESSAGEBOX_URL` from env.
- `assets.ts` — the issuer's admin-auth bookkeeping. **The wallet basket is the
  single source of truth** (no localStorage). Each admin UTXO's
  `customInstructions` carries `{ type, assetId, label, authDetails, metadata }`
  (`adminCustomInstructions`). `listAdminAssets(wallet)` reconstructs the
  issuer's live assets straight from basket outputs. The genesis output stores
  an empty assetId (it *is* its own outpoint) and resolves to its outpoint on
  read. `submitAdminAction` is the unified builder for all admin action kinds
  (pause/unpause, freeze/unfreeze, block/allow, setAccessMode, reissue);
  `submitGlobalAdminAction` fans a single action (e.g. `blockIdentity`) across
  all of the issuer's assets in one tx.
- `adminState.ts` — `resolveAssetState(assetId)`: fetches
  `GET /admin/asset-state/:assetId` from the overlay and returns
  `AssetAdminStateView` (memoized, 10 s TTL). Shared by issuer and holder
  components.
- `adminHistory.ts` — `resolveAdminHistory(assetId)` (full history, for CSV
  export), `resolveAdminHistoryPage(assetId, {limit, offset})` (paged,
  newest-first — drives the audit log), `resolveAdminSummary(assetId)`
  (aggregated `totalIssued`/`totalRedeemed` — drives KPIs + reconciliation).
  `describeAction(details)` formats each action kind into a human-readable
  string. `exportAdminHistoryCsv(rows)` emits per row: `txid`, `outputIndex`,
  `priorOutpoint`, `kind`, `canonicalDetailsJson`, `commitment`, `height`,
  `offset`, `description`.
- `overlayActivity.ts` — client for `GET /admin/activity`: cursor-paged
  semantic per-tx summaries (`{txid, when, assetId, kind, from, to, amount,
  proofs}`); `flattenActivityPages` dedupes boundary tx groups re-served by
  the inclusive cursor.
- `banking.ts` + `mockBankStore.ts` — simulated per-asset bank feed:
  `makeTransfer(amount, direction, assetId)` builds a synthetic transfer
  ("Company {letter}" counterparty); the store persists to localStorage and
  is shared (useSyncExternalStore) between the Banking page and the Overview
  reserve-ratio KPI. `reconcile` compares bank balance vs net supply.
- `history.ts` — `parseActionsToHistory(actions)` (pure, testable): classifies
  wallet `listActions` results into `HistoryRow[]` (direction: sent/received/
  issued/redeemed/admin). `loadHistory(wallet, assetId?)` calls the wallet.
  `exportTransactionsCsv(rows)`.
- `contacts.ts` — `deriveContacts(history)`: unique counterparties ordered by
  recency/frequency from history rows; no separate persistence.
- `qr.ts` — `toQrDataUrl(text)`: client-side QR code rendering via the `qrcode`
  package (no CDN).
- `metadata.ts` — `parseMetadataFromBeef` (pure decode) +
  `resolveAssetMetadata` (overlay lookup → SPV → decode, memoized).
- `amount.ts` — `formatAmount` / `formatAmountPlain` / `parseAmount` /
  `formatCurrency` (applies `currencySymbol(ticker)` for $/€/£/CHF display).
- `unlock.ts` — `walletMandalaUnlock` (wallet-signed FT spend, `forSelf:true`).
- `overlay.ts` — `submitToOverlay(beef, offChainValues?)` →
  `HTTPSOverlayBroadcastFacilitator.send`, throws on empty admit.
- `encoding.ts` — `encodeLinkagePayload`; **re-exports** `MandalaActionKind` and
  `MandalaActionDetails` from `@bsv/templates` (previously this file re-declared
  its own local copies — as of this branch it is a clean re-export, eliminating
  any risk of drift between the app and the package).
- `tokens.ts` — `outpoint(txid, vout)`, `revealLinkage(wallet, keyID, cp)`.

### `listOutputs` include-mode gotcha

`include: 'locking scripts'` attaches per-output `lockingScript` (+ optional
`customInstructions`) but **no BEEF**. `include: 'entire transactions'`
attaches BEEF but **no lockingScript**. FT selection + spend therefore issues
**two queries** and lines them up by outpoint. Don't try to collapse them.

### Transaction-building pattern (all four issuer actions + send)

1. `createAction` with inputs/outputs. Issuer actions keep
   `randomizeOutputs:false` (fixed output layout, linkage indices hardcoded).
   The holder **send** path lets the wallet randomize output order and recovers
   the final indices by matching locking-script hex (`matchOutputIndices` in
   `tokens.ts`) — unique keyIDs make every planned script byte-unique.
2. Sign the signable tx by attaching `unlockingScriptTemplate`s and `.sign()`.
3. `signAction({ reference, spends })`.
4. **Use `signed.txid` / `reg.txid`** for the txid — never
   `Transaction.fromBEEF(...).id()`, which can return the wrong tx from an
   AtomicBEEF bundle.
5. `revealLinkage` for FT outputs → `encodeLinkagePayload({ inputs, outputs,
   admin })` → `submitToOverlay`. Every FT output needs its own linkage entry
   (an unlinked FT output is skipped by the overlay, which then fails per-asset
   conservation and rejects the whole tx).
6. For peer delivery, `messageBoxClient.sendMessage` with the tx + keyID +
   protocolID + `outputIndex` (where the shuffle put the recipient's output) so
   the recipient can `internalizeAction` (basket insertion) on accept. Missing
   `outputIndex` is read as 0 (legacy messages, issuer reissue).

### Token change splitting (`ftChange.ts`)

Send change is split across multiple outputs, mirroring the wallet-toolbox
satoshi change strategy (`generateChangeSdk`) in token units per assetId:
output count targets net growth of the per-asset UTXO pool toward
`DESIRED_FT_UTXOS` (32), capped at `MAX_FT_CHANGE_OUTPUTS` (8) per tx; each
output seeds at 1 unit and the surplus is scattered in random 25–50% slices
onto random outputs. Combined with randomized output order this makes change
indistinguishable from the recipient output. Each change output gets its own
keyID (`change-<stamp>-<i>`) and full-`sentAmount` customInstructions (history
reads the first change CI it finds).

---

## 9. Overlay API (`@bsv/overlay-topics`, deployed in `overlay/`)

### Topic manager — `tm_mandala`

`identifyAdmissibleOutputs(beef, previousCoins, offChainValues?)` →
`{ outputsToAdmit, coinsToRetain }`. Logic = the five base gates + three control
gates in §4. Deps: `{ verifierWallet, screeningProvider, adminWallet,
adminProtocolID, stateStore }` (`stateStore` is the `MandalaStorageManager`
instance, shared with `ls_mandala`; provides both `getAssetState` and
`getTokenRow` for the reissue amount check).

### Lookup service — `ls_mandala`

Indexes admitted outputs into Mongo (`MandalaStorageManager`). Runs in
`admissionMode:'whole-tx'` so each `outputAdmittedByTopic` callback carries
`atomicBEEF`; locking scripts are decoded from `Transaction.fromBEEF(atomicBEEF)
.outputs[outputIndex].lockingScript`. Block height and in-block offset are
sourced from the tx's merkle path (`tx.merklePath?.blockHeight`,
`tx.merklePath?.path[0][…].offset`) — sentinel `Number.MAX_SAFE_INTEGER` for
unconfirmed txs; a monotonic `admitSeq` counter is the deterministic tiebreak.

`outputAdmittedByTopic` additionally folds admin actions into derived state:
when an admin output is admitted and `offChainValues.admin[outputIndex]` carries
`actionDetails`, the service appends an `AdminHistoryRow`, calls `foldAction`
(the pure state reducer), and persists the updated `AssetAdminState`.

Query forms via `lookup({ query })`:

- `{ metadataAssetId }` → genesis metadata record(s) for that assetId (§6).
- `{ assetId }` → token outputs for an asset.
- `{ txid, outputIndex }` → a specific outpoint.
- `{ assetStateAssetId }` → the derived `AssetAdminState` for that asset.
- `{ adminHistoryAssetId }` → ordered `AdminHistoryRow[]` for that asset,
  sorted by `(height, offset, admitSeq)`.

Notes:
- `outputAdmittedByTopic` stores FTs (with identity key from linkage) and,
  separately, admin outputs carrying `publicData` as metadata. Balance reads
  exclude `evictedOutpoints` as a query-time filter (reissued coins are
  retained in the row store; the filter makes them invisible to balance queries).
- `outputSpent` removes a token row and decrements its identity balance but
  **does not** delete metadata or undo folded admin state.
- `outputEvicted` deletes both token and metadata (admin override).
- **No public identity→balance query is exposed** (privacy; see service
  `shortDescription`).

**`rebuildState(assetId)`** deterministically replays the ordered
`AdminHistoryRow[]` via `foldAction` from default state to re-derive
`AssetAdminState`. Used for disaster recovery or re-sync; live enforcement reads
the incrementally maintained state.

### Custom read endpoints (demo overlay `overlay/src/index.ts`)

`@bsv/overlay`'s `LookupAnswer` type returns an output list only — it cannot
carry arbitrary derived state. The demo overlay therefore registers two custom
Express endpoints directly on `server.app`:

- `GET /admin/asset-state/:assetId` → `sharedStorage.getAssetState(assetId)` →
  JSON `AssetAdminStateView`. Used by `resolveAssetState` (app-side).
- `GET /admin/admin-history/:assetId` → `sharedStorage.findAdminHistoryByAssetId
  (assetId)` → JSON `AdminHistoryRow[]` (full — used for CSV export).
- `GET /admin/admin-history-page/:assetId?limit=&offset=` → paged
  newest-first (by `admitSeq`) `AdminHistoryRow[]`. Drives the audit log UI.
- `GET /admin/admin-summary/:assetId` → mongo aggregation over admin history:
  `{ totalIssued, totalRedeemed, actionCount }` (`issue`/`redeem` only —
  `reissue` conserves supply). Drives Overview KPIs + Banking reconciliation
  without shipping the history to the client.
- `GET /admin/activity?assetId=&limit=&before=` → the operator-oversight
  transaction feed (`overlay/src/activity.ts`): groups the append-only
  `mandalaLinkageRecords` by txid, decodes amounts from the engine's raw-tx
  store, walks inputs back to their linkage-proven source outputs to identify
  the sender, and classifies each tx by token conservation (`issue` /
  `transfer` / `self` / `redeem`). Cursor-paginated (`limit` clamped 1–500,
  inclusive `before` cursor; boundary-straddling tx groups are dropped whole
  and re-served complete — clients dedupe by txid). Boot creates the
  supporting indexes (`linkage.createdAt`, `adminHistory.(assetId,
  admitSeq)`).

Both set `Access-Control-Allow-Origin: *` for local dev. These endpoints exist
because the standard `ls_mandala` lookup path cannot return shaped objects — not
because the data is outside the overlay; it is stored in the same
`MandalaStorageManager` Mongo instance.

### App-side resolver wiring

`LookupResolver({ networkPreset:'mainnet', hostOverrides:{ ls_mandala:
[OVERLAY_URL] } })`. The overlay instance runs with GASP sync **disabled**
(`configureEnableGASPSync(false)`), `NETWORK=main`, behind an ngrok URL set in
`app/.env` (`VITE_OVERLAY_URL`).

Admin state and history are fetched directly via `fetch(OVERLAY_URL + '/admin/…')`
in `adminState.ts` and `adminHistory.ts` (not via `LookupResolver`).

---

## 10. End-to-end flow (happy path)

1. **Register** (issuer): one tx, one genesis output (metadata + first auth).
   assetId = `genesisTxid.0`.
2. **Issue** (issuer): spend genesis auth → `[FT to self, next auth]`; submit;
   FT now in issuer's basket.
3. **Send** (holder): select FT inputs; outputs = FT to recipient + N split
   change outputs (ftChange.ts), order randomized by the wallet; submit to
   overlay; notify recipient via message box (body carries `outputIndex`).
4. **Receive** (recipient): list message-box messages, `internalizeAction`
   (basket insertion) on accept, acknowledge the message. Label resolved by
   SPV.
5. **Redeem** (issuer): burn units (negative issuance keeps conservation).
6. **Freeze → Reissue** (issuer): freeze a holder's outpoint, then reissue
   replacement units to the rightful identity key (frozen coin evicted,
   supply conserved); notify the recipient via message box.

---

## 11. State of the repo / open threads

- On `master`. Package versions: `@bsv/templates@^1.9.0`,
  `@bsv/overlay-topics@^1.5.0`, `@bsv/overlay@^2.2.0`.
- Issuer console restructured into Overview / Treasury / Operations /
  Activity / Banking; registration lives in the Overview top bar; the
  standalone Regulatory page merged into Operations.
- **Activity feed shipped** (overlay `/admin/activity` + app page): overlay-wide
  per-tx summaries with linkage-proven counterparties — the operator-oversight
  showcase.
- **Scale pass shipped**: cursor/offset pagination on activity + admin history,
  server-side supply aggregation for KPIs, boot-time mongo indexes, and
  virtualized infinite-scroll tables (`@tanstack/react-virtual`) — UI stays
  snappy at thousands of transactions.
- Phase A (new action kinds, `AssetAdminState`, state reducer, ordered replay,
  lookup-service admin fold, topic-manager control gates) is shipped in
  `@bsv/overlay-topics@1.4.0` / `@bsv/templates@1.8.0`.
- Phase B (issuer dashboard: asset overview, regulatory controls, banking mock,
  audit log + CSV) and Phase C (holder neobanking: accounts overview, per-asset
  accounts, alert banners, QR receive, tx history, contacts) are implemented in
  `app/`.
- `encoding.ts` now re-exports (not re-declares) the `MandalaActionKind` /
  `MandalaActionDetails` union from `@bsv/templates`.
- Natural next-feature hooks: **admin-rights transfer** (the `counterparty`
  parameter on `MandalaAdmin.lock` already supports handing the auth chain to
  another party — no UI yet); `submitGlobalAdminAction` for cross-asset
  block/allow is in `assets.ts` but not yet wired to a UI control; richer
  metadata (ticker is surfaced via `publicData` and used for $/€ display).

---

## 12. Quick reference

| Thing | Value |
|---|---|
| Topic | `tm_mandala` |
| Lookup service | `ls_mandala` |
| FT protocol | `[2, 'mandala token']` |
| Admin protocol | `[2, 'mandala admin']` |
| Basket | `mandala-tokens` |
| Message box | `mandala-payments` |
| Templates pkg | `@bsv/templates@^1.9.0` |
| Overlay topics pkg | `@bsv/overlay-topics@^1.5.0` |
| FT script | `<assetId> <amount> OP_2DROP` + P2PKH (8 chunks) |
| Admin script | `[<json> OP_DROP]` + P2PKH (5 or 7 chunks) |
| assetId on-chain | reversed txid (`tx.hash()` order) + LE vout, 36 bytes |
| assetId string | `<txid>.<vout>` |
| Admin state endpoint | `GET /admin/asset-state/:assetId` |
| Admin history endpoints | `GET /admin/admin-history/:assetId` (full) · `/admin/admin-history-page/:assetId?limit=&offset=` (paged) |
| Admin summary endpoint | `GET /admin/admin-summary/:assetId` |
| Activity endpoint | `GET /admin/activity?assetId=&limit=&before=` |
| Action kinds | register, issue, redeem, pause, unpause, blockIdentity, unblockIdentity, allowIdentity, unallowIdentity, setAccessMode, freezeOutput, unfreezeOutput, reissue (`recover` legacy-only) |
