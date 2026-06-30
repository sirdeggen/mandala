# Mandala Token — Project State

> Onboarding doc for an agent picking up new-feature work. Covers what the
> system is, the design north-star, the architecture, how the issuer gates and
> controls transfers, and the API surface (Overlay + app).

_Last updated: 2026-06-30. Branch `mandala-p2pkh-no-marker`._

---

## 1. What this is

A working demo of a **regulated fungible token (FT)** on BSV. An *issuer*
registers an asset, mints (issues) units, and retains regulatory powers over
the supply: **redeem** (burn) and **recover** (seize and re-issue to another
holder). Ordinary holders **send** and **receive** units peer-to-peer. Every
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

Current dep floor: `@bsv/templates@^1.7.2`, `@bsv/overlay-topics@^1.3.1`,
`@bsv/sdk@^2.1.6` (both app and overlay pinned to the same templates version —
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
  tied to one specific action (`register` / `issue` / `redeem` / `recover`).
- `counterparty` defaults to `'self'` (issuer locks to itself). Passing another
  party's identity key would **transfer admin rights** to them (not surfaced in
  the UI yet — a natural feature hook).
- `MandalaAdmin.decode(script)` → `{ pubKeyHash, publicData? }`.
- `MandalaAdmin.unlock({ wallet, data, counterparty })` reproduces the sig via
  `wallet.createSignature` and pushes the `forSelf:true` derived pubkey (BRC-42
  symmetry — see §5 for why `forSelf:true` matters).

`MandalaActionDetails`: `{ kind, assetId?, amount?, priorOutpoint?, ... }`.
`kind ∈ {register, issue, redeem, recover}`.

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
- **Recover** spends prior auth → outputs `[FT to a target holder, next auth]`,
  seizing/re-issuing supply to an identity key the issuer names.

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
2. **Authorized issuance accounting** — `issue`/`recover` credit
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

> So: the **script** ensures only the issuer can extend the auth chain and only
> a key-holder can spend an FT; the **overlay** ensures supply conservation,
> issuer-authorized minting, valid linkage, and sanctions compliance before any
> output is recognized. A transfer the overlay won't admit is effectively
> invisible to other holders, even if it lands on-chain.

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
`identityKey`). Four user-facing surfaces:

| Component | Role |
|---|---|
| `IssuerPanel.tsx` | Issuer-only: Register, Issue, Redeem (burn), Recover (seize). |
| `SendTokens.tsx` | Holder→holder transfer; identity search; "Return to issuer". |
| `ReceiveTokens.tsx` | Accept/reject incoming tokens from the message box. |
| `TokenWallet.tsx` | Balance display. |

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
  read.
- `metadata.ts` — `parseMetadataFromBeef` (pure decode) +
  `resolveAssetMetadata` (overlay lookup → SPV → decode, memoized).
- `amount.ts` — `formatAmount` / `formatAmountPlain` / `parseAmount`.
- `unlock.ts` — `walletMandalaUnlock` (wallet-signed FT spend, `forSelf:true`).
- `overlay.ts` — `submitToOverlay(beef, offChainValues?)` →
  `HTTPSOverlayBroadcastFacilitator.send`, throws on empty admit.
- `encoding.ts` — `encodeLinkagePayload` / `MandalaActionDetails` re-export.
- `tokens.ts` — `outpoint(txid, vout)`, `revealLinkage(wallet, keyID, cp)`.

### `listOutputs` include-mode gotcha

`include: 'locking scripts'` attaches per-output `lockingScript` (+ optional
`customInstructions`) but **no BEEF**. `include: 'entire transactions'`
attaches BEEF but **no lockingScript**. FT selection + spend therefore issues
**two queries** and lines them up by outpoint. Don't try to collapse them.

### Transaction-building pattern (all four issuer actions + send)

1. `createAction` with inputs/outputs (`randomizeOutputs:false`, since output
   indices matter for linkage).
2. Sign the signable tx by attaching `unlockingScriptTemplate`s and `.sign()`.
3. `signAction({ reference, spends })`.
4. **Use `signed.txid` / `reg.txid`** for the txid — never
   `Transaction.fromBEEF(...).id()`, which can return the wrong tx from an
   AtomicBEEF bundle.
5. `revealLinkage` for FT outputs → `encodeLinkagePayload({ inputs, outputs,
   admin })` → `submitToOverlay`.
6. For peer delivery, `messageBoxClient.sendMessage` with the tx + keyID +
   protocolID so the recipient can `internalizeAction` (basket insertion) on
   accept.

---

## 9. Overlay API (`@bsv/overlay-topics`, deployed in `overlay/`)

### Topic manager — `tm_mandala`

`identifyAdmissibleOutputs(beef, previousCoins, offChainValues?)` →
`{ outputsToAdmit, coinsToRetain }`. Logic = the five gates in §4. Deps:
`{ verifierWallet, screeningProvider, adminWallet, adminProtocolID }`.

### Lookup service — `ls_mandala`

Indexes admitted outputs into Mongo (`MandalaStorageManager`). Query forms via
`lookup({ query })`:

- `{ metadataAssetId }` → genesis metadata record(s) for that assetId (§6).
- `{ assetId }` → token outputs for an asset.
- `{ txid, outputIndex }` → a specific outpoint.

Notes:
- `outputAdmittedByTopic` stores FTs (with identity key from linkage) and,
  separately, admin outputs carrying `publicData` as metadata.
- `outputSpent` removes a token row and decrements its identity balance but
  **does not** delete metadata.
- `outputEvicted` deletes both token and metadata (admin override).
- **No public identity→balance query is exposed** (privacy; see service
  `shortDescription`).

### App-side resolver wiring

`LookupResolver({ networkPreset:'mainnet', hostOverrides:{ ls_mandala:
[OVERLAY_URL] } })`. The overlay instance runs with GASP sync **disabled**
(`configureEnableGASPSync(false)`), `NETWORK=main`, behind an ngrok URL set in
`app/.env` (`VITE_OVERLAY_URL`).

---

## 10. End-to-end flow (happy path)

1. **Register** (issuer): one tx, one genesis output (metadata + first auth).
   assetId = `genesisTxid.0`.
2. **Issue** (issuer): spend genesis auth → `[FT to self, next auth]`; submit;
   FT now in issuer's basket.
3. **Send** (holder): select FT inputs, output `[FT to recipient, change?]`;
   submit to overlay; notify recipient via message box.
4. **Receive** (recipient): list message-box messages, `internalizeAction`
   (basket insertion) on accept, acknowledge the message. Label resolved by
   SPV.
5. **Redeem** (issuer): burn units (negative issuance keeps conservation).
6. **Recover** (issuer): seize/re-issue units to a named identity key; notify
   that recipient via message box.

---

## 11. State of the repo / open threads

- Branch `mandala-p2pkh-no-marker`; recent commits up to `5fbfaa5` (templates
  1.7.2 bump). The byte-order ts-stack PR (#252) is merged and published.
- The full P2PKH + no-marker + metadata + decimals + return-to-issuer feature
  set is implemented and was being E2E-verified against templates 1.7.2.
- Natural next-feature hooks: **admin-rights transfer** (the `counterparty`
  parameter on `MandalaAdmin.lock` already supports handing the auth chain to
  another party — no UI yet); richer metadata (ticker is in the type but not
  surfaced); multi-input issuer batching; a holder-facing asset directory built
  on `ls_mandala`.

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
| Templates pkg | `@bsv/templates@^1.7.2` |
| Overlay topics pkg | `@bsv/overlay-topics@^1.3.1` |
| FT script | `<assetId> <amount> OP_2DROP` + P2PKH (8 chunks) |
| Admin script | `[<json> OP_DROP] ` + P2PKH (5 or 7 chunks) |
| assetId on-chain | reversed txid (`tx.hash()` order) + LE vout, 36 bytes |
| assetId string | `<txid>.<vout>` |
