# Mandala Overlay — Language-Neutral Implementation Spec (for Go port)

Derived from a complete read of:
- `/Users/personal/git/demos/mandala/overlay/node_modules/@bsv/overlay-topics/src/mandala/` (MandalaTopicManager.ts, MandalaLookupService.ts, verifyKeyLinkage.ts, types.ts, MandalaStorageManager.ts, ordering.ts, AssetStateReducer.ts, docs, all tests)
- `/Users/personal/git/demos/mandala/app/node_modules/@bsv/templates/src/MandalaToken.ts`, `mandala-encoding.ts`, `MandalaAdmin.ts`, `mandala-signing.ts`
- Supporting SDK internals: `@bsv/sdk` KeyDeriver.ts, ProtoWallet.ts, PrivateKey/PublicKey.deriveChild, SymmetricKey.ts

All byte arrays are octet sequences. "hex" means lowercase hex display encoding. `hash160(x) = RIPEMD160(SHA256(x))`. `hash256(x) = SHA256(SHA256(x))`. Curve is secp256k1; `G` its generator, `n` its order. "Compressed point" = 33-byte SEC1 (0x02/0x03 prefix).

---

## 0. Shared data types and off-chain payload

### 0.1 AssetId string form
`"<txid>.<vout>"` — `txid` is 64 lowercase hex chars in **display order** (the reversed double-SHA256, i.e. `tx.id('hex')`), `vout` a base-10 non-negative integer. The dot used for splitting is the **last** `.` in the string.

### 0.2 Outpoint string form
Same as assetId: `"<display-txid-hex>.<voutDecimal>"`. Used for `priorOutpoint`, `outpoint`, frozen/evicted sets, input-outpoint comparison.

### 0.3 SpecificLinkage (BRC-72 reveal object)
```
SpecificLinkage {
  prover:                string   // compressed pubkey hex — identity key of the party revealing
  verifier:              string   // compressed pubkey hex — identity key of the overlay verifier
  counterparty:          string   // compressed pubkey hex — identity key the child key was derived FOR
  protocolID:            [int, string]   // original protocol: [securityLevel, name]
  keyID:                 string
  encryptedLinkage:      []byte   // ciphertext of the 32-byte linkage scalar L
  encryptedLinkageProof: []byte   // ciphertext of [0x00] (proofType 0 = no proof); carried, never verified
  proofType:             int      // 0
}
```

### 0.4 MandalaActionDetails
```
MandalaActionKind = "register" | "issue" | "redeem" | "pause" | "unpause"
                  | "blockIdentity" | "unblockIdentity"
                  | "allowIdentity" | "unallowIdentity"
                  | "setAccessMode" | "freezeOutput" | "unfreezeOutput" | "reissue"

MandalaActionDetails {
  kind:          MandalaActionKind   // required
  assetId?:      string
  amount?:       number (integer)
  priorOutpoint?: string             // outpoint of the previous admin-auth output being consumed
  identityKey?:  string
  outpoint?:     string              // target of freeze/unfreeze/reissue
  recipient?:    string
  mode?:         "denylist" | "allowlist"
  bankRef?:      string
  ...arbitrary extra keys allowed (they participate in canonicalization)
}
```

### 0.5 Off-chain linkage payload (`offChainValues`)
UTF-8 bytes of a JSON object (`encodeLinkagePayload` = `JSON.stringify`; `decodeLinkagePayload` = `JSON.parse` of UTF-8):
```
MandalaLinkagePayload {
  inputs:  [{ index: int, linkage: SpecificLinkage }]   // index into tx.inputs
  outputs: [{ index: int, linkage: SpecificLinkage }]   // index into tx.outputs
  admin?:  [{ index: int, actionDetails: MandalaActionDetails }]  // index into tx.outputs
}
```
If `offChainValues` is absent, treat as `{ inputs: [], outputs: [] }`.

---

## 1. Script formats

### 1.1 Script-chunk model
A locking script is a sequence of chunks `{ op: byte, data?: []byte }`. Decoding a raw script into chunks follows standard Bitcoin script parsing: opcodes 0x01–0x4b push that many bytes; 0x4c (PUSHDATA1), 0x4d (PUSHDATA2), 0x4e (PUSHDATA4) push length-prefixed data; all other opcodes are single-byte chunks with no data.

**Minimal-push encoder** (`createMinimallyEncodedScriptChunk(data)`) used when building scripts:
- `len(data) == 0` → `{op: 0x00}` (OP_0)
- `len == 1 && data[0] == 0` → `{op: 0x00}`
- `len == 1 && 1 <= data[0] <= 16` → `{op: 0x50 + data[0]}` (OP_1..OP_16, i.e. 0x51..0x60)
- `len == 1 && data[0] == 0x81` → `{op: 0x4f}` (OP_1NEGATE)
- `len <= 75` → `{op: len, data}`
- `len <= 255` → `{op: 0x4c, data}`
- `len <= 65535` → `{op: 0x4d, data}`
- else → `{op: 0x4e, data}`

**Script number encoding** (`encodeScriptNum`, Bitcoin CScriptNum): minimal little-endian magnitude; if the top byte's high bit (0x80) is set, append an extra byte (0x00 positive / 0x80 negative); otherwise for negatives OR 0x80 into the top byte. `0` encodes as empty array.

**Script number chunk decoding** (`decodeScriptNumChunk`) — must accept both encodings symmetrically:
- `op == 0x00` → 0
- `op == 0x4f` → −1
- `0x51 <= op <= 0x60` → `op − 0x50` (1..16)
- else decode `data` as little-endian with sign in high bit of last byte (`decodeScriptNum`); empty/missing data → 0. Non-minimal encodings are accepted on decode.

### 1.2 On-chain assetId encoding (36 bytes)
`encodeAssetId("<txid>.<vout>")`:
- txid must be exactly 64 hex chars; vout a non-negative integer (else error).
- Bytes = `reverse(hexDecode(txid))` (32 bytes, **internal/hash byte order**, i.e. display hex reversed) `||` 4-byte **little-endian** uint32 vout.

`decodeAssetId(bytes)`: must be exactly 36 bytes; txid = hex of `reverse(bytes[0:32])`; vout = LE uint32 of `bytes[32:36]`; return `"<txid>.<vout>"`.

### 1.3 MandalaToken locking script

Chunk sequence (exactly 8 chunks):

| # | Chunk | Bytes on wire |
|---|-------|----------------|
| 0 | minimal push of 36-byte assetId | `0x24` + 36 bytes |
| 1 | minimal push of script-number `amount` | `0x51..0x60` alone for 1–16; else `<len>` + LE bytes |
| 2 | OP_2DROP | `0x6d` |
| 3 | OP_DUP | `0x76` |
| 4 | OP_HASH160 | `0xa9` |
| 5 | push of 20-byte pubKeyHash | `0x14` + 20 bytes |
| 6 | OP_EQUALVERIFY | `0x88` |
| 7 | OP_CHECKSIG | `0xac` |

Full serialized layout (amount ≥ 17):
`24 <36B assetId> <k> <k-byte scriptnum amount> 6d 76 a9 14 <20B pkh> 88 ac`
For amount 1–16 chunk 1 is the single opcode `0x51+amount−1` (no data). There is **no identifier/prefix marker**; token outputs are classified purely by shape (and off-chain payload).

**Lock rules**: `pubKeyHash` must be exactly 20 bytes; `amount` must be an integer ≥ 1 (JS number — practical max 2^53−1; Go: int64, validate ≤ 9007199254740991 for cross-compat). `lockBRC29` variant derives the key: `pubKeyHash = hash160(compressed derivePublicKey(protocolID, keyID, counterparty))` (BRC-42/43, §2.2; forSelf=false).

**Decode rules** (`MandalaToken.decode`) — throw/fail unless ALL hold:
1. Exactly 8 chunks.
2. `c[2].op == 0x6d` (OP_2DROP).
3. `c[3].op == 0x76`, `c[4].op == 0xa9`, `c[6].op == 0x88`, `c[7].op == 0xac`.
4. `c[0].data` present and exactly 36 bytes → assetId via `decodeAssetId`.
5. `amount = decodeScriptNumChunk(c[1])`; must be an integer ≥ 1.
6. `c[5].data` present and exactly 20 bytes → pubKeyHash.

Note the decoder does **not** check push-opcode minimality of chunks 0/5, and accepts either opcode-form or data-form numbers for chunk 1. Result: `{assetId string, amount int, pubKeyHash [20]byte}`.

**Unlock** (for completeness): standard P2PKH unlocking script `[<sig+hashtypeByte> <33B compressed pubkey>]`. Sighash: BIP143-style BSV preimage (`TransactionSignature.format`) with scope `SIGHASH_FORKID | (ALL|NONE|SINGLE) [| ANYONECANPAY]`; sign `SHA256(preimage)` with ECDSA (the SDK signs the single SHA256 here; hash256's second SHA is inside ECDSA), signature DER + 1 hashtype byte. Estimated unlock length 108 bytes.

### 1.4 MandalaAdmin locking script

Two shapes:

**Plain (5 chunks)** — standard P2PKH:
`76 a9 14 <20B pkh> 88 ac`

**With publicData (7 chunks)** — informational JSON prefix, pushed then dropped:
`<minimal push of UTF-8 JSON.stringify(publicData)> 75 76 a9 14 <20B pkh> 88 ac` (0x75 = OP_DROP)

No on-chain marker; admin outputs are classified via the off-chain `admin[]` payload.

**Key binding**: the P2PKH key is wallet-derived with
- `ADMIN_PROTOCOL = [2, "mandala admin"]`
- `keyID = commitment(actionDetails)` where

```
canonicalize(v):
  primitives / null      → JSON.stringify(v)   (exact JS JSON formatting)
  array                  → "[" + join(map(canon, v), ",") + "]"
  object                 → "{" + join(sortedKeys.map(k => JSON.stringify(k)+":"+canon(v[k])), ",") + "}"
                           (keys sorted by plain string comparison, code-unit order)
commitment(d) = lowercaseHex(SHA256(UTF8(canonicalize(d))))
```
Go note: numbers must serialize exactly as JS `JSON.stringify` (integers without decimal point; details arrive via JSON round-trip so exotic floats don't occur in practice, but match JS semantics).

- `counterparty` = `details.counterparty` if it is a string in the action payload, else `"self"`.
- `pubKeyHash = hash160(compressed derivePublicKey(ADMIN_PROTOCOL, keyID, counterparty, forSelf=false))` computed by the **admin wallet** (holder of the admin root key). `"self"` counterparty ⇒ counterparty pubkey = admin root identity key.

**Decode rules** (`MandalaAdmin.decode`):
1. If exactly 7 chunks: `c[1].op` must be 0x75 (OP_DROP); `c[0].data` must be present; `publicData = JSONparse(UTF8(c[0].data))`; P2PKH = chunks 2..6. Else must be exactly 5 chunks (P2PKH = all).
2. P2PKH shape: `p[0].op==0x76, p[1].op==0xa9, p[3].op==0x88, p[4].op==0xac`; `p[2].data` exactly 20 bytes.
3. Result `{pubKeyHash [20]byte, publicData map|nil}`.

**Unlock**: same P2PKH unlock; the signing key is `derivePrivateKey(ADMIN_PROTOCOL, commitment(data), counterparty)`; the pushed pubkey is the `forSelf=true` derivation (BRC-42 symmetry makes it hash to the locked pkh). Signature made over `hash256(preimage)` via `createSignature` (raw ECDSA over the 32-byte digest).

---

## 2. verifyKeyLinkage — exact crypto (BRC-42 / BRC-43 / BRC-72)

### 2.1 Invoice number (BRC-43)
```
invoiceNumber(protocolID=[level, name], keyID) = "<level>-<normName>-<keyID>"
normName = lowercase(trim(name))
```
Validation: `level ∈ {0,1,2}`; `1 <= len(keyID) <= 800`; `5 <= len(normName)`; `len(normName) <= 400` except names starting `"specific linkage revelation "` which may be up to 430; charset `[a-z0-9 ]` only; no `"  "` (double space); must not end with `" protocol"`.

### 2.2 BRC-42 child key derivation
Given root private key `a` (pubkey `A = aG`), counterparty pubkey `C` (counterparty root private `c`), and invoice number string `I`:
```
S      = ECDH point  = a·C  (== c·A)             // validate C on curve
hmac   = HMAC-SHA256( key = compress(S) [33B], msg = UTF8(I) )   // 32 bytes, interpret big-endian
derivePublicKey(forSelf=false)  = C + hmac·G      // the COUNTERPARTY's child pubkey
derivePublicKey(forSelf=true)   = A + hmac·G      // own child pubkey
derivePrivateKey                = (a + hmac) mod n // own child privkey
```
Counterparty normalization: `"self"` → own root pubkey; `"anyone"` → pubkey of privkey 1 (i.e. `G`); hex string → parse compressed point.

### 2.3 BRC-2 encryption primitive (what `wallet.encrypt`/`decrypt` do)
```
deriveSymmetricKey(protocolID, keyID, counterparty):
  I    = invoiceNumber(protocolID, keyID)
  Pub  = derivePublicKey(protocolID, keyID, counterparty, forSelf=false)   // counterparty child pubkey
  Priv = derivePrivateKey(protocolID, keyID, counterparty)                 // own child privkey
  P    = Priv · Pub          // ECDH of the two CHILD keys
  key  = P.x as 32-byte big-endian (left-padded)
ciphertext layout = IV(32 random bytes) || AES-256-GCM(key, IV, plaintext) || authTag(16 bytes)
```
Note the **32-byte GCM nonce** (not 12): in Go use `cipher.NewGCMWithNonceSize(aesBlock, 32)`; Go's GCM appends the 16-byte tag to the ciphertext, matching `ct||tag`. Decrypt: split IV = first 32 bytes, tag = last 16, verify+decrypt.

By BRC-42 symmetry the prover computes the same symmetric key with roles swapped, so verifier-side decryption works with only the verifier root key + prover identity pubkey.

### 2.4 What the prover produced (`revealSpecificKeyLinkage`)
- Linkage scalar (BRC-42 offset actually used to derive the token key):
  `L = HMAC-SHA256( key = compress(proverRoot · counterpartyPub), msg = UTF8(invoiceNumber(protocolID, keyID)) )` — 32 bytes.
- `encryptedLinkage = encrypt(L)` with `protocolID = [2, "specific linkage revelation <origLevel> <origName>"]` (origName embedded **as passed**, then normalized inside invoiceNumber), `keyID = original keyID`, `counterparty = verifier identity key`.
- `encryptedLinkageProof = encrypt([0x00])` same parameters; `proofType = 0`.

### 2.5 Verifier algorithm (`verifyKeyLinkage(linkage, verifierWallet)`)
1. **Decrypt L**: `plaintext = decrypt(linkage.encryptedLinkage)` using
   `protocolID = [2, "specific linkage revelation " + linkage.protocolID[0] + " " + linkage.protocolID[1]]`,
   `keyID = linkage.keyID`, `counterparty = linkage.prover` (§2.3, verifier root key). Full invoice number example for original `[2,"mandala token"]`, keyID `k`: `"2-specific linkage revelation 2 mandala token-k"`.
2. **Reconstruct derived key**: `L = bigEndianInt(plaintext)`; `derived = Point(linkage.counterparty) + (L mod n)·G`. `derivedKey` = compressed hex of `derived`.
3. `pubKeyHash = hash160(33-byte compressed derived pubkey)`.
4. Return `{ identityKey: linkage.counterparty, derivedKey, pubKeyHash }`.

The proof is **never checked** (proofType 0). Errors (bad point, GCM auth failure, malformed) propagate as failure.

`linkageControlsPubKeyHash(linkage, wallet, pkh)` = run the above; on any error → false; else constant-shape byte-equality of hashes (length + every byte).

### 2.6 Go primitives required
- secp256k1: point decompress/compress (SEC1), point addition, scalar mult, scalar-base mult, scalar add mod n (e.g. `dcrd/dcrec/secp256k1`)
- ECDH = plain scalar·point, output the point (compressed for HMAC key; x-coord 32B BE for AES key)
- HMAC-SHA256, SHA-256, RIPEMD-160 (`golang.org/x/crypto/ripemd160`)
- AES-256-GCM with 32-byte nonce, 16-byte tag
- Big-endian big-int decode; reduce mod n before scalar mult
- (only if signing needed) ECDSA/DER, BIP143 BSV sighash preimage

---

## 3. Topic manager (`tm_mandala`)

Entry point: `identifyAdmissibleOutputs(beef []byte, previousCoins []int, offChainValues []byte) → { outputsToAdmit []int, coinsToRetain []int }` **or error**. Rejections MUST be errors/throws (not empty instructions): the engine treats a thrown topic as failed and won't broadcast a tx every topic rejected; empty output would be indistinguishable from a legit consume-only tx. Log a warning with the reason before rethrowing.

Dependencies:
- `verifierWallet` — holds verifier root key (for §2 decrypt)
- `adminWallet` + `adminProtocolID` — admin root key + protocol (normally `[2,"mandala admin"]`) for re-deriving admin lock keys
- `screeningProvider.isSanctioned(identityKeyHex) → bool`
- `stateStore.getAssetState(assetId) → AssetAdminState` (§5/§6) and `getTokenRow(txid, vout)` (present in the interface; the gate logic itself only uses `getAssetState` — frozen amounts ride in state)

### 3.1 Parse
1. `tx = Transaction.fromBEEF(beef)` (inputs carry `sourceTransaction`/`sourceTXID`; source outputs available for `previousCoins` and control-gate scans).
2. `payload` = decode off-chain JSON (§0.5) or `{inputs:[],outputs:[]}` if nil.

### 3.2 Classify outputs
Build `adminDetails: map[outputIndex]actionDetails` from `payload.admin`. For each output `i` in order:
- Try `MandalaToken.decode(lockingScript)` → if success, record FT output `{index, assetId, amount, pubKeyHash}`; continue.
- Else **verifyAdminOutput**:
  a. `MandalaAdmin.decode` — fail → not admin, skip output.
  b. `details = adminDetails[i]` — missing → **not admitted** (skip).
  c. `counterparty = details.counterparty` if string else `"self"`. Re-derive: `expected = hash160(derivePublicKey(adminProtocolID, commitment(details), counterparty, forSelf=false))` using the admin wallet; must byte-equal the decoded pkh.
  d. **priorOutpointSpent**: `kind == "register"` → true. Else `details.priorOutpoint` must be a string AND some tx input satisfies `"<sourceTXID||sourceTx.id(hex)||''>.<sourceOutputIndex>" == priorOutpoint`. (This chains every admin action to spending the previous admin-auth output.)
  e. If c or d fails → not admitted. Else: admitted admin output at index `i`; if `details.assetId` is a string, record `verifiedAdminAssetKinds[assetId] = details` (this verified map — never the raw payload — is the source of the admin exemption in the control gate).
  f. **Issuance credit** per admitted admin output: `kind ∈ {issue, reissue}` with string assetId → `authorizedIssuance[assetId] += details.amount ?? 0`. `kind == redeem` with string assetId → `authorizedIssuance[assetId] += −(details.amount ?? 0)` (negative delta so partial redeems satisfy conservation). Other kinds: no credit.

### 3.3 Verify FT outputs (key linkage)
For each FT output: find `payload.outputs` entry with matching index; **missing linkage → silently not admitted** (skip, no error). Run `verifyKeyLinkage` (§2.5); admit only if derived `pubKeyHash` byte-equals the on-chain pkh. Admitted FT records `identityKey = linkage.counterparty`.

### 3.4 Conservation (throws `"conservation violated..."` on failure)
- `outTotals[assetId]` = sum of amounts of **admitted** FT outputs.
- `inTotals[assetId]` = for each index `ci` in `previousCoins`: take `tx.inputs[ci].sourceTransaction.outputs[sourceOutputIndex]`; if absent skip; try `MandalaToken.decode` on its locking script (failure → skip, non-token coin); accumulate amount by assetId.
- For every assetId **present in outTotals**: require `outAmt == inAmt + authorizedIssuance[assetId]` (missing map entries = 0). Assets appearing only on the input side are unconstrained here (consume-only, e.g. full redeem — the redeem admin output is what gets admitted).

### 3.5 Sanctions screening (throws `"sanctioned party involved in transfer"`)
Identity set = all admitted-FT `identityKey`s ∪ `verifyKeyLinkage(inp.linkage).identityKey` for **every** `payload.inputs` entry. NOTE: here a linkage verification error is **not** caught — it propagates and rejects the whole tx (asymmetric with §3.6 sender resolution, which tolerates failures). If `isSanctioned(key)` for any key → reject.

### 3.6 Control gate (throws `"control gate rejected..."` on failure)
Asset universe = admitted-FT assetIds ∪ assetId of every tx input whose source output decodes as MandalaToken (**all** `tx.inputs`, not just previousCoins). `inputOutpoints` = every input as `"<sourceTXID||sourceTx id||''>.<idx>"`.

`resolveSenders()` (lazy, computed once, shared): for each `payload.inputs` entry, `verifyKeyLinkage(...).identityKey`; **errors caught and skipped** (unverifiable input ⇒ not counted as a party).

For each asset X in the universe, with `state = getAssetState(X)`:
- `frozen = set(state.frozenOutpoints[].outpoint) ∪ set(state.evictedOutpoints)`
- **Gate 1 — frozen/evicted spend (ALL txs, admin included)**: any element of `inputOutpoints` ∈ frozen → reject. (Blocks even redeems of frozen coins; only unfreeze or reissue resolves.)
- `adminAction = verifiedAdminAssetKinds[X]`; `isAdmin = adminAction != nil`. A tx is an "issuer admin action for X" iff it carries a **verified** admin output whose actionDetails.assetId == X; otherwise its movement of X is a peer transfer.
- **Gate 2 — pause (peer transfers only)**: `state.isPaused && !isAdmin` → reject.
- **Gate 3 — access mode (peer transfers only)**: `parties = [identityKeys of admitted FT outputs with assetId==X] ++ resolveSenders()`, then remove any key equal to `state.issuerIdentityKey`. `accessMode == "denylist"`: reject if any party ∈ `blockedIdentities`. `accessMode == "allowlist"` (any other value): reject if any party ∉ `allowedIdentities`.
- **Reissue guards** (when `adminAction.kind == "reissue"`), reject if ANY of:
  (a) `adminAction.outpoint` (string, else `""`) is not in `state.frozenOutpoints`;
  (b) the frozen ref's `amount != adminAction.amount`;
  (c) any tx input's source output decodes as a MandalaToken with assetId X (reissue must carry **zero** FT inputs of X).

### 3.7 Result
`outputsToAdmit` = admitted FT indices ∪ admitted admin indices, sorted ascending. `coinsToRetain = previousCoins` unchanged. Metadata: name `"tm_mandala"`.

---

## 4. Lookup service (`ls_mandala`)

Modes: `admissionMode = "whole-tx"`, `spendNotificationMode = "script"`. All handlers ignore payloads whose `topic != "tm_mandala"`; admission handler additionally requires `mode == "whole-tx"`.

### 4.1 `outputAdmittedByTopic({mode:"whole-tx", atomicBEEF, outputIndex, topic, offChainValues?})`
Called once per admitted output. `tx = fromBEEF(atomicBEEF)`, `txid = tx.id(hex)`, `ls = tx.outputs[outputIndex].lockingScript`.

**Case FT** (`MandalaToken.decode` succeeds):
1. `identityKey = ""`, `matchedLinkage = nil`. If offChainValues present: decode payload; find `outputs[]` entry with `index == outputIndex`; if found, `verifyKeyLinkage` → `identityKey = result.identityKey`, keep the linkage. (A verification error here propagates — the engine call fails.)
2. `storeToken({txid, outputIndex, assetId, amount, identityKey, createdAt: now})` (insert; unique on outpoint).
3. If `identityKey != ""`: `adjustBalance(identityKey, +amount)`; and if a linkage matched, `storeLinkage({txid, outputIndex, identityKey, linkage, createdAt: now})` (encrypted linkage retained ≥ 5 years — no TTL).

**Case not FT** → `indexAdminOutput`:
1. `MandalaAdmin.decode`; failure → return (not mandala).
2. If `publicData != nil`: `storeMetadata({txid, outputIndex, assetId: "<txid>.<outputIndex>"})` (upsert). Register's publicData is served under its own outpoint (= assetId).
3. Decode payload (or empty); find `admin[]` entry with `index == outputIndex`; **missing → return** (metadata may still have been stored).
4. `details = entry.actionDetails`. `assetId = details.assetId` if non-empty string else `"<txid>.<outputIndex>"` (register case — self-referential genesis).
5. Ordering `txOrdering(tx)`: if the tx has no merkle path → `{height: 9007199254740991 (MAX_SAFE_INTEGER), offset: 0}`; else `height = merklePath.blockHeight`, `offset` = the offset of the level-0 leaf whose `hash == txid` (display hex) **and** `txid` flag true, defaulting to 0 if no such leaf.
6. `admitSeq = storage.nextAdmitSeq()` (global monotonically increasing counter).
7. `appendAdminHistory({assetId, txid, outputIndex, height, offset, admitSeq, actionDetails: details, createdAt: now})`.
8. Build `FoldContext`:
   - `kind == "register"` and `details.issuer` is string → `ctx.issuer = details.issuer` (sourced from persisted actionDetails, NOT publicData, so live admit and rebuild agree).
   - `kind == "freezeOutput"` and `details.outpoint` is string → split at `"."`, `row = getTokenRow(ftxid, vout)`; if found → `ctx.frozenAmount = row.amount`, `ctx.frozenOwner = row.identityKey`.
9. `prev = getAssetState(assetId)` (default if absent); `next = foldAction(prev, details, ctx)` (§6); set `next.lastProcessedHeight = height`, `lastProcessedOffset = offset`, `lastAdmitSeq = admitSeq`; `putAssetState(next)` (upsert).

### 4.2 `rebuildState(assetId) → AssetAdminState`
Read full admin history for the asset **sorted by (height asc, offset asc, admitSeq asc)**; fold from `defaultAssetState(assetId)` with the same per-entry ctx sourcing as 4.1 step 8 (freezeOutput row lookup against current token rows; register issuer from actionDetails). Persist and return. (Does not update the lastProcessed* fields.) Must be deterministic regardless of insert order — the sort provides ordering.

### 4.3 `outputSpent({mode:"script", txid, outputIndex, topic, ...})`
If topic matches: if a token row exists for (txid, outputIndex) (checked via `findByOutpoint` non-empty) then re-fetch via `getTokenRow`; if found and `identityKey != ""` → `adjustBalance(identityKey, −amount)`. Then `deleteToken(txid, outputIndex)` unconditionally.

### 4.4 `outputEvicted(txid, outputIndex)`
`deleteToken` + `deleteMetadata` for the outpoint. (No balance adjustment.)

### 4.5 `lookup(question)` — dispatch on `question.query`, in this precedence order
1. `query.metadataAssetId` (string) → `findMetadataByAssetId` → `[{txid, outputIndex}]` (UTXO references; engine hydrates BEEF).
2. `query.assetStateAssetId` (string) → `[AssetAdminState]` — single-element array, **not** a UTXO shape (the TS code force-casts past the LookupFormula type; in Go, the response is the raw state document array).
3. `query.adminHistoryAssetId` (string) → `AdminHistoryEntry[]` sorted (height, offset, admitSeq) — also non-UTXO shape.
4. `query.assetId` (string) → token UTXO refs for the asset, **excluding** outpoints listed in that asset's `state.evictedOutpoints`.
5. `query.txid` (string) **and** `query.outputIndex` (number) → UTXO refs matching the outpoint (0 or 1 rows).
6. Otherwise → error `"Unsupported query"`.

**No identity/balance query is exposed** (balances are internal only). Metadata: name `"ls_mandala"`.

---

## 5. State store — MandalaStorageManager (MongoDB)

Seven collections (indexes created lazily once, on first use):

| Collection | Document | Indexes |
|---|---|---|
| `mandalaTokens` | `{txid, outputIndex, assetId, amount, identityKey, createdAt}` | `(txid,outputIndex)` **unique**; `assetId`; `identityKey` |
| `mandalaLinkageRecords` | `{txid, outputIndex, identityKey, linkage: SpecificLinkage, createdAt}` | `(txid,outputIndex)`; `identityKey` — **deliberately no TTL** (retention ≥ 5 years) |
| `mandalaBalances` | `{identityKey, balance}` | `identityKey` **unique** |
| `mandalaMetadata` | `{txid, outputIndex, assetId}` | `(txid,outputIndex)` **unique**; `assetId` |
| `mandalaAssetStates` | `AssetAdminState` (§6) | `assetId` **unique** |
| `mandalaAdminHistory` | `AdminHistoryEntry` = `{assetId, txid, outputIndex, height, offset, admitSeq, actionDetails, createdAt}` | `(assetId, height, offset, admitSeq)` |
| `mandalaCounters` | `{_id: "admitSeq", seq}` | — |

Operations (all ensure indexes first):
- `storeToken(rec)` — plain insert; duplicate outpoint violates the unique index (error propagates).
- `storeLinkage(rec)` — plain insert.
- `adjustBalance(identityKey, delta)` — upsert `$inc balance`.
- `deleteToken(txid, vout)` — delete one.
- `findByAssetId(assetId)` — project `{txid, outputIndex}` for matching tokens, then filter out outpoints in `getAssetState(assetId).evictedOutpoints`.
- `findByOutpoint(txid, vout)` — project `{txid, outputIndex}`.
- `getTokenRow(txid, vout)` — full row or nil.
- `getBalance(identityKey)` — balance or 0.
- `storeMetadata(rec)` — upsert by outpoint (`$set` whole record).
- `findMetadataByAssetId(assetId)` — project `{txid, outputIndex}`.
- `deleteMetadata(txid, vout)` — delete one.
- `getAssetState(assetId)` — find (excluding Mongo `_id`) or `defaultAssetState(assetId)`.
- `putAssetState(state)` — upsert by assetId (`$set`).
- `appendAdminHistory(entry)` — insert.
- `findAdminHistoryByAssetId(assetId)` — all entries (no `_id`), sorted `(height 1, offset 1, admitSeq 1)`.
- `nextAdmitSeq()` — atomic `findOneAndUpdate {_id:"admitSeq"} $inc seq:1, upsert, return after`; fallback 1.
- `findStateByAssetId(assetId)` — `[getAssetState(assetId)]`.

The topic manager's `stateStore` dependency is satisfied by `getAssetState` + `getTokenRow` from this same store.

---

## 6. AssetAdminState reducer

```
FrozenRef { outpoint string, amount int, owner string }

AssetAdminState {
  assetId             string
  issuerIdentityKey   string        // "" default
  isPaused            bool          // false default
  accessMode          "denylist" | "allowlist"   // "denylist" default
  blockedIdentities   []string      // [] default
  allowedIdentities   []string      // [] default
  frozenOutpoints     []FrozenRef   // [] default
  evictedOutpoints    []string      // [] default
  lastProcessedHeight int           // 0 default
  lastProcessedOffset int           // 0 default
  lastAdmitSeq        int           // 0 default
}
```

`foldAction(state, details, ctx) → newState` is **pure** (copy-on-write; arrays replaced, never mutated). Per `details.kind`:

| kind | effect |
|---|---|
| `register` | if `ctx.issuer` is string → `issuerIdentityKey = ctx.issuer` |
| `pause` | `isPaused = true` |
| `unpause` | `isPaused = false` |
| `blockIdentity` | if `details.identityKey` string → add to `blockedIdentities` (unique-append: no-op if present) |
| `unblockIdentity` | remove `details.identityKey` from `blockedIdentities` |
| `allowIdentity` | unique-append to `allowedIdentities` |
| `unallowIdentity` | remove from `allowedIdentities` |
| `setAccessMode` | if `details.mode ∈ {denylist, allowlist}` → `accessMode = mode` |
| `freezeOutput` | if `details.outpoint` string → remove any existing FrozenRef for that outpoint, append `{outpoint, amount: ctx.frozenAmount ?? 0, owner: ctx.frozenOwner ?? ""}` |
| `unfreezeOutput` | remove FrozenRef for `details.outpoint` |
| `reissue` | remove FrozenRef for `details.outpoint`; unique-append `details.outpoint` to `evictedOutpoints` |
| `issue`, `redeem`, unknown | **no state change** |

---

## 7. Port-critical gotchas (summary)

1. Amounts 1–16 appear as OP_1..OP_16 opcode chunks with no data — decode both forms; on-chain assetId txid is **reversed** (internal order) vs the display-hex string form used everywhere off-chain.
2. AES-256-GCM uses a **32-byte IV** (`NewGCMWithNonceSize(…, 32)`), layout `iv||ct||tag16`; symmetric key = 32-byte BE x-coordinate of child-key ECDH; HMAC key for BRC-42 offsets = **compressed 33-byte** ECDH point.
3. Invoice-number protocol name is lowercased+trimmed; the linkage-revelation wrapper protocol is `[2, "specific linkage revelation <lvl> <name>"]` with the **original** keyID; reduce L mod n before `L·G`.
4. The linkage **proof is never verified** (proofType 0); `identityKey` is taken from `linkage.counterparty` after confirming `hash160(counterparty + L·G)` equals the on-chain pkh.
5. Rejections in the topic manager **throw**; missing/unmatched output linkage merely skips that output (silent non-admission), but a bad linkage in `payload.inputs` throws during sanctions screening while the same failure is tolerated during control-gate sender resolution.
6. Admin exemption comes only from **verified** admin outputs (pkh re-derivation via `commitment(actionDetails)` canonical JSON + priorOutpoint spend check), never from the raw payload; register needs no priorOutpoint.
7. `redeem` credits **negative** issuance so partial burns satisfy `out == in + issued`; reissue requires target frozen + exact amount match + zero FT inputs of that asset; frozen/evicted-input Gate 1 applies to ALL txs including admin/redeem.
8. Control-gate asset universe scans **all** tx inputs' source outputs (not just previousCoins); conservation scans only `previousCoins`; issuer identity is excluded from access-mode party checks.
9. Admin-history ordering key is `(height, offset, admitSeq)` with unconfirmed sentinel `height = 9007199254740991`; `admitSeq` is a global atomic counter; `rebuildState` must equal live folding (issuer sourced from actionDetails, frozen amount/owner from token rows).
10. Verification requires the verifier root **private** key (decrypt) and the admin root private key (admin pkh re-derivation) — plan Go key material accordingly; balances are internal-only, never exposed via lookup.