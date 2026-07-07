# Go overlay port — design

**Date:** 2026-07-07
**Status:** Approved pending user review
**Appendices:** [A — language-neutral port spec](2026-07-07-go-overlay-port-appendix-a-port-spec.md) (script formats, linkage crypto, topic gates, reducer, lookup, storage ops), [B — frontend wire contract](2026-07-07-go-overlay-port-appendix-b-wire-contract.md) (all 7 endpoints, exact encodings)

## Goal

Reimplement the Mandala overlay service in Go for performance, using the
bsv-blockchain org's Go stack. The frontend app is not modified in any way:
every HTTP call it makes today must work unchanged against the Go overlay.

Decisions made with the user:

- **Storage: MongoDB** — keep the existing Mongo deployment; same collections,
  documents, and indexes as the TS `MandalaStorageManager`, so existing demo
  data survives. Engine storage also on Mongo via `b-open-io/overlay` (below).
  SQLite/Knex disappears.
- **Arcade: full parity** — port the `ARCADE_URL` branch (broadcast-before-fold
  via Arcade, `/arc-ingest` proof callbacks, chaintracks chain tracker), plus
  the local-demo default (scripts-only validation, client wallet broadcasts).
- **Engine storage: `b-open-io/overlay`** (MIT, v3.x) — production Mongo
  implementation of the overlay engine storage interface, built for
  1Sat-indexer scale.

## Non-goals

- No frontend changes (hard requirement).
- No GASP sync, SHIP/SLAP advertisements, BASM routes, ban service, HTML UI,
  or BSV mutual-auth middleware — all disabled/unused in today's Mandala
  config (Appendix B; overlay/src/index.ts:78, `configureEngine(false)`).
- No new auth on the `/admin/*` GET endpoints — they are unauthenticated
  today; parity preserved deliberately.
- The TS overlay package (`overlay/`) is not deleted by this work; it stays
  until the user verifies parity and removes it.

## Architecture

```
app (unchanged)
  │  POST /submit · POST /lookup · GET /admin/* (5) 
  ▼
overlay-go/  (new Go module)
  cmd/overlay/main.go          — env config, wiring, listen :8080
  internal/httpapi/            — Fiber handlers, TS wire parity layer
  internal/mandala/            — ported domain logic (see below)
  internal/activity/           — /admin/activity feed builder
  internal/arcade/             — Arcade broadcaster + chaintracks ChainTracker
  │
  ├── go-overlay-services v1.3.x   pkg/core/engine  (Submit/Lookup pipeline,
  │                                 SPV, spend tracking, BEEF hydration)
  ├── b-open-io/overlay v3.x       Mongo engine storage + BEEF store
  ├── go-sdk v1.2.x                ProtoWallet, KeyDeriver, BEEF, scripts
  └── mongo-go-driver              mandala projection collections
```

**Why engine + custom HTTP instead of the stock `pkg/server`:** the shipped Go
server cannot serve this app — it drops the off-chain-values body framing
entirely, wraps the submit response as `{"STEAK": …}` where the app's SDK
client expects a bare STEAK map, and marshals lookup BEEF as base64 where the
client expects `number[]` or the binary aggregate format. The engine beneath
is sound; the HTTP layer is thin. So: `engine.NewEngine(...)` + our own Fiber
handlers reproducing the TS wire contract exactly (Appendix B §4).

**Why not go-wallet-toolbox:** the overlay is a verifier, not a spender.
go-sdk's `ProtoWallet` (from `SERVER_PRIVATE_KEY`) provides every operation
needed: BRC-42/43 derivation, BRC-2 decrypt (linkage verification), signatures.
go-wallet-toolbox is a full spending-wallet stack and would add weight without
function here.

## Components

### internal/mandala — domain port (spec: Appendix A)

| Unit | Source of truth | Notes |
|---|---|---|
| `token.go` — MandalaToken codec | Appendix A §1.3 | 8-chunk script; OP_1..OP_16 amount forms; assetId 36-byte reversed-txid encoding |
| `admin.go` — MandalaAdmin codec + `commitment()` | Appendix A §1.4 | canonical-JSON must match JS `JSON.stringify` semantics; publicData variant |
| `linkage.go` — verifyKeyLinkage | Appendix A §2 | ProtoWallet.Decrypt with wrapper protocol `[2, "specific linkage revelation <lvl> <name>"]`; reconstruct `counterparty + L·G`; hash160 compare. go-sdk's BRC-2 handles the 32-byte GCM nonce |
| `payload.go` — MandalaLinkagePayload | Appendix A §0.5 | JSON decode of offChainValues |
| `topic_manager.go` | Appendix A §3 | all gates, conservation, admin verification, reissue guards; rejections are errors |
| `lookup_service.go` | Appendix A §4 | admitted/spent/evicted handlers + 5 query shapes |
| `reducer.go` — AssetAdminState fold | Appendix A §6 | pure; rebuild must equal live fold |
| `storage.go` — Mongo projections | Appendix A §5 | same 7 collections/indexes as TS (`mandalaTokens`, `mandalaLinkageRecords`, `mandalaBalances`, `mandalaMetadata`, `mandalaAssetStates`, `mandalaAdminHistory`, `mandalaCounters`) |

### internal/httpapi — wire parity (contract: Appendix B)

- `POST /submit` — parse `X-Topics` (JSON array header) and, when
  `x-includes-off-chain-values: true`, split the body as
  `varint(beefLen) ‖ beef ‖ offChainValues`. Call `Engine.Submit` with
  `TaggedBEEF{Beef, Topics, OffChainValues}`. Respond **200 + bare STEAK
  JSON** on success; **400 `{status:"error",message}`** on rejection. Success
  with empty `outputsToAdmit` must only occur for genuinely no-op topics —
  the app treats empty-admit as rejection.
- `POST /lookup` — validate `{service, query}`, call `Engine.Lookup`, respond
  JSON `{type:"output-list", outputs:[{beef:number[], outputIndex}]}`
  (marshal BEEF bytes as JSON number arrays, NOT base64). The binary
  `X-Aggregation` mode is not implemented — the app's `LookupResolver`
  switches on response Content-Type and accepts the JSON form.
- `GET /admin/asset-state/:assetId`, `/admin/admin-history/:assetId`,
  `/admin/admin-history-page/:assetId?limit&offset`,
  `/admin/admin-summary/:assetId`, `/admin/activity?assetId&limit&before` —
  same shapes as TS (Appendix B §3), URL-decoded assetIds.
- `POST /arc-ingest` — token-checked (`Authorization: Bearer` or
  `x-callback-token`) when configured; terminal statuses evict, merkle proofs
  go to `Engine.HandleNewMerkleProof`. Registered only when Arcade configured.
- `/health`, `/health/live`, `/health/ready` — process/engine/mongo checks.
- Middleware: wildcard CORS (`Origin/Headers/Methods/Expose: *`,
  `Allow-Private-Network: true`, OPTIONS → 200), octet-stream + JSON bodies,
  TS-shaped 404 `{status:"error",code:"ERR_ROUTE_NOT_FOUND",…}`.

### offChainValues threading (engine gap)

Go's `TopicManager.IdentifyAdmissibleOutputs(ctx, beef, txid, previousCoins)`
has no offChainValues parameter (TS does). Lookup services receive it natively
(`OutputAdmittedByTopic.OffChainValues`). For the topic manager, the submit
handler stores the decoded payload in the request `context.Context` under a
package-private key; the topic manager reads it back. **Implementation must
verify the engine propagates the submit ctx to `IdentifyAdmissibleOutputs`
unchanged** (it takes ctx; call-site inspection required at pinned version).
Fallback if ctx is not propagated: txid-keyed `sync.Map` populated before
`Engine.Submit`, cleaned up after — same semantics, uglier.

### internal/activity

Port of `overlay/src/activity.ts`: `summarizeTx` conservation classifier,
paging with `GROUP_OVERLAP = 9` (must stay ≥ max linkage rows per tx =
recipient + 8 split change outputs), inclusive `before` cursor, per-tx raw-tx
and source-outpoint joins. Performance improvement over TS: batch the raw-tx
and linkage-by-outpoint reads (single `$in` queries — the TS version already
batches; keep it that way, no N+1).

### internal/arcade

- `Broadcaster`: `POST {ARCADE_URL}/tx` with `{rawTx}` EF-format hex (fallback
  plain hex), `Authorization: Bearer`, `X-CallbackUrl: https://<fqdn>/arc-ingest`,
  `X-CallbackToken`, deployment-ID headers. Classify response even on HTTP 200:
  `DOUBLE_SPEND_ATTEMPTED / REJECTED / INVALID / MALFORMED / MINED_IN_STALE_BLOCK / *ORPHAN*`
  → terminal failure. Engine config: broadcast **before** folding state;
  broadcast failure rejects the submit (TS `throwOnBroadcastFailure: true`).
- `ChainTracker`: chaintracks client — `GET {base}{prefix}/height` and
  `GET {base}{prefix}/header/height/{h}`; used for merkle-root validation.
  Defaults: `CHAINTRACKS_URL = ARCADE_URL + "/chaintracks"`,
  `CHAINTRACKS_API_PREFIX = "/v2"`.
- Without `ARCADE_URL`: scripts-only validation (a permissive ChainTracker
  equivalent of TS `'scripts only'`), no broadcaster, no `/arc-ingest` route —
  the client wallet broadcasts after overlay acceptance (overlay-first flow).

## Configuration

Same env vars as TS, none added, one dropped: `NODE_NAME` (Mongo db name =
`${NODE_NAME}_lookup_services`), `SERVER_PRIVATE_KEY`, `HOSTING_URL`,
`MONGO_URL`, `NETWORK`, optional `ARCADE_URL`, `ARCADE_API_KEY`,
`CHAINTRACKS_URL`, `CHAINTRACKS_API_PREFIX`. `SQLITE_FILE` is dropped
(no Knex/SQLite layer remains).
Port 8080. Dockerfile (multi-stage Go build, distroless) + compose service
replacing the TS overlay container; Mongo container unchanged.

## Error semantics (must-hold invariants)

1. A tx the overlay did not fold must never yield 200 + non-empty
   `outputsToAdmit` for `tm_mandala` — the app broadcasts on that signal.
2. Topic-manager rejections are 400s; body text is diagnostic only (the app
   discards it).
3. Conservation, gates, and reissue-guard behavior byte-match Appendix A §3 —
   including the asymmetry: bad linkage in `payload.inputs` rejects during
   sanctions screening but is tolerated during sender resolution; missing
   output linkage silently skips that output.

## Testing

1. **Golden vectors from TS** — a small script in `overlay-go/testdata/gen/`
   (Node, using the installed `@bsv/templates` + `@bsv/sdk`) emits JSON
   vectors: token/admin scripts across amount forms (1, 16, 17, 2^32, max
   safe), assetId encodings, `commitment()` canonical-JSON cases (nested
   objects, arrays, unicode keys), and a full linkage fixture (prover key,
   verifier key, keyID → encryptedLinkage bytes + expected derived pkh).
   Go tests consume the vectors. BRC-42 official vectors already ship in
   go-sdk.
2. **Unit** — topic-manager gate table tests (every gate, every rejection
   path), reducer fold/rebuild equivalence, activity paging (incl. the 9-row
   max-split boundary case), storage ops against a Mongo testcontainer.
3. **Wire** — httptest suite asserting exact response shapes against recorded
   TS responses (submit success/reject, lookup JSON, all 5 admin GETs, CORS
   preflight, 404 shape).
4. **E2E** — compose up (Go overlay + Mongo + app), run the full demo flow
   from the unchanged frontend: register → issue → send (multi-output split
   change) → freeze → reissue → redeem → pause/access-mode rejections →
   activity + history pages.

## Risks

| Risk | Mitigation |
|---|---|
| `b-open-io/overlay` v3 storage may have drifted from go-overlay-services v1.3.2 `engine.Storage` interface | Pin compatible versions at implementation start; if v3 diverged, use its last engine-compatible tag, or fall back to writing a minimal Mongo `engine.Storage` in-repo (interface is ~15 methods) |
| Engine may not propagate submit ctx to `IdentifyAdmissibleOutputs` | Verified at implementation; `sync.Map` fallback designed above |
| JS-exact canonical JSON in `commitment()` | Golden vectors generated by the actual TS code; any mismatch caught before wiring |
| App's `LookupResolver` uses `networkPreset:'mainnet'` → lookups require `https:` overlay URL | Unchanged from today (deployment concern, not code); noted for compose/TLS setup |
| go-overlay-services may be folded into go-stack monorepo | Pin v1.3.x; migration is a rename later |

## Rollout

1. Build `overlay-go/` to green tests.
2. Compose: add `overlay-go` service; frontend `VITE_OVERLAY_URL` switches to
   it; TS overlay container stays defined but stopped.
3. User runs the demo flow; on parity satisfaction, TS overlay removal is a
   separate decision.
