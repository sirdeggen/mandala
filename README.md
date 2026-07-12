# Underwrite

### The regulated-stablecoin platform where every token is *provable*, not promised.

A stablecoin is a promise: every token in circulation is backed, one-for-one, by
real money in a real account. Most of the market runs on that promise alone —
holders, auditors and regulators take the backing on faith and reconcile reserves
in spreadsheets weeks after the fact, if at all. When a peg slips, everyone finds
out too late.

**Underwrite closes that gap.** It is a source-available, self-hosted platform for
issuing and administering **regulated, fully-reserved stablecoins, tokenised
deposits and e-money** — where issuance, transfer and redemption settle on a public
chain, every unit of supply is independently verifiable in real time, and the rules
you are legally accountable for are enforced by your own infrastructure, not a
vendor's black box. Reserve attestations, redemption-at-par confirmations and
sensitive control actions are **cryptographically signed and anchored on-chain**,
giving your auditors and regulator a tamper-evident trail from every token back to
the cash that backs it — without ever taking the issuer's word for it.

You own the deployment, the data and the brand. There is no per-seat SaaS licence,
no custody lock-in, and no minimum. A full instance runs on a single VPS for the
price of a team lunch — or on the public network at production scale.

> **For evaluators:** Underwrite is designed to satisfy a MiCA / GENIUS-Act-style
> mandate end to end — licensed issuance, eligible-reserve rules, redemption at par,
> sanctions and travel-rule controls, independent audit, and continuous
> proof-of-reserves — on infrastructure you host and control. Sections below map
> directly to typical tender requirements.

---

## Capabilities

**Issuance & token lifecycle.** Register any instrument (EUR/USD/CHF-pegged token,
tokenised deposit, e-money) in one genesis transaction, then issue, transfer,
receive and redeem. Every movement settles on-chain with a per-transaction
**key-linkage proof** binding each output to a controlling identity, so supply and
counterparties are provable — not asserted. Multiple instruments per operator, each
independently governed.

**Reserves & continuous proof-of-reserves.** Record reserve composition by asset
class with the compliance fields an auditor expects (custodian, jurisdiction,
maturity, ISIN). Eligibility rules encode regulatory constraints — e.g. the
**93-day residual-maturity cap** — so only qualifying assets count toward backing.
A live reconciliation compares on-chain supply against reserve and bank balances
and flags any drift, giving *"is every token backed?"* a continuous, provable
answer.

**Reserve attestations & independent audit.** Auditors sign period attestations
with their own wallet key; the signature is a canonical, tamper-evident digest of
exactly what was attested and is **anchored on-chain**. Sign-with-exceptions,
evidence attachments and verification badges are built in. Alter any signed figure
and verification fails.

**Redemption at par.** A published redemption policy (settlement window, minimum,
terms) plus a redemption register where each settlement is confirmed **at par**
with a signed, anchored auditor confirmation — the core holder-protection
obligation under MiCA and the GENIUS Act.

**Regulatory controls, enforced server-side.** Pause, freeze/unfreeze, block/allow
identities, allow-list vs deny-list access modes, and **supply-conserving reissue**
from a frozen output (recover funds to the rightful owner without changing net
supply). Controls are enforced by the overlay at admission — not merely hidden in
the UI — and sensitive actions carry auditor sign-off anchored on-chain. A
developer mode lets you *prove* enforcement is server-side.

**Screening, sanctions governance & travel rule.** Holder KYC/sanctions/PEP/risk
screening, per-instrument and org-wide **sanction-list governance** (OFAC, EU, UN,
UK OFSI, Swiss SECO) with inherited or custom policies and an incoming-updates feed,
and a configurable travel-rule threshold — all designed as clean **integration
points** for your production KYC, screening and analytics providers.

**Reporting & signed export.** Preview and export every compliance surface
(composition, attestations, redemptions, screening, reconciliation, control
actions, ledger) as CSV, spreadsheet or PDF. Taking data out is itself a controlled
action: downloads require a **wallet signature anchored on-chain**, so there is an
audit trail of who exported what, and when.

**Relationships & role-based access.** A directory-driven relationship manager for
the institutions you work with — reserve banks, custodians, market makers,
exchanges, auditors, regulators — each with named people who hold platform access
under a system role (Administrator / Approver / Operator / Auditor / Viewer) and
granular permissions. You manage your own organisation's members; counterparties
manage theirs.

**Licensing & authorisation.** Category whitelisting (which instrument types a Badge
may issue) is granted by an external licensing authority (e.g. FINMA, an EU MiCA
authority) and merely *reflected* in-app — never self-assigned — with a request
flow for additional categories.

**Integrations hub.** A connections surface modelling how the platform wires to the
external services a regulated issuer depends on — KYC, sanctions feeds, blockchain
analytics, banking & custody, SSO, attestation, regulatory reporting and licensing
— with environments, scopes, key rotation and webhooks.

**White-label & multi-tenant by design.** Rebrandable issuer console, holder wallet
and auditor view. Every operator runs one shared codebase against a shared on-chain
data standard, so tokens, identities, linkage proofs and audit trails stay
interoperable across instances and jurisdictions.

---

## Benefits

- **Provable backing, in real time.** Supply is verifiable on a public ledger and
  reconciled continuously against reserves — replacing after-the-fact spreadsheet
  reconciliation with a live, independently checkable answer.
- **Regulator-grade enforcement.** The rules you are accountable for (conservation,
  sanctions, freeze, access mode) are enforced by your infrastructure at the point
  of settlement, and demonstrably so.
- **Tamper-evident audit.** Attestations, redemptions and control actions are
  cryptographically signed and anchored on-chain — non-repudiable and impossible to
  quietly backdate or edit.
- **Data sovereignty, no lock-in.** Self-hosted and source-available. You hold the
  keys, the data and the deployment; no custodian sits between you and your reserves,
  and no vendor can switch you off.
- **Low total cost of ownership.** No per-seat licence. A local instance costs
  nothing; a hosted single-VPS deployment runs roughly **€10–25/month**, and
  on-chain settlement fees are sub-cent on a high-throughput public network.
- **Fast to stand up.** Running end-to-end on a laptop in minutes via Docker
  Compose; the same codebase goes to production by pointing at a network node.
- **Audit-ready on day one.** Auditors get their own verifiable, exportable view
  instead of a data dump — shortening review cycles and reducing audit cost.
- **Interoperable.** A shared standard means holders, counterparties and auditors
  can verify across operators and borders.

---

## How Underwrite is different

Most commercial stablecoin offerings are **custodial issuance-as-a-service**: a
vendor mints on your behalf, holds or brokers your reserves, runs the compliance
stack in their cloud, and hands you a dashboard and an API. That is fast to start
and a poor fit for an institution that must *own* its regulatory posture. Underwrite
takes the opposite stance.

| | Typical commercial platform | **Underwrite** |
|---|---|---|
| **Deployment** | Vendor SaaS / managed custody | **Self-hosted**, source-available; you run it |
| **Custody of reserves & keys** | Vendor or partner custodian | **You hold the keys**; connect your own bank/custodian |
| **Backing verification** | Vendor attestation / periodic report | **On-chain, real-time**, independently verifiable |
| **Rule enforcement** | In the vendor's backend | **In your overlay**, at settlement — provably server-side |
| **Audit trail** | Exportable logs you must trust | **Cryptographically signed & on-chain-anchored** |
| **Auditor experience** | Read access to a dashboard | **Independent, verifiable, exportable** sign-off workflow |
| **Recovery of funds** | Vendor-mediated | **Supply-conserving reissue** you control |
| **Commercials** | Per-seat / volume SaaS + custody fees | **No licence fee**; ~€10–25/mo hosting, sub-cent settlement |
| **Lock-in** | Proprietary rails & data | **Open standard**; interoperable across operators |
| **Identity & access** | Vendor accounts & passwords | **Wallet-native identity** + role-based access |

**In short:** commercial platforms ask you to trust their infrastructure;
Underwrite lets your holders, auditors and regulator trust *mathematics and a public
ledger* — while you keep custody, control and your brand.

---

Operating this platform is your responsibility. The software is provided "as is"
with no warranty, and the author's liability is excluded to the fullest extent
permitted by law; **you alone are responsible for your deployment's legal and
regulatory compliance** — e-money and stablecoin regulation (e.g. MiCA), securities
law, AML/KYC, sanctions screening, and GDPR. The KYC, sanctions, banking, custody,
licensing and analytics integrations ship as clearly-marked integration points to
be wired to your production providers before go-live. Prospective issuers should
take their own legal advice before issuing a regulated instrument to the public.

**Built on:** @bsv/sdk v2.1.6, @bsv/templates v1.9.0, @bsv/overlay-topics
v1.5.0, @bsv/overlay v2.2.0, BRC-100 identity protocol.

---

## Architecture Overview

- **Overlay Service** (`overlay/`): OverlayExpress instance on localhost:8080
  running the `tm_mandala` topic manager and `ls_mandala` lookup service.
  MongoDB stores tokens, key-linkage records, asset admin state and history;
  SQLite caches engine transactions/outputs. Exposes custom admin read
  endpoints (asset state, admin history, aggregated supply summary, and an
  overlay-wide activity feed with linkage-proven counterparties).
  A Go port lives in `overlay-go/` (see that package’s README).
- **App Frontend** (`app/`): React/Vite SPA, role-gated by wallet identity.
  - **Issuer console** (`/issuer/:section`) — sidebar sections: **Overview**
    (KPIs, admin history, register-asset strip), **Treasury** (issuer's own
    balance, send/receive), **Operations** (issue/redeem + regulatory
    controls), **Activity** (overlay-wide transaction feed), **Banking**
    (simulated bank transfers + reserve reconciliation).
  - **Holder wallet** — accounts overview, per-asset account with send/receive/
    history, contacts, QR receive.
- **Token client** (`lib/`): `@bsv/mandala` — send, receive, and administer
  assets with overlay-first commit and journaled recovery.
- **Token Flows**: Register asset (genesis outpoint = assetId) → Issue →
  Transfer (per-output `revealSpecificKeyLinkage` proves counterparties to the
  overlay) → Receive (MessageBox internalize) → Redeem (burn) →
  Freeze/Reissue (regulatory recovery, supply-conserving).

---

## Quick Start

### 1. Start the Overlay Service

```bash
cd overlay
npm install
npm run gen-key
```

This prints:
```
SERVER_PRIVATE_KEY: <private_key>
IDENTITY_PUBLIC_KEY: <public_key>
```

Save the output. Copy `.env.example` → `.env` and paste the `SERVER_PRIVATE_KEY`:

```bash
cp .env.example .env
# Edit .env, replace SERVER_PRIVATE_KEY with the output above
```

Start the overlay and MongoDB:

```bash
docker compose up --build
```

Verify it's running:

```bash
curl http://localhost:8080/api/v1/info
```

You should see the overlay info response with `tm_mandala` configured.

### 2. Start the Frontend App

In a new terminal:

```bash
cd app
npm install
cp .env.example .env
```

Edit `app/.env` and set:
- `VITE_OVERLAY_IDENTITY_KEY`: the `IDENTITY_PUBLIC_KEY` from step 1
- `VITE_OVERLAY_URL`: `http://localhost:8080`
- `VITE_MESSAGEBOX_URL`: `https://messagebox.babbage.systems` (or your own MessageBox instance)

Run the dev server:

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### 3. Connect Your Wallet

The app requires a **BRC-100 (MetaNet) wallet** running locally. When the
wallet's identity key matches `VITE_OVERLAY_IDENTITY_KEY`, the app renders the
**issuer console**; any other wallet gets the **holder wallet** UI.

---

## The Issuer Console

Navigate between sections in the left sidebar; the selected asset lives in the
URL (`?asset=`) so a reload restores exactly where you were.

### Overview

KPI tiles (in circulation, net issued, reserve ratio, restrictions) computed
from the overlay's aggregated supply summary, the ordered admin-action history
(virtualized, infinite scroll), and the **Register a new asset** strip in the
top bar (label, ticker, decimals → one genesis tx; its outpoint becomes the
assetId).

### Treasury

The issuer's own holdings of the selected asset: balance card and
Send / Receive tabs (the same flows a holder uses, locked to the asset).

### Operations

- **Issue tokens** — mint new units into circulation (optionally referencing a
  bank deposit ref from the Banking page).
- **Redeem tokens** — burn units out of circulation.
- **Regulatory controls** — pause/unpause transfers, block/allow identities,
  set access mode (denylist/allowlist), freeze/unfreeze outputs, and **reissue**
  from a frozen output (supply-conserving recovery: the frozen coin is evicted
  and replacement units are minted to the rightful owner).

### Activity

The **overlay-wide transaction feed** — every transaction admitted by the
overlay for the asset, with sender and recipient identities proven by the key
linkage revealed at submission. Each row is a semantic summary (issued /
transfer A→B / self / redeemed, with net units moved) plus a linkage-proof
badge. This is the operator’s oversight surface: not just the issuer’s own
transfers, but every party to every movement of the asset. Cursor-paginated
and virtualized — it stays snappy at thousands of transactions.

### Banking

A bank feed for reserve reconciliation: add incoming/outgoing transfers per
asset (persisted locally, deletable), and a reconciliation view comparing the
bank balance to net on-chain supply, flagging drift with guidance to issue or
redeem.

---

## Holder Operations

### Receive a Transfer

1. **Receive** shows your identity key as a QR code, plus pending inbound
   transfers from the message box.
2. **Accept** internalizes the tokens into your wallet basket; balance updates
   immediately.

### Send Tokens

1. **Send** — search recipients by name/@handle/email, pick a recent contact,
   paste an identity key (one field handles all three), or use the
   **Return to issuer** shortcut.
2. Amount keypad → review → send. The overlay validates conservation,
   key linkage, sanctions, pause state and access mode before admitting.
3. The recipient is notified via MessageBox.

### History

Per-asset transaction table (type, counterparty, amount, txid) with CSV
export. Counterparty identity keys resolve to names/avatars where the identity
network knows them.

---

## Overlay Admin Endpoints

Custom read endpoints registered by `overlay/src/index.ts` (all CORS-open for
local development):

| Endpoint | Purpose |
|---|---|
| `GET /admin/asset-state/:assetId` | Derived `AssetAdminState` (paused, access mode, blocked/allowed identities, frozen outpoints). |
| `GET /admin/admin-history/:assetId` | Full ordered admin-action history (used for CSV export). |
| `GET /admin/admin-history-page/:assetId?limit=&offset=` | Paged, newest-first admin history (drives the audit log UI). |
| `GET /admin/admin-summary/:assetId` | Aggregated `totalIssued` / `totalRedeemed` / `actionCount` (drives KPI + reconciliation math without shipping the full history). |
| `GET /admin/activity?assetId=&limit=&before=` | Cursor-paginated overlay-wide transaction feed with linkage-proven counterparties (see `overlay/src/activity.ts`). |

Mongo indexes backing the hot paths (`linkage.createdAt`,
`adminHistory.(assetId, admitSeq)`) are created at overlay boot.

---

## Manual End-to-End Verification Checklist

### Setup

- [ ] Overlay running on localhost:8080; `curl http://localhost:8080/api/v1/info` returns valid response.
- [ ] App running on localhost:5173 with `VITE_OVERLAY_IDENTITY_KEY` set to overlay's identity pubkey.
- [ ] Issuer wallet connected (identity key matches the overlay's).

### Registration & Issuance

- [ ] Issuer console renders (only when wallet identity === overlay identity).
- [ ] Overview → Register "Gold" (ticker GLD) → asset appears in the top-bar switcher; assetId is `<genesis_txid>.0`.
- [ ] Operations → Issue 100 → Overview "In circulation" shows 100; Treasury balance shows 100.
- [ ] Activity page shows the issuance (`Issued +100`, minted → issuer identity).

### Transfer & Receive

- [ ] Connect a **second wallet** (different identity) — it gets the holder UI, no issuer console.
- [ ] Issuer: Treasury → Send 40 to the second wallet's identity.
- [ ] Second wallet: Receive shows 40 pending → Accept → balance 40.
- [ ] Issuer Treasury balance 60 (change).
- [ ] Activity page shows the transfer as `Transfer 40` from issuer to recipient (change output not shown — it's a technical detail).
- [ ] Second wallet sends 10 back → issuer accepts → balances 30 / 70.

### Redeem

- [ ] Operations → Redeem 20 → Overview "In circulation" drops to 50; Activity shows `Redeemed −20`.

### Regulatory Controls

- [ ] Operations → Pause → second wallet's send is rejected by the overlay (frontend guard bypassable via the Dev toggle to prove server-side enforcement).
- [ ] Freeze one of the second wallet's outpoints → that coin cannot be spent.
- [ ] Reissue from the frozen outpoint to the same identity → replacement units arrive; audit log records `freezeOutput` then `reissue`.

### Banking Reconciliation

- [ ] Banking → add incoming transfer 50 → reconciliation shows drift (bank 50 vs supply) with guidance.
- [ ] Issue 50 from Operations → reconciliation shows "Reconciled — 100%".

---

## Running Tests

```bash
cd app && npm run test        # component, lib and flow tests (Vitest)
cd overlay && npm run test    # activity feed classifier + pagination tests
```

Both suites must pass. Typecheck with `npx tsc --noEmit` in either package.

---

## Environment Variables

### Overlay (`overlay/.env`)

```env
NODE_NAME=mandala
SERVER_PRIVATE_KEY=<output_from_npm_run_gen-key>
HOSTING_URL=http://localhost:8080
MONGO_URL=mongodb://mongodb:27017/mandala
NETWORK=main                # or test
SQLITE_FILE=/data/overlay.sqlite
# Optional — makes the overlay a full network participant (broadcast + SPV):
# ARCADE_URL=<arcade host>
# ARCADE_API_KEY=<key>
# CHAINTRACKS_URL=<defaults to $ARCADE_URL/chaintracks>
```

Without `ARCADE_URL` the overlay validates scripts only and the wallet is the
sole broadcaster (local development mode).

### App (`app/.env`)

```env
VITE_OVERLAY_URL=http://localhost:8080
VITE_OVERLAY_IDENTITY_KEY=<IDENTITY_PUBLIC_KEY_from_overlay_gen-key>
VITE_MESSAGEBOX_URL=https://messagebox.babbage.systems
```

---

## Key Dependencies

- **@bsv/sdk** `^2.1.6` — core blockchain and transaction utilities.
- **@bsv/templates** `^1.9.0` — `MandalaToken` / `MandalaAdmin` script templates. App and overlay MUST run the same version (assetId byte-order encoding must agree).
- **@bsv/overlay** `^2.2.0` — overlay engine + Knex/Mongo storage.
- **@bsv/overlay-express** `^2.4.1` — Express host for the overlay HTTP API.
- **@bsv/overlay-topics** `^1.5.0` — `tm_mandala` topic manager + `ls_mandala` lookup service + `MandalaStorageManager`.
- **@bsv/identity-react** `^1.1.14` — identity resolution hooks.
- **@bsv/message-box-client** `^2.2.0` — peer-to-peer transfer handoff.
- **React 19 / Vite 6 / Tailwind CSS 4** — frontend stack.
- **@tanstack/react-query + react-virtual** — cached/paged data fetching and virtualized lists.

---

## Troubleshooting

### Overlay won't start

- Ensure Docker and Docker Compose are installed and running.
- Check `docker compose logs mongodb` for MongoDB errors.
- Verify `.env` has the correct `SERVER_PRIVATE_KEY` (no leading/trailing whitespace).
- Clear volumes: `docker compose down -v && docker compose up --build`.

### App won't connect to overlay

- Verify `VITE_OVERLAY_URL=http://localhost:8080`.
- Check overlay is running: `curl http://localhost:8080/api/v1/info`.
- Clear browser cache and restart dev server.

### Issuer console not appearing

- Ensure wallet identity key matches overlay's `IDENTITY_PUBLIC_KEY` (from `npm run gen-key`).
- Check `app/.env` has correct `VITE_OVERLAY_IDENTITY_KEY`.

### `overlay rejected the transaction` after a dependency bump

- A stale Vite pre-bundle cache can serve an old `@bsv/templates` after a bump,
  causing an assetId encoding mismatch → conservation failure. Fix:
  `rm -rf app/node_modules/.vite` and restart the dev server.

### Transfer not appearing in Receive

- Confirm both wallets are connected and running.
- Check overlay logs: `docker compose logs overlay`.
- Refresh the Receive tab.

---

## Architecture Notes

### Role Gating

The issuer console appears **only when** the connected wallet's identity key
equals the overlay's identity key. Everyone else gets the holder wallet. Only
the token authority can mint, redeem, pause, freeze or reissue.

### Transfer Linkage & Operator Oversight

Every FT output submitted to the overlay carries a `revealSpecificKeyLinkage`
proof binding it to a controlling identity key. The overlay verifies the proof
before admission and retains the linkage record permanently — this is what
powers sanctions screening, access-mode enforcement, and the issuer's
**Activity** page (sender/recipient per transaction, derived by walking each
input back to its linkage-proven source output).

### Supply Conservation

Per asset, the overlay only admits transactions where
`outputs == inputs + authorizedIssuance`. Minting balances only because the
issuer's admin-authorized `+amount` is present; redemption is negative
issuance; a `reissue` mints replacement units while evicting the frozen coin
from the overlay's balance view, keeping net supply constant.

### MessageBox Integration

Pending transfers are delivered as MessageBox entries. The recipient's wallet
calls `internalizeAction` to accept, which inserts the output into its basket
and updates the balance.

---

## License

Mandala is part of the BSV Mandala Token stack. Refer to `docs/` for detailed
architecture (`docs/PROJECT-STATE.md`) and operator documentation
(`docs/STABLECOIN-ADMIN.md`).
