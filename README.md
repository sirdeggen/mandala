# Mandala Token Demo

A complete BSV blockchain token system demonstration featuring a self-hosted overlay service for token registration, issuance, transfer, and redemption, paired with a React/Vite frontend for wallet-based token management.

**Built on:** BSV SDK v2.1.6, @bsv/templates v1.6.1, BRC-100 identity protocol.

---

## Architecture Overview

- **Overlay Service** (`overlay/`): Topic Manager instance running on localhost:8080, manages token lifecycle via tm_mandala topic. Uses MongoDB for certificate storage, SQLite for transaction/output caching.
- **App Frontend** (`app/`): React/Vite SPA with role-gated UI. Issuer (admin) sees Register/Issue/Redeem/Recover tabs; regular wallets see Wallet/Send/Receive. Connects to a BRC-100 identity wallet (MetaNet / Babbage) and the overlay service.
- **Token Flows**: Register asset (genesis outpoint) → Issue → Transfer (per-output `revealSpecificKeyLinkage` for counterparty verification) → Receive (MessageBox internalize) → Redeem/Recover.

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

The app requires a **BRC-100 (MetaNet) wallet** running locally. The wallet's identity key must match `VITE_OVERLAY_IDENTITY_KEY` to unlock the **Issuer** tab (Register/Issue/Redeem/Recover). Other wallets see Wallet/Send/Receive only.

---

## Token Operations

### Register an Asset

(Issuer only)

1. Go to the **Issuer** tab → **Register**.
2. Enter an asset name (e.g., "Gold").
3. Click **Register**.
4. You'll see a toast: `assetId: <genesis_txid>.0`. This is the token identifier.
5. The asset appears in the **Issuer asset list**.

### Issue Tokens

(Issuer only)

1. Go to **Issuer** → **Issue**.
2. Select the asset.
3. Enter a quantity (e.g., 100).
4. Click **Issue**.
5. Go to **Wallet** → you now see the balance.

### Transfer to Another Wallet

1. Go to **Wallet** → **Send**.
2. Enter the recipient's wallet identity key and amount.
3. Click **Send**.
4. The overlay validates counterparty eligibility using per-output `revealSpecificKeyLinkage` linking.
5. The recipient's wallet receives a pending transfer in **Receive**.

### Receive a Transfer

1. Go to **Wallet** → **Receive**.
2. You'll see pending inbound transfers.
3. Click **Accept** to finalize.
4. Balance updates immediately.

### Redeem Tokens

(Issuer or token holder)

1. Go to **Issuer** → **Redeem** (or same flow from **Wallet** if not issuer, if permitted).
2. Enter the amount and click **Redeem**.
3. The tokens are burned. Balance drops.

### Recover Tokens (Admin Seize)

(Issuer only)

1. Go to **Issuer** → **Recover**.
2. Enter a target identity key and amount.
3. Click **Recover**.
4. The target wallet receives the tokens via the overlay's MessageBox.

---

## Manual End-to-End Verification Checklist

Run through the following steps to verify the entire system:

### Setup

- [ ] Overlay running on localhost:8080; `curl http://localhost:8080/api/v1/info` returns valid response.
- [ ] App running on localhost:5173 with `VITE_OVERLAY_IDENTITY_KEY` set to overlay's identity pubkey.
- [ ] Issuer wallet connected (identity key matches `SERVER_PRIVATE_KEY`).

### Token Registration & Issuance

- [ ] **Issuer** tab visible (only when wallet identity === overlay identity).
- [ ] Issuer: Register "Gold" → toast shows `assetId: <genesis_txid>.0`.
- [ ] "Gold" appears in **Issuer asset list**.
- [ ] Issuer: Issue 100 Gold to self → **Wallet** tab shows "Gold: 100".

### Transfer & Receive (Single Recipient)

- [ ] Connect a **second wallet** (different identity key).
- [ ] Second wallet: verify **Issuer tab is NOT visible** (role-gating works).
- [ ] Issuer: **Send** 40 Gold to second wallet's identity.
- [ ] Overlay admits the transfer (per-output linkage verified).
- [ ] Second wallet: **Receive** shows pending transfer (40 Gold).
- [ ] Second wallet: **Accept** → **Wallet** shows "Gold: 40".
- [ ] Issuer: **Wallet** shows "Gold: 60" (change from 100 − 40).

### Bidirectional Transfer

- [ ] Second wallet: **Send** 10 Gold back to issuer.
- [ ] Issuer: **Receive** shows pending (10 Gold).
- [ ] Issuer: **Accept** → **Wallet** shows "Gold: 70" (60 + 10).
- [ ] Second wallet: **Wallet** shows "Gold: 30" (40 − 10).

### Redeem

- [ ] Issuer: **Redeem** 20 Gold.
- [ ] **Wallet** balance drops to "Gold: 50" (70 − 20).
- [ ] Overlay confirms burn.

### Recover (Admin Seize)

- [ ] Issuer: **Recover** 5 Gold to second wallet's identity.
- [ ] Second wallet: **Receive** shows 5 Gold pending (from recover).
- [ ] Second wallet: **Accept** → **Wallet** shows "Gold: 35" (30 + 5).

### Role Gating

- [ ] Connect a **third wallet** (different identity, not issuer).
- [ ] Verify **Issuer tab is NOT visible**.
- [ ] Third wallet can see **Wallet/Send/Receive** only.

---

## Running Tests

The app includes unit tests for encoding, unlock, overlay integration, asset store, and token operations:

```bash
cd app
npm run test
```

Expected output: all Vitest suites (encoding, unlock, overlay, assetStore, tokens) **PASS**.

Test files:
- `src/lib/mandala/encoding.test.ts` — off-chain payload encoding/decoding
- `src/lib/mandala/unlock.test.ts` — wallet-based script unlock
- `src/lib/mandala/overlay.test.ts` — overlay integration (submission, certificate parsing)
- `src/lib/mandala/assetStore.test.ts` — asset registry and balance tracking
- `src/lib/mandala/tokens.test.ts` — token lifecycle (register, issue, transfer, redeem, recover)

---

## Environment Variables

### Overlay (`overlay/.env`)

```env
NODE_NAME=mandala
SERVER_PRIVATE_KEY=<output_from_npm_run_gen-key>
HOSTING_URL=http://localhost:8080
MONGO_URL=mongodb://mongodb:27017/mandala
NETWORK=test
SQLITE_FILE=/data/overlay.sqlite
```

### App (`app/.env`)

```env
VITE_OVERLAY_URL=http://localhost:8080
VITE_OVERLAY_IDENTITY_KEY=<IDENTITY_PUBLIC_KEY_from_overlay_gen-key>
VITE_MESSAGEBOX_URL=https://messagebox.babbage.systems
```

---

## Key Dependencies

- **@bsv/sdk** `^2.1.6` — Core blockchain and transaction utilities.
- **@bsv/templates** `^1.6.1` — MandalaToken encode/decode (fixes amounts 1–16).
- **@bsv/overlay** `^2.1.0` — Overlay Topic Manager and certificate validation.
- **@bsv/overlay-express** `^2.4.0` — Express middleware for overlay HTTP API.
- **@bsv/overlay-topics** `^1.2.0` — Topic-specific lookups and operations.
- **@bsv/identity-react** `^1.1.10` — React hooks for BRC-100 wallet integration.
- **@bsv/message-box-client** `^1.4.5` — MessageBox client for internalizing pending transfers.
- **React** `^19.2.0` — UI framework.
- **Vite** `^6.0.5` — Frontend bundler and dev server.
- **Tailwind CSS** `^4.1.17` — Styling.

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

### Issuer tab not visible

- Ensure wallet identity key matches overlay's `IDENTITY_PUBLIC_KEY` (from `npm run gen-key`).
- Check `app/.env` has correct `VITE_OVERLAY_IDENTITY_KEY`.
- Verify wallet is properly connected and showing its identity.

### Wallet connection issues

- Ensure a BRC-100 (MetaNet) wallet is running locally.
- Verify wallet is unlocked.
- Check browser console for errors.

### Transfer not appearing in Receive

- Confirm both wallets are connected and running.
- Check overlay logs: `docker compose logs overlay`.
- Refresh the Receive tab.

---

## Architecture Notes

### Role Gating

The **Issuer** tab appears **only when** the connected wallet's identity key equals the overlay's `SERVER_PRIVATE_KEY` (encoded as the overlay's `IDENTITY_PUBLIC_KEY`). This ensures only the token authority can mint, redeem, or recover tokens.

### Transfer Linkage

Each output sent in a transfer includes `revealSpecificKeyLinkage` so the overlay can verify:
1. The recipient's identity key is known to the system.
2. Sanctions and regulatory checks pass.
3. The unlock script is eligible to consume the output.

### Off-Chain Values

Transfers encode counterparty identity and eligibility metadata in `offChainValues` before submission to the overlay. The overlay validates this metadata and persists it with the output for later unlock/spend operations.

### MessageBox Integration

Pending transfers are stored as MessageBox entries. The recipient's wallet calls MessageBox `internalize` to finalize the receive, which unlocks the output and updates the balance.

---

## License

This demo is part of the BSV Mandala Token specification. Refer to `docs/` for detailed architecture and API documentation.
