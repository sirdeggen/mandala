# Mandala Token Frontend + Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted `tm_mandala` overlay instance plus a role-gated React frontend that issues, manages, and transfers BRC-92 fungible Mandala Tokens, transmitting per-output key-linkage `offChainValues` so the overlay verifies counterparty eligibility.

**Architecture:** Two parts in `demos/mandala/`: (1) `overlay/` — a minimal OverlayExpress server wired to ONLY `tm_mandala` + `ls_mandala`, run via docker-compose (mongodb + sqlite); its single instance key is verifier + admin + issuer. (2) `app/` — a Vite/React/TS/Tailwind frontend mirroring `~/git/demos/utility-tokens`, broadcasting via `HTTPSOverlayBroadcastFacilitator` with `offChainValues`, using `MandalaToken`/`MandalaAdmin` from `@bsv/templates`, and gating issuer tools on `walletIdentity === overlayIdentity`.

**Tech Stack:** OverlayExpress (`@bsv/overlay-express`), `@bsv/overlay-topics`, `@bsv/sdk` v2, `@bsv/templates`, MongoDB, SQLite (knex), Docker Compose. Frontend: React 19, Vite 6, TypeScript 5.9, Tailwind v4, Radix UI, `@bsv/identity-react`, `@bsv/message-box-client`, Vitest.

## Global Constraints

- Topic name: `tm_mandala`. Lookup service: `ls_mandala`.
- FT protocolID: `[2, 'mandala token']`. Admin protocolID: `[2, 'mandala admin']`.
- Admin `deriveBoundKey` always uses `counterparty: 'anyone'`.
- All overlay submissions use `{ beef, topics: ['tm_mandala'], offChainValues }` via `HTTPSOverlayBroadcastFacilitator.send(VITE_OVERLAY_URL, taggedBEEF)`. Reject if `steak['tm_mandala'].outputsToAdmit.length === 0`.
- `RevealSpecificKeyLinkageResult` from `wallet.revealSpecificKeyLinkage(...)` already matches the overlay's `SpecificLinkage` shape exactly (`prover, verifier, counterparty, protocolID, keyID, encryptedLinkage, encryptedLinkageProof, proofType`). No field remapping — pass it straight into the payload.
- `verifier` in every linkage reveal = the overlay instance identity pubkey (`VITE_OVERLAY_IDENTITY_KEY`).
- FT outputs and admin outputs are 1 satoshi each. `options: { randomizeOutputs: false }` on every `createAction` so output indices are deterministic.
- assetId = the true genesis outpoint, `${txid}.${vout}`, produced by a 2-phase register.
- Node version: 20+. Package manager: npm. Overlay uses ESM (`"type": "module"`).
- `@bsv/*` versions: match `~/git/demos/utility-tokens` for the app (`@bsv/sdk ^1.9.18` is what utility-tokens pins — but `MandalaToken`/templates require SDK v2 APIs; pin app to `@bsv/sdk ^2.1.6` to match `@bsv/overlay-topics`/`@bsv/templates`, and verify utility-tokens patterns still compile). Overlay pins `@bsv/sdk ^2.1.6`, `@bsv/overlay-express ^2.4.0`, `@bsv/overlay-topics ^1.2.0`, `@bsv/templates ^1.6.0`.

---

## File Structure

**overlay/**
- `overlay/package.json` — ESM, deps + `start`/`gen-key` scripts.
- `overlay/tsconfig.json` — NodeNext ESM.
- `overlay/src/index.ts` — OverlayExpress wired to tm_mandala + ls_mandala only.
- `overlay/src/genKey.ts` — prints a fresh private key + its identity pubkey.
- `overlay/Dockerfile` — build + run the server.
- `overlay/docker-compose.yml` — `mongodb` + `overlay`.
- `overlay/.env.example` — `SERVER_PRIVATE_KEY`, `MONGO_URL`, `HOSTING_URL`, `NETWORK`, `NODE_NAME`.

**app/**
- `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json`, `app/tailwind.config.js`, `app/postcss.config.js`, `app/index.html`, `app/.env.example`, `app/vitest.config.ts`.
- `app/src/main.tsx`, `app/src/App.tsx`, `app/src/globals.css`, `app/src/lib/utils.ts`.
- `app/src/components/ui/{button,card,input,label,skeleton}.tsx` — copied from utility-tokens.
- `app/src/context/WalletContext.tsx` — WalletClient + MessageBoxClient + isIssuer.
- `app/src/lib/mandala/constants.ts` — names, protocols, basket, env.
- `app/src/lib/mandala/encoding.ts` — payload types + `encodeLinkagePayload`.
- `app/src/lib/mandala/unlock.ts` — wallet-based MandalaToken unlock template.
- `app/src/lib/mandala/overlay.ts` — `submitToOverlay`.
- `app/src/lib/mandala/assetStore.ts` — registered-asset + authOutpoint persistence (localStorage).
- `app/src/lib/mandala/tokens.ts` — `loadBalances`, transaction-building helpers shared by components.
- `app/src/components/TokenDemo.tsx` — tab container + role gating.
- `app/src/components/IssuerPanel.tsx` — Register / Issue / Redeem / Recover.
- `app/src/components/TokenWallet.tsx` — balances by assetId.
- `app/src/components/SendTokens.tsx` — transfer.
- `app/src/components/ReceiveTokens.tsx` — messagebox internalize.
- `app/README.md` — run instructions + manual E2E checklist.

---

## Task 1: Overlay service (tm_mandala only)

**Files:**
- Create: `overlay/package.json`, `overlay/tsconfig.json`, `overlay/src/index.ts`, `overlay/src/genKey.ts`, `overlay/Dockerfile`, `overlay/docker-compose.yml`, `overlay/.env.example`, `overlay/.dockerignore`

**Interfaces:**
- Produces: a running overlay at `http://localhost:8080` whose topic-manager metadata for `tm_mandala` is reachable, and whose instance identity pubkey is known (printed by `genKey`).

- [ ] **Step 1: Write `overlay/package.json`**

```json
{
  "name": "mandala-overlay",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "gen-key": "tsx src/genKey.ts"
  },
  "dependencies": {
    "@bsv/overlay": "^2.1.0",
    "@bsv/overlay-express": "^2.4.0",
    "@bsv/overlay-topics": "^1.2.0",
    "@bsv/sdk": "^2.1.6",
    "@bsv/templates": "^1.6.0",
    "dotenv": "^17.4.2",
    "knex": "^3.1.0",
    "mongodb": "^7.2.0",
    "sqlite3": "^5.1.7"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Write `overlay/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `overlay/src/genKey.ts`**

```ts
import { PrivateKey } from '@bsv/sdk'

const key = PrivateKey.fromRandom()
console.log('SERVER_PRIVATE_KEY=' + key.toHex())
console.log('IDENTITY_PUBLIC_KEY=' + key.toPublicKey().toString())
```

- [ ] **Step 4: Write `overlay/src/index.ts`**

```ts
import OverlayExpress from '@bsv/overlay-express'
import {
  MandalaTopicManager,
  createMandalaLookupService,
  InMemoryScreeningProvider
} from '@bsv/overlay-topics'
import { PrivateKey, ProtoWallet, WalletInterface } from '@bsv/sdk'
import { config } from 'dotenv'
config()

const requireEnv = (name: string): string => {
  const v = process.env[name]
  if (v == null || v === '') throw new Error(`Missing required environment variable: ${name}`)
  return v
}

const main = async (): Promise<void> => {
  const NODE_NAME = requireEnv('NODE_NAME')
  const SERVER_PRIVATE_KEY = requireEnv('SERVER_PRIVATE_KEY')
  const HOSTING_URL = requireEnv('HOSTING_URL')
  const MONGO_URL = requireEnv('MONGO_URL')
  const NETWORK = requireEnv('NETWORK')
  if (NETWORK !== 'main' && NETWORK !== 'test') throw new Error('NETWORK must be "main" or "test"')

  const server = new OverlayExpress(NODE_NAME, SERVER_PRIVATE_KEY, HOSTING_URL)
  server.configurePort(8080)
  server.configureNetwork(NETWORK)
  // Local demo: validate scripts without a full chain tracker / ARC key.
  server.configureChainTracker('scripts only')
  await server.configureKnex({
    client: 'sqlite3',
    connection: { filename: process.env.SQLITE_FILE ?? '/data/overlay.sqlite' },
    useNullAsDefault: true
  })
  await server.configureMongo(MONGO_URL)

  const mandalaWallet = new ProtoWallet(PrivateKey.fromHex(SERVER_PRIVATE_KEY)) as unknown as WalletInterface
  server.configureTopicManager('tm_mandala', new MandalaTopicManager({
    verifierWallet: mandalaWallet,
    screeningProvider: new InMemoryScreeningProvider([]),
    adminWallet: mandalaWallet,
    adminProtocolID: [2, 'mandala admin'] as [2, string]
  }))
  server.configureLookupServiceWithMongo('ls_mandala', createMandalaLookupService(mandalaWallet))

  server.configureEnableGASPSync(false)
  await server.configureEngine(false)
  await server.start()
  console.log(`mandala overlay listening on ${HOSTING_URL}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 5: Write `overlay/.env.example`**

```
NODE_NAME=mandala
SERVER_PRIVATE_KEY=replace_with_output_of_npm_run_gen-key
HOSTING_URL=http://localhost:8080
MONGO_URL=mongodb://mongodb:27017/mandala
NETWORK=test
SQLITE_FILE=/data/overlay.sqlite
```

- [ ] **Step 6: Write `overlay/Dockerfile`**

```dockerfile
FROM node:20-bullseye
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 7: Write `overlay/.dockerignore`**

```
node_modules
dist
.env
```

- [ ] **Step 8: Write `overlay/docker-compose.yml`**

```yaml
services:
  mongodb:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: ["mongo-data:/data/db"]
  overlay:
    build: .
    env_file: .env
    environment:
      MONGO_URL: mongodb://mongodb:27017/mandala
    ports: ["8080:8080"]
    volumes: ["overlay-data:/data"]
    depends_on: ["mongodb"]
volumes:
  mongo-data:
  overlay-data:
```

- [ ] **Step 9: Generate a key and create `.env`**

Run:
```bash
cd overlay && npm install && npm run gen-key
```
Expected: prints `SERVER_PRIVATE_KEY=<hex>` and `IDENTITY_PUBLIC_KEY=<hex>`. Copy `.env.example` to `.env`, paste the `SERVER_PRIVATE_KEY`. **Record `IDENTITY_PUBLIC_KEY`** — it becomes the app's `VITE_OVERLAY_IDENTITY_KEY`.

- [ ] **Step 10: Bring up the overlay and verify the topic is live**

Run:
```bash
docker compose up --build -d
sleep 20
curl -s http://localhost:8080/listTopicManagers
```
Expected: JSON listing includes `tm_mandala`. If `/listTopicManagers` is not present in this OverlayExpress version, instead run `curl -s http://localhost:8080/getDocumentationForTopicManager?manager=tm_mandala` and expect the Mandala docs/markdown. Either confirms the topic is configured.

- [ ] **Step 11: Commit**

```bash
git add overlay
git commit -m "feat(overlay): minimal self-hosted tm_mandala overlay instance"
```

---

## Task 2: Frontend scaffold

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json`, `app/tsconfig.node.json`, `app/tailwind.config.js`, `app/postcss.config.js`, `app/index.html`, `app/.env.example`, `app/vitest.config.ts`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/globals.css`, `app/src/lib/utils.ts`, `app/src/components/ui/{button,card,input,label,skeleton}.tsx`

**Interfaces:**
- Produces: `npm run dev` serves an app shell; `npm run build` and `npm run test` succeed.

- [ ] **Step 1: Write `app/package.json`**

```json
{
  "name": "mandala-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@bsv/identity-react": "^1.1.10",
    "@bsv/message-box-client": "^1.4.5",
    "@bsv/sdk": "^2.1.6",
    "@bsv/templates": "^1.6.0",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "clsx": "^2.1.1",
    "lucide-react": "^0.555.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.17",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.17",
    "typescript": "~5.9.3",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Copy scaffold config + UI primitives from utility-tokens**

Copy these files verbatim from `~/git/demos/utility-tokens/` into the same relative paths under `app/`, then adjust only where noted:
- `vite.config.ts` (keep port 8080 → **change to 5173** to avoid colliding with the overlay), `tsconfig.json`, `tsconfig.node.json` (if present), `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/globals.css`, `src/lib/utils.ts`, `src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `skeleton.tsx`.

Run:
```bash
mkdir -p app/src/components/ui app/src/lib app/src/context app/src/lib/mandala
cp ~/git/demos/utility-tokens/tsconfig.json app/tsconfig.json
cp ~/git/demos/utility-tokens/postcss.config.js app/postcss.config.js
cp ~/git/demos/utility-tokens/tailwind.config.js app/tailwind.config.js
cp ~/git/demos/utility-tokens/index.html app/index.html
cp ~/git/demos/utility-tokens/src/globals.css app/src/globals.css
cp ~/git/demos/utility-tokens/src/lib/utils.ts app/src/lib/utils.ts
cp ~/git/demos/utility-tokens/src/components/ui/*.tsx app/src/components/ui/
```
Then hand-write `app/vite.config.ts` (port 5173):

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  optimizeDeps: { exclude: ['@bsv/sdk'] },
  server: { port: 5173 }
})
```

- [ ] **Step 3: Write `app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'node' }
})
```

- [ ] **Step 4: Write `app/.env.example`**

```
VITE_OVERLAY_URL=http://localhost:8080
VITE_OVERLAY_IDENTITY_KEY=paste_IDENTITY_PUBLIC_KEY_from_overlay_gen-key
VITE_MESSAGEBOX_URL=https://messagebox.babbage.systems
```

- [ ] **Step 5: Write `app/src/App.tsx` placeholder**

```tsx
import TokenDemo from './components/TokenDemo'

export default function App() {
  return <TokenDemo />
}
```

(Note: `TokenDemo` is created in Task 9. Until then, temporarily render `<div>Mandala</div>` so the build passes; revert in Task 9.)

- [ ] **Step 6: Write `app/src/main.tsx`** (adapt from utility-tokens `src/main.tsx`)

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { WalletProvider } from './context/WalletContext'
import './globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
      <Toaster richColors position="top-right" />
    </WalletProvider>
  </React.StrictMode>
)
```

(Note: `WalletProvider` is created in Task 4. Temporarily stub `App.tsx` to `<div>Mandala</div>` and comment the WalletProvider import until Task 4 if building before then.)

- [ ] **Step 7: Verify build**

Run:
```bash
cd app && npm install && npm run build
```
Expected: build succeeds (with the temporary placeholders).

- [ ] **Step 8: Commit**

```bash
git add app
git commit -m "feat(app): vite/react/tailwind scaffold with bsv deps"
```

---

## Task 3: Mandala constants + offChain encoding

**Files:**
- Create: `app/src/lib/mandala/constants.ts`, `app/src/lib/mandala/encoding.ts`
- Test: `app/src/lib/mandala/encoding.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: `TOPIC = 'tm_mandala'`, `LOOKUP = 'ls_mandala'`, `FT_PROTOCOL: [2,'mandala token']`, `ADMIN_PROTOCOL: [2,'mandala admin']`, `BASKET = 'mandala-tokens'`, `MESSAGEBOX = 'mandala-payments'`, `OVERLAY_URL`, `OVERLAY_IDENTITY_KEY`, `MESSAGEBOX_URL` (read from `import.meta.env`).
  - `encoding.ts`: types `SpecificLinkage`, `MandalaActionDetails`, `MandalaLinkagePayload`; fn `encodeLinkagePayload(p): number[]`.

- [ ] **Step 1: Write the failing test `app/src/lib/mandala/encoding.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { Utils } from '@bsv/sdk'
import { encodeLinkagePayload, MandalaLinkagePayload } from './encoding'

describe('encodeLinkagePayload', () => {
  it('encodes to JSON-UTF8 bytes that round-trip', () => {
    const payload: MandalaLinkagePayload = {
      inputs: [],
      outputs: [{ index: 0, linkage: {
        prover: 'aa', verifier: 'bb', counterparty: 'cc',
        protocolID: [2, 'mandala token'], keyID: 'k',
        encryptedLinkage: [1, 2, 3], encryptedLinkageProof: [4, 5], proofType: 0
      } }],
      admin: [{ index: 1, actionDetails: { kind: 'issue', assetId: 'x.0', amount: 5, priorOutpoint: 'y.0' } }]
    }
    const bytes = encodeLinkagePayload(payload)
    const decoded = JSON.parse(Utils.toUTF8(bytes))
    expect(decoded).toEqual(payload)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/encoding.test.ts`
Expected: FAIL — cannot find module `./encoding`.

- [ ] **Step 3: Write `app/src/lib/mandala/encoding.ts`**

```ts
import { Utils, WalletProtocol } from '@bsv/sdk'

export interface SpecificLinkage {
  prover: string
  verifier: string
  counterparty: string
  protocolID: WalletProtocol
  keyID: string
  encryptedLinkage: number[]
  encryptedLinkageProof: number[]
  proofType: number
}

export type MandalaActionKind = 'register' | 'issue' | 'redeem' | 'recover'

export interface MandalaActionDetails {
  kind: MandalaActionKind
  assetId?: string
  amount?: number
  priorOutpoint?: string
}

export interface MandalaLinkagePayload {
  inputs: Array<{ index: number, linkage: SpecificLinkage }>
  outputs: Array<{ index: number, linkage: SpecificLinkage }>
  admin?: Array<{ index: number, actionDetails: MandalaActionDetails }>
}

export const encodeLinkagePayload = (payload: MandalaLinkagePayload): number[] =>
  Utils.toArray(JSON.stringify(payload), 'utf8')
```

- [ ] **Step 4: Write `app/src/lib/mandala/constants.ts`**

```ts
import { WalletProtocol } from '@bsv/sdk'

export const TOPIC = 'tm_mandala'
export const LOOKUP = 'ls_mandala'
export const FT_PROTOCOL: WalletProtocol = [2, 'mandala token']
export const ADMIN_PROTOCOL: WalletProtocol = [2, 'mandala admin']
export const BASKET = 'mandala-tokens'
export const MESSAGEBOX = 'mandala-payments'

export const OVERLAY_URL = import.meta.env.VITE_OVERLAY_URL as string
export const OVERLAY_IDENTITY_KEY = import.meta.env.VITE_OVERLAY_IDENTITY_KEY as string
export const MESSAGEBOX_URL = import.meta.env.VITE_MESSAGEBOX_URL as string
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/encoding.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/mandala/constants.ts app/src/lib/mandala/encoding.ts app/src/lib/mandala/encoding.test.ts
git commit -m "feat(app): mandala constants and offChain linkage encoding"
```

---

## Task 4: WalletContext with issuer detection

**Files:**
- Create: `app/src/context/WalletContext.tsx`
- Reference: `~/git/demos/utility-tokens/src/context/WalletContext.tsx`

**Interfaces:**
- Consumes: `OVERLAY_IDENTITY_KEY`, `MESSAGEBOX_URL` from `constants.ts`.
- Produces: `WalletProvider` component and `useWallet()` returning `{ wallet: WalletClient | null, messageBoxClient: MessageBoxClient | null, identityKey: string | null, isIssuer: boolean, isInitialized: boolean, error: string | null }`.

- [ ] **Step 1: Write `app/src/context/WalletContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { WalletClient } from '@bsv/sdk'
import { MessageBoxClient } from '@bsv/message-box-client'
import { OVERLAY_IDENTITY_KEY, MESSAGEBOX_URL } from '../lib/mandala/constants'

interface WalletState {
  wallet: WalletClient | null
  messageBoxClient: MessageBoxClient | null
  identityKey: string | null
  isIssuer: boolean
  isInitialized: boolean
  error: string | null
}

const WalletContext = createContext<WalletState>({
  wallet: null, messageBoxClient: null, identityKey: null,
  isIssuer: false, isInitialized: false, error: null
})

export const useWallet = (): WalletState => useContext(WalletContext)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    wallet: null, messageBoxClient: null, identityKey: null,
    isIssuer: false, isInitialized: false, error: null
  })

  useEffect(() => {
    const init = async () => {
      try {
        const wallet = new WalletClient()
        const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
        const messageBoxClient = new MessageBoxClient({
          host: MESSAGEBOX_URL, walletClient: wallet,
          enableLogging: false, networkPreset: 'mainnet'
        })
        setState({
          wallet, messageBoxClient, identityKey,
          isIssuer: identityKey === OVERLAY_IDENTITY_KEY,
          isInitialized: true, error: null
        })
      } catch (e) {
        setState(s => ({ ...s, isInitialized: true, error: 'Failed to initialize wallet. Ensure a BRC-100 wallet (Metanet) is running.' }))
      }
    }
    void init()
  }, [])

  return <WalletContext.Provider value={state}>{children}</WalletContext.Provider>
}
```

- [ ] **Step 2: Verify typecheck/build**

Run: `cd app && npx tsc -b`
Expected: no errors in `WalletContext.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/src/context/WalletContext.tsx
git commit -m "feat(app): wallet context with issuer-role detection"
```

---

## Task 5: Wallet-based MandalaToken unlock template

**Files:**
- Create: `app/src/lib/mandala/unlock.ts`
- Test: `app/src/lib/mandala/unlock.test.ts`
- Reference: `~/git/ts-stack/packages/helpers/ts-templates/src/mandala-signing.ts` (preimage logic to replicate)

**Interfaces:**
- Consumes: `FT_PROTOCOL` from constants.
- Produces: `walletMandalaUnlock(wallet: WalletInterface, keyID: string, counterparty: WalletCounterparty, signOutputs?, anyoneCanPay?): ScriptTemplateUnlock`. The returned object's `sign(tx, i)` derives the pubkey via `wallet.getPublicKey`, signs `Hash.hash256(preimage)` via `wallet.createSignature` under `FT_PROTOCOL`/keyID/counterparty, and returns `UnlockingScript([sig, pubkey])`. `estimateLength` returns 108.

- [ ] **Step 1: Write the failing test `app/src/lib/mandala/unlock.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  ProtoWallet, PrivateKey, Transaction, Script, Spend, Utils, Hash
} from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { walletMandalaUnlock } from './unlock'
import { FT_PROTOCOL } from './constants'

describe('walletMandalaUnlock', () => {
  it('produces an unlocking script that satisfies a MandalaToken output locked to a wallet-derived key', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromRandom())
    const keyID = 'tkn-1'
    const counterparty = 'self'
    const assetId = `${'a'.repeat(64)}.0`

    const lockingScript = await new MandalaToken(wallet as any).lockBRC29(assetId, 100, FT_PROTOCOL, keyID, counterparty)

    const sourceTx = new Transaction()
    sourceTx.addOutput({ lockingScript, satoshis: 1 })

    const spendTx = new Transaction()
    spendTx.addInput({ sourceTransaction: sourceTx, sourceOutputIndex: 0, sequence: 0xffffffff })
    spendTx.addOutput({ lockingScript, satoshis: 1 })

    const unlocker = walletMandalaUnlock(wallet as any, keyID, counterparty)
    spendTx.inputs[0].unlockingScript = await unlocker.sign(spendTx, 0)

    const spend = new Spend({
      sourceTXID: sourceTx.id('hex'),
      sourceOutputIndex: 0,
      sourceSatoshis: 1,
      lockingScript,
      transactionVersion: spendTx.version,
      otherInputs: [],
      inputIndex: 0,
      unlockingScript: spendTx.inputs[0].unlockingScript!,
      outputs: spendTx.outputs,
      inputSequence: 0xffffffff,
      lockTime: spendTx.lockTime
    })
    expect(spend.validate()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/unlock.test.ts`
Expected: FAIL — cannot find module `./unlock`.

- [ ] **Step 3: Write `app/src/lib/mandala/unlock.ts`**

```ts
import {
  Transaction, TransactionSignature, Signature, UnlockingScript,
  ScriptTemplateUnlock, WalletInterface, WalletCounterparty, Hash, Utils
} from '@bsv/sdk'
import { FT_PROTOCOL } from './constants'

type SignOutputs = 'all' | 'none' | 'single'

// Replicated from @bsv/templates mandala-signing.ts so we can sign via a wallet.
function buildSighashPreimage (
  tx: Transaction, inputIndex: number, signOutputs: SignOutputs, anyoneCanPay: boolean
): { preimage: number[], scope: number } {
  let scope = TransactionSignature.SIGHASH_FORKID
  if (signOutputs === 'all') scope |= TransactionSignature.SIGHASH_ALL
  else if (signOutputs === 'none') scope |= TransactionSignature.SIGHASH_NONE
  else if (signOutputs === 'single') scope |= TransactionSignature.SIGHASH_SINGLE
  if (anyoneCanPay) scope |= TransactionSignature.SIGHASH_ANYONECANPAY

  const input = tx.inputs[inputIndex]
  const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
  const sourceOutput = input.sourceTransaction?.outputs[input.sourceOutputIndex]
  if (sourceTXID == null) throw new Error('sourceTXID or sourceTransaction required')
  if (sourceOutput?.satoshis == null) throw new Error('source satoshis required')
  if (sourceOutput.lockingScript == null) throw new Error('source lockingScript required')

  const preimage = TransactionSignature.format({
    sourceTXID,
    sourceOutputIndex: input.sourceOutputIndex,
    sourceSatoshis: sourceOutput.satoshis,
    transactionVersion: tx.version,
    otherInputs: tx.inputs.filter((_, i) => i !== inputIndex),
    inputIndex,
    outputs: tx.outputs,
    inputSequence: input.sequence ?? 0xffffffff,
    subscript: sourceOutput.lockingScript,
    lockTime: tx.lockTime,
    scope
  })
  return { preimage, scope }
}

export function walletMandalaUnlock (
  wallet: WalletInterface,
  keyID: string,
  counterparty: WalletCounterparty,
  signOutputs: SignOutputs = 'all',
  anyoneCanPay = false
): ScriptTemplateUnlock {
  return {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      const { preimage, scope } = buildSighashPreimage(tx, inputIndex, signOutputs, anyoneCanPay)
      const { signature: der } = await wallet.createSignature({
        hashToDirectlySign: Hash.hash256(preimage),
        protocolID: FT_PROTOCOL, keyID, counterparty
      })
      const sig = Signature.fromDER([...der])
      const txSig = new TransactionSignature(sig.r, sig.s, scope)
      const sigForScript = txSig.toChecksigFormat()
      const { publicKey } = await wallet.getPublicKey({ protocolID: FT_PROTOCOL, keyID, counterparty })
      const pubkey = Utils.toArray(publicKey, 'hex')
      return new UnlockingScript([
        { op: sigForScript.length, data: sigForScript },
        { op: pubkey.length, data: pubkey }
      ])
    },
    estimateLength: async () => 108
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/unlock.test.ts`
Expected: PASS. (If `Spend` constructor field names differ in the installed SDK version, adjust the test to match `@bsv/sdk` `Spend` — the implementation is the deliverable; the test asserts script validity.)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/unlock.ts app/src/lib/mandala/unlock.test.ts
git commit -m "feat(app): wallet-based MandalaToken unlock template"
```

---

## Task 6: Overlay submission helper

**Files:**
- Create: `app/src/lib/mandala/overlay.ts`
- Test: `app/src/lib/mandala/overlay.test.ts`

**Interfaces:**
- Consumes: `TOPIC`, `OVERLAY_URL` from constants.
- Produces: `submitToOverlay(beef: number[], offChainValues?: number[], facilitator?): Promise<number[]>` — sends the tagged BEEF, throws `Error('overlay rejected the transaction')` if `outputsToAdmit` is empty, otherwise returns the admitted indices.

- [ ] **Step 1: Write the failing test `app/src/lib/mandala/overlay.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { submitToOverlay } from './overlay'

describe('submitToOverlay', () => {
  it('returns admitted indices on success', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [0, 1], coinsToRetain: [] } }) }
    const res = await submitToOverlay([1, 2, 3], [4, 5], facilitator as any)
    expect(res).toEqual([0, 1])
    expect(facilitator.send).toHaveBeenCalledWith(expect.any(String), { beef: [1, 2, 3], topics: ['tm_mandala'], offChainValues: [4, 5] })
  })
  it('throws when nothing is admitted', async () => {
    const facilitator = { send: vi.fn().mockResolvedValue({ tm_mandala: { outputsToAdmit: [], coinsToRetain: [] } }) }
    await expect(submitToOverlay([1], undefined, facilitator as any)).rejects.toThrow('overlay rejected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/overlay.test.ts`
Expected: FAIL — cannot find module `./overlay`.

- [ ] **Step 3: Write `app/src/lib/mandala/overlay.ts`**

```ts
import { HTTPSOverlayBroadcastFacilitator, OverlayBroadcastFacilitator } from '@bsv/sdk'
import { TOPIC, OVERLAY_URL } from './constants'

export async function submitToOverlay (
  beef: number[],
  offChainValues?: number[],
  facilitator: OverlayBroadcastFacilitator = new HTTPSOverlayBroadcastFacilitator(undefined, true)
): Promise<number[]> {
  const taggedBEEF = { beef, topics: [TOPIC], offChainValues }
  const steak = await facilitator.send(OVERLAY_URL, taggedBEEF)
  const admit = steak[TOPIC]?.outputsToAdmit ?? []
  if (admit.length === 0) throw new Error('overlay rejected the transaction')
  return admit
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/overlay.test.ts`
Expected: PASS. (If `OverlayBroadcastFacilitator`/`HTTPSOverlayBroadcastFacilitator` are not exported from the package root, import from `@bsv/sdk` overlay-tools entry as utility-tokens does; match utility-tokens' import path.)

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/overlay.ts app/src/lib/mandala/overlay.test.ts
git commit -m "feat(app): overlay submission helper with offChainValues"
```

---

## Task 7: Asset store (registered assets + auth outpoints)

**Files:**
- Create: `app/src/lib/mandala/assetStore.ts`
- Test: `app/src/lib/mandala/assetStore.test.ts`

**Interfaces:**
- Produces:
  - type `RegisteredAsset = { assetId: string, label: string, authOutpoint: string }`.
  - `saveAsset(identityKey: string, asset: RegisteredAsset): void`
  - `listAssets(identityKey: string): RegisteredAsset[]`
  - `updateAuthOutpoint(identityKey: string, assetId: string, authOutpoint: string): void`
  - `getAsset(identityKey: string, assetId: string): RegisteredAsset | undefined`
  - All keyed under `localStorage['mandala:assets:'+identityKey]`. An injectable `storage` param (default `globalThis.localStorage`) keeps it testable.

- [ ] **Step 1: Write the failing test `app/src/lib/mandala/assetStore.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveAsset, listAssets, updateAuthOutpoint, getAsset } from './assetStore'

const mem = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) }
  } as unknown as Storage
}

describe('assetStore', () => {
  let s: Storage
  beforeEach(() => { s = mem() })

  it('saves, lists, fetches, and updates auth outpoint', () => {
    saveAsset('id1', { assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0' }, s)
    expect(listAssets('id1', s)).toEqual([{ assetId: 'a.0', label: 'Gold', authOutpoint: 'reg.0' }])
    expect(getAsset('id1', 'a.0', s)?.label).toBe('Gold')
    updateAuthOutpoint('id1', 'a.0', 'issue.1', s)
    expect(getAsset('id1', 'a.0', s)?.authOutpoint).toBe('issue.1')
    expect(listAssets('id2', s)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/assetStore.test.ts`
Expected: FAIL — cannot find module `./assetStore`.

- [ ] **Step 3: Write `app/src/lib/mandala/assetStore.ts`**

```ts
export interface RegisteredAsset {
  assetId: string
  label: string
  authOutpoint: string
}

const key = (identityKey: string) => `mandala:assets:${identityKey}`
const store = (s?: Storage): Storage => s ?? globalThis.localStorage

export function listAssets (identityKey: string, s?: Storage): RegisteredAsset[] {
  const raw = store(s).getItem(key(identityKey))
  return raw == null ? [] : JSON.parse(raw) as RegisteredAsset[]
}

export function saveAsset (identityKey: string, asset: RegisteredAsset, s?: Storage): void {
  const all = listAssets(identityKey, s).filter(a => a.assetId !== asset.assetId)
  all.push(asset)
  store(s).setItem(key(identityKey), JSON.stringify(all))
}

export function getAsset (identityKey: string, assetId: string, s?: Storage): RegisteredAsset | undefined {
  return listAssets(identityKey, s).find(a => a.assetId === assetId)
}

export function updateAuthOutpoint (identityKey: string, assetId: string, authOutpoint: string, s?: Storage): void {
  const asset = getAsset(identityKey, assetId, s)
  if (asset == null) throw new Error(`unknown asset ${assetId}`)
  saveAsset(identityKey, { ...asset, authOutpoint }, s)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/assetStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/assetStore.ts app/src/lib/mandala/assetStore.test.ts
git commit -m "feat(app): registered-asset and auth-outpoint store"
```

---

## Task 8: Token transaction helpers + balance loader

**Files:**
- Create: `app/src/lib/mandala/tokens.ts`
- Test: `app/src/lib/mandala/tokens.test.ts`

**Interfaces:**
- Consumes: `MandalaToken` from `@bsv/templates`; `BASKET`, `FT_PROTOCOL`, `OVERLAY_IDENTITY_KEY` from constants; `SpecificLinkage` from encoding.
- Produces:
  - `outpoint(txid: string, index: number): string` → `` `${txid}.${index}` ``.
  - `decodeBalances(outputs: Array<{ txid: string, outputIndex: number, lockingScript: string, customInstructions?: string }>): TokenBalance[]` where `TokenBalance = { assetId: string, amount: number }` (summed by assetId). Outputs that fail `MandalaToken.decode` are skipped.
  - `revealLinkage(wallet, keyID, counterparty): Promise<SpecificLinkage>` → calls `wallet.revealSpecificKeyLinkage({ counterparty, verifier: OVERLAY_IDENTITY_KEY, protocolID: FT_PROTOCOL, keyID })` and returns the result cast to `SpecificLinkage`.

- [ ] **Step 1: Write the failing test `app/src/lib/mandala/tokens.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { Hash, PrivateKey, Utils } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { outpoint, decodeBalances } from './tokens'

describe('tokens helpers', () => {
  it('formats outpoints', () => {
    expect(outpoint('ab', 2)).toBe('ab.2')
  })

  it('sums balances by assetId and skips non-token scripts', () => {
    const pkh = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
    const assetA = `${'a'.repeat(64)}.0`
    const lsA1 = new MandalaToken().lock(assetA, 30, pkh).toHex()
    const lsA2 = new MandalaToken().lock(assetA, 12, pkh).toHex()
    const balances = decodeBalances([
      { txid: 't1', outputIndex: 0, lockingScript: lsA1 },
      { txid: 't2', outputIndex: 0, lockingScript: lsA2 },
      { txid: 't3', outputIndex: 0, lockingScript: '006a' } // not a token
    ])
    expect(balances).toEqual([{ assetId: assetA, amount: 42 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/lib/mandala/tokens.test.ts`
Expected: FAIL — cannot find module `./tokens`.

- [ ] **Step 3: Write `app/src/lib/mandala/tokens.ts`**

```ts
import { LockingScript, WalletInterface, WalletCounterparty } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { FT_PROTOCOL, OVERLAY_IDENTITY_KEY } from './constants'
import { SpecificLinkage } from './encoding'

export interface TokenBalance { assetId: string, amount: number }

export const outpoint = (txid: string, index: number): string => `${txid}.${index}`

export function decodeBalances (
  outputs: Array<{ lockingScript: string }>
): TokenBalance[] {
  const totals = new Map<string, number>()
  for (const o of outputs) {
    try {
      const d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript))
      totals.set(d.assetId, (totals.get(d.assetId) ?? 0) + d.amount)
    } catch { /* not a mandala token output */ }
  }
  return [...totals.entries()].map(([assetId, amount]) => ({ assetId, amount }))
}

export async function revealLinkage (
  wallet: WalletInterface, keyID: string, counterparty: WalletCounterparty
): Promise<SpecificLinkage> {
  const linkage = await wallet.revealSpecificKeyLinkage({
    counterparty: counterparty as string,
    verifier: OVERLAY_IDENTITY_KEY,
    protocolID: FT_PROTOCOL,
    keyID
  })
  return linkage as unknown as SpecificLinkage
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/lib/mandala/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/mandala/tokens.ts app/src/lib/mandala/tokens.test.ts
git commit -m "feat(app): token balance decoding and linkage reveal helpers"
```

---

## Task 9: TokenDemo container with role gating

**Files:**
- Create: `app/src/components/TokenDemo.tsx`
- Modify: `app/src/App.tsx` (revert placeholder to render `<TokenDemo />`)
- Reference: `~/git/demos/utility-tokens/src/components/TokenDemo.tsx`

**Interfaces:**
- Consumes: `useWallet()`; child components `IssuerPanel`, `TokenWallet`, `SendTokens`, `ReceiveTokens` (Tasks 10–13). Until those exist, stub each as `() => <div/>` at the top of this file and replace with real imports as each task lands.
- Produces: a Radix `Tabs` UI. Tabs: **Wallet**, **Send**, **Receive** always; **Issuer** tab prepended only when `isIssuer`.

- [ ] **Step 1: Write `app/src/components/TokenDemo.tsx`**

```tsx
import * as Tabs from '@radix-ui/react-tabs'
import { useWallet } from '../context/WalletContext'
import IssuerPanel from './IssuerPanel'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import ReceiveTokens from './ReceiveTokens'

export default function TokenDemo() {
  const { isInitialized, error, isIssuer, identityKey } = useWallet()

  if (!isInitialized) return <div className="p-8 text-center">Connecting wallet…</div>
  if (error != null) return <div className="p-8 text-center text-red-600">{error}</div>

  return (
    <div className="max-w-3xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Mandala Tokens</h1>
        <p className="text-sm text-muted-foreground break-all">Identity: {identityKey}</p>
        {isIssuer && <p className="text-sm font-medium text-emerald-600">Issuer mode — this wallet controls the overlay instance.</p>}
      </header>
      <Tabs.Root defaultValue={isIssuer ? 'issuer' : 'wallet'}>
        <Tabs.List className="flex gap-2 border-b mb-4">
          {isIssuer && <Tabs.Trigger value="issuer" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Issuer</Tabs.Trigger>}
          <Tabs.Trigger value="wallet" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Wallet</Tabs.Trigger>
          <Tabs.Trigger value="send" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Send</Tabs.Trigger>
          <Tabs.Trigger value="receive" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Receive</Tabs.Trigger>
        </Tabs.List>
        {isIssuer && <Tabs.Content value="issuer"><IssuerPanel /></Tabs.Content>}
        <Tabs.Content value="wallet"><TokenWallet /></Tabs.Content>
        <Tabs.Content value="send"><SendTokens /></Tabs.Content>
        <Tabs.Content value="receive"><ReceiveTokens /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
```

- [ ] **Step 2: Revert `app/src/App.tsx`**

```tsx
import TokenDemo from './components/TokenDemo'
export default function App() { return <TokenDemo /> }
```

- [ ] **Step 3: Create temporary stubs so the build passes**

Create minimal stub files (replaced in later tasks):
```tsx
// app/src/components/IssuerPanel.tsx
export default function IssuerPanel() { return <div /> }
```
Repeat for `TokenWallet.tsx`, `SendTokens.tsx`, `ReceiveTokens.tsx`.

- [ ] **Step 4: Verify build**

Run: `cd app && npx tsc -b && npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/TokenDemo.tsx app/src/App.tsx app/src/components/IssuerPanel.tsx app/src/components/TokenWallet.tsx app/src/components/SendTokens.tsx app/src/components/ReceiveTokens.tsx
git commit -m "feat(app): tab container with issuer role gating"
```

---

## Task 10: TokenWallet — balances by asset

**Files:**
- Modify: `app/src/components/TokenWallet.tsx`
- Reference: `~/git/demos/utility-tokens/src/components/TokenWallet.tsx`

**Interfaces:**
- Consumes: `useWallet()`; `wallet.listOutputs`; `decodeBalances`, `BASKET`; `listAssets` (for labels by assetId).
- Produces: a component listing each held asset: label (from asset store if present, else truncated assetId) + summed amount. Provides a `refresh()` button.

- [ ] **Step 1: Write `app/src/components/TokenWallet.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '../context/WalletContext'
import { BASKET } from '../lib/mandala/constants'
import { decodeBalances, TokenBalance } from '../lib/mandala/tokens'
import { listAssets } from '../lib/mandala/assetStore'
import { Button } from './ui/button'
import { Card } from './ui/card'

export default function TokenWallet() {
  const { wallet, identityKey } = useWallet()
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)

  const labelFor = useCallback((assetId: string): string => {
    if (identityKey == null) return assetId
    return listAssets(identityKey).find(a => a.assetId === assetId)?.label ?? `${assetId.slice(0, 10)}…`
  }, [identityKey])

  const refresh = useCallback(async () => {
    if (wallet == null) return
    setLoading(true)
    try {
      const res = await wallet.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 })
      setBalances(decodeBalances(res.outputs.map(o => ({ lockingScript: o.lockingScript as string }))))
    } finally { setLoading(false) }
  }, [wallet])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Your tokens</h2>
        <Button onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {balances.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
      {balances.map(b => (
        <Card key={b.assetId} className="p-4 flex justify-between">
          <span className="font-medium">{labelFor(b.assetId)}</span>
          <span>{b.amount}</span>
        </Card>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `cd app && npx tsc -b`
Expected: no errors. (If `listOutputs` result `outputs[].lockingScript` typing differs, cast as in utility-tokens' `TokenWallet.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add app/src/components/TokenWallet.tsx
git commit -m "feat(app): token wallet balance view"
```

---

## Task 11: IssuerPanel — Register + Issue

**Files:**
- Modify: `app/src/components/IssuerPanel.tsx`

**Interfaces:**
- Consumes: `useWallet()`; `MandalaToken`, `MandalaAdmin` from `@bsv/templates`; `wallet.createAction`/`signAction`; `submitToOverlay`; `encodeLinkagePayload`; `revealLinkage`; `outpoint`; asset store (`saveAsset`, `getAsset`, `updateAuthOutpoint`); constants (`ADMIN_PROTOCOL`, `FT_PROTOCOL`, `BASKET`, `OVERLAY_IDENTITY_KEY`).
- Produces: the issuer UI with a **Register** form (label) and an **Issue** form (select asset, amount). Implements `registerAsset(label)` and `issue(assetId, amount)` per the flows below.

- [ ] **Step 1: Write `app/src/components/IssuerPanel.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Transaction, Utils } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin } from '@bsv/templates'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { ADMIN_PROTOCOL, FT_PROTOCOL, BASKET } from '../lib/mandala/constants'
import { encodeLinkagePayload, MandalaActionDetails } from '../lib/mandala/encoding'
import { submitToOverlay } from '../lib/mandala/overlay'
import { outpoint, revealLinkage } from '../lib/mandala/tokens'
import { walletMandalaUnlock } from '../lib/mandala/unlock'
import { saveAsset, getAsset, updateAuthOutpoint, listAssets, RegisteredAsset } from '../lib/mandala/assetStore'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

export default function IssuerPanel() {
  const { wallet, identityKey } = useWallet()
  const [label, setLabel] = useState('')
  const [assets, setAssets] = useState<RegisteredAsset[]>([])
  const [issueAsset, setIssueAsset] = useState('')
  const [issueAmount, setIssueAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    if (identityKey != null) setAssets(listAssets(identityKey))
  }, [identityKey])
  useEffect(() => { reload() }, [reload])

  // --- Register: 2-phase, assetId = true genesis outpoint ---
  const registerAsset = useCallback(async () => {
    if (wallet == null || identityKey == null || label.trim() === '') return
    setBusy(true)
    try {
      // Phase 1: create a 1-sat genesis UTXO to self; its outpoint becomes the assetId.
      const admin = new MandalaAdmin(wallet as any)
      const genesisPubKey = (await wallet.getPublicKey({ protocolID: ADMIN_PROTOCOL, keyID: 'genesis-' + label, counterparty: 'anyone' })).publicKey
      const genesisLock = admin.lock(genesisPubKey) // any 1-sat marker output we control; spent in phase 2
      const phase1 = await wallet.createAction({
        description: `Genesis for ${label}`,
        outputs: [{ satoshis: 1, lockingScript: genesisLock.toHex(), outputDescription: 'asset genesis', basket: BASKET }],
        options: { randomizeOutputs: false }
      })
      const genesisTx = Transaction.fromBEEF(phase1.tx as number[])
      const assetId = outpoint(genesisTx.id('hex'), 0)

      // Phase 2: register tx spends the genesis output and creates the admin auth output.
      const details: MandalaActionDetails = { kind: 'register', assetId }
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, details)
      const adminLock = admin.lock(boundKey)

      const beef = genesisTx.toBEEF()
      const reg = await wallet.createAction({
        description: `Register ${label}`,
        inputBEEF: beef,
        inputs: [{ outpoint: assetId, unlockingScriptLength: 74, inputDescription: 'spend genesis' }],
        outputs: [{ satoshis: 1, lockingScript: adminLock.toHex(), outputDescription: 'admin auth', basket: BASKET }],
        options: { randomizeOutputs: false }
      })

      // Sign the genesis input with the admin unlock (genesis was locked to the same genesis bound key).
      const regTx = Transaction.fromBEEF(reg.tx as number[])
      regTx.inputs[0].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, { kind: 'register', assetId } as any)
      // The genesis output bound key derived from keyID 'genesis-'+label; align its unlock:
      // (Use a dedicated genesis action-details whose commitment equals the genesis keyID.)
      await regTx.sign()
      const spends: Record<string, { unlockingScript: string }> = {
        '0': { unlockingScript: regTx.inputs[0].unlockingScript!.toHex() }
      }
      const signed = await wallet.signAction({ reference: reg.signableTransaction!.reference, spends })

      const offChainValues = encodeLinkagePayload({ inputs: [], outputs: [], admin: [{ index: 0, actionDetails: details }] })
      await submitToOverlay(signed.tx as number[], offChainValues)

      const authOutpoint = outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 0)
      saveAsset(identityKey, { assetId, label: label.trim(), authOutpoint })
      toast.success(`Registered ${label} (${assetId})`)
      setLabel(''); reload()
    } catch (e) {
      toast.error(`Register failed: ${String(e)}`)
    } finally { setBusy(false) }
  }, [wallet, identityKey, label, reload])

  // --- Issue: spend current auth outpoint; mint FT + next auth output ---
  const issue = useCallback(async () => {
    if (wallet == null || identityKey == null) return
    const asset = getAsset(identityKey, issueAsset)
    const amount = Number(issueAmount)
    if (asset == null || !Number.isInteger(amount) || amount < 1) return
    setBusy(true)
    try {
      const admin = new MandalaAdmin(wallet as any)
      const keyID = 'mint-' + Date.now()
      const counterparty = 'self'
      const ftLock = await new MandalaToken(wallet as any).lockBRC29(asset.assetId, amount, FT_PROTOCOL, keyID, counterparty)

      const priorOutpoint = asset.authOutpoint
      const issueDetails: MandalaActionDetails = { kind: 'issue', assetId: asset.assetId, amount, priorOutpoint }
      const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, issueDetails)
      const nextAuthLock = admin.lock(boundKey)

      // The action must SPEND the prior auth outpoint. Provide its BEEF via listOutputs include.
      const priorRef = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
      const priorOut = priorRef.outputs.find(o => `${o.outpoint}` === priorOutpoint)
      if (priorOut == null) throw new Error('prior auth outpoint not found in wallet outputs')

      const created = await wallet.createAction({
        description: `Issue ${amount} ${asset.label}`,
        inputBEEF: priorRef.BEEF as number[],
        inputs: [{ outpoint: priorOutpoint, unlockingScriptLength: 74, inputDescription: 'spend prior auth' }],
        outputs: [
          { satoshis: 1, lockingScript: ftLock.toHex(), outputDescription: 'minted FT', basket: BASKET,
            customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID, counterparty }) },
          { satoshis: 1, lockingScript: nextAuthLock.toHex(), outputDescription: 'next admin auth', basket: BASKET }
        ],
        options: { randomizeOutputs: false }
      })

      const tx = Transaction.fromBEEF(created.tx as number[])
      // Re-derive the prior action details to unlock the prior auth output.
      const prior = priorActionDetailsFor(asset, priorOutpoint)
      tx.inputs[0].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, prior as any)
      await tx.sign()
      const signed = await wallet.signAction({
        reference: created.signableTransaction!.reference,
        spends: { '0': { unlockingScript: tx.inputs[0].unlockingScript!.toHex() } }
      })

      const linkage = await revealLinkage(wallet as any, keyID, counterparty)
      const offChainValues = encodeLinkagePayload({
        inputs: [], outputs: [{ index: 0, linkage }], admin: [{ index: 1, actionDetails: issueDetails }]
      })
      await submitToOverlay(signed.tx as number[], offChainValues)

      const nextAuth = outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 1)
      updateAuthOutpoint(identityKey, asset.assetId, nextAuth)
      toast.success(`Issued ${amount} ${asset.label}`)
      setIssueAmount(''); reload()
    } catch (e) {
      toast.error(`Issue failed: ${String(e)}`)
    } finally { setBusy(false) }
  }, [wallet, identityKey, issueAsset, issueAmount, reload])

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Register asset</h2>
        <Label htmlFor="label">Label</Label>
        <Input id="label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Gold Coin" />
        <Button onClick={() => void registerAsset()} disabled={busy || label.trim() === ''}>Register</Button>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Issue tokens</h2>
        <Label htmlFor="asset">Asset</Label>
        <select id="asset" className="border rounded p-2 w-full" value={issueAsset} onChange={e => setIssueAsset(e.target.value)}>
          <option value="">Select…</option>
          {assets.map(a => <option key={a.assetId} value={a.assetId}>{a.label}</option>)}
        </select>
        <Label htmlFor="amount">Amount</Label>
        <Input id="amount" type="number" value={issueAmount} onChange={e => setIssueAmount(e.target.value)} />
        <Button onClick={() => void issue()} disabled={busy || issueAsset === '' || issueAmount === ''}>Issue</Button>
      </Card>
    </div>
  )
}

// The action-details whose commitment equals the bound key the prior auth output was locked with.
// register -> { kind:'register', assetId }; issue/recover -> the stored details. For v1 we store only
// the latest kind+amount+priorOutpoint, so reconstruct from the asset's history marker.
function priorActionDetailsFor(asset: RegisteredAsset, priorOutpoint: string): MandalaActionDetails {
  // For the first issue the prior auth is the register output:
  if (asset.authOutpoint === asset.authOutpoint) {
    return { kind: 'register', assetId: asset.assetId }
  }
  return { kind: 'register', assetId: asset.assetId }
}
```

> **Implementer note (important):** the admin auth chain requires that, when spending a prior auth output, you unlock it with the *exact* `actionDetails` it was created with (its `keyID` = `MandalaAdmin.commitment(details)`). v1 must persist the full prior `actionDetails` (not just the outpoint) so `priorActionDetailsFor` returns the correct record. Extend `RegisteredAsset` with `authDetails: MandalaActionDetails` and set it in `saveAsset`/`updateAuthOutpoint` calls: register → `{kind:'register',assetId}`; issue → the `issueDetails`; redeem/recover → their details. Replace the placeholder `priorActionDetailsFor` body to return `asset.authDetails`. Add this field in Task 7's type if not already present, and update the asset store test to round-trip it. The genesis input (phase 2) is locked with keyID `'genesis-'+label`; create its bound key from `{kind:'register',assetId:'genesis:'+label}` consistently in both lock and unlock, or simpler: lock the genesis output with a plain `P2PKH` to a wallet-derived key and unlock with the standard wallet P2PKH template — whichever keeps lock/unlock symmetric. Verify the chosen genesis lock/unlock pair validates locally before wiring issue.

- [ ] **Step 2: Update `RegisteredAsset` to carry `authDetails`**

In `app/src/lib/mandala/assetStore.ts` add `authDetails: MandalaActionDetails` to the `RegisteredAsset` interface (import the type from `./encoding`), thread it through `saveAsset`/`updateAuthOutpoint` (add an `updateAuth(identityKey, assetId, authOutpoint, authDetails)` that sets both), and update `assetStore.test.ts` to assert it round-trips. Re-run `npx vitest run src/lib/mandala/assetStore.test.ts` → PASS. Replace `priorActionDetailsFor` to `return asset.authDetails`.

- [ ] **Step 3: Verify build**

Run: `cd app && npx tsc -b`
Expected: no errors. (Adjust `createAction`/`signAction` argument shapes — `inputs[].outpoint`, `signableTransaction.reference`, `BEEF` field on `listOutputs` — to match the installed `@bsv/sdk` v2 types; cross-check against `~/git/demos/utility-tokens/src/components/SendTokens.tsx`, which performs the same create→sign→broadcast dance.)

- [ ] **Step 4: Commit**

```bash
git add app/src/components/IssuerPanel.tsx app/src/lib/mandala/assetStore.ts app/src/lib/mandala/assetStore.test.ts
git commit -m "feat(app): issuer register (2-phase genesis) and issue flows"
```

---

## Task 12: SendTokens — transfer with linkage

**Files:**
- Modify: `app/src/components/SendTokens.tsx`
- Reference: `~/git/demos/utility-tokens/src/components/SendTokens.tsx` (input gathering, change output, sign→broadcast, messagebox handoff)

**Interfaces:**
- Consumes: `useWallet()`; `@bsv/identity-react` `useIdentitySearch` (recipient lookup, as in utility-tokens); `MandalaToken`; `walletMandalaUnlock`; `revealLinkage`; `submitToOverlay`; `encodeLinkagePayload`; constants; `messageBoxClient.sendMessage`.
- Produces: a transfer form (asset, amount, recipient). Implements `transfer(assetId, amount, recipientIdentityKey)`:
  1. `listOutputs({ basket: BASKET, include: 'entire transactions' })`, decode, pick inputs of `assetId` until Σ ≥ amount; merge their BEEF.
  2. Outputs: `[0]` FT to recipient via `lockBRC29(assetId, amount, FT_PROTOCOL, keyIDOut, recipientIdentityKey)`; `[1]` FT change to self via `lockBRC29(assetId, change, FT_PROTOCOL, keyIDChange, 'self')` when `Σin > amount`.
  3. For each spent FT input set `unlockingScriptTemplate = walletMandalaUnlock(wallet, inputKeyID, inputCounterparty)` using the `customInstructions` stored at receive/issue time; `sign()` then `signAction`.
  4. `offChainValues.outputs` = one `revealLinkage` per FT output (`{index:0, linkage(recipient)}`, and `{index:1, linkage('self')}` if change). No admin section.
  5. `submitToOverlay`. Then `messageBoxClient.sendMessage({ recipient, messageBox: MESSAGEBOX, body: { assetId, amount, transaction: signed.tx, keyID: keyIDOut, protocolID: FT_PROTOCOL, sender: identityKey } })`.

- [ ] **Step 1: Write `app/src/components/SendTokens.tsx`**

Implement per the interface above. Use utility-tokens `SendTokens.tsx` as the structural template for: `useIdentitySearch` wiring, the input-selection loop with `beef.mergeBeef`, the `createAction` → `Transaction.fromBEEF` → per-input `unlockingScriptTemplate` → `sign()` → `signAction({ reference, spends })` sequence, and the `messageBoxClient.sendMessage` call. Substitute:
- PushDrop → `MandalaToken` (`lockBRC29` for locks; `walletMandalaUnlock` for spends).
- `customInstructions` parsing yields `{ protocolID, keyID, counterparty }`; for spends pass `keyID` + `counterparty` to `walletMandalaUnlock`.
- token field reads (amount) → `MandalaToken.decode(LockingScript.fromHex(...)).amount`.
- topic `'tm_tokendemo'` → use `submitToOverlay(signed.tx, offChainValues)`.
- Add the `offChainValues` linkage section (utility-tokens has none).

Full transfer function body:

```tsx
// inside SendTokens component
const transfer = async (assetId: string, amount: number, recipient: string) => {
  if (wallet == null || messageBoxClient == null || identityKey == null) return
  const res = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  // pick FT inputs of this asset
  const beef = new Beef()
  const inputs: Array<{ outpoint: string, unlockingScriptLength: number, inputDescription: string }> = []
  const spendInfo: Array<{ keyID: string, counterparty: string }> = []
  let gathered = 0
  for (const o of res.outputs) {
    if (gathered >= amount) break
    let decoded
    try { decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string)) } catch { continue }
    if (decoded.assetId !== assetId) continue
    const ci = JSON.parse((o.customInstructions as string) ?? '{}')
    beef.mergeBeef(res.BEEF as number[])
    inputs.push({ outpoint: o.outpoint as string, unlockingScriptLength: 108, inputDescription: 'spend FT' })
    spendInfo.push({ keyID: ci.keyID, counterparty: ci.counterparty })
    gathered += decoded.amount
  }
  if (gathered < amount) throw new Error('insufficient token balance')
  const change = gathered - amount

  const keyIDOut = 'xfer-' + Date.now()
  const ftOut = await new MandalaToken(wallet as any).lockBRC29(assetId, amount, FT_PROTOCOL, keyIDOut, recipient)
  const outputs: any[] = [{ satoshis: 1, lockingScript: ftOut.toHex(), outputDescription: 'FT to recipient' }]
  let keyIDChange = ''
  if (change > 0) {
    keyIDChange = 'change-' + Date.now()
    const ftChange = await new MandalaToken(wallet as any).lockBRC29(assetId, change, FT_PROTOCOL, keyIDChange, 'self')
    outputs.push({ satoshis: 1, lockingScript: ftChange.toHex(), outputDescription: 'FT change', basket: BASKET,
      customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: 'self' }) })
  }

  const created = await wallet.createAction({
    description: `Send ${amount} of ${assetId}`,
    inputBEEF: beef.toBinary(),
    inputs,
    outputs,
    options: { randomizeOutputs: false }
  })

  const tx = Transaction.fromBEEF(created.tx as number[])
  for (let i = 0; i < spendInfo.length; i++) {
    tx.inputs[i].unlockingScriptTemplate = walletMandalaUnlock(wallet as any, spendInfo[i].keyID, spendInfo[i].counterparty)
  }
  await tx.sign()
  const spends: Record<string, { unlockingScript: string }> = {}
  for (let i = 0; i < spendInfo.length; i++) spends[String(i)] = { unlockingScript: tx.inputs[i].unlockingScript!.toHex() }
  const signed = await wallet.signAction({ reference: created.signableTransaction!.reference, spends })

  const linkOut = await revealLinkage(wallet as any, keyIDOut, recipient)
  const outLinks = [{ index: 0, linkage: linkOut }]
  if (change > 0) outLinks.push({ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, 'self') })
  const offChainValues = encodeLinkagePayload({ inputs: [], outputs: outLinks })
  await submitToOverlay(signed.tx as number[], offChainValues)

  await messageBoxClient.sendMessage({
    recipient,
    messageBox: MESSAGEBOX,
    body: { assetId, amount, transaction: signed.tx, keyID: keyIDOut, protocolID: FT_PROTOCOL, sender: identityKey }
  })
}
```

Wrap with the same form/identity-search UI as utility-tokens `SendTokens.tsx`. Imports needed: `Beef, Transaction, LockingScript` from `@bsv/sdk`; `MandalaToken` from `@bsv/templates`; helpers from `lib/mandala/*`.

- [ ] **Step 2: Verify build**

Run: `cd app && npx tsc -b`
Expected: no errors. Cross-check `listOutputs` `BEEF`/`outpoint` field names and `createAction` input shape against utility-tokens; adjust casts as needed.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/SendTokens.tsx
git commit -m "feat(app): token transfer with per-output linkage and messagebox handoff"
```

---

## Task 13: ReceiveTokens — messagebox internalize

**Files:**
- Modify: `app/src/components/ReceiveTokens.tsx`
- Reference: `~/git/demos/utility-tokens/src/components/ReceiveTokens.tsx`

**Interfaces:**
- Consumes: `useWallet()`; `messageBoxClient.listMessages` / `acknowledgeMessage`; `wallet.internalizeAction`; constants (`MESSAGEBOX`, `BASKET`, `FT_PROTOCOL`).
- Produces: a list of pending incoming tokens with Accept buttons. On accept, internalize output index 0 into `BASKET` with `customInstructions = { protocolID, keyID, counterparty: sender }`, then acknowledge.

- [ ] **Step 1: Write `app/src/components/ReceiveTokens.tsx`** — adapt utility-tokens `ReceiveTokens.tsx` 1:1, changing only the message box name to `MESSAGEBOX`, the basket to `BASKET`, and the `customInstructions` to `{ protocolID: msg.body.protocolID, keyID: msg.body.keyID, counterparty: msg.body.sender }`. The internalize call:

```tsx
await wallet.internalizeAction({
  tx: msg.body.transaction,
  outputs: [{
    outputIndex: 0,
    protocol: 'basket insertion',
    insertionRemittance: {
      basket: BASKET,
      customInstructions: JSON.stringify({ protocolID: msg.body.protocolID, keyID: msg.body.keyID, counterparty: msg.body.sender }),
      tags: ['mandala', 'received', msg.body.assetId]
    }
  }],
  description: `Receive ${msg.body.amount} of ${msg.body.assetId}`
})
await messageBoxClient.acknowledgeMessage({ messageIds: [msg.messageId] })
```

- [ ] **Step 2: Verify build**

Run: `cd app && npx tsc -b`
Expected: no errors. (Match `listMessages` message shape / `messageId` field to utility-tokens.)

- [ ] **Step 3: Commit**

```bash
git add app/src/components/ReceiveTokens.tsx
git commit -m "feat(app): receive tokens via messagebox internalize"
```

---

## Task 14: IssuerPanel — Redeem + Recover

**Files:**
- Modify: `app/src/components/IssuerPanel.tsx`

**Interfaces:**
- Consumes: same as Task 11 plus `walletMandalaUnlock` (to spend FT inputs in redeem).
- Produces: a **Redeem** form (asset, amount → burn) and a **Recover** form (asset, amount, recipient identity → seize/re-issue). Adds `redeem(assetId, amount)` and `recover(assetId, amount, recipient)`.

- [ ] **Step 1: Add `redeem` to `IssuerPanel.tsx`**

```tsx
const redeem = async (assetId: string, amount: number) => {
  if (wallet == null || identityKey == null) return
  const asset = getAsset(identityKey, assetId); if (asset == null) return
  const admin = new MandalaAdmin(wallet as any)
  // gather FT inputs of this asset totaling >= amount (same selection as transfer)
  const res = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  const beef = new Beef()
  const ftInputs: any[] = []; const ftSpend: Array<{keyID:string,counterparty:string}> = []
  let gathered = 0
  for (const o of res.outputs) {
    if (gathered >= amount) break
    let d; try { d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string)) } catch { continue }
    if (d.assetId !== assetId) continue
    const ci = JSON.parse((o.customInstructions as string) ?? '{}')
    beef.mergeBeef(res.BEEF as number[])
    ftInputs.push({ outpoint: o.outpoint as string, unlockingScriptLength: 108, inputDescription: 'burn FT' })
    ftSpend.push({ keyID: ci.keyID, counterparty: ci.counterparty }); gathered += d.amount
  }
  if (gathered < amount) throw new Error('insufficient balance to redeem')
  const change = gathered - amount

  const redeemDetails: MandalaActionDetails = { kind: 'redeem', assetId, amount, priorOutpoint: asset.authOutpoint }
  const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, redeemDetails)
  const nextAuthLock = admin.lock(boundKey)

  // also spend the prior auth outpoint
  const priorRef = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  beef.mergeBeef(priorRef.BEEF as number[])
  const inputs = [...ftInputs, { outpoint: asset.authOutpoint, unlockingScriptLength: 74, inputDescription: 'spend prior auth' }]

  const outputs: any[] = [{ satoshis: 1, lockingScript: nextAuthLock.toHex(), outputDescription: 'redeem auth', basket: BASKET }]
  let keyIDChange = ''
  if (change > 0) {
    keyIDChange = 'rchg-' + Date.now()
    const ftChange = await new MandalaToken(wallet as any).lockBRC29(assetId, change, FT_PROTOCOL, keyIDChange, 'self')
    outputs.push({ satoshis: 1, lockingScript: ftChange.toHex(), outputDescription: 'FT change', basket: BASKET,
      customInstructions: JSON.stringify({ protocolID: FT_PROTOCOL, keyID: keyIDChange, counterparty: 'self' }) })
  }

  const created = await wallet.createAction({ description: `Redeem ${amount} ${asset.label}`, inputBEEF: beef.toBinary(), inputs, outputs, options: { randomizeOutputs: false } })
  const tx = Transaction.fromBEEF(created.tx as number[])
  for (let i = 0; i < ftSpend.length; i++) tx.inputs[i].unlockingScriptTemplate = walletMandalaUnlock(wallet as any, ftSpend[i].keyID, ftSpend[i].counterparty)
  tx.inputs[ftSpend.length].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, asset.authDetails as any)
  await tx.sign()
  const spends: Record<string, { unlockingScript: string }> = {}
  for (let i = 0; i < inputs.length; i++) spends[String(i)] = { unlockingScript: tx.inputs[i].unlockingScript!.toHex() }
  const signed = await wallet.signAction({ reference: created.signableTransaction!.reference, spends })

  // admin index is 0; change FT (if any) is index 1 → its linkage
  const outLinks = change > 0 ? [{ index: 1, linkage: await revealLinkage(wallet as any, keyIDChange, 'self') }] : []
  const offChainValues = encodeLinkagePayload({ inputs: [], outputs: outLinks, admin: [{ index: 0, actionDetails: redeemDetails }] })
  await submitToOverlay(signed.tx as number[], offChainValues)
  updateAuth(identityKey, assetId, outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 0), redeemDetails)
}
```

- [ ] **Step 2: Add `recover` to `IssuerPanel.tsx`** — identical shape to `issue` but `kind: 'recover'` and `counterparty = recipient` (a provided identity key), FT output index 0 + next auth index 1, FT linkage for index 0:

```tsx
const recover = async (assetId: string, amount: number, recipient: string) => {
  if (wallet == null || identityKey == null) return
  const asset = getAsset(identityKey, assetId); if (asset == null) return
  const admin = new MandalaAdmin(wallet as any)
  const keyID = 'recover-' + Date.now()
  const ftLock = await new MandalaToken(wallet as any).lockBRC29(assetId, amount, FT_PROTOCOL, keyID, recipient)
  const details: MandalaActionDetails = { kind: 'recover', assetId, amount, priorOutpoint: asset.authOutpoint }
  const { boundKey } = await admin.deriveBoundKey(ADMIN_PROTOCOL, details)
  const nextAuthLock = admin.lock(boundKey)
  const priorRef = await wallet.listOutputs({ basket: BASKET, include: 'entire transactions', limit: 1000 })
  const created = await wallet.createAction({
    description: `Recover ${amount} ${asset.label}`,
    inputBEEF: priorRef.BEEF as number[],
    inputs: [{ outpoint: asset.authOutpoint, unlockingScriptLength: 74, inputDescription: 'spend prior auth' }],
    outputs: [
      { satoshis: 1, lockingScript: ftLock.toHex(), outputDescription: 'recovered FT' },
      { satoshis: 1, lockingScript: nextAuthLock.toHex(), outputDescription: 'recover auth', basket: BASKET }
    ],
    options: { randomizeOutputs: false }
  })
  const tx = Transaction.fromBEEF(created.tx as number[])
  tx.inputs[0].unlockingScriptTemplate = admin.unlock(ADMIN_PROTOCOL, asset.authDetails as any)
  await tx.sign()
  const signed = await wallet.signAction({ reference: created.signableTransaction!.reference, spends: { '0': { unlockingScript: tx.inputs[0].unlockingScript!.toHex() } } })
  const linkage = await revealLinkage(wallet as any, keyID, recipient)
  const offChainValues = encodeLinkagePayload({ inputs: [], outputs: [{ index: 0, linkage }], admin: [{ index: 1, actionDetails: details }] })
  await submitToOverlay(signed.tx as number[], offChainValues)
  updateAuth(identityKey, assetId, outpoint(Transaction.fromBEEF(signed.tx as number[]).id('hex'), 1), details)
}
```

Add Redeem + Recover `Card` forms (asset select + amount, plus recipient input for recover) wired to these functions with `busy`/`toast` handling like register/issue.

- [ ] **Step 3: Verify build**

Run: `cd app && npx tsc -b && npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/IssuerPanel.tsx
git commit -m "feat(app): issuer redeem (burn) and recover (seize/re-issue) flows"
```

---

## Task 15: README + manual end-to-end verification

**Files:**
- Create: `app/README.md`, `overlay/README.md` (or a single top-level `demos/mandala/README.md`)

**Interfaces:**
- Produces: run + verification instructions.

- [ ] **Step 1: Write `demos/mandala/README.md`**

Document: (1) `cd overlay && npm i && npm run gen-key`, paste key into `overlay/.env`, record identity pubkey; (2) `docker compose up --build`; (3) `cd app && npm i`, copy `.env.example`→`.env`, set `VITE_OVERLAY_IDENTITY_KEY` to the recorded pubkey; (4) run the **issuer** wallet (a BRC-100 wallet whose identity key equals `SERVER_PRIVATE_KEY`) → `npm run dev` → Issuer tab appears; (5) any other wallet → only Wallet/Send/Receive.

- [ ] **Step 2: Manual E2E checklist (run and confirm each)**

```
[ ] Overlay up; curl shows tm_mandala configured.
[ ] Issuer wallet: Register "Gold" → toast shows assetId == <genesisTxid>.0; appears in Issuer asset list.
[ ] Issuer: Issue 100 Gold to self → Wallet tab shows Gold: 100.
[ ] Issuer: Send 40 Gold to a second wallet's identity → overlay admits; second wallet Receive shows pending.
[ ] Second wallet: Accept → Wallet shows Gold: 40. Issuer Wallet shows Gold: 60 (change).
[ ] Second wallet: Send 10 back to issuer → issuer Receive → Accept → balances update.
[ ] Issuer: Redeem 20 Gold → Wallet balance drops by 20; overlay admits redeem.
[ ] Issuer: Recover 5 Gold to a target identity → that wallet receives via overlay/messagebox.
[ ] Negative: a non-issuer wallet sees NO Issuer tab.
```

- [ ] **Step 3: Run the unit suite**

Run: `cd app && npm run test`
Expected: all Vitest suites (encoding, unlock, overlay, assetStore, tokens) PASS.

- [ ] **Step 4: Commit**

```bash
git add demos/mandala/README.md
git commit -m "docs(mandala): run instructions and manual E2E checklist"
```

---

## Self-Review

**Spec coverage:**
- Overlay service (tm_mandala only, instance key) → Task 1. ✓
- Role gating (issuer vs user) → Tasks 4, 9. ✓
- Register (2-phase, true genesis outpoint) → Task 11. ✓
- Issue → Task 11. ✓
- Transfer + per-output linkage offChainValues → Task 12. ✓
- Receive (messagebox internalize) → Task 13. ✓
- Redeem + Recover → Task 14. ✓
- Balance/management view → Task 10. ✓
- offChain encoding helper → Task 3. ✓
- Wallet-based unlock wrapper → Task 5. ✓
- Overlay submission with offChainValues → Task 6. ✓
- Asset/auth-outpoint persistence → Task 7 (+ `authDetails` extension in Task 11). ✓
- Broadcast pattern parity with utility-tokens → Tasks 12, 13 reference it directly. ✓

**Known risk areas flagged for the implementer (verify against installed SDK v2 at build time):**
1. `createAction`/`signAction` exact arg shapes (`inputs[].outpoint`, `unlockingScriptLength`, `signableTransaction.reference`, `inputBEEF`) and `listOutputs` `BEEF`/`outpoint`/`customInstructions` fields — cross-check with utility-tokens `SendTokens.tsx`/`TokenWallet.tsx` (the authoritative working example in this SDK family).
2. The admin auth-chain unlock must use the prior output's exact `actionDetails` (persisted as `authDetails`). Task 11 Step 2 makes this explicit; Tasks 14 redeem/recover rely on it.
3. Genesis lock/unlock symmetry in Register phase 2 — pick one consistent scheme (admin-bound key OR plain wallet P2PKH) and validate it locally before issue. Flagged inline in Task 11.
4. `Spend` constructor field names in Task 5's test — adjust to the installed SDK; the implementation is the deliverable.
5. Overlay broadcast import path (`HTTPSOverlayBroadcastFacilitator`) — match utility-tokens' import.

**Type consistency:** `RegisteredAsset` gains `authDetails` in Task 11 and is consumed in Task 14 (`asset.authDetails`) — consistent. `walletMandalaUnlock(wallet, keyID, counterparty)` signature used identically in Tasks 12 and 14. `revealLinkage(wallet, keyID, counterparty)` and `encodeLinkagePayload(payload)` signatures stable across tasks. `submitToOverlay(beef, offChainValues)` stable.

**Placeholder scan:** No `TBD`/`TODO` left as deliverables. The `priorActionDetailsFor` placeholder in Task 11 Step 1 is explicitly replaced in Task 11 Step 2 (not left dangling).
