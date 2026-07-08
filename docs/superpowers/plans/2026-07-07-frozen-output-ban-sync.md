# Frozen / Evicted Output Ban-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let holder wallets learn — before a spend — which of their token outputs are frozen (exclude from coin selection) or evicted (relinquish), by polling the existing admin-state endpoint; add an optional reason to admin actions surfaced via that endpoint and admin history.

**Architecture:** The overlay's `/admin/asset-state/:assetId` endpoint already returns `frozenOutpoints` and `evictedOutpoints`; it is authoritative (the overlay validated the issuer's authenticated admin tx before folding this state) so no client-side sender verification is needed. The wallet fetches it during coin selection to drop frozen outputs and during a reconcile pass to relinquish evicted ones. A `reason` string rides inside the committed admin action-details map — captured in `AdminHistoryEntry.ActionDetails` for every action automatically, and additionally copied into `FrozenRef.Reason` (the only reason a holder displays).

**Tech Stack:** Go (overlay-go: fiber, mongo, `go test`), TypeScript/React (app: vite, vitest, `@bsv/sdk`, `@bsv/templates`, `@bsv/message-box-client`, `@tanstack/react-query`).

## Global Constraints

- Reason-less actions MUST produce byte-identical commitments to today — omit the `reason` key from `details` entirely when empty (never send `reason: ""`). The admin locking key derives from `Commitment(details)`; an extra key changes it.
- `reason` requires **no** `@bsv/templates` change — `MandalaActionDetails` has `[k: string]: unknown` (`MandalaAdmin.d.ts:19`).
- `EvictedOutpoints` stays `[]string` — do not restructure it (it is read by the topic-manager eviction-enforcement path, `topic_manager.go:405`).
- Coin-selection frozen exclusion MUST fail open: if the state fetch returns null, exclude nothing (the overlay still rejects a frozen spend).
- Only `overlay-go` changes on the overlay side (`overlay/` TS is legacy-thin).
- Go module path: `github.com/sirdeggen/mandala/overlay-go`. Go tests: `cd overlay-go && go test ./...`. TS tests: `cd app && npx vitest run <file>`.

---

## File Structure

- `overlay-go/internal/mandala/reducer.go` — add `FrozenRef.Reason`; freeze fold reads reason. (modify)
- `overlay-go/internal/mandala/reducer_test.go` — freeze-with-reason + rebuild-parity cases. (modify)
- `app/src/lib/mandala/adminState.ts` — `frozenOutpoints[].reason`. (modify)
- `app/src/lib/mandala/adminState.test.ts` — sample includes reason. (modify)
- `app/src/lib/mandala/ftCandidates.ts` — fetch state, exclude frozen via new `excludeFrozen`. (modify)
- `app/src/lib/mandala/ftCandidates.test.ts` — `excludeFrozen` unit tests. (create)
- `app/src/lib/mandala/reconcileBans.ts` — relinquish evicted-and-held outputs. (create)
- `app/src/lib/mandala/reconcileBans.test.ts` — reconcile unit tests. (create)
- `app/src/hooks/useSendMutation.ts` — call `reconcileBans` in `onSettled`. (modify)
- `app/src/components/SendTokens.tsx` — call `reconcileBans` on mount; show frozen holdings + reason. (modify)
- `app/src/lib/mandala/assets.ts` — `withReason` helper. (modify)
- `app/src/lib/mandala/assets.test.ts` — `withReason` unit tests. (modify)
- `app/src/components/issuer/RegulatoryControls.tsx` — Admin Operations dropdown form + reason input; wrap every `details` with `withReason`. (modify)

---

### Task 1: Overlay — `FrozenRef.Reason` + freeze fold reads reason

**Files:**
- Modify: `overlay-go/internal/mandala/reducer.go:3-7` (struct), `:99-103` (freeze case)
- Test: `overlay-go/internal/mandala/reducer_test.go`

**Interfaces:**
- Produces: `FrozenRef { Outpoint string; Amount int64; Owner string; Reason string }` serialized as `frozenOutpoints[].reason` by the unchanged `assetStateHandler`.

- [ ] **Step 1: Write the failing test**

Add these two cases to `reducer_test.go`. Append the first inside the `cases` slice of `TestFoldActionTable` (after the existing `"freeze records amount+owner"` case, before `"issue is a no-op"`); add the second as a new top-level function.

```go
		{"freeze records reason", ActionDetails{"kind": "freezeOutput", "outpoint": "t.1", "reason": "court order 12/A"},
			FoldContext{FrozenAmount: 40, FrozenOwner: "02own", HasFrozenRow: true},
			func(t *testing.T, s AssetAdminState) {
				want := []FrozenRef{{Outpoint: "t.1", Amount: 40, Owner: "02own", Reason: "court order 12/A"}}
				if !reflect.DeepEqual(s.FrozenOutpoints, want) {
					t.Fatalf("%+v", s.FrozenOutpoints)
				}
			}},
```

```go
func TestFreezeReasonRebuildParity(t *testing.T) {
	// Folding the same persisted details twice (live admit vs later rebuild)
	// must reproduce the identical FrozenRef, reason included.
	details := ActionDetails{"kind": "freezeOutput", "outpoint": "t.9", "reason": "aml hold"}
	fctx := FoldContext{FrozenAmount: 7, FrozenOwner: "02z", HasFrozenRow: true}
	live := FoldAction(DefaultAssetState("a.0"), details, fctx)
	rebuilt := FoldAction(DefaultAssetState("a.0"), details, fctx)
	if !reflect.DeepEqual(live.FrozenOutpoints, rebuilt.FrozenOutpoints) {
		t.Fatalf("live %+v != rebuilt %+v", live.FrozenOutpoints, rebuilt.FrozenOutpoints)
	}
	if live.FrozenOutpoints[0].Reason != "aml hold" {
		t.Fatalf("reason lost: %+v", live.FrozenOutpoints[0])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'TestFoldActionTable|TestFreezeReasonRebuildParity' -v`
Expected: compile error / FAIL — `FrozenRef` has no field `Reason`.

- [ ] **Step 3: Add the `Reason` field**

In `reducer.go`, change the struct:

```go
type FrozenRef struct {
	Outpoint string `json:"outpoint" bson:"outpoint"`
	Amount   int64  `json:"amount" bson:"amount"`
	Owner    string `json:"owner" bson:"owner"`
	Reason   string `json:"reason" bson:"reason"`
}
```

- [ ] **Step 4: Read reason in the freeze fold case**

In `reducer.go`, replace the `freezeOutput` case body:

```go
	case "freezeOutput":
		if op, ok := details.Str("outpoint"); ok {
			reason, _ := details.Str("reason")
			s.FrozenOutpoints = append(removeFrozen(prev.FrozenOutpoints, op),
				FrozenRef{Outpoint: op, Amount: ctx.FrozenAmount, Owner: ctx.FrozenOwner, Reason: reason})
		}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'TestFoldActionTable|TestFreezeReasonRebuildParity' -v`
Expected: PASS. Then full package: `cd overlay-go && go test ./...` → all pass (existing `"freeze records amount+owner"` case still passes because its `want` leaves `Reason` as the zero value `""`, matching a no-reason fold).

- [ ] **Step 6: Commit**

```bash
git add overlay-go/internal/mandala/reducer.go overlay-go/internal/mandala/reducer_test.go
git commit -m "feat(overlay-go): freeze reason on FrozenRef"
```

---

### Task 2: Wallet state view — `frozenOutpoints[].reason`

**Files:**
- Modify: `app/src/lib/mandala/adminState.ts:10`
- Test: `app/src/lib/mandala/adminState.test.ts:21,47-48`

**Interfaces:**
- Produces: `AssetAdminStateView.frozenOutpoints: Array<{ outpoint: string, amount: number, owner: string, reason: string }>`.

- [ ] **Step 1: Update the test's sample + assertion**

In `adminState.test.ts`, change the `SAMPLE_STATE.frozenOutpoints` line and add a reason assertion in the first `it`:

```ts
  frozenOutpoints: [{ outpoint: 'txid.0', amount: 100, owner: 'key2', reason: 'court order' }],
```

After the existing `expect(result?.frozenOutpoints[0].outpoint).toBe('txid.0')`:

```ts
    expect(result?.frozenOutpoints[0].reason).toBe('court order')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/adminState.test.ts`
Expected: FAIL — type error on `reason` (tsc) or assertion undefined.

- [ ] **Step 3: Add `reason` to the type**

In `adminState.ts` change:

```ts
  frozenOutpoints: Array<{ outpoint: string, amount: number, owner: string, reason: string }>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/adminState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/adminState.ts app/src/lib/mandala/adminState.test.ts
git commit -m "feat(app): frozen reason in admin state view"
```

---

### Task 3: Coin selection — exclude frozen outputs (fail open)

**Files:**
- Modify: `app/src/lib/mandala/ftCandidates.ts`
- Test: `app/src/lib/mandala/ftCandidates.test.ts` (create)

**Interfaces:**
- Consumes: `FtCandidate` (from `ftSelect.ts`), `resolveAssetState` (from `adminState.ts`).
- Produces: `excludeFrozen(candidates: FtCandidate[], frozen: Set<string>): FtCandidate[]`; `loadFtCandidates` return shape unchanged but candidates now exclude frozen outpoints.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/mandala/ftCandidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { excludeFrozen } from './ftCandidates'
import type { FtCandidate } from './ftSelect'

const c = (outpoint: string): FtCandidate => ({
  outpoint, amount: 1, keyID: 'k', counterparty: '', confirmed: true, order: 0
})

describe('excludeFrozen', () => {
  it('drops candidates whose outpoint is frozen', () => {
    const out = excludeFrozen([c('a.0'), c('b.1'), c('c.2')], new Set(['b.1']))
    expect(out.map(o => o.outpoint)).toEqual(['a.0', 'c.2'])
  })

  it('returns all candidates when the frozen set is empty (fail-open shape)', () => {
    const all = [c('a.0'), c('b.1')]
    expect(excludeFrozen(all, new Set())).toEqual(all)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/ftCandidates.test.ts`
Expected: FAIL — `excludeFrozen` is not exported.

- [ ] **Step 3: Implement `excludeFrozen` and wire it into `loadFtCandidates`**

In `ftCandidates.ts`, add the import and helper, and apply it before returning.

Add to the import block near the top:

```ts
import { resolveAssetState } from './adminState'
```

Add the exported helper (above `loadFtCandidates`):

```ts
/**
 * Drop candidates the overlay has frozen. Pure so it is unit-testable; the
 * frozen set is sourced from the admin-state endpoint by loadFtCandidates.
 */
export function excludeFrozen (candidates: FtCandidate[], frozen: Set<string>): FtCandidate[] {
  if (frozen.size === 0) return candidates
  return candidates.filter(c => !frozen.has(c.outpoint))
}
```

At the end of `loadFtCandidates`, replace the final `return { candidates, beef: ... }` with a frozen-filtered return. **Fail open:** `resolveAssetState` already returns `null` on any fetch failure, so an unreachable endpoint yields an empty frozen set and excludes nothing:

```ts
  // Overlay-authoritative freeze list; fail open (null → empty set) so a brief
  // endpoint outage never blocks sends — the overlay still rejects a frozen spend.
  const state = await resolveAssetState(assetId)
  const frozen = new Set((state?.frozenOutpoints ?? []).map(f => f.outpoint))

  return { candidates: excludeFrozen(candidates, frozen), beef: beefRes.BEEF as number[] }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/ftCandidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/ftCandidates.ts app/src/lib/mandala/ftCandidates.test.ts
git commit -m "feat(app): exclude frozen outputs from coin selection (fail open)"
```

---

### Task 4: Relinquish evicted outputs — `reconcileBans`

**Files:**
- Create: `app/src/lib/mandala/reconcileBans.ts`
- Test: `app/src/lib/mandala/reconcileBans.test.ts` (create)
- Modify: `app/src/hooks/useSendMutation.ts`

**Interfaces:**
- Consumes: `resolveAssetState` (`adminState.ts`), `BASKET` (`constants.ts`), `WalletInterface.listOutputs` / `WalletInterface.relinquishOutput`.
- Produces: `reconcileBans(wallet: WalletInterface, assetIds: string[]): Promise<string[]>` — returns the outpoints it relinquished.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/mandala/reconcileBans.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./constants', () => ({ BASKET: 'mandala-tokens' }))
const resolveAssetState = vi.fn()
vi.mock('./adminState', () => ({ resolveAssetState: (...a: any[]) => resolveAssetState(...a) }))

import { reconcileBans } from './reconcileBans'

const wallet = () => {
  const relinquishOutput = vi.fn().mockResolvedValue({})
  const listOutputs = vi.fn().mockResolvedValue({
    outputs: [{ outpoint: 'held.0' }, { outpoint: 'held.1' }]
  })
  return { relinquishOutput, listOutputs } as any
}

describe('reconcileBans', () => {
  beforeEach(() => resolveAssetState.mockReset())

  it('relinquishes only evicted outputs the wallet still holds', async () => {
    resolveAssetState.mockResolvedValue({ evictedOutpoints: ['held.1', 'gone.9'] })
    const w = wallet()
    const done = await reconcileBans(w, ['asset.0'])
    expect(done).toEqual(['held.1'])
    expect(w.relinquishOutput).toHaveBeenCalledTimes(1)
    expect(w.relinquishOutput).toHaveBeenCalledWith({ basket: 'mandala-tokens', output: 'held.1' })
  })

  it('does nothing when state is unavailable (fail open)', async () => {
    resolveAssetState.mockResolvedValue(null)
    const w = wallet()
    const done = await reconcileBans(w, ['asset.0'])
    expect(done).toEqual([])
    expect(w.relinquishOutput).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/reconcileBans.test.ts`
Expected: FAIL — cannot find module `./reconcileBans`.

- [ ] **Step 3: Implement `reconcileBans`**

Create `app/src/lib/mandala/reconcileBans.ts`:

```ts
/**
 * Relinquish outputs the overlay has evicted (reissued to another holder) but
 * that still linger in our basket. Evicted outputs are permanently dead — unlike
 * frozen ones, which may later unfreeze — so they are safe to drop.
 *
 * Trust model: the endpoint is authoritative. The overlay only lists an outpoint
 * in evictedOutpoints after validating the issuer's authenticated reissue tx, so
 * no client-side sender check is needed. Fail open: an unreachable endpoint
 * (state === null) relinquishes nothing.
 */
import { WalletInterface } from '@bsv/sdk'
import { BASKET } from './constants'
import { resolveAssetState } from './adminState'

export async function reconcileBans (
  wallet: WalletInterface,
  assetIds: string[]
): Promise<string[]> {
  const relinquished: string[] = []

  // What we currently hold, once — evicted matching is by outpoint string.
  const held = new Set<string>()
  try {
    const res = await wallet.listOutputs({ basket: BASKET, limit: 1000 })
    for (const o of res.outputs) held.add(o.outpoint as string)
  } catch { return relinquished }

  for (const assetId of assetIds) {
    const state = await resolveAssetState(assetId)
    if (state == null) continue // fail open
    for (const op of state.evictedOutpoints) {
      if (!held.has(op)) continue
      try {
        await wallet.relinquishOutput({ basket: BASKET, output: op })
        relinquished.push(op)
      } catch { /* already gone / not ours — idempotent, ignore */ }
    }
  }
  return relinquished
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/reconcileBans.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `useSendMutation` `onSettled`**

In `useSendMutation.ts`, add the import and call it for the sent asset after a send settles. Add near the other lib imports:

```ts
import { reconcileBans } from '../lib/mandala/reconcileBans'
```

In the `onSettled` callback, after the existing `reconcileWallet` line, add (it has access to `vars` — change the signature to `onSettled: (_d, _e, vars) => {`):

```ts
      if (wallet != null) void reconcileBans(wallet as any, [vars.assetId]).catch(() => {})
```

- [ ] **Step 6: Run the hook's dependents + typecheck**

Run: `cd app && npx tsc -b`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/mandala/reconcileBans.ts app/src/lib/mandala/reconcileBans.test.ts app/src/hooks/useSendMutation.ts
git commit -m "feat(app): relinquish evicted outputs via reconcileBans"
```

---

### Task 5: Admin action reason — `withReason` helper + Operations form refactor

**Files:**
- Modify: `app/src/lib/mandala/assets.ts`
- Test: `app/src/lib/mandala/assets.test.ts`
- Modify: `app/src/components/issuer/RegulatoryControls.tsx`

**Interfaces:**
- Produces: `withReason<T extends Record<string, unknown>>(details: T, reason?: string): T` — returns `details` unchanged when `reason` is empty/whitespace, else `{ ...details, reason: <trimmed> }`.

- [ ] **Step 1: Write the failing test**

Add to `app/src/lib/mandala/assets.test.ts` (import `withReason` alongside existing imports from `./assets`):

```ts
import { withReason } from './assets'

describe('withReason', () => {
  it('adds a trimmed reason when present', () => {
    expect(withReason({ kind: 'freezeOutput' }, '  court order  ')).toEqual({ kind: 'freezeOutput', reason: 'court order' })
  })

  it('omits the key entirely when empty/whitespace (commitment stays identical)', () => {
    expect(withReason({ kind: 'pause' }, '')).toEqual({ kind: 'pause' })
    expect(withReason({ kind: 'pause' }, '   ')).toEqual({ kind: 'pause' })
    expect(withReason({ kind: 'pause' }, undefined)).toEqual({ kind: 'pause' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/assets.test.ts`
Expected: FAIL — `withReason` is not exported.

- [ ] **Step 3: Implement `withReason`**

In `assets.ts`, add (near the top-level exported helpers):

```ts
/**
 * Attach an optional admin-action reason. Omits the key when empty so the
 * commitment for reason-less actions is byte-identical to before this feature —
 * the admin locking key derives from Commitment(details), and an extra key would
 * change it.
 */
export function withReason<T extends Record<string, unknown>> (details: T, reason?: string): T {
  const r = reason?.trim()
  return r ? { ...details, reason: r } : details
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `RegulatoryControls` into an Admin Operations form**

Rebuild the component around a single action `<select>` plus a shared optional reason input, reusing the existing per-action handler bodies. Concretely:

1. Add a reason state: `const [reason, setReason] = useState('')`.
2. Add an operation selector state: `const [op, setOp] = useState<ActionKey>('freeze')` (the `ActionKey` union already exists at line 24; add `'unpause'` handling via the pause toggle).
3. Wrap **every** `details` object passed to `submitAdminAction` with `withReason(...)`. Import it: `import { submitAdminAction, withReason } from '../../lib/mandala/assets'` (adjust the existing `assets` import). For each handler, change e.g.:

```ts
      details: withReason({ kind: 'freezeOutput', assetId: asset!.assetId, outpoint: op, priorOutpoint: asset!.authOutpoint }, reason),
```

Apply the same `withReason(..., reason)` wrap to the details in `handleFreeze`, `handleUnfreeze`, `handlePauseToggle`, `handleIdentityAction`, `handleSetAccessMode`, and `handleReissue`.

4. Clear reason after a successful action inside the shared `run` helper: in its `try` block after `await fn()`, add `setReason('')`.
5. Render the selector + dynamic fields + reason input. Replace the current grid of always-visible cards with: a `<Select value={op} onChange={e => setOp(e.target.value as ActionKey)}>` listing the operations; a switch on `op` that renders the fields already used by that action (move the existing per-card inputs into per-`op` branches); and one shared reason field rendered for all ops:

```tsx
<div className="mt-3">
  <label className="text-[10.5px] text-subtle-foreground font-medium">Reason (optional)</label>
  <input
    value={reason}
    onChange={e => setReason(e.target.value)}
    placeholder="e.g. court order 12/A"
    className="bg-muted border border-border rounded px-[13px] py-[11px] text-[12px] w-full mt-1 outline-none focus:border-ring"
  />
</div>
```

Keep the existing "live state strip" (status / access mode / frozen / blocked / allowed) at the top unchanged. Preserve the `embedded` and `controlledAssetId` props and behaviour.

- [ ] **Step 6: Typecheck + run existing component-adjacent tests**

Run: `cd app && npx tsc -b && npx vitest run src/lib/mandala/assets.test.ts`
Expected: no type errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/mandala/assets.ts app/src/lib/mandala/assets.test.ts app/src/components/issuer/RegulatoryControls.tsx
git commit -m "feat(app): Admin Operations form with optional reason on every action"
```

---

### Task 6: Send view — surface frozen holdings + reason

**Files:**
- Modify: `app/src/components/SendTokens.tsx`

**Interfaces:**
- Consumes: `resolveAssetState` (`adminState.ts`), `reconcileBans` (`reconcileBans.ts`), `useWallet` identity key.

- [ ] **Step 1: Relinquish evicted on mount**

In `SendTokens.tsx`, add an effect that runs `reconcileBans` for the currently selected asset when the view mounts / the asset changes, so stale evicted outputs clear before the user tries to send. Add the import `import { reconcileBans } from '../lib/mandala/reconcileBans'` and, using the existing wallet + selected assetId in this component:

```tsx
useEffect(() => {
  if (wallet == null || selectedAssetId === '') return
  void reconcileBans(wallet as any, [selectedAssetId]).catch(() => {})
}, [wallet, selectedAssetId])
```

(Use the component's actual wallet/asset variable names.)

- [ ] **Step 2: Show frozen holdings with reason**

Fetch the asset state for the selected asset and, for frozen outpoints owned by the current identity, render a note. Add:

```tsx
const { identityKey } = useWallet()
const [frozenNote, setFrozenNote] = useState<Array<{ amount: number, reason: string }>>([])
useEffect(() => {
  let live = true
  if (selectedAssetId === '' || identityKey == null) { setFrozenNote([]); return }
  void resolveAssetState(selectedAssetId).then(s => {
    if (!live || s == null) return
    setFrozenNote(
      s.frozenOutpoints
        .filter(f => f.owner === identityKey)
        .map(f => ({ amount: f.amount, reason: f.reason }))
    )
  })
  return () => { live = false }
}, [selectedAssetId, identityKey])
```

Render near the amount field, only when `frozenNote.length > 0`:

```tsx
{frozenNote.length > 0 && (
  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[12px] text-warning">
    {frozenNote.map((f, i) => (
      <div key={i}>
        {f.amount} units frozen{f.reason ? ` — ${f.reason}` : ''} (unspendable)
      </div>
    ))}
  </div>
)}
```

Add the import `import { resolveAssetState } from '../lib/mandala/adminState'` and ensure `useState`/`useEffect` are imported.

- [ ] **Step 3: Typecheck + build**

Run: `cd app && npx tsc -b`
Expected: no type errors.

- [ ] **Step 4: Manual verification**

Run: `cd app && npx vite build` (or `npm run build`) → succeeds. Manually: freeze one of a holder's outputs with a reason via Admin Operations, open the holder Send view for that asset → the frozen note shows the amount + reason, and a send that would need that output selects around it (or reports insufficient balance if it was the only coin).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/SendTokens.tsx
git commit -m "feat(app): show frozen holdings + reason on Send view, relinquish evicted on mount"
```

---

## Self-Review

**Spec coverage:**
- §A1 FrozenRef.Reason + freeze fold → Task 1. ✓
- §A2 endpoint unchanged (reason flows) → Task 1 (no handler change). ✓
- §A3 Go tests → Task 1. ✓
- §B adminState frozen reason → Task 2. ✓
- §C loadFtCandidates frozen exclude + fail open → Task 3. ✓
- §D reconcileBans + wiring (useSendMutation + Send mount) → Task 4 + Task 6 Step 1. ✓
- §E holder UX frozen reason → Task 6. ✓
- §F Admin Operations form + reason threading + assets.ts → Task 5. ✓
- Global: reason-less commitment identical (omit empty) → `withReason` (Task 5) + test. ✓
- Global: EvictedOutpoints unchanged → confirmed, no task touches it. ✓

**Placeholder scan:** none — every code step shows full code. (Task 5/6 form-render steps reference "the component's actual variable names" because they adapt existing files; the exact edits and new code are given.)

**Type consistency:** `FrozenRef.Reason` (Go) ↔ `frozenOutpoints[].reason` (TS). `excludeFrozen(FtCandidate[], Set<string>)`, `reconcileBans(WalletInterface, string[])`, `withReason<T>(T, string?)` used consistently across tasks and call sites.
