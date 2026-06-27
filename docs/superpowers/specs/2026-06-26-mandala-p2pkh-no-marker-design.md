# Mandala: P2PKH admin + drop `!` marker

Date: 2026-06-26

## Goal

Make Mandala the simplest possible token system with no frilly bits:

1. Convert `MandalaAdmin` from P2PK to standard P2PKH (hash the key in the lock; reveal the pubkey only when unlocking).
2. Drop the leading `!` (0x21) marker push from **both** `MandalaToken` and `MandalaAdmin` locking scripts. The marker only ever served global indexing; this system commits fully to overlays + p2p exchange, so it is dead weight. Accept the resulting divergence from BRC-92.

## Rationale

The `!` push was a UTF-8 identifier for global indexing. With no global index, it adds bytes and complexity for nothing. Admin outputs being bare P2PKH is fine: admin outputs are classified by the off-chain admin payload (index + action details), not by on-chain shape.

## Scope

Three surfaces:

- `@bsv/templates` — `~/git/ts-stack/packages/helpers/ts-templates` (1.6.2 → 1.7.0)
- `@bsv/overlay-topics` — `~/git/ts-stack/packages/overlays/topics` (1.2.1 → 1.3.0)
- Demo app — `app/src/components/IssuerPanel.tsx`

Breaking on-chain script format change. Acceptable: demo, no persisted token state worth preserving. Minor version bumps (per decision).

## Design

### `@bsv/templates`

#### MandalaToken (drop marker only)

Lock, was (10 chunks):
```
push(MARKER) push(assetId) push(amount) OP_2DROP OP_DROP OP_DUP OP_HASH160 push(pkh) OP_EQUALVERIFY OP_CHECKSIG
```
Lock, new (8 chunks) — one fewer data item means `OP_2DROP` alone clears the prefix, so the extra `OP_DROP` also goes:
```
push(assetId) push(amount) OP_2DROP OP_DUP OP_HASH160 push(pkh) OP_EQUALVERIFY OP_CHECKSIG
```
- `decode`: expect 8 chunks. New indices: `c[0]=assetId, c[1]=amount, c[2]=OP_2DROP, c[3]=OP_DUP, c[4]=OP_HASH160, c[5]=pkh(20), c[6]=OP_EQUALVERIFY, c[7]=OP_CHECKSIG`. Return shape `{assetId, amount, pubKeyHash}` unchanged.
- `unlock` (raw priv) and `lockBRC29`: unchanged. The P2PKH tail is intact, so existing unlock (sig + pubkey push) still satisfies it.

#### MandalaAdmin (P2PK → P2PKH; static API; internal protocolID)

- Module constant: `const ADMIN_PROTOCOL: WalletProtocol = [2, 'mandala admin']`.
- `static async lock({ wallet, counterparty = 'self', data }): Promise<LockingScript>`
  - `keyID = MandalaAdmin.commitment(data)` (canonicalize → sha256, existing helpers).
  - `{ publicKey } = await wallet.getPublicKey({ protocolID: ADMIN_PROTOCOL, keyID, counterparty })` — `forSelf` defaults false (standard BRC-29 counterparty derivation). Correct for `'self'` (symmetric) and for transfer to a new admin pubkey.
  - return standard P2PKH on `hash160(publicKey)`:
    ```
    OP_DUP OP_HASH160 push(hash160(pub) 20) OP_EQUALVERIFY OP_CHECKSIG
    ```
- `static unlock({ wallet, counterparty = 'self', data }): ScriptTemplateUnlock`
  - `sign`: `keyID = commitment(data)`; build sighash preimage (existing `buildSighashPreimage`); `createSignature({ hashToDirectlySign: hash256(preimage), protocolID: ADMIN_PROTOCOL, keyID, counterparty })`; format to checksig; push `[sig, pubkey]` where `pubkey = getPublicKey({ protocolID: ADMIN_PROTOCOL, keyID, counterparty, forSelf: true })`.
  - Why `forSelf: true` on the pushed pubkey: the signer signs with `derivePrivateKey(counterparty)`, whose matching public key is the `forSelf:true` derivation. The lock hashed the `forSelf:false` counterparty key; by BRC-42 symmetry these are the same point for `'self'` and for cross-party transfer, so `hash160(pushed pubkey) === pkh` and `OP_CHECKSIG` passes.
  - `estimateLength`: 108 (P2PKH unlock, was 74).
- `decode`: validate standard P2PKH shape (5 chunks: `OP_DUP OP_HASH160 push(20) OP_EQUALVERIFY OP_CHECKSIG`); return `{ pubKeyHash }` (was `{ boundKey }`).
- `commitment` / `canonicalize`: kept (static).
- **`deriveBoundKey`: removed.** Folded into `lock`/`unlock`. This supersedes the earlier `forSelf:true` patch on `deriveBoundKey` — the model no longer uses `counterparty:'anyone'`.
- Constructor: lock/unlock are static and take `wallet` in args, so the instance `wallet` field is no longer required by them. Remove the constructor wallet dependency for these paths.

#### mandala-encoding

- Remove the `MARKER` export. Remove its import from `MandalaToken.ts` / `MandalaAdmin.ts`.

### `@bsv/overlay-topics` — `MandalaTopicManager.verifyAdminOutput`

- `decode` now yields `{ pubKeyHash }`.
- Compute expected hash with the admin wallet:
  ```
  const counterparty = (details.counterparty as string) ?? 'self'
  const { publicKey } = await adminWallet.getPublicKey({ protocolID: adminProtocolID, keyID: commitment(details), counterparty })
  const expected = Hash.hash160(Utils.toArray(publicKey, 'hex'))
  admit iff expected bytes === decoded.pubKeyHash && priorOutpointSpent(...)
  ```
- `commitment(details)` reachable via `MandalaAdmin.commitment`. `adminProtocolID` stays a dep (overlay still configures it; equals the templates constant).
- counterparty defaults `'self'` — the only path the app exercises. Transfer-to-new-admin is API-ready but not wired in the app yet.

### Demo app `IssuerPanel.tsx`

- 4 lock sites (register, issue, redeem, recover): replace `deriveBoundKey` + `admin.lock(boundKey)` with `await MandalaAdmin.lock({ wallet, data: <details> })`.
- 3 unlock sites (issue, redeem, recover): replace `admin.unlock(ADMIN_PROTOCOL, asset.authDetails)` with `MandalaAdmin.unlock({ wallet, data: asset.authDetails })`.
- 3 `unlockingScriptLength: 74` → `108`.
- Drop now-unused `MandalaAdmin` instance construction and `ADMIN_PROTOCOL` import where no longer needed (FT keeps `FT_PROTOCOL`).

## Testing (TDD)

Each behavior change gets a failing test first, then the fix.

- `MandalaAdmin.spend.test.ts`: interpreter round-trip — self-locked admin auth spends (P2PKH). Add a transfer case: lock counterparty = a second wallet's identity, that wallet spends with counterparty = granter identity; `Spend.validate()` true.
- `MandalaAdmin.script.test.ts`: assert new 5-chunk P2PKH shape, no marker; `decode` returns `pubKeyHash`.
- `MandalaAdmin.derive.test.ts`: remove (deriveBoundKey gone) or repoint to `lock`/`commitment`.
- `MandalaToken.test.ts`: assert 8-chunk shape, no marker; decode round-trip.
- `mandala-encoding.test.ts`: drop `MARKER` assertion.
- `exports.test.ts`: drop `MARKER` from expected exports.
- overlay-topics mandala tests: update admin verification expectations to pubKeyHash comparison.

## Rollout

1. `@bsv/templates`: implement, `npm test`, bump 1.7.0, publish.
2. `@bsv/overlay-topics`: implement against new templates, test, bump 1.3.0, publish.
3. App: `npm install @bsv/templates@^1.7.0 @bsv/overlay-topics@^1.3.0`; apply `IssuerPanel.tsx` edits; typecheck/build.
4. Rebuild overlay container (bundles both packages).
5. Manual E2E: register → issue → send → redeem → recover.

## Out of scope

- Wiring an admin-transfer UI flow (API supports it; app stays self).
- Backward compatibility with marker/P2PK outputs.
