# Frozen / evicted output ban-sync via poll endpoint

**Date:** 2026-07-07
**Status:** Approved design — ready for implementation plan

## Problem

When an admin freezes a token output, the overlay rejects any tx that tries to
spend it — but the holder's wallet has no way to know ahead of time. It will
happily select the frozen output as a coin-selection input, build a transfer,
and only discover the freeze when the overlay rejects the whole tx. Worse, when
an admin **evicts** an output (via `reissue`, which reassigns the value to a new
holder), the original holder's wallet still carries a now-dead basket output
that will never spend.

The holder wallet needs to learn, before a spend, which of its outputs are:

1. **Frozen** — temporarily unspendable; may later unfreeze. Exclude from coin
   selection, keep in the basket.
2. **Evicted** — permanently gone (reissued to someone else). Relinquish from
   the basket so nothing stale lingers.

Holders should also see a human-readable **reason** for a freeze, and admins
should be able to attach a reason to any admin action.

## Approach chosen

**Poll the existing admin-state endpoint.** `/admin/asset-state/:assetId`
already returns `frozenOutpoints`, `evictedOutpoints`, and `issuerIdentityKey`
(see `app/src/lib/mandala/adminState.ts`). It has no auth (only wildcard CORS),
which is correct here: the data is read-only derived state, already inferable
from public overlay lookups and on-chain data, and the overlay is the real
enforcer of the freeze.

Rejected alternatives:

- **Messagebox push** (admin sends a freeze order to the owner's inbox): needs a
  new inbox route, output-tagging via `internalizeAction`, and sender
  verification. The endpoint already carries authoritative state, so this is
  redundant plumbing.
- **Hybrid** (endpoint for correctness + messagebox for a UX ping): deferred.
  Can be layered on later without changing the endpoint-driven core.

**Why no sender verification is needed:** the overlay only writes an outpoint
into `evictedOutpoints` after it has validated the issuer's authenticated
`reissue` transaction. The holder trusts the endpoint because the overlay
already did the authority check when it admitted that tx. The endpoint being
public/unauthenticated does not affect integrity — it is read-only.

## Reason plumbing (verified safe)

`reason` rides **inside the committed action-details map**, not as a new payload
field.

- Go `ActionDetails` is `map[string]any` (`payload.go:189`); `reason` is just
  another key read via `details.Str("reason")`.
- The admin locking key derives from `Commitment(details)`, canonicalized
  identically on both sides (`admin.go:152` `canonicalize` sorts map keys
  generically and mirrors the TS `commitment()`; verified). Adding `reason` is
  symmetric — the key derivation stays consistent.
- TS `MandalaActionDetails` has an open index signature `[k: string]: unknown`
  (`@bsv/templates` `MandalaAdmin.d.ts:19`), so `reason` compiles with **no
  `@bsv/templates` change**. (`bankRef?` is an existing precedent.) Optionally a
  later ts-stack PR could add `reason?: string` for discoverability — not
  required for this work.

Because the full `ActionDetails` map is already persisted on each
`AdminHistoryEntry` (`storage.go:58`) and re-folded on rebuild, reason survives
rebuild-from-chain automatically for every action kind.

## Scope

`overlay/` (TS) is legacy-thin (only `index.ts`/`activity.ts`/`genKey.ts`, no
reducer). **`overlay-go` is the only overlay implementation to change.**

---

## Component changes

### A. Overlay (Go) — `overlay-go/`

Only **freeze** reason lives in `AssetAdminState` (the holder displays it on the
Send view). Evict, block, allow, unallow, pause and access-mode reasons are
captured for audit in `AdminHistoryEntry.ActionDetails` **automatically** — the
full details map (including `reason`) is already persisted per history entry
(`storage.go:58`) and surfaced by the `/admin/admin-history/:assetId` endpoint.
No reducer or state change is needed for those; they only require the TS form to
put `reason` in `details`. This keeps `EvictedOutpoints []string` unchanged,
avoiding churn to the topic-manager eviction-enforcement path
(`topic_manager.go:405`) and the wire format.

**A1. `internal/mandala/reducer.go`**
- `FrozenRef` gains `Reason string \`json:"reason" bson:"reason"\``.
- `FoldAction` `freezeOutput` case: read `reason, _ := details.Str("reason")`
  and set it on the appended `FrozenRef`.
- Everything else (`reissue`/`EvictedOutpoints`, block/allow/pause,
  `DefaultAssetState`, `removeFrozen`): **no change**.

**A2. `internal/httpapi/admin.go` / endpoint**
- No handler change: `assetStateHandler` serializes `AssetAdminState` directly;
  the new `FrozenRef.Reason` flows through. `adminHistoryHandler` already returns
  `ActionDetails`, so every other action's reason is queryable there.

**A3. Tests**
- `reducer_test.go`: the freeze case (line ~47) asserts `Reason` on the
  `FrozenRef`; add a freeze-with-reason case and a rebuild-parity case (folding
  the same persisted details reproduces the reason). `EvictedOutpoints` tests
  unchanged.
- No `storage_test.go` / `admin_test.go` evicted-shape changes (type unchanged).

### B. Wallet state view (TS) — `app/src/lib/mandala/adminState.ts`
- `frozenOutpoints[]` item gains `reason: string`.
- `evictedOutpoints: string[]` **unchanged**.

### C. Coin-selection filter (TS) — `app/src/lib/mandala/ftCandidates.ts`
- In `loadFtCandidates`, fetch `resolveAssetState(assetId)` and build a frozen
  outpoint set. Exclude any candidate whose outpoint is in that set **before**
  returning candidates.
- **Fail open:** if the state fetch fails/returns null, do not exclude anything
  (the overlay still rejects a frozen spend); log a warning. This keeps sends
  working when the endpoint is briefly unreachable.
- Frozen outputs are excluded but **not** relinquished (a later unfreeze makes
  them reappear automatically, with no local state to clear).

### D. Evicted relinquish (TS) — new `app/src/lib/mandala/reconcileBans.ts`
- `reconcileBans(wallet, assetIds)`: for each asset, fetch state; for each
  `evictedOutpoints[].outpoint` that the wallet still holds in `BASKET`, call
  `wallet.relinquishOutput({ basket: BASKET, output: outpoint })`.
- Only relinquish evicted (never frozen). Idempotent — a already-relinquished
  output is simply absent, so re-running is safe.
- Call sites: Send-view mount, and `useSendMutation` `onSettled` (alongside the
  existing `reconcileWallet`).

### E. Holder UX (TS) — Send view
- Surface frozen holdings with their reason inline, e.g. "N units frozen —
  <reason>", so the holder understands why a balance is unspendable.
- Evicted outputs relinquish silently (value is gone; nothing to act on).

### F. Admin Operations form refactor (TS) — `app/src/components/issuer/RegulatoryControls.tsx`
- Rebuild the multi-card `RegulatoryControls` into a single **Admin Operations**
  form:
  - An action `<select>` listing: pause / unpause / set access mode / freeze /
    unfreeze / block / unblock / allow / unallow / reissue.
  - Fields render dynamically per selected action (outpoint for freeze, identity
    search for block/allow, recipient+amount for reissue, segmented control for
    access mode, etc. — reuse existing field logic).
  - An **optional reason** `<input>` present for all actions.
- Submit through the existing `submitAdminAction` / `submitGlobalAdminAction`,
  threading `reason` into the `details` object.
- `app/src/lib/mandala/assets.ts`: `SubmitAdminActionParams` / the built
  `details` carry `reason` when provided (drop the key entirely when empty so
  the commitment for reason-less actions is unchanged from today).

---

## Data flow (end to end)

**Freeze:**
1. Admin picks `freezeOutput` + reason in Admin Operations → `submitAdminAction`
   puts `{ kind:'freezeOutput', outpoint, reason, … }` in `details`.
2. Overlay admits the tx; `foldContext` fills `FrozenAmount`/`FrozenOwner`;
   `FoldAction` appends `FrozenRef{outpoint, amount, owner, reason}`.
3. Holder opens Send → `loadFtCandidates` fetches asset-state, excludes the
   frozen outpoint from selection; UI shows "frozen — <reason>".

**Evict (reissue):**
1. Admin reissues a frozen outpoint (optionally with a reason, captured in
   admin-history) → overlay evicts it, `FoldAction` appends the outpoint to
   `EvictedOutpoints` (unchanged).
2. Holder opens Send (or completes any send) → `reconcileBans` sees the outpoint
   in `evictedOutpoints`, calls `relinquishOutput`. Stale basket entry cleared.

## Edge cases

- **Endpoint down:** fail open — sends proceed without exclusion; overlay stays
  the enforcer. No hard block on the holder.
- **Unfreeze:** outpoint drops out of `frozenOutpoints`; next `loadFtCandidates`
  naturally re-includes it. No client state to reset.
- **Reason-less action:** omit the `reason` key from `details` so commitments for
  existing action kinds are byte-identical to today (no key-derivation drift).
- **Rebuild-from-chain:** reason persisted in `ActionDetails`, re-folded
  identically; frozen/evicted reasons reproduce.

## Out of scope

- Messagebox push notification (hybrid) — can layer on later, endpoint core
  unchanged.
- A slimmer public sub-route that returns only frozen/evicted/issuer (the full
  state endpoint is reused as-is).
- `@bsv/templates` `reason?: string` type addition (optional future nicety).

## Testing

- Go: reducer freeze-with-reason + rebuild parity (fold reproduces reason);
  endpoint serialization carries `frozenOutpoints[].reason`.
- TS: `loadFtCandidates` excludes frozen + fails open; `reconcileBans`
  relinquishes only evicted-and-held; `adminState` frozen `reason` shape; Admin
  Operations form threads reason into `details` (and omits when empty).
