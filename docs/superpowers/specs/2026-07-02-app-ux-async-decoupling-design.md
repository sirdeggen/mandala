# App UX: async decoupling + minimalist polish — design

Date: 2026-07-02. Approved direction (user): fully optimistic mutations, both
holder + issuer, keep the brass/Meridian visual style, journal reconciliation
reconsidered for snappy AND robust. Hard invariant (user): the overlay MUST
evaluate the topic-manager rule set before any network broadcast; if the
overlay rejects, the wallet-side action MUST be aborted (inputs released).

## Problem

Every view fetches inline (`useState` + `useEffect`); navigation refetches from
scratch and blocks render on chain/overlay round-trips. Mutations block the
button through the whole pipeline: build → sign → linkage → overlay submit →
network broadcast → messagebox. The UI waits on steps the user doesn't need to
watch.

## 1. Data layer — TanStack Query

- `src/lib/queryClient.ts`: one `QueryClient` (staleTime 15 s, gcTime 5 min,
  retry 1, no refetch-on-focus spam). Provider wraps the app in `main.tsx`.
- Shared hooks in `src/hooks/`:
  - `useHolderData()` → `['holder-data', identityKey]`: balances (listOutputs +
    decode), history (loadHistory), resolved metadata — one query, one shape,
    consumed by HolderHome / SendTokens / TransactionHistory / AssetAccount.
  - `useAdminAssets()` → `['admin-assets', identityKey]`: listAdminAssets, for
    the whole issuer console.
  - `useAssetState(assetId)` → `['asset-state', assetId]`: pause/access state.
  - `useContactsData()` → `['contacts', identityKey]`: derived + saved contacts.
- Cached data renders instantly; refetch happens in the background. "Refresh"
  is `refetch()` with a small spinning glyph — it never disables anything.
- Skeletons appear only when a query has no cached data at all.

## 2. Optimistic mutations — commit point = overlay accept

`submitAndBroadcast` splits at the overlay-accept boundary:

- **submit → accept** stays awaited. Reject → `abortAction` (existing) →
  mutation `onError` → optimistic cache rolled back → error surfaced where the
  user is. Nothing ever reaches the network on a reject.
- **accept → broadcast** moves to the background. The journal 'accepted' entry
  is written before broadcast starts (unchanged), so a failed/interrupted
  broadcast is retried by `reconcileWallet` — now also invoked in the
  background after each mutation settles, not only on page load.
- Messagebox notify (send flow) also runs post-accept in the background; a
  failure shows a non-fatal warning toast (funds are safe; recipient can still
  discover via overlay).

Mutation hooks:
- `useSendMutation`: `onMutate` decrements the asset balance and inserts a
  pending history row into `['holder-data']`; `onError` restores the snapshot;
  `onSettled` invalidates. The Send wizard flips to a "Sending" screen the
  instant the button is pressed; overlay accept flips it to the check mark;
  reject returns to Review with the error inline.
- `useIssuerMutations` (register / issue / redeem): optimistic supply/balance
  update in `['admin-assets']`, rollback on reject, invalidate on settle.

## 3. Journal — unchanged storage, wider use

Stages stay `'accepted' | 'abort'`. The createAction→sign gap is already
covered by the bulk nosend sweep in `reconcileWallet` (spec-op, chain-checked).
New: `reconcileWallet` runs after mutations settle as well as at load, so a
stuck state self-heals without a reload, and journal entries drive a
"confirming…" badge on pending history rows.

## 4. Visual polish (keep style)

Consistent pending/confirming/error affordances; skeletons; no layout jumps;
buttons disabled only when genuinely unsafe (paused asset, invalid amount) —
never because a background fetch is running.

## Out of scope

Overlay/server changes; wallet-toolbox changes; new visual direction.
