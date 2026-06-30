# Mandala Stablecoin — Phase C: Holder Neobanking UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A neobanking-style holder experience: per-asset accounts with currency-formatted balances, issuer alert banners (paused/frozen), a per-asset transaction history with enriched counterparties + CSV export, QR receive, recent contacts, and "Pay again".

**Architecture:** Holder views derive everything from wallet state (`listOutputs`, `listActions`) + the overlay's derived control state (`resolveAssetState`) + the identity client — no localStorage. Transaction history comes from `listActions` filtered by the `['mandala', …]` labels added in Phase B; counterparties come from each action's stored `customInstructions`.

**Tech Stack:** React + Vite, `@bsv/sdk`, `@bsv/identity-react`, `qrcode` (new), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-mandala-stablecoin-admin-ux-design.md` (Phase C = §C1–C5).

**Prereq:** Phase A published + consumed; Phase B Tasks 1–3 (union re-export, action labels, outbound-counterparty capture) and Task 5 (`resolveAssetState`) landed — Phase C depends on all four.

## Global Constraints

- **No localStorage** — history/contacts derived from wallet + overlay + identity client.
- **Identity enrichment is scoped to what `resolveByIdentityKey` yields:** `name`, `badgeLabel`, `avatarURL`, `abbreviatedKey`. **No raw email / X-handle strings.**
- **Zero-balance = assets previously held now at zero** (derived from `listActions`), not all assets in existence.
- **QR dependency must be a pure client-side encoder** (`qrcode`), no network/CDN.
- App test runner: `cd /Users/personal/git/demos/mandala/app && npx vitest run <file>`.

**Paths:** lib `app/src/lib/mandala`; components `app/src/components`.

---

### Task 1: Currency formatting (`currencySymbol`)

**Files:**
- Modify: `app/src/lib/mandala/amount.ts` (add `currencySymbol`, `formatCurrency`)
- Test: `app/src/lib/mandala/amount.test.ts` (extend the existing file)

**Interfaces:**
- Produces: `currencySymbol(ticker?: string): string` (USD→`$`, EUR→`€`, GBP→`£`, CHF→`CHF `, else the ticker, else `''`); `formatCurrency(base: number, decimals: number, ticker?: string): string` → e.g. `$1,245.75`.

- [ ] **Step 1: Write the failing test**

```ts
// append to app/src/lib/mandala/amount.test.ts
import { currencySymbol, formatCurrency } from './amount'

describe('currency', () => {
  it('maps known tickers to symbols and falls back to the ticker', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('GBP')).toBe('£')
    expect(currencySymbol('CHF')).toBe('CHF ')
    expect(currencySymbol('XYZ')).toBe('XYZ ')
    expect(currencySymbol(undefined)).toBe('')
  })
  it('formats base units with the symbol and grouping', () => {
    expect(formatCurrency(124575, 2, 'USD')).toBe('$1,245.75')
    expect(formatCurrency(5, 0, undefined)).toBe('5')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails** — `npx vitest run src/lib/mandala/amount.test.ts` → FAIL.

- [ ] **Step 3: Implement** (reusing the existing `formatAmount`):

```ts
// in amount.ts
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ' }

export function currencySymbol (ticker?: string): string {
  if (ticker == null || ticker === '') return ''
  return SYMBOLS[ticker.toUpperCase()] ?? `${ticker.toUpperCase()} `
}

export function formatCurrency (base: number, decimals: number, ticker?: string): string {
  return `${currencySymbol(ticker)}${formatAmount(base, decimals)}`
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/amount.ts app/src/lib/mandala/amount.test.ts
git commit -m "feat(app): currencySymbol + formatCurrency for per-asset balances"
```

---

### Task 2: Transaction history from `listActions`

**Files:**
- Create: `app/src/lib/mandala/history.ts`
- Test: `app/src/lib/mandala/history.test.ts`

**Interfaces:**
- Produces:
  - `HistoryRow` (`txid, assetId, direction: 'sent'|'received'|'issued'|'redeemed'|'admin', amount, counterparty: string, when: number, kind: string`)
  - `parseActionsToHistory(actions: WalletAction[]): HistoryRow[]` — **pure**, unit-tested against fixtures.
  - `loadHistory(wallet, assetId?): Promise<HistoryRow[]>` — calls `wallet.listActions({ labels: ['mandala'], includeOutputs: true, includeLabels: true })` (confirm the exact arg names against the installed SDK's `ListActionsArgs`; the SDK requires `labels`), then `parseActionsToHistory`, then optional asset filter.
  - `exportTransactionsCsv(rows): string`.

- [ ] **Step 1: Write the failing test** — drive the pure parser with a fixture mirroring `ListActionsResult.actions`:

```ts
// app/src/lib/mandala/history.test.ts
import { describe, it, expect } from 'vitest'
import { parseActionsToHistory, exportTransactionsCsv } from './history'

const actions = [
  { txid: 't1', description: 'Send', labels: ['mandala', 'transfer'], satoshis: 0,
    outputs: [{ outputDescription: 'FT to recipient', customInstructions: JSON.stringify({ keyID: 'k', counterparty: '02recip', direction: 'sent', recipient: '02recip', assetId: 'x.0' }), tags: ['mandala', 'sent', 'x.0'] }] },
  { txid: 't2', description: 'Receive', labels: ['mandala', 'receive'],
    outputs: [{ outputDescription: 'received', customInstructions: JSON.stringify({ keyID: 'k', counterparty: '02sender', assetId: 'x.0' }), tags: ['mandala', 'received', 'x.0'] }] }
]

it('classifies sent vs received and extracts counterparty + assetId', () => {
  const rows = parseActionsToHistory(actions as any)
  const sent = rows.find(r => r.txid === 't1')!
  const recv = rows.find(r => r.txid === 't2')!
  expect(sent.direction).toBe('sent')
  expect(sent.counterparty).toBe('02recip')
  expect(sent.assetId).toBe('x.0')
  expect(recv.direction).toBe('received')
  expect(recv.counterparty).toBe('02sender')
})

it('CSV has a header and one row per history entry', () => {
  const csv = exportTransactionsCsv(parseActionsToHistory(actions as any))
  expect(csv.split('\n')).toHaveLength(3) // header + 2
})
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/mandala/history.ts
import { WalletInterface } from '@bsv/sdk'

export interface HistoryRow {
  txid: string
  assetId: string
  direction: 'sent' | 'received' | 'issued' | 'redeemed' | 'admin'
  amount: number
  counterparty: string
  when: number
  kind: string
}

interface RawAction { txid: string, description?: string, labels?: string[], outputs?: Array<{ outputDescription?: string, customInstructions?: string, tags?: string[], satoshis?: number }> }

const kindFromLabels = (labels: string[] = []): string => labels.find(l => l !== 'mandala') ?? 'admin'

export function parseActionsToHistory (actions: RawAction[]): HistoryRow[] {
  const rows: HistoryRow[] = []
  for (const a of actions) {
    const kind = kindFromLabels(a.labels)
    for (const o of a.outputs ?? []) {
      let ci: any = {}
      try { ci = JSON.parse(o.customInstructions ?? '{}') } catch { /* skip */ }
      const assetId = ci.assetId ?? (o.tags?.find(t => t.includes('.')) ?? '')
      if (assetId === '') continue
      const direction: HistoryRow['direction'] =
        kind === 'transfer' ? (ci.direction === 'sent' ? 'sent' : 'received')
        : kind === 'receive' ? 'received'
        : kind === 'issue' ? 'issued'
        : kind === 'redeem' ? 'redeemed'
        : kind === 'recover' ? 'received'
        : 'admin'
      rows.push({ txid: a.txid, assetId, direction, amount: 0, counterparty: ci.recipient ?? ci.counterparty ?? '', when: 0, kind })
    }
  }
  return rows
}

export async function loadHistory (wallet: WalletInterface, assetId?: string): Promise<HistoryRow[]> {
  const res = await wallet.listActions({ labels: ['mandala'], includeOutputs: true, includeLabels: true } as any)
  const rows = parseActionsToHistory((res as any).actions ?? [])
  return assetId == null ? rows : rows.filter(r => r.assetId === assetId)
}

const esc = (s: string): string => `"${String(s).replace(/"/g, '""')}"`
export function exportTransactionsCsv (rows: HistoryRow[]): string {
  const header = ['txid', 'assetId', 'direction', 'kind', 'counterparty']
  return [header.join(','), ...rows.map(r => [esc(r.txid), esc(r.assetId), r.direction, r.kind, esc(r.counterparty)].join(','))].join('\n')
}
```

(`amount`/`when` are placeholders the implementer fills from the action's decoded FT output amount + `listActions` timestamp if the SDK surfaces one; if not, leave `amount` derived from the FT output decode and `when` from any available action timestamp. The pure parser + CSV shape are what this task locks.)

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/history.ts app/src/lib/mandala/history.test.ts
git commit -m "feat(app): transaction history derived from listActions labels + CSV export"
```

---

### Task 3: Contacts derivation

**Files:**
- Create: `app/src/lib/mandala/contacts.ts`
- Test: `app/src/lib/mandala/contacts.test.ts`

**Interfaces:**
- Consumes: `HistoryRow` (Task 2).
- Produces: `Contact` (`identityKey, lastSeen, count`); `deriveContacts(history: HistoryRow[]): Contact[]` (unique by `identityKey`, ordered by recency then frequency, excludes empty keys).

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/mandala/contacts.test.ts
import { describe, it, expect } from 'vitest'
import { deriveContacts } from './contacts'

const h = (counterparty: string, when: number) => ({ txid: 't', assetId: 'x.0', direction: 'sent' as const, amount: 1, counterparty, when, kind: 'transfer' })

it('dedups by identity key, orders by recency then frequency, drops empties', () => {
  const rows = [h('02a', 100), h('02b', 50), h('02a', 200), h('', 999)]
  const contacts = deriveContacts(rows as any)
  expect(contacts.map(c => c.identityKey)).toEqual(['02a', '02b'])
  expect(contacts[0]).toEqual({ identityKey: '02a', lastSeen: 200, count: 2 })
})
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/mandala/contacts.ts
import { HistoryRow } from './history'

export interface Contact { identityKey: string, lastSeen: number, count: number }

export function deriveContacts (history: HistoryRow[]): Contact[] {
  const map = new Map<string, Contact>()
  for (const r of history) {
    if (r.counterparty === '') continue
    const c = map.get(r.counterparty) ?? { identityKey: r.counterparty, lastSeen: 0, count: 0 }
    c.count += 1
    if (r.when > c.lastSeen) c.lastSeen = r.when
    map.set(r.counterparty, c)
  }
  return [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen || b.count - a.count)
}
```

- [ ] **Step 4: Run tests** — PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/lib/mandala/contacts.ts app/src/lib/mandala/contacts.test.ts
git commit -m "feat(app): deriveContacts from transaction history"
```

---

### Task 4: Add the `qrcode` dependency + QR helper

**Files:**
- Modify: `app/package.json` (add `qrcode` + `@types/qrcode` dev)
- Create: `app/src/lib/mandala/qr.ts`
- Test: `app/src/lib/mandala/qr.test.ts`

**Interfaces:**
- Produces: `toQrDataUrl(text: string): Promise<string>` (returns a `data:image/png;base64,…` URL via `qrcode`, fully local).

- [ ] **Step 1: Install** — `cd /Users/personal/git/demos/mandala/app && npm install qrcode && npm install -D @types/qrcode`.

- [ ] **Step 2: Write the failing test**

```ts
// app/src/lib/mandala/qr.test.ts
import { describe, it, expect } from 'vitest'
import { toQrDataUrl } from './qr'

it('produces a base64 png data url', async () => {
  const url = await toQrDataUrl('02abcdef')
  expect(url.startsWith('data:image/png;base64,')).toBe(true)
})
```

- [ ] **Step 3: Run it to confirm it fails** — FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// app/src/lib/mandala/qr.ts
import QRCode from 'qrcode'
export async function toQrDataUrl (text: string): Promise<string> {
  return await QRCode.toDataURL(text, { margin: 1, width: 220 })
}
```

- [ ] **Step 5: Run tests** — PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/package.json app/package-lock.json app/src/lib/mandala/qr.ts app/src/lib/mandala/qr.test.ts
git commit -m "feat(app): local QR data-url helper (qrcode dep)"
```

---

### Task 5: Send — input linkage, recent contacts, pay-again, pause guard

**Files:**
- Modify: `app/src/components/SendTokens.tsx`
- Test: extend an existing SendTokens test or add a focused one for the input-linkage payload (assert `payload.inputs` is populated).

**Interfaces:**
- Consumes: `revealLinkage` (tokens.ts), `deriveContacts` + `loadHistory` (Tasks 2–3), `resolveAssetState` (Phase B Task 5).
- Produces: peer transfers reveal input linkage; a recent-contacts row; "Pay again"; Send disabled when paused.

- [ ] **Step 1: Reveal input linkage in `transfer`** — after building `outLinks`, also reveal linkage for each spent FT input and include it in `payload.inputs`:

```ts
const inLinks: Array<{ index: number, linkage: any }> = []
for (let i = 0; i < spendInfo.length; i++) {
  inLinks.push({ index: i, linkage: await revealLinkage(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty) })
}
const offChainValues = encodeLinkagePayload({ inputs: inLinks, outputs: outLinks })
```

- [ ] **Step 2: Recent contacts + Pay again** — on mount, `const history = await loadHistory(wallet); setContacts(deriveContacts(history))`; render a contacts row that sets `recipient`/`publicKeyInput` on click; a "Pay again" affordance on each history row prefills asset + recipient.

- [ ] **Step 3: Pause guard** — `resolveAssetState(assetId)`; if `isPaused`, disable Send and show "Transfers are temporarily disabled by the issuer."

- [ ] **Step 4: Test** — assert `transfer` builds a payload whose `inputs` length equals the number of spent FT inputs (mock wallet as in existing tests). Run `npx vitest run src/components/SendTokens` (or the lib seam if the component is hard to test).

- [ ] **Step 5: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/SendTokens.tsx
git commit -m "feat(app): send reveals input linkage; recent contacts, pay-again, pause guard"
```

---

### Task 6: Holder components — accounts, account view, alerts, history, receive QR

**Files:**
- Create: `app/src/components/holder/AccountsOverview.tsx`, `AssetAccount.tsx`, `AlertBanners.tsx`, `TransactionHistory.tsx`, `ReceivePanel.tsx`
- Modify: `app/src/components/TokenWallet.tsx` (compose the account-centric layout), `ReceiveTokens.tsx` (add the QR panel)
- Test: a render smoke test per component (logic is unit-tested in Tasks 1–4).

**Interfaces:**
- Consumes: `listOutputs` + `decodeBalances` (tokens.ts), `resolveAssetMetadata` (metadata.ts), `currencySymbol`/`formatCurrency` (Task 1), `loadHistory`/`exportTransactionsCsv` (Task 2), `deriveContacts` (Task 3), `toQrDataUrl` (Task 4), `resolveAssetState` (Phase B Task 5), `@bsv/identity-react` for enrichment.

- [ ] **Step 1: `AccountsOverview.tsx`** — gather held + previously-held assets: union of `decodeBalances(listOutputs('locking scripts'))` and the asset ids appearing in `loadHistory(wallet)` (so zero-balance-but-held assets show). For each, resolve metadata (label/ticker/decimals) and render a card with `formatCurrency(balance, decimals, ticker)`. Click → open `AssetAccount`.

- [ ] **Step 2: `AlertBanners.tsx`** — `resolveAssetState(assetId)`; render paused banner "Transfers temporarily disabled by the issuer." when `isPaused`; compute frozen amount = sum of decoded amounts of the holder's `listOutputs` outpoints whose `txid.vout` ∈ `state.frozenOutpoints[].outpoint`; if > 0 render "$X of your balance has been frozen. Please contact support to dispute." (format with `formatCurrency`).

- [ ] **Step 3: `TransactionHistory.tsx`** — `loadHistory(wallet, assetId)`; render rows (date/time from `when`, direction icon, `formatCurrency(amount, decimals, ticker)`, counterparty). Enrich counterparty via `@bsv/identity-react` `resolveByIdentityKey` → show `name` + `badgeLabel` + avatar when resolvable, else `abbreviatedKey`. "Export CSV" downloads `exportTransactionsCsv(rows)` via a Blob.

- [ ] **Step 4: `ReceivePanel.tsx`** — `toQrDataUrl(identityKey)` → `<img src={dataUrl}>` + a copy button for the identity key. Add it into `ReceiveTokens.tsx` above the pending-tokens list.

- [ ] **Step 5: `AssetAccount.tsx`** — single-asset view: balance header (`formatCurrency`), `<AlertBanners assetId>`, tabs for Send (existing `SendTokens` scoped to the asset) / Receive (`ReceivePanel`) / History (`TransactionHistory`).

- [ ] **Step 6: Compose in `TokenWallet.tsx`** — render `AccountsOverview`; selecting an account renders `AssetAccount`.

- [ ] **Step 7: Smoke tests** — render each component with mocked deps; assert mount. `npx vitest run src/components/holder`.

- [ ] **Step 8: Build + manual E2E** — `cd app && npx tsc --noEmit && npm run build`. Manual (Phase A overlay + a Phase B-registered USD asset): see per-asset USD account with `$` balance; pause as issuer → holder sees paused banner + disabled Send; freeze the holder's outpoint → frozen banner; send/receive → history rows with enriched counterparties; export CSV; QR receive.

- [ ] **Step 9: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/holder app/src/components/TokenWallet.tsx app/src/components/ReceiveTokens.tsx
git commit -m "feat(app): holder neobanking UX — accounts, alerts, history+CSV, QR receive"
```

---

### Task 7: Docs update

**Files:**
- Modify: `docs/PROJECT-STATE.md`
- Create: `docs/STABLECOIN-ADMIN.md`

- [ ] **Step 1: Update `PROJECT-STATE.md`** — add the new action kinds, derived `AssetAdminState` + enforcement gates, the `ls_mandala` `assetStateAssetId`/`adminHistoryAssetId` queries, the issuer dashboard + holder neobanking surfaces. Fix the §8 inaccuracy: `encoding.ts` now **re-exports** (no longer re-declares) the action union.

- [ ] **Step 2: Create `docs/STABLECOIN-ADMIN.md`** — operator guide: each control, what it enforces, the one-submit lag, the off-chain reissue conservation caveat, the frozen-coin resolution paths (unfreeze/reissue only), and the audit-proof verification recipe.

- [ ] **Step 3: Commit**

```bash
cd /Users/personal/git/demos/mandala
git add docs/PROJECT-STATE.md docs/STABLECOIN-ADMIN.md
git commit -m "docs: update project state + add stablecoin admin operator guide"
```

---

## Self-Review (Phase C)

- **Spec coverage:** C1 currency→Task1; C3 history→Task2; C4 contacts→Task3; QR dep→Task4; C3 send (input linkage/contacts/pay-again/pause)→Task5; C1/C2/C3 components→Task6; docs→Task7. ✓
- **Placeholder scan:** lib tasks (1–4) full code+tests; `amount`/`when` in history explicitly flagged as implementer-filled from the FT decode + SDK timestamp, with the locked contract being the pure parser + CSV. Component task follows enumerated patterns. ✓
- **Type consistency:** `HistoryRow`/`Contact` defined once and reused; `currencySymbol`/`formatCurrency`/`toQrDataUrl`/`resolveAssetState` signatures consistent across tasks and with Phase B. ✓
- **DRY/YAGNI:** one history parser feeding both history view and contacts; identity enrichment scoped to the real API surface; no email/handle gold-plating. ✓

---

## Cross-Phase Execution Note

Build order: **Phase A** (publish packages) → **Phase B Tasks 1–5** (union, labels, counterparty capture, builders, shared `resolveAssetState`) → **Phase B Tasks 6–9** and **Phase C** in parallel. The whole-tx admission switch (Phase A Task 5) and the published-package bump (Phase A Task 7) gate everything app-side; clear `app/node_modules/.vite` after the bump.
