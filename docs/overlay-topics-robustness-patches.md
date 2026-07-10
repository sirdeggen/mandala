# @bsv/overlay-topics — required robustness patches (upstream)

Findings from the 2026-07-09 robustness audit that live INSIDE the
`@bsv/overlay-topics` engine and must ship as a ts-stack PR (this repo only
consumes the package). Ordered by severity. File/line references are against
the version pinned by `overlay/package.json`.

## 1. Reissue inflates the balance ledger (supply violation)

`MandalaLookupService.ts` — reissue mints `amount` new units to the issuer
(credited in `outputAdmittedByTopic`), but the original frozen coin's credit
is never debited: `outputEvicted` deletes the token row without an
`adjustBalance`, and the reissue reducer only appends to `evictedOutpoints`.
The frozen coin is never spent (guard (c) forbids it as an FT input), so
`outputSpent`'s debit never fires either.

**Fix:** when a reissue is folded (and equivalently in `outputEvicted` for the
reissued source), debit the evicted coin's owner by its amount in the same
storage operation that records the eviction. Add a regression test: freeze →
reissue → sum of all balances unchanged.

## 2. outputSpent double-debit TOCTOU (ledger corruption)

`MandalaLookupService.ts:150` — `outputSpent` reads the token row, then
`adjustBalance(-amount)` via unconditional `$inc`, then `deleteToken`. Two
concurrent spend notifications for one outpoint both pass the exists-check and
both debit.

**Fix:** make the delete the guard: `findOneAndDelete` the token row first and
debit ONLY when this call actually removed it (the delete is the atomic
claim). No lock needed.

## 3. Control gate reads stale admin state (freeze/block bypass window)

`MandalaTopicManager.ts:226` — `identifyAdmissibleOutputs` reads
`getAssetState` while admin actions fold asynchronously in
`outputAdmittedByTopic`. A transfer validated between an admin action's
admission and its fold bypasses the new rule (banned party receives funds,
frozen coin moves).

**Fix:** serialize per-asset: fold admin actions and evaluate the control gate
under one per-assetId mutex (or re-read + re-check state inside the admission
transaction). At minimum, fold admin admissions synchronously before returning
from the admin tx's admission.

## 4. Admin-history rows duplicate on re-admit (phantom supply in summaries)

`MandalaStorageManager.ts:130` — `appendAdminHistory` is `insertOne` with a
non-unique index; GASP re-sync / reorg replay re-admits the same tx and
duplicates the row, double-counting issue/redeem totals downstream.

**Fix:** unique index on `(assetId, txid, outputIndex)` + upsert (ignore
duplicate key). Note: `overlay/src/index.ts` in the demo now dedups in the
`/admin/admin-summary` aggregation as a consumer-side mitigation — remove that
once this lands.

## 5. Admit-time (height, offset) never refreshed (terminal state mis-order)

`ordering.ts:3` — txs admitted unconfirmed persist `height =
MAX_SAFE_INTEGER` in adminHistory forever; `rebuildState` sorts by
(height, offset, admitSeq), so a freeze/unfreeze pair can fold in the wrong
order after confirmation.

**Fix:** update stored (height, offset) when the merkle proof arrives
(the engine already refreshes proofs); or sort rebuildState by admitSeq alone
when any row still has sentinel height.

## 6. Freeze of an already-spent outpoint records a zombie ref

`AssetStateReducer.ts:52` — `frozenOutpoints` gets `{amount: 0, owner: ''}`
when the target coin's row is gone; later reissue against it can only mint 0.

**Fix:** reject the freeze admission outright when `getTokenRow` returns null
(the coin is spent — freezing it is meaningless), surfacing a clear error to
the admin.

## 7. Broadcast-failure compensation parity (verify against Go port)

`overlay-go/internal/httpapi/submit.go` + `storage.go` snapshot input tokens
before engine Submit and restore them when the Arcade broadcast fails, because
OutputSpent deletes rows/debits balances mid-Submit. The TS side relies on
`throwOnBroadcastFailure` + "broadcast before fold" ordering. These two claims
contradict — verify the pinned engine's actual ordering; if fold precedes (or
interleaves) broadcast, port the Go SnapshotTokens/RestoreTokens seam into the
TS storage manager.

## 8. Allowlist mode with empty allowlist bricks transfers (confirm intended)

`MandalaTopicManager.ts:196` — `setAccessMode('allowlist')` with an empty
`allowedIdentities` rejects every non-issuer transfer until the first
allowIdentity folds. Deny-by-default may be the intended compliance posture —
if so, document it; if not, require ≥1 allowlisted identity before accepting
the mode switch (client already permits the empty switch deliberately, see
commit 3706d9d).
