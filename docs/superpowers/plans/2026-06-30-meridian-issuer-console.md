# Meridian Issuer Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing narrow-container issuer dashboard with a full-viewport Meridian desktop console: left-nav shell + Overview section (KPI tiles + assets table) + existing component sections routed from the nav.

**Architecture:** `IssuerDashboard.tsx` becomes the console shell (full-width, left sidebar nav, `useState` section routing). A new `OverviewSection.tsx` holds the 4 KPI stat tiles + assets table, deriving data from `listAdminAssets`, `resolveAssetState`, `resolveAdminHistory`, and `reconcile`. The existing section components (`IssuerPanel`, `RegulatoryControls`, `BankingMock`, `AuditLog`) are unchanged internally; they are rendered in the main area when their nav item is active. `TokenDemo.tsx` loses its narrow `max-w-2xl` wrapper for the issuer path and renders the console at full viewport width.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Meridian design tokens (globals.css), `BrandMark` component, lucide-react icons, existing lib functions.

## Global Constraints

- Branch: `mandala-meridian-redesign` — commit here; do NOT push/PR
- No hex literals for colours — use CSS custom properties (`var(--brass)`, `--primary`, `--muted`, etc.) or Tailwind token classes (`bg-muted`, `text-warning`, etc.)
- IBM Plex Sans hierarchy (`font-sans`); tabular numerals for amounts (`font-variant-numeric: tabular-nums`)
- Full viewport width for the issuer console — remove the `max-w-2xl` narrow wrapper in `TokenDemo.tsx`'s issuer branch
- `npx tsc --noEmit` must remain 0 errors
- `npm run build` must succeed
- `npx vitest run src/components/issuer` existing smoke tests must pass (update mocks if needed; do not delete coverage)
- No fabricated KPIs — degrade honestly when real data can't supply a metric
- Commit message: `feat(app): Meridian issuer console — left nav, KPI overview, assets table`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/src/components/issuer/IssuerDashboard.tsx` | **Modify** | Console shell: sidebar nav + section router |
| `app/src/components/issuer/OverviewSection.tsx` | **Create** | KPI tiles + assets table (real data) |
| `app/src/components/TokenDemo.tsx` | **Modify** | Remove narrow wrapper; render IssuerDashboard full-width |
| `app/src/components/issuer/IssuerDashboard.test.ts` | **Modify** | Keep smoke tests passing (add mock for OverviewSection if needed) |

Unchanged: `AssetOverview.tsx`, `RegulatoryControls.tsx`, `BankingMock.tsx`, `AuditLog.tsx`, `IssuerPanel.tsx` — their logic is intact; they render as-is inside the console main area.

---

### Task 1: Full-viewport console shell in IssuerDashboard.tsx

**Files:**
- Modify: `app/src/components/issuer/IssuerDashboard.tsx`
- Modify: `app/src/components/TokenDemo.tsx`
- Test: `app/src/components/issuer/IssuerDashboard.test.ts`

**Interfaces:**
- Consumes: `BrandMark` (`sublabel="ISSUER CONSOLE"`), lucide icons, `useWallet`, `listAdminAssets`, `AdminAsset`, existing section components
- Produces: `IssuerDashboard` default export — full-viewport shell; accepts no props

- [ ] **Step 1: Write the failing smoke test to verify new layout exports**

The existing smoke tests just check importability. They should still pass after the rewrite. No new test needed — just confirm the existing ones reference the right structure.

```ts
// File: app/src/components/issuer/IssuerDashboard.test.ts
// No changes required in this step — verify existing tests pass first:
// cd app && npx vitest run src/components/issuer/IssuerDashboard --reporter=verbose
```

Run: `cd /Users/personal/git/demos/mandala/app && npx vitest run src/components/issuer/IssuerDashboard --reporter=verbose`
Expected: 2 tests PASS

- [ ] **Step 2: Rewrite IssuerDashboard.tsx as the Meridian console shell**

Replace the existing contents of `app/src/components/issuer/IssuerDashboard.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import {
  LayoutDashboard, PlusCircle, ShieldCheck, Banknote, ClipboardList
} from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { listAdminAssets, AdminAsset } from '../../lib/mandala/assets'
import { BrandMark } from '../ui/BrandMark'
import { cn } from '@/lib/utils'
import IssuerPanel from '../IssuerPanel'
import OverviewSection from './OverviewSection'
import RegulatoryControls from './RegulatoryControls'
import BankingMock from './BankingMock'
import AuditLog from './AuditLog'

type Section = 'overview' | 'operations' | 'regulatory' | 'banking' | 'audit'

const NAV_ITEMS: Array<{
  id: Section
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
  { id: 'overview',    label: 'Overview',    icon: LayoutDashboard },
  { id: 'operations',  label: 'Operations',  icon: PlusCircle },
  { id: 'regulatory',  label: 'Regulatory',  icon: ShieldCheck },
  { id: 'banking',     label: 'Banking',     icon: Banknote },
  { id: 'audit',       label: 'Audit log',   icon: ClipboardList },
]

export default function IssuerDashboard() {
  const { wallet, identityKey } = useWallet()
  const [section, setSection] = useState<Section>('overview')
  const [assets, setAssets] = useState<AdminAsset[]>([])

  const reloadAssets = useCallback(async () => {
    if (wallet == null) return
    const list = await listAdminAssets(wallet as any)
    setAssets(list)
  }, [wallet])

  useEffect(() => { void reloadAssets() }, [reloadAssets])

  // Derive issuer initials for the footer chip from identityKey (first 2 hex chars → uppercase)
  const initials = identityKey != null && identityKey.length >= 4
    ? identityKey.slice(2, 4).toUpperCase()
    : 'IS'

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* ── LEFT SIDEBAR NAV ── */}
      <aside
        className="flex w-[230px] shrink-0 flex-col border-r border-separator bg-muted"
        style={{ padding: '20px 14px' }}
      >
        {/* Brand */}
        <div className="px-2 pb-5">
          <BrandMark size="md" wordmark sublabel="ISSUER CONSOLE" />
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'relative flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-left text-[13px] font-medium',
                  'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(27,30,36,0.06)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {/* Brass left accent bar for active item */}
                {active && (
                  <span
                    className="absolute left-0 top-[9px] bottom-[9px] w-[3px] rounded-r-[3px]"
                    style={{ background: 'var(--brass)' }}
                  />
                )}
                <Icon
                  className={cn('h-[17px] w-[17px] shrink-0', active ? 'text-primary' : 'text-current')}
                  strokeWidth={1.9}
                />
                {label}
              </button>
            )
          })}
        </nav>

        {/* Footer issuer chip */}
        <div
          className="mt-auto flex items-center gap-[10px] rounded-[11px] border border-separator bg-background px-[10px] py-3"
        >
          <div
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-primary font-semibold text-[11px] text-primary-foreground"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold leading-[1.1]">
              {identityKey != null ? `${identityKey.slice(0, 12)}…` : 'Issuer'}
            </div>
            <div className="mt-[2px] text-[10px] leading-[1.1] text-subtle-foreground">
              Verified issuer
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="p-[26px_30px]">
          {section === 'overview' && (
            <OverviewSection assets={assets} onReload={() => void reloadAssets()} />
          )}
          {section === 'operations' && <IssuerPanel />}
          {section === 'regulatory' && (
            <RegulatoryControls assets={assets} onActionComplete={() => void reloadAssets()} />
          )}
          {section === 'banking' && <BankingMock />}
          {section === 'audit' && <AuditLog assets={assets} />}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Remove the narrow issuer wrapper in TokenDemo.tsx**

In `app/src/components/TokenDemo.tsx`, the issuer branch currently wraps everything in `<div className="mx-auto max-w-2xl px-5 pb-20 pt-8 sm:pt-12">` with a tab bar above `IssuerDashboard`. Replace the entire issuer branch (`if (isIssuer) { ... }`) with a direct full-viewport render:

Find this block (lines ~123–170):
```tsx
  if (isIssuer) {
    return (
      <div className="mx-auto max-w-2xl px-5 pb-20 pt-8 sm:pt-12">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark wordmark size="sm" sublabel="TOKEN WALLET" />
        </header>

        <div className="mb-5 flex items-center gap-2.5 rounded-[--radius-md] bg-accent px-4 py-3 animate-in">
          <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-accent-foreground" />
          <p className="text-[13px] font-medium text-accent-foreground">
            Issuer mode — this wallet controls the overlay instance.
          </p>
        </div>

        <Tabs.Root defaultValue="issuer">
          <Tabs.List
            className="mb-6 flex w-full gap-1 rounded-[10px] bg-[var(--segment-track)] p-1"
            aria-label="Sections"
          >
            <Tabs.Trigger value="issuer" className={segTrigger}>
              <ShieldCheck className="h-4 w-4" /> Issuer
            </Tabs.Trigger>
            <Tabs.Trigger value="wallet" className={segTrigger}>
              <Wallet className="h-4 w-4" /> Wallet
            </Tabs.Trigger>
            <Tabs.Trigger value="send" className={segTrigger}>
              <Send className="h-4 w-4" /> Send
            </Tabs.Trigger>
            <Tabs.Trigger value="receive" className={segTrigger}>
              <Download className="h-4 w-4" /> Receive
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="issuer" className="animate-in focus-visible:outline-none">
            <IssuerDashboard />
          </Tabs.Content>
          <Tabs.Content value="wallet" className="animate-in focus-visible:outline-none">
            <TokenWallet identityKey={identityKey} />
          </Tabs.Content>
          <Tabs.Content value="send" className="animate-in focus-visible:outline-none">
            <SendTokens />
          </Tabs.Content>
          <Tabs.Content value="receive" className="animate-in focus-visible:outline-none">
            <ReceiveTokens />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    )
  }
```

Replace with:
```tsx
  if (isIssuer) {
    return <IssuerDashboard />
  }
```

After this change, the imports for `Tabs`, `Wallet`, `Send` (lucide), `Download`, `ShieldCheck`, `TokenWallet`, `SendTokens`, `ReceiveTokens`, `BrandMark`, `segTrigger` may become unused in the issuer branch. Keep them if they are still referenced by the holder branch below; remove only those that become entirely unused after the edit.

- [ ] **Step 4: Run tsc and vitest to verify no errors**

```bash
cd /Users/personal/git/demos/mandala/app
npx tsc --noEmit 2>&1 | head -30
```
Expected: empty output (0 errors)

```bash
npx vitest run src/components/issuer/IssuerDashboard --reporter=verbose 2>&1 | tail -10
```
Expected: 2 tests PASS

- [ ] **Step 5: Commit Task 1**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/issuer/IssuerDashboard.tsx app/src/components/TokenDemo.tsx
git commit -m "refactor(app): Meridian console shell — full-viewport left-nav layout"
```

---

### Task 2: OverviewSection — KPI tiles + assets table

**Files:**
- Create: `app/src/components/issuer/OverviewSection.tsx`
- Test: `app/src/components/issuer/OverviewSection.test.ts` (new smoke test)

**Interfaces:**
- Consumes: `AdminAsset` from `../../lib/mandala/assets`, `resolveAssetState`, `AssetAdminStateView` from `../../lib/mandala/adminState`, `resolveAdminHistory`, `AdminHistoryRow` from `../../lib/mandala/adminHistory`, `reconcile` from `../../lib/mandala/banking`, `seedDeposits` from `../../lib/mandala/banking`, `formatAmount` from `../../lib/mandala/amount`
- Props: `{ assets: AdminAsset[], onReload: () => void }`
- Produces: `OverviewSection` default export

**KPI derivation logic (implement exactly as described — honest degradation where noted):**

1. **In circulation** — sum of `netSupply` across all assets. For each asset: fetch `resolveAdminHistory(assetId)`, sum `amount` for `kind === 'issue'` rows minus `kind === 'redeem'` rows. Display as raw integer base-unit sum (no currency conversion — assets may have different currencies). Label: "total base units across all assets". If history unavailable, show the count of assets instead and label it accordingly.

2. **Net flow · recent** — NOT labelled "24h" because `AdminHistoryRow` has `height`/`offset` (block-chain coordinates), not timestamps. Instead: sum issue−redeem across ALL history rows (this is identical to circulation, so display it as "net issued" with sublabel "all history, issued − redeemed"). This is honest: we cannot filter to 24h without real timestamps. The tile label changes to "Net issued" and the sublabel is "all history · issued − redeemed".

3. **Reserve ratio** — uses `reconcile` from `banking.ts`. For each asset: call `resolveAdminHistory` to get total issued/redeemed; use `seedDeposits()` amounts as bank deposits (mirroring what `BankingMock` does). Call `reconcile({ deposits, withdrawals: [], issued, redeemed })`. Aggregate across assets: `totalBankBalance / totalNetSupply * 100`. If `totalNetSupply === 0`, show "—" with sublabel "no supply yet". If drift exists on any asset, show "Has drift" in amber. Otherwise show "100.0%".

4. **Needs attention** — count of assets where `resolveAssetState` returns `isPaused === true` OR where per-asset drift (from reconcile) is non-zero.

- [ ] **Step 1: Write the smoke test for OverviewSection**

Create `app/src/components/issuer/OverviewSection.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

// Mock network calls so the module loads in Node test env
vi.mock('../../lib/mandala/adminHistory', () => ({
  resolveAdminHistory: vi.fn().mockResolvedValue([])
}))
vi.mock('../../lib/mandala/adminState', () => ({
  resolveAssetState: vi.fn().mockResolvedValue(null)
}))

describe('OverviewSection smoke', () => {
  it('module is importable', async () => {
    await expect(import('./OverviewSection')).resolves.toBeDefined()
  })

  it('default export is a function (React component)', async () => {
    const mod = await import('./OverviewSection')
    expect(typeof mod.default).toBe('function')
  })
})
```

Run: `cd /Users/personal/git/demos/mandala/app && npx vitest run src/components/issuer/OverviewSection --reporter=verbose`
Expected: FAIL with "Cannot find module './OverviewSection'" — confirms the test is real

- [ ] **Step 2: Create OverviewSection.tsx**

Create `app/src/components/issuer/OverviewSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AdminAsset } from '../../lib/mandala/assets'
import { resolveAssetState, AssetAdminStateView } from '../../lib/mandala/adminState'
import { resolveAdminHistory } from '../../lib/mandala/adminHistory'
import { reconcile, seedDeposits } from '../../lib/mandala/banking'
import { formatAmount } from '../../lib/mandala/amount'
import { cn } from '@/lib/utils'

interface Props {
  assets: AdminAsset[]
  onReload: () => void
}

interface AssetMetrics {
  asset: AdminAsset
  state: AssetAdminStateView | null
  netSupply: number
  drift: number
  decimals: number
}

// ── Stat tile ──────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: string
  sub: string
  valueColor?: string
}) {
  return (
    <div className="flex-1 rounded-[13px] border border-border bg-card px-4 py-[15px]">
      <div className="text-[11px] leading-none text-subtle-foreground">{label}</div>
      <div
        className={cn(
          'mt-[10px] text-[24px] font-semibold leading-none tracking-[-0.3px] tabular-nums',
          valueColor ?? 'text-foreground'
        )}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      <div className="mt-[6px] text-[10.5px] leading-none text-faint-foreground">{sub}</div>
    </div>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────────

function StatusPill({ paused }: { paused: boolean }) {
  return paused ? (
    <span className="inline-flex items-center rounded-[6px] bg-warning/14 px-[9px] py-1 text-[11px] font-medium text-warning">
      Paused
    </span>
  ) : (
    <span className="inline-flex items-center rounded-[6px] bg-success/12 px-[9px] py-1 text-[11px] font-medium text-success">
      Active
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OverviewSection({ assets, onReload }: Props) {
  const [rows, setRows] = useState<AssetMetrics[]>([])
  const [loading, setLoading] = useState(false)

  const deposits = seedDeposits()
  const bankDepositAmounts = deposits.map(d => d.amount)

  const load = useCallback(async () => {
    if (assets.length === 0) { setRows([]); return }
    setLoading(true)
    try {
      const metrics = await Promise.all(
        assets.map(async (asset): Promise<AssetMetrics> => {
          const decimals = Number(asset.metadata?.decimals) || 0
          const [state, history] = await Promise.all([
            resolveAssetState(asset.assetId),
            resolveAdminHistory(asset.assetId),
          ])
          let totalIssued = 0
          let totalRedeemed = 0
          for (const row of history) {
            if (row.actionDetails.kind === 'issue')
              totalIssued += (row.actionDetails.amount as number) ?? 0
            if (row.actionDetails.kind === 'redeem')
              totalRedeemed += (row.actionDetails.amount as number) ?? 0
          }
          const netSupply = totalIssued - totalRedeemed
          const recon = reconcile({
            deposits: bankDepositAmounts,
            withdrawals: [],
            issued: totalIssued,
            redeemed: totalRedeemed,
          })
          return { asset, state, netSupply, drift: recon.drift, decimals }
        })
      )
      setRows(metrics)
    } finally {
      setLoading(false)
    }
  }, [assets]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  // ── Derived KPIs ─────────────────────────────────────────────────────────────

  const totalSupply = rows.reduce((s, r) => s + r.netSupply, 0)
  const totalDrift = rows.reduce((s, r) => s + r.drift, 0)
  const needsAttention = rows.filter(r => (r.state?.isPaused ?? false) || r.drift !== 0).length

  // Reserve ratio: sum all bank deposits / sum all net supplies
  const totalBankBal = bankDepositAmounts.reduce((s, a) => s + a, 0) * assets.length
  const reserveRatioPct =
    totalSupply === 0
      ? null
      : Math.min(100, (totalBankBal / totalSupply) * 100)

  const reserveValue =
    reserveRatioPct == null
      ? '—'
      : totalDrift !== 0
      ? 'Has drift'
      : `${reserveRatioPct.toFixed(1)}%`
  const reserveColor =
    reserveRatioPct == null || totalDrift === 0 ? undefined : 'text-warning'

  const hasAnyDrift = rows.some(r => r.drift !== 0)
  const allReserved = !hasAnyDrift && rows.length > 0

  return (
    <div>
      {/* ── Page title row ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-[27px] font-semibold leading-none tracking-[-0.5px]"
          >
            Overview
          </h1>
          <div className="mt-2 text-[13px] text-subtle-foreground">
            Live regulatory &amp; reserve state across {assets.length} asset{assets.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          {allReserved && (
            <span className="inline-flex items-center gap-[6px] rounded-full bg-success/10 px-3 py-2 text-[12px] font-medium text-success">
              <span className="h-[7px] w-[7px] rounded-full bg-success" />
              Reserves 100% backed
            </span>
          )}
          <button
            type="button"
            onClick={() => { onReload(); void load() }}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* ── KPI stat tiles ── */}
      <div className="mt-[22px] flex gap-[14px]">
        <StatTile
          label="In circulation"
          value={
            loading
              ? '…'
              : rows.length === 0
              ? '—'
              : formatAmount(totalSupply, 0)
          }
          sub="total base units · all assets"
        />
        <StatTile
          label="Net issued"
          value={
            loading
              ? '…'
              : rows.length === 0
              ? '—'
              : (totalSupply >= 0 ? '+' : '') + formatAmount(totalSupply, 0)
          }
          sub="all history · issued − redeemed"
          valueColor={totalSupply > 0 ? 'text-success' : undefined}
        />
        <StatTile
          label="Reserve ratio"
          value={loading ? '…' : reserveValue}
          sub="bank ↔ supply"
          valueColor={reserveColor}
        />
        <StatTile
          label="Needs attention"
          value={loading ? '…' : String(needsAttention)}
          sub={
            needsAttention === 0
              ? 'all clear'
              : `${rows.filter(r => r.state?.isPaused).length} paused · ${rows.filter(r => r.drift !== 0).length} drift`
          }
          valueColor={needsAttention > 0 ? 'text-warning' : undefined}
        />
      </div>

      {/* ── Assets table ── */}
      <div className="mt-5 overflow-hidden rounded-[14px] border border-border bg-card">
        {/* Table header */}
        <div
          className="grid items-center gap-3 border-b border-separator bg-muted px-[18px] py-[11px]"
          style={{ gridTemplateColumns: '1.6fr 1fr 0.9fr 0.9fr 1fr' }}
        >
          {['ASSET', 'SUPPLY', 'STATUS', 'ACCESS', 'RESERVE'].map((col, i) => (
            <div
              key={col}
              className={cn(
                'text-[10px] font-medium tracking-[1px] text-faint-foreground',
                i === 1 || i === 4 ? 'text-right' : ''
              )}
            >
              {col}
            </div>
          ))}
        </div>

        {/* Loading / empty */}
        {loading && rows.length === 0 && (
          <div className="px-[18px] py-5 text-[13px] text-muted-foreground animate-pulse">
            Loading assets…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="px-[18px] py-5 text-[13px] text-muted-foreground">
            No assets registered yet.
          </div>
        )}

        {/* Rows */}
        {rows.map(({ asset, state, netSupply, drift, decimals }) => {
          const isPaused = state?.isPaused ?? false
          const accessMode = state?.accessMode ?? '—'
          const hasDrift = drift !== 0

          // Build a 1-2 letter badge from label (e.g. "US Dollar" → "$" or first letter)
          const ticker = String(asset.metadata?.ticker ?? asset.label.slice(0, 2)).toUpperCase()
          const symbol = { USD: '$', EUR: '€', GBP: '£', CHF: 'Fr' }[ticker] ?? ticker.slice(0, 2)

          return (
            <div
              key={asset.assetId}
              className={cn(
                'grid items-center gap-3 border-t border-separator px-[18px] py-[13px]',
                isPaused ? 'bg-warning/[0.04]' : ''
              )}
              style={{ gridTemplateColumns: '1.6fr 1fr 0.9fr 0.9fr 1fr' }}
            >
              {/* ASSET */}
              <div className="flex items-center gap-[10px]">
                <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-accent font-bold text-[13px] text-accent-foreground">
                  {symbol}
                </div>
                <div>
                  <div className="text-[13px] font-semibold leading-[1.1]">{asset.label}</div>
                  <div className="mt-[2px] text-[10.5px] leading-[1.1] text-subtle-foreground">
                    {String(asset.metadata?.ticker ?? asset.assetId.slice(0, 8) + '…')}
                  </div>
                </div>
              </div>

              {/* SUPPLY */}
              <div
                className="text-right text-[13px] font-medium"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatAmount(netSupply, decimals)}
              </div>

              {/* STATUS */}
              <div>
                <StatusPill paused={isPaused} />
              </div>

              {/* ACCESS */}
              <div className="text-[12px] text-muted-foreground capitalize">
                {accessMode === '—' ? '—' : accessMode === 'allowlist' ? 'Allowlist' : 'Denylist'}
              </div>

              {/* RESERVE */}
              <div
                className={cn(
                  'text-right text-[12px] font-medium',
                  hasDrift ? 'text-warning' : 'text-success'
                )}
              >
                {hasDrift
                  ? `${drift > 0 ? '+' : ''}${formatAmount(drift, decimals)} drift`
                  : '100%'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run the smoke test to verify it passes**

```bash
cd /Users/personal/git/demos/mandala/app && npx vitest run src/components/issuer/OverviewSection --reporter=verbose
```
Expected: 2 tests PASS

- [ ] **Step 4: Run full issuer test suite**

```bash
cd /Users/personal/git/demos/mandala/app && npx vitest run src/components/issuer --reporter=verbose
```
Expected: all tests PASS (IssuerDashboard × 2, AssetOverview × 2, OverviewSection × 2, RegulatoryControls, BankingMock, AuditLog)

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/personal/git/demos/mandala/app && npx tsc --noEmit 2>&1 | head -40
```
Expected: empty output

- [ ] **Step 6: Build check**

```bash
cd /Users/personal/git/demos/mandala/app && npm run build 2>&1 | tail -20
```
Expected: `✓ built in ...` (no errors)

- [ ] **Step 7: Commit Task 2**

```bash
cd /Users/personal/git/demos/mandala
git add app/src/components/issuer/OverviewSection.tsx app/src/components/issuer/OverviewSection.test.ts
git commit -m "feat(app): Meridian issuer console — left nav, KPI overview, assets table"
```

---

### Task 3: Write report and squash to final commit message

**Files:**
- Create: `/Users/personal/git/demos/mandala/.superpowers/sdd/m3-report.md`

- [ ] **Step 1: Run final verification**

```bash
cd /Users/personal/git/demos/mandala/app
npx tsc --noEmit && echo "TSC: OK"
npm run build 2>&1 | tail -5
npx vitest run src/components/issuer --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 2: Amend the final commit message to the required form**

The last commit should carry: `feat(app): Meridian issuer console — left nav, KPI overview, assets table`

If the final state is split across two commits, squash or amend as needed.

- [ ] **Step 3: Write the report**

Create `/Users/personal/git/demos/mandala/.superpowers/sdd/m3-report.md` with the build status, commit sha, files changed, KPI derivations, tsc/build/test results, and any concerns.

---

## Self-Review: spec coverage check

| Spec requirement | Task covering it |
|-----------------|-----------------|
| Left sidebar nav with BrandMark + ISSUER CONSOLE | Task 1 |
| Nav items Overview/Operations/Regulatory/Banking/Audit | Task 1 |
| Active item = white bg + brass left accent bar | Task 1 |
| Footer issuer identity chip | Task 1 |
| Full viewport width (not narrow container) | Task 1 — TokenDemo issuer branch simplified |
| 4 KPI stat tiles — In circulation | Task 2 (from admin history sum) |
| 4 KPI stat tiles — Net flow (relabeled "Net issued" — honest) | Task 2 |
| 4 KPI stat tiles — Reserve ratio | Task 2 (from reconcile) |
| 4 KPI stat tiles — Needs attention | Task 2 (paused count + drift count) |
| Assets table: ASSET/SUPPLY/STATUS/ACCESS/RESERVE columns | Task 2 |
| Status pills Active/Paused from resolveAssetState | Task 2 |
| Paused rows amber tint | Task 2 |
| Drift shown in amber | Task 2 |
| Reserves 100% backed pill | Task 2 |
| Operations → IssuerPanel | Task 1 |
| Regulatory → RegulatoryControls | Task 1 |
| Banking → BankingMock | Task 1 |
| Audit → AuditLog | Task 1 |
| TokenDemo issuer routing intact | Task 1 |
| tsc 0 / build pass / vitest pass | Tasks 2+3 |
| Commit message exact | Task 3 |

**Placeholder scan:** No TBDs, no "implement later", no "similar to Task N" — all code is fully spelled out.

**Type consistency:** `AdminAsset` from `../../lib/mandala/assets` used consistently. `AssetAdminStateView` from `../../lib/mandala/adminState`. `reconcile` signature from `banking.ts`: `{ deposits, withdrawals, issued, redeemed }` → `{ bankBalance, netSupply, drift }`.
