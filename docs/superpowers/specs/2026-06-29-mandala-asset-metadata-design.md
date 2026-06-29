# Mandala: on-chain asset metadata (publicData on genesis)

Date: 2026-06-29

## Goal

Let anyone — including a brand-new recipient who is not the issuer — resolve an
asset's human metadata (label, and optionally ticker/decimals/etc.) from its
`assetId`, with the metadata anchored on-chain and SPV-verifiable.

Today the label lives only in the issuer's admin-output `customInstructions`
(private to the issuer's wallet). A recipient sees only the raw `assetId`.

## Approach

Carry a public JSON metadata blob in the **genesis output's locking script** via a
new optional `publicData` argument to `MandalaAdmin.lock`. The genesis output is
the `assetId` anchor (`assetId = genesisTxid.0`) and is not spent in normal flow.
The overlay indexes it and serves it by `assetId`; the recipient SPV-verifies the
genesis transaction and reads the blob.

No new output type, no propagation through the auth chain — the metadata lives in
exactly one place (genesis).

## Scope

- `@bsv/templates` — `~/git/ts-stack/packages/helpers/ts-templates` (1.7.0 → 1.7.1)
- `@bsv/overlay-topics` — `~/git/ts-stack/packages/overlays/topics` (1.3.0 → 1.3.1)
- Demo app — `app/src/...`

Patch bumps (additive: new optional arg, new query, new index — no breaking change
to existing scripts or queries).

## Design

### `@bsv/templates` — `MandalaAdmin`

`lock` gains an optional `publicData`:

```ts
interface MandalaAdminLockParams {
  wallet: WalletInterface
  data: MandalaActionDetails
  counterparty?: WalletCounterparty
  originator?: string
  publicData?: Record<string, unknown>   // NEW
}
```

When `publicData` is present, prepend a push + drop before the P2PKH:

```
<push JSON.stringify(publicData)> OP_DROP OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG   (7 chunks)
```

Without it, the script is unchanged (5-chunk P2PKH). The prefix is purely data —
`OP_DROP` discards it; spending semantics are identical.

`decode` returns the optional blob:

```ts
interface MandalaAdminDecoded { pubKeyHash: number[]; publicData?: Record<string, unknown> }
```

- 5 chunks → plain P2PKH; `pubKeyHash = c[2].data`.
- 7 chunks → `c[0]` data push, `c[1] === OP_DROP`, then P2PKH (`OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG`); `pubKeyHash = c[4].data`; `publicData = JSON.parse(toUTF8(c[0].data))`.
- Any other shape → throw.

`unlock` is unchanged. The sighash subscript is the full locking script (already
sourced from `sourceOutput.lockingScript`), so the publicData prefix is covered by
the signature with no code change. `estimateLength` stays 108.

`AssetMetadata` (exported helper type): `{ label: string; ticker?: string; decimals?: number; [k: string]: unknown }`. Only `label` is required by convention; the encoder/decoder treat `publicData` as an open object.

### `@bsv/overlay-topics`

**MandalaTopicManager.verifyAdminOutput** — no logic change; relies on the updated
`decode`, which now returns `pubKeyHash` for both the 5- and 7-chunk shapes. This is
required: without it the new 7-chunk genesis output would fail to decode and be
rejected.

**MandalaLookupService.outputAdmittedByTopic** — after the existing FT path, add an
admin path:
- `MandalaToken.decode` fails → try `MandalaAdmin.decode`.
- If the decoded admin output has `publicData`, store a **metadata record** keyed by
  its own outpoint: `assetId = ${payload.txid}.${payload.outputIndex}`, with
  `{ txid, outputIndex, assetId }`. (The blob itself is read from the BEEF by the
  client; the record just makes the output resolvable.)

**MandalaLookupService.lookup** — add `query.metadataAssetId` →
`storage.findMetadataByAssetId(assetId)` returning `[{ txid, outputIndex }]` so the
overlay engine hydrates the genesis BEEF for the caller.

**Retention** — metadata records outlive the output:
- `outputSpent` → **do not** delete the metadata record (only the FT/token bookkeeping, as today).
- `outputEvicted` → **delete** the metadata record (eviction is an admin override).

**MandalaStorageManager** — new `metadata` collection: `storeMetadata`,
`findMetadataByAssetId`, `deleteMetadata(txid, outputIndex)`.

### App

**Register (`IssuerPanel.registerAsset`)**
- Phase 1 genesis output: replace `new P2PKH().lock(...)` with
  `await MandalaAdmin.lock({ wallet, data: { kind: 'register' }, publicData: metadata })`.
  `assetId = genesisTxid.0` unchanged.
- Submit the genesis tx to `tm_mandala` with an off-chain admin payload
  `admin: [{ index: 0, actionDetails: { kind: 'register' } }]` so the topic manager
  admits it and the lookup indexes the metadata. (Phase 2 register admin-auth is
  unchanged.)
- `metadata` initially `{ label }`; the input stays a single label field, but the
  blob is an open object for future fields.

**Issuer bookkeeping (`assets.ts`)** — store the full `metadata` object in the admin
`customInstructions` (alongside `authDetails`); `AdminAsset` gains `metadata`. Issuer
label display continues to come from here (no overlay round-trip for the issuer).

**Resolver (`app/src/lib/mandala/metadata.ts`, new)**
```ts
resolveAssetMetadata(wallet, assetId): Promise<AssetMetadata | null>
```
- Query `ls_mandala` with `{ metadataAssetId: assetId }` (via the overlay lookup
  HTTP facilitator) → genesis BEEF.
- `Transaction.fromBEEF` → `verify(new WhatsOnChain('main'))` (SPV proof it is on-chain).
- Read output 0's locking script → `MandalaAdmin.decode` → `publicData`.
- Memoize by `assetId` (module-level cache).
- Returns `null` on any failure (not found, verify fails, no publicData).

**ReceiveTokens** — resolve metadata for the incoming `assetId`; show the label (and
ticker if present) next to the amount before Accept. On Accept, persist
`label`/metadata into the received FT's basket `customInstructions` so Wallet/Send
show it afterward without re-resolving.

**Wallet / Send** — for assetIds not in the issuer's admin CI (i.e. non-issuers),
fall back to `resolveAssetMetadata` for the label.

## Testing

**templates**
- `lock` with/without `publicData` produces 7-/5-chunk scripts; `decode` round-trips
  the blob and the pubKeyHash.
- Interpreter spend test: a `publicData` admin output is still spendable (CHECKSIG
  passes over the full subscript).
- `decode` rejects malformed prefixes (push without OP_DROP, bad JSON).

**overlay-topics**
- Genesis admin output with `publicData` is admitted; `{ metadataAssetId }` returns it.
- `outputSpent` does **not** remove the metadata record; `outputEvicted` does.
- FT `outputSpent` still removes the token record (unchanged).
- Admin output **without** publicData is not indexed as metadata.

**app**
- `resolveAssetMetadata`: given a mock lookup + a known genesis BEEF, verifies and
  returns the parsed blob; returns `null` when verify fails or publicData absent.

## Rollout

1. `@bsv/templates`: implement, test, bump 1.7.1, publish.
2. `@bsv/overlay-topics`: implement, test, bump 1.3.1, publish.
3. App: `npm install` new versions; register/resolver/ReceiveTokens changes; build.
4. Rebuild overlay container.
5. Manual E2E: register (genesis carries label) → from a second wallet, receive →
   label shown, SPV-verified → accept → label persists in Wallet/Send.

## Out of scope

- Editable/mutable metadata (it is immutable on the genesis output).
- A metadata-authoring UI beyond the existing single label field.
- Backfilling labels for assets registered before this change (their genesis has no
  publicData; they resolve to `null` and fall back to a truncated assetId).
