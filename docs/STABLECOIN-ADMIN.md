# Mandala Stablecoin — Operator Guide

> Covers the issuer-facing admin controls, what each one does, what the overlay
> enforces, and how to verify the audit trail. For the broader architecture see
> `docs/PROJECT-STATE.md`.

_Last updated: 2026-06-30. Branch `mandala-stablecoin-spike`._

---

## 1. Control model

Every admin action is an on-chain BSV transaction that spends the issuer's
current **admin-auth UTXO** and produces the next one. The locking key of each
auth output is derived from `commitment(canonicalize(actionDetails))`, so a
given output is cryptographically tied to exactly one action and its parameters.
This forms an unbroken, verifiable chain — the **auth chain** — that only the
issuer's wallet can extend.

Derived enforcement state (`AssetAdminState`) is folded from the ordered
admin-action history by the overlay's lookup service and read by the topic
manager. The lookup service is the single writer; the topic manager only reads.
An action takes effect for transfers submitted **after** the admin tx is
admitted and indexed (one-submit enforcement lag — see §7).

---

## 2. Admin controls

### pause / unpause

**What it does.** Toggles a global pause flag for the asset. While paused, all
peer-to-peer transfers of that asset are rejected by the overlay. The issuer's
own admin actions (unfreeze, reissue, unpause) are not blocked.

**What the overlay enforces (Gate 2).** For each admitted tx: if
`state.isPaused` and the tx is a peer transfer (no verified admin output for
this asset), reject.

**Use case.** Emergency suspension during an incident; regulatory halt.

---

### blockIdentity / unblockIdentity

**What it does.** Adds or removes an identity key from the `blockedIdentities`
denylist. Effective only when `accessMode` is `'denylist'` (the default).

**What the overlay enforces (Gate 3, denylist mode).** For peer transfers,
collect the identity keys of FT input senders (from input linkage) and FT output
recipients. Reject if any key is in `blockedIdentities`. The issuer's own
identity key is always authorized. Admin actions (issue/recover/reissue) are
exempt — the issuer can still reissue a frozen coin to a blocked rightful owner.

---

### allowIdentity / unallowIdentity

**What it does.** Adds or removes an identity key from the `allowedIdentities`
allowlist. Effective only when `accessMode` is `'allowlist'`.

**What the overlay enforces (Gate 3, allowlist mode).** For peer transfers,
reject if any party (sender or recipient) is not in `allowedIdentities`. The
issuer's identity key is always authorized. Admin actions are exempt.

**Footgun guard.** Switching to allowlist mode with an empty `allowedIdentities`
list locks out all non-issuer peer transfers. The `RegulatoryControls` UI
requires at least one allowed identity before switching modes.

---

### setAccessMode

**What it does.** Sets `accessMode` to `'denylist'` or `'allowlist'`, selecting
which list the overlay enforces for peer transfers.

**Default.** `'denylist'` (open transfers, only explicitly blocked identities
are rejected). Switching to `'allowlist'` inverts the model to closed-loop.

---

### freezeOutput / unfreezeOutput

**What it does.** Adds or removes a specific FT outpoint (by `txid.outputIndex`)
from `frozenOutpoints`. The stored record includes the outpoint, the FT amount
at the time of freezing, and the owner's identity key.

**What the overlay enforces (Gate 1 — universal, no exemptions).** Any tx that
spends a frozen outpoint as an input is rejected — **for all tx types**, including
issuer `recover` and `redeem`. This is intentional: the only valid resolutions
for a frozen coin are `unfreezeOutput` (restore normal access) or `reissue`
(evict the frozen coin and mint a replacement). Attempting to spend a frozen coin
via recover/redeem is blocked.

**Holder experience.** The holder's `AssetAccount` view shows an alert banner
("$X.XX of your balance has been frozen") computed by intersecting their wallet
outputs with `state.frozenOutpoints`.

---

### reissue

**What it does.** Targets an already-frozen outpoint; evicts it (making it
permanently unspendable via this overlay) and mints an equal-amount FT output to
the specified recipient identity key. Sends the minted tokens to the recipient
via the message box.

**What the overlay enforces.** Three guards in addition to the base gates:
(a) `details.outpoint` must be in `frozenOutpoints`; (b) `details.amount` must
equal the stored `FrozenRef.amount` (recorded at freeze time); (c) the reissue tx
must have zero FT inputs of this asset (`in == 0`), preventing inflation via
minting on top of moved inputs. The `+amount` authorized issuance satisfies the
standard conservation check (`out == in + authorized`).

**Optional `bankRef`.** A banking reference string (e.g. `BR-1042`) can be
included in `actionDetails.bankRef`. It is committed into the auth key derivation
and appears in the audit log. It is not in the public on-chain script but is
visible to the overlay operator in plaintext.

**Off-chain-only conservation note.** A reissue increases the on-chain FT token
count by `amount`. Net supply is unchanged **only in the overlay's derived
balance view**, where the evicted outpoint is excluded as a query-time filter.
This is not an on-chain invariant. A different overlay that admitted the evicted
coin's spend would double-count. This trade-off is accepted by design — do not
remove the Gate 1 eviction check or the evicted-outpoint filter, as doing so
would reintroduce inflation.

---

## 3. One-submit enforcement lag

Admin actions take effect for transfers submitted **after** the admin tx has been
both admitted (Phase 1 of `@bsv/overlay`'s Engine) **and** indexed by the lookup
service (Phase 3). Because Phase 1 runs before Phase 3 in every submit cycle:

- An admin action admitted in submit *N* gates transfers from submit *N+1* onward.
- Submit *N* itself is not subject to the new control (the state hasn't been
  folded yet).

In practice this lag is sub-second (the next submit after the admin tx). It is
well ahead of block confirmation (minutes) but operators should not expect the
same submit to be blocked.

---

## 4. Frozen-coin resolution paths

Once an outpoint is frozen, the valid resolutions are:

| Resolution | Steps | Effect |
|---|---|---|
| **Unfreeze** | Submit `unfreezeOutput` for that outpoint | Removes from `frozenOutpoints`; the coin can be spent normally again. |
| **Reissue** | Submit `reissue` naming the frozen outpoint + recipient + amount | Evicts the frozen outpoint; mints equal amount to recipient. Net supply unchanged in overlay view. |

**Blocked paths:** `recover` and `redeem` of a frozen coin are **rejected by
Gate 1** (they would spend the frozen input). Do not attempt them; use reissue
instead.

---

## 5. Sanctions screening

Separate from access-mode controls. `ScreeningProvider.isSanctioned` is called
for **every** identity key the tx touches, including admin-action parties. No
issuer override exists for sanctions: you cannot reissue or recover to a
sanctioned key. Access-mode screening (§2 gate 3) is a distinct check that
applies only to peer transfers and exempts admin actions. Do not conflate the two.

---

## 6. Audit log and proof verification

`GET /admin/admin-history/:assetId` returns `AdminHistoryRow[]` ordered by
`(height, offset, admitSeq)`. Each row carries:

```
txid, outputIndex, priorOutpoint, kind, assetId, [action-specific fields],
height, offset
```

The app's `exportAdminHistoryCsv` serialises the following columns per row:

| Column | Content |
|---|---|
| `txid` | Transaction ID |
| `outputIndex` | Output index of the admin auth output in the tx |
| `priorOutpoint` | The auth UTXO this action spent |
| `kind` | Action kind |
| `canonicalDetailsJson` | `MandalaAdmin.canonicalize(actionDetails)` — the exact JSON used to derive the key |
| `commitment` | `MandalaAdmin.commitment(actionDetails)` = sha256 of `canonicalDetailsJson` — this is the `keyID` |
| `height` | Block height (or `Number.MAX_SAFE_INTEGER` if unconfirmed) |
| `offset` | In-block merkle leaf offset |
| `description` | Human-readable description |

### Verification recipe

To independently verify an audit-log row:

1. **Re-derive the expected admin pubKeyHash.**
   - Take `canonicalDetailsJson` from the CSV row.
   - Compute `sha256(canonicalDetailsJson)` — this must equal `commitment`.
   - Use `commitment` as `keyID` and call `getPublicKey({ protocolID: [2, 'mandala admin'], keyID: commitment, counterparty: 'self' })` on the issuer's overlay wallet (or the public key the overlay was initialised with). Hash the result with `hash160` → `expectedPubKeyHash`.
   - Fetch the tx by `txid` and decode `outputs[outputIndex]` as a `MandalaAdmin` script. Compare its `pubKeyHash` against `expectedPubKeyHash`. A match proves this output was produced by the legitimate overlay/issuer key for exactly these action parameters.

2. **Verify the auth-chain order.**
   - Follow `priorOutpoint` from row to row. Each row's admin output (`txid.outputIndex`) should equal the next row's `priorOutpoint`. Gaps indicate a missing row; forks indicate a branch (should not occur under normal operation).

3. **SPV-verify each txid.**
   - Each txid can be verified against its block header using the `height` and `offset` columns and a BSV SPV library (e.g. `Transaction.verify(new WhatsOnChain('main'))`).

4. **Reissue cross-check.**
   - For a `reissue` row, confirm that the `outpoint` field (the frozen outpoint) appears as a `freezeOutput` in an earlier row, and that the `amount` fields match.

---

## 7. Banking reconciliation

`BankingMock` (front-end only, no backend persistence) tracks:

- **Bank balance** = sum of simulated ACH/wire deposits − withdrawals.
- **Net circulating supply** = total `issued` base units − total `redeemed` base
  units. `reissue` is net-zero in the overlay view (evicted coin is excluded from
  the supply sum), so it does not appear as drift.

A redemption reduces `netSupply` without reducing `bankBalance` (the bank leg of
a redemption — the return of fiat to the holder — is modeled as a withdrawal and
must be accounted for in the bank-balance sum). The reconciliation view flags
genuine drift only when these two figures diverge after correct accounting.

---

## 8. Quick-reference: action → overlay effect

| kind | `isPaused` | `blockedIdentities` | `allowedIdentities` | `frozenOutpoints` | `evictedOutpoints` | `accessMode` |
|---|---|---|---|---|---|---|
| `pause` | → `true` | — | — | — | — | — |
| `unpause` | → `false` | — | — | — | — | — |
| `blockIdentity` | — | add key | — | — | — | — |
| `unblockIdentity` | — | remove key | — | — | — | — |
| `allowIdentity` | — | — | add key | — | — | — |
| `unallowIdentity` | — | — | remove key | — | — | — |
| `setAccessMode` | — | — | — | — | — | → `mode` |
| `freezeOutput` | — | — | — | add `{outpoint,amount,owner}` | — | — |
| `unfreezeOutput` | — | — | — | remove outpoint | — | — |
| `reissue` | — | — | — | remove outpoint | add outpoint | — |
