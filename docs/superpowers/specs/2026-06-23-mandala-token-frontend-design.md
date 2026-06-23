# Mandala Token Frontend + Overlay — Design

**Date:** 2026-06-23
**Status:** Approved (pending spec review)

## Goal

A frontend application for issuance, management, and transfer of fungible
**Mandala Tokens** (BRC-92, https://brc.dev/92), using the `MandalaToken` /
`MandalaAdmin` classes from `@bsv/templates` and the `tm_mandala` overlay topic
manager from `~/git/ts-stack`. On submission the app transmits `offChainValues`
(key-linkage payload) so the overlay can verify counterparty eligibility and run
sanctions screening for each token output. The broadcast pattern mirrors
`~/git/demos/utility-tokens`, targeting the `tm_mandala` topic.

## Key differences from utility-tokens

`utility-tokens` is **permissionless** (anyone mints PushDrop tokens). Mandala is
a **regulated** token:

- **Issuance is admin-gated.** The overlay only admits `register`/`issue`/
  `redeem`/`recover` admin outputs whose `boundKey` re-derives from the overlay
  instance's configured `adminWallet` key. Supply conservation (Σin == Σout per
  assetId) is enforced; minting requires an authorized admin output.
- **Counterparty eligibility is overlay-verified.** Each FT output carries a
  `revealSpecificKeyLinkage` record in `offChainValues`; the overlay decrypts it
  with its verifier key, re-derives the output's pubKeyHash, and screens both
  sides against a sanctions list. No linkage → output not admitted.
- **One instance key = issuer + admin + verifier.** This demo runs its **own**
  `tm_mandala` overlay instance whose `SERVER_PRIVATE_KEY` is the single
  authority key (verifier wallet, admin wallet). The issuer is the holder of a
  BRC-100 wallet whose identity key equals that instance key.

## Architecture

Single repo directory, two parts:

```
demos/mandala/
├── overlay/                 # self-hosted tm_mandala instance
│   ├── docker-compose.yml   # mongodb + overlay service (localhost:8080)
│   ├── Dockerfile
│   ├── src/index.ts         # OverlayExpress: ONLY tm_mandala + ls_mandala
│   ├── .env.example         # SERVER_PRIVATE_KEY, MONGO_URL, HOSTING_URL, NETWORK, NODE_NAME
│   └── package.json
└── app/                     # React 19 + Vite + TS + Tailwind + Radix (mirrors utility-tokens)
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── context/WalletContext.tsx
    │   ├── lib/mandala/
    │   │   ├── encoding.ts          # encodeLinkagePayload + payload/linkage types
    │   │   ├── unlock.ts            # wallet-based MandalaToken unlock wrapper
    │   │   ├── assetStore.ts        # local registered-asset / auth-outpoint tracking
    │   │   └── overlay.ts           # broadcast helper (offChainValues)
    │   ├── components/
    │   │   ├── TokenDemo.tsx        # tab container, role-gated
    │   │   ├── IssuerPanel.tsx      # Register / Issue / Redeem / Recover (issuer only)
    │   │   ├── TokenWallet.tsx      # balances by assetId
    │   │   ├── SendTokens.tsx       # transfer with linkage offChain
    │   │   ├── ReceiveTokens.tsx    # messagebox internalize
    │   │   └── ui/                  # button/card/input/label/skeleton
    │   └── globals.css
    └── .env.example          # VITE_OVERLAY_URL, VITE_OVERLAY_IDENTITY_KEY, VITE_MESSAGEBOX_URL
```

**Rationale:** one clone runs the entire demo. The overlay is trimmed to the
single `tm_mandala` topic + `ls_mandala` lookup — no SHIP/SLAP or unrelated
managers.

### Overlay service (`overlay/`)

Modeled on `ts-stack/infra/overlay-server/src/index.ts` but minimal:

```ts
const wallet = new ProtoWallet(PrivateKey.fromHex(SERVER_PRIVATE_KEY)) as unknown as WalletInterface
server.configureTopicManager('tm_mandala', new MandalaTopicManager({
  verifierWallet: wallet,
  screeningProvider: new InMemoryScreeningProvider([]),
  adminWallet: wallet,
  adminProtocolID: [2, 'mandala admin']
}))
server.configureLookupServiceWithMongo('ls_mandala', createMandalaLookupService(wallet))
```

- `verifierWallet === adminWallet === ProtoWallet(SERVER_PRIVATE_KEY)`. Its
  identity pubkey is the **verifier key** (linkage decrypt) and the
  **admin/issuer key**.
- `docker-compose.yml`: `mongodb` + `overlay` (port 8080). `.env` supplies
  `SERVER_PRIVATE_KEY`, `MONGO_URL`, `HOSTING_URL`, `NETWORK`, `NODE_NAME`.
- The overlay's identity pubkey is published to the frontend via
  `VITE_OVERLAY_IDENTITY_KEY` (and can be confirmed at `/getDocumentation` /
  overlay metadata if desired).

### Role model (frontend)

- On load `WalletContext` connects a `WalletClient` (BRC-100 / Metanet) and a
  `MessageBoxClient`, exactly like utility-tokens.
- `isIssuer = (await wallet.getPublicKey({ identityKey: true })).publicKey === VITE_OVERLAY_IDENTITY_KEY`.
- `isIssuer === true` → render the **Issuer** tab (Register / Issue / Redeem /
  Recover). All users see **Wallet**, **Send**, **Receive**.
- To operate as issuer, the admin runs a BRC-100 wallet whose identity key
  equals the overlay's `SERVER_PRIVATE_KEY`. Documented demo assumption.

## Protocol constants

| Purpose            | Value                      |
|--------------------|----------------------------|
| Topic              | `tm_mandala`               |
| Lookup service     | `ls_mandala`               |
| FT protocolID      | `[2, 'mandala token']`     |
| Admin protocolID   | `[2, 'mandala admin']`     |
| FT counterparty    | recipient identity key (`'self'` for self-held) |
| Admin counterparty | `'anyone'` (per `MandalaAdmin.deriveBoundKey`)  |

## Data flows

All broadcasts use the utility-tokens pattern with `offChainValues` added:

```ts
const overlay = new HTTPSOverlayBroadcastFacilitator(undefined, true)
const steak = await overlay.send(OVERLAY_URL, {
  beef: tx.toBEEF(),
  topics: ['tm_mandala'],
  offChainValues: encodeLinkagePayload({ inputs, outputs, admin })
})
if ((steak['tm_mandala']?.outputsToAdmit.length ?? 0) === 0) throw new Error('overlay rejection')
```

### Register asset (issuer) — true genesis outpoint, 2-phase

1. **Phase 1 (genesis UTXO):** `wallet.createAction` with one 1-sat P2PKH output
   to self. Read the resulting txid → `assetId = ${txid}.${vout}`. This real,
   unique outpoint is the asset's genesis identifier (BRC-92 outpoint format).
2. **Phase 2 (register):** `wallet.createAction` that **spends the genesis
   output** and creates one admin output:
   `MandalaAdmin(wallet).lock(boundKey)` where
   `{ boundKey } = await admin.deriveBoundKey([2,'mandala admin'], { kind:'register', assetId })`.
   - `offChainValues = encodeLinkagePayload({ inputs:[], outputs:[], admin:[{ index:0, actionDetails:{ kind:'register', assetId } }] })`.
   - Broadcast. On success persist `{ assetId, label, authOutpoint: <register tx>.0 }`
     to a local store (basket / customInstructions) — this is the asset's current
     admin auth outpoint, consumed by the next admin action.

`priorOutpointSpent` returns `true` for `kind:'register'`, so no prior auth input
is required by the overlay; spending the genesis UTXO is our anchoring choice.

### Issue / mint (issuer)

`wallet.createAction` that:
- **spends the asset's current auth outpoint** (register or prior admin output),
- outputs `[0]` FT to a holder:
  `MandalaToken(wallet).lockBRC29(assetId, amount, [2,'mandala token'], keyID, counterparty)`
  (`counterparty = 'self'` to mint to the issuer, or the recipient identity key),
- outputs `[1]` next admin auth:
  `admin.lock(deriveBoundKey([2,'mandala admin'], { kind:'issue', assetId, amount, priorOutpoint }))`.
- `offChainValues = { outputs:[{ index:0, linkage }], admin:[{ index:1, actionDetails:{ kind:'issue', assetId, amount, priorOutpoint } }] }`
  where `linkage = await wallet.revealSpecificKeyLinkage({ counterparty, verifier: OVERLAY_IDENTITY_KEY, protocolID:[2,'mandala token'], keyID })`.
- Sign the spent auth input with `MandalaAdmin(wallet).unlock([2,'mandala admin'], priorActionDetails)` via `signAction`.
- Overlay admits FT (issuance authorized) + next auth output; update local
  auth outpoint to `<issue tx>.1`.

### Transfer (any holder)

Mirrors `utility-tokens/SendTokens.tsx`:
- Recipient identity resolved via `@bsv/identity-react` search.
- Gather FT inputs for `assetId` until Σ ≥ amount (merge their BEEF).
- Outputs: `[0]` FT to recipient (`counterparty = recipientIdentityKey`),
  `[1]` FT change to self (`counterparty = 'self'`) when needed.
- `offChainValues = { outputs: [ {index:0, linkage_recipient}, {index:1, linkage_self} ] }`
  (one `revealSpecificKeyLinkage` per FT output). No admin section.
- Spend each FT input with the **wallet-based unlock wrapper** (see helpers) via
  `signAction`. Σin == Σout per assetId → conservation holds.
- Broadcast `tm_mandala` with `offChainValues`.
- **MessageBox handoff:** `messageBoxClient.sendMessage` the BEEF + metadata
  (`assetId, amount, keyID, protocolID, sender`) to the recipient's box.

### Receive (any holder)

Mirrors `utility-tokens/ReceiveTokens.tsx`: poll `messageBoxClient.listMessages`
→ `wallet.internalizeAction` (basket insertion with `customInstructions` for the
derived key) → `acknowledgeMessage`.

### Redeem / burn (issuer)

`wallet.createAction` that:
- spends FT input(s) of `assetId` (amount to burn) **and** the asset's current
  auth outpoint,
- outputs one admin auth output `{ kind:'redeem', assetId, amount, priorOutpoint }`,
- produces **no FT output** for the burned amount (or a smaller FT change output;
  if partial, include change FT + its linkage).
- `offChainValues`: `admin:[{ index, actionDetails }]` plus `outputs` linkage for
  any FT change output.
- Conservation: with no FT output for `assetId` the conservation loop skips it;
  the burned FT input coins are removed from the topic. Update local auth
  outpoint to the redeem admin output.

### Recover / seize-reissue (issuer)

Same shape as **Issue** but `actionDetails.kind = 'recover'`. The overlay counts
`recover` as authorized issuance, so it mints `amount` to the designated holder
(e.g. recovered/seized funds re-issued to a controlled key). FT output linkage +
next admin auth output as in Issue.

## Helpers to implement (not provided by published packages)

### `lib/mandala/encoding.ts`

The overlay's `encodeLinkagePayload` and payload/linkage types live in the
overlay package's internal `types.ts`, not in `@bsv/templates`. Replicate:

```ts
export interface SpecificLinkage {
  prover: string; verifier: string; counterparty: string
  protocolID: [number, string]; keyID: string
  encryptedLinkage: number[]; encryptedLinkageProof: number[]; proofType?: number
}
export interface MandalaActionDetails {
  kind: 'register' | 'issue' | 'redeem' | 'recover'
  assetId?: string; amount?: number; priorOutpoint?: string
}
export interface MandalaLinkagePayload {
  inputs: Array<{ index: number, linkage: SpecificLinkage }>
  outputs: Array<{ index: number, linkage: SpecificLinkage }>
  admin?: Array<{ index: number, actionDetails: MandalaActionDetails }>
}
export const encodeLinkagePayload = (p: MandalaLinkagePayload): number[] =>
  Utils.toArray(JSON.stringify(p), 'utf8')
```

The shape of `revealSpecificKeyLinkage`'s result must map onto `SpecificLinkage`
(the overlay's `verifyKeyLinkage` reads `encryptedLinkage`, `protocolID`, `keyID`,
`counterparty`, `prover`). Verify field names against the SDK result at build
time and adapt if needed.

### `lib/mandala/unlock.ts`

`MandalaToken.unlock(privateKey, ...)` signs with a raw `PrivateKey`, which a
`WalletClient` will not expose. Provide a `ScriptTemplateUnlock` that signs via
the wallet for the BRC-29 derived key:

1. Build the BIP143 sighash preimage (replicate `buildSighashPreimage` from
   `@bsv/templates/src/mandala-signing.ts`).
2. `const { signature } = await wallet.createSignature({ hashToDirectlySign: Hash.hash256(preimage), protocolID:[2,'mandala token'], keyID, counterparty })`.
3. Assemble `UnlockingScript([{ sig: TransactionSignature(signature, scope).toChecksigFormat() }, { derivedPubKey }])`
   where `derivedPubKey = (await wallet.getPublicKey({ protocolID, keyID, counterparty })).publicKey`.

`MandalaAdmin.unlock` is already wallet-based (`createSignature`, counterparty
`'anyone'`) — use it directly for spending admin auth outpoints.

### `lib/mandala/assetStore.ts`

Track registered assets and their current admin auth outpoint (the outpoint each
next admin action must spend). Persist via the wallet (a dedicated basket with
`customInstructions`, mirroring how utility-tokens stores token metadata) so it
survives reloads. Holds `{ assetId, label, authOutpoint }`.

## Management / balances view

`ls_mandala` returns only outpoints (`findByAssetId` / `findByOutpoint`), not full
transactions. Balances are computed locally, mirroring
`utility-tokens/TokenWallet.tsx`: `wallet.listOutputs({ basket })` →
`MandalaToken.decode(lockingScript)` → group `amount` by `assetId`, joined with
the local asset store for labels.

## Config

**Overlay `.env`:** `SERVER_PRIVATE_KEY`, `MONGO_URL`, `HOSTING_URL`, `NETWORK`
(`test`|`main`), `NODE_NAME`.

**App `.env`:** `VITE_OVERLAY_URL` (e.g. `http://localhost:8080`),
`VITE_OVERLAY_IDENTITY_KEY` (overlay instance identity pubkey, drives issuer
gating), `VITE_MESSAGEBOX_URL` (e.g. `https://messagebox.babbage.systems`).

## Scope

**In v1:** overlay service (docker), role gating, Register (2-phase genesis
outpoint), Issue, Transfer, Receive, Redeem, Recover, balance view.

**Out:** SHIP/SLAP advertisement and multi-host discovery, multi-recipient
issuance in a single action, production HSM/KMS custody of the instance key,
mainnet ARC tuning. The instance key doubling as issuer + admin + verifier is a
documented demo simplification.

## Testing

- Overlay: `docker compose up`, confirm `tm_mandala` admits a known-good
  transfer (port the `mandala.test.ts` vectors) and rejects missing-linkage /
  sanctioned cases.
- Helpers: unit-test `encodeLinkagePayload` round-trip against the overlay's
  `decodeLinkagePayload`, and the unlock wrapper against `MandalaToken.decode` +
  a real `signAction` spend on the local overlay.
- End-to-end: issuer wallet registers + issues to self; transfers to a second
  wallet; second wallet receives (messagebox) and transfers back; issuer redeems
  and recovers. Verify overlay admittance + local balances at each step.
