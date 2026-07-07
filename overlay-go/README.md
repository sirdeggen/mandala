# overlay-go

Go port of the Mandala BSV overlay service (replaces the TS `overlay/` service).
Module path: `github.com/sirdeggen/mandala/overlay-go`.

Status: Task 1 (module scaffold + pinned deps + ctx-propagation spike) only.
Nothing is wired up yet — `cmd/overlay/main.go` is a placeholder and
`internal/mandala` is an empty package awaiting the domain-logic port.

## Toolchain

- Built/verified with `go1.26.0 darwin/arm64` (local toolchain).
- `go-overlay-services@v1.3.2` requires Go 1.25+; `go.mod` declares `go 1.25.4`
  and `go get` auto-bumped it from 1.25.0 during dependency resolution.
  `GOTOOLCHAIN=auto` (default) will download a matching toolchain if the local
  one is older than what a dependency requires.

## Pinned dependencies

```
github.com/bsv-blockchain/go-overlay-services v1.3.2
github.com/bsv-blockchain/go-sdk              v1.2.24   (@latest at pin time)
go.mongodb.org/mongo-driver/v2                v2.7.0    (@latest at pin time)
github.com/gofiber/fiber/v2                   v2.52.14  (@latest at pin time)
```

`github.com/b-open-io/overlay` (pinned at v0.3.0 in Task 1) was **dropped in
Task 12**: no published tag implements go-overlay-services v1.3.2's
`engine.Storage` (see the compatibility verdict below), so the spec fallback
governs and `internal/enginestore` is the in-repo Mongo implementation.

`go mod tidy` is now safe to run: everything except fiber is imported by
shipped code, and the root `tools.go` (build tag `tools`, never compiled
into real builds) blank-imports fiber so tidy keeps that pin until Task 13's
HTTP server imports it directly.

## Pinned API notes

Reconciled via `go doc` against the exact pinned versions above. These are
the signatures later tasks should code against verbatim.

### `engine.TopicManager` (go-overlay-services v1.3.2)

```
type TopicManager interface {
	IdentifyAdmissibleOutputs(ctx context.Context, beef *transaction.Beef, txid *chainhash.Hash, previousCoins []uint32) (overlay.AdmittanceInstructions, error)
	IdentifyNeededInputs(ctx context.Context, beef *transaction.Beef, txid *chainhash.Hash) ([]*transaction.Outpoint, error)
	GetDocumentation() string
	GetMetaData() *overlay.MetaData
}
```

### `engine.LookupService` (go-overlay-services v1.3.2)

```
type LookupService interface {
	OutputAdmittedByTopic(ctx context.Context, payload *OutputAdmittedByTopic) error
	OutputSpent(ctx context.Context, payload *OutputSpent) error
	OutputNoLongerRetainedInHistory(ctx context.Context, outpoint *transaction.Outpoint, topic string) error
	OutputEvicted(ctx context.Context, outpoint *transaction.Outpoint) error
	OutputBlockHeightUpdated(ctx context.Context, txid *chainhash.Hash, blockHeight uint32, blockIndex uint64) error
	Lookup(ctx context.Context, question *lookup.LookupQuestion) (*lookup.LookupAnswer, error)
	GetDocumentation() string
	GetMetaData() *overlay.MetaData
}
```

### `engine.Config` (go-overlay-services v1.3.2)

```
type Config struct {
	Managers                map[string]TopicManager
	LookupServices          map[string]LookupService
	Storage                 Storage
	ChainTracker            chaintracker.ChainTracker
	HostingURL              string
	SHIPTrackers            []string
	SLAPTrackers            []string
	Broadcaster             transaction.Broadcaster
	Advertiser              advertiser.Advertiser
	SyncConfiguration       map[string]SyncConfiguration
	LogTime                 bool
	LogPrefix               string
	ErrorOnBroadcastFailure bool
	BroadcastFacilitator    topic.Facilitator
	LookupResolver          LookupResolverProvider
}
```

Use `NewEngine(Config)` to construct an `*Engine`.

### `Engine.Submit` (go-overlay-services v1.3.2)

```
func (e *Engine) Submit(ctx context.Context, taggedBEEF overlay.TaggedBEEF, mode SumbitMode, onSteakReady OnSteakReady) (overlay.Steak, error)
```

Note the upstream typo: `SumbitMode`, not `SubmitMode` (the type name — values
like `SubmitModeHistorical` are spelled normally).

### `overlay.TaggedBEEF` (go-sdk)

```
type TaggedBEEF struct {
	Beef           []byte
	Topics         []string
	OffChainValues []byte
}
```

### `overlay.AdmittanceInstructions` (go-sdk)

```
type AdmittanceInstructions struct {
	OutputsToAdmit []uint32
	CoinsToRetain  []uint32
	CoinsRemoved   []uint32
	AncillaryTxids []*chainhash.Hash
}
```

### `wallet.NewProtoWallet` (go-sdk)

```
func NewProtoWallet(rootKeyOrKeyDeriver ProtoWalletArgs) (*ProtoWallet, error)
```

### `wallet.ProtoWallet.Decrypt` (go-sdk)

```
func (p *ProtoWallet) Decrypt(
	ctx context.Context,
	args DecryptArgs,
	originator string,
) (*DecryptResult, error)
```

### `engine.Storage` (go-overlay-services v1.3.2) — the interface a Mongo/BEEF store must satisfy

```
type Storage interface {
	InsertOutputs(ctx context.Context, topic string, txid *chainhash.Hash, outputs []uint32, outpointsConsumed []*transaction.Outpoint, beef *transaction.Beef, ancillaryTxids []*chainhash.Hash) error
	FindOutput(ctx context.Context, outpoint *transaction.Outpoint, topic *string, spent *bool, includeBEEF bool) (*Output, error)
	FindOutputs(ctx context.Context, outpoints []*transaction.Outpoint, topic string, spent *bool, includeBEEF bool) ([]*Output, error)
	FindOutputsForTransaction(ctx context.Context, txid *chainhash.Hash, includeBEEF bool) ([]*Output, error)
	FindUTXOsForTopic(ctx context.Context, topic string, since float64, limit uint32, includeBEEF bool) ([]*Output, error)
	DeleteOutput(ctx context.Context, outpoint *transaction.Outpoint, topic string) error
	MarkUTXOsAsSpent(ctx context.Context, outpoints []*transaction.Outpoint, topic string, spendTxid *chainhash.Hash) error
	UpdateConsumedBy(ctx context.Context, outpoint *transaction.Outpoint, topic string, consumedBy []*transaction.Outpoint) error
	UpdateTransactionBEEF(ctx context.Context, txid *chainhash.Hash, beef *transaction.Beef) error
	UpdateOutputBlockHeight(ctx context.Context, outpoint *transaction.Outpoint, topic string, blockHeight uint32, blockIndex uint64) error
	InsertAppliedTransaction(ctx context.Context, tx *overlay.AppliedTransaction) error
	DoesAppliedTransactionExist(ctx context.Context, tx *overlay.AppliedTransaction) (bool, error)
	UpdateLastInteraction(ctx context.Context, host, topic string, since float64) error
	GetLastInteraction(ctx context.Context, host, topic string) (float64, error)
	FindOutpointsByMerkleState(ctx context.Context, topic string, state MerkleState, limit uint32) ([]*transaction.Outpoint, error)
	ReconcileMerkleRoot(ctx context.Context, topic string, blockHeight uint32, merkleRoot *chainhash.Hash) error
	LoadAncillaryBeef(ctx context.Context, output *Output) error
}
```

`engine.Output.Beef` (the field a `Storage`/BEEF layer must round-trip) is
typed `*transaction.Beef`, not `[]byte`. This matters for the compatibility
verdict below.

## b-open-io/overlay compatibility verdict: **NOT COMPATIBLE** (as of v0.3.0, 2026-07-07)

**Verdict: `github.com/b-open-io/overlay` does NOT implement
`go-overlay-services@v1.3.2`'s `engine.Storage` interface, at any currently
published tag (`v0.1.0`, `v0.2.0`, `v0.2.1`, `v0.3.0` — there is no v2.x/v3.x
line; the module has never left 0.x).** This contradicts the brief's
assumption that a `v2.x`/`v3.x` tag might resolve the mismatch — no such tags
exist. Per the brief's instruction, this is flagged rather than
improvised around: **the fallback (an in-repo Mongo `engine.Storage`
implementation) is the spec-level decision a later task needs to make.**

### How this was verified

1. `go get github.com/b-open-io/overlay@latest` resolves to `v0.3.0`.
2. `github.com/b-open-io/overlay@v0.3.0`'s own `go.mod` requires
   `github.com/bsv-blockchain/go-overlay-services v0.1.1` and additionally
   carries:
   ```
   replace github.com/bsv-blockchain/go-overlay-services => github.com/bsv-blockchain/go-overlay-services v0.1.2-0.20250808182921-aeae02752891
   ```
   i.e. b-open-io's own code was written and tested against a pre-`v0.1.2`
   snapshot of `engine.Storage` — many minor versions behind our pinned
   `v1.3.2`. **`replace` directives in a dependency's `go.mod` are ignored
   when that module is not the main module**, so in `overlay-go`'s build,
   Minimal Version Selection picks our higher pin, `v1.3.2`, for the shared
   dependency — confirmed via `go list -m github.com/bsv-blockchain/go-overlay-services` → `v1.3.2`. b-open-io/overlay's storage code is therefore
   compiled against an `engine.Storage` interface that has moved on since
   they wrote it.
3. Building `overlay-go` with a probe file that imports
   `github.com/b-open-io/overlay/storage` and assigns
   `*storage.MongoEventDataStorage` to an `engine.Storage`-typed variable
   surfaces two independent, stacked problems:

   **(a) A real bug in the published `v0.3.0` module itself**, unrelated to
   `engine.Storage`: `github.com/b-open-io/overlay/pubsub` fails to compile
   on its own —
   ```
   pubsub/channels.go:6:2: "time" imported and not used
   pubsub/redis.go:9:2: "time" imported and not used
   ```
   (verified: `grep -n "time\."` over both files returns zero uses). This
   bug is present in all four published tags' `pubsub` package in some form,
   and `storage/*.go` imports `pubsub` directly (`factory.go`, `mongo.go`,
   `base.go`, `sqlite.go`, `event_data.go`, `redis.go` all reference it), so
   this alone blocks `go build` for anyone who imports
   `b-open-io/overlay/storage`, before the `engine.Storage` question is even
   reached.

   **(b) A genuine `engine.Storage` interface mismatch**, visible once (a)
   is patched around locally to see past it (diagnostic only — not part of
   the pinned module):
   - `storage/event_data.go:39-40` — `EventDataStorage` embeds `engine.Storage`:
     ```go
     type EventDataStorage interface {
     	engine.Storage
     	GetBeefStorage() beef.BeefStorage
     	...
     }
     ```
   - `storage/factory.go:76,80,89,93,100` — `*RedisEventDataStorage`,
     `*MongoEventDataStorage`, `*SQLiteEventDataStorage` all fail to satisfy
     `EventDataStorage` with: **`missing method FindOutpointsByMerkleState`**
     (and, transitively, `ReconcileMerkleRoot`/`LoadAncillaryBeef` are also
     absent — these three methods were added to `engine.Storage` after
     b-open-io/overlay's last sync; confirmed absent via
     `grep -rn "FindOutpointsByMerkleState\|ReconcileMerkleRoot\|LoadAncillaryBeef" storage/*.go` → no matches).
   - `storage/mongo.go:157` — `s.beefStore.SaveBeef(ctx, &utxo.Outpoint.Txid, utxo.Beef)`
     fails to compile: `beef.BeefStorage.SaveBeef` (see `beef/{filesystem,junglebus,sqlite,redis}.go`)
     takes `beefBytes []byte`, but `utxo` is `*engine.Output` and
     `engine.Output.Beef` is typed `*transaction.Beef` in v1.3.2 (confirmed via
     `go doc .../engine Output`). Same shape of error recurs at
     `storage/mongo.go:211,238,271,305` for `LoadBeef`'s return value.
   - This same `FindOutpointsByMerkleState`/Beef-type failure pattern was
     independently confirmed by actually building against `v0.1.0`, `v0.2.0`,
     and `v0.2.1` (no local patching needed — their `pubsub` package doesn't
     block the build early the same way, so the real errors surface
     directly). All four tags fail the same way.

4. Conclusion: no published `b-open-io/overlay` tag builds cleanly as an
   `engine.Storage` against `go-overlay-services@v1.3.2`, independent of the
   `pubsub` compile bug. `go.mod` still pins `b-open-io/overlay@v0.3.0` (the
   most recent tag, and the only one that gets past the interface-shape
   issues once the unrelated `pubsub` bug is set aside) because the brief's
   Step 1 explicitly calls for `@latest`, and no better-fitting tag exists —
   but **nothing in `overlay-go` imports it yet**, so this does not block
   `go build ./...` today. Whoever picks up storage (a later task) must
   choose between (i) waiting on/forking a b-open-io fix, or (ii) writing an
   in-repo `engine.Storage` implementation against MongoDB directly. This
   repo does not decide that here — flagging per the brief's instruction.

Constructor names for reference, in case a future task still wants to try
b-open-io/overlay's Mongo-backed storage (e.g. against a patched fork):
`storage.NewMongoEventDataStorage(connString string, beefStore beef.BeefStorage, pubsub pubsub.PubSub) (*MongoEventDataStorage, error)`.
BEEF store: `beef.BeefStorage` interface (see `github.com/b-open-io/overlay/beef`),
concrete constructors include `beef.NewSQLiteBeefStorage`, `beef.NewFilesystemBeefStorage`,
`beef.NewJunglebusBeefStorage`, `beef.NewRedisBeefStorage` (signatures not
reconciled further here since the interface-level blocker above makes this
moot until the Storage question is resolved).

## ctx-propagation verdict: **YES**

`Engine.Submit`'s `ctx` reaches `TopicManager.IdentifyAdmissibleOutputs`
unmodified — no `context.WithValue`, no `context.Background()` reset, no
derived/child context anywhere in the call chain. The exact same `ctx`
variable is threaded through every intermediate call:

```
$(go env GOMODCACHE)/github.com/bsv-blockchain/go-overlay-services@v1.3.2/pkg/core/engine/engine.go
```

- `engine.go:312` — `func (e *Engine) Submit(ctx context.Context, ...)`
- `engine.go:323` — `return e.SubmitParsedBeef(ctx, beef, txid, ...)` (same `ctx`)
- `engine.go:340` — `func (e *Engine) SubmitParsedBeef(ctx context.Context, ...)`
- `engine.go:341` — `return e.submitParsedBeefInternal(ctx, &submitParsedBeefParams{...})` (same `ctx`; note `ctx` is a separate positional arg, not a struct field)
- `engine.go:349` — `func (e *Engine) submitParsedBeefInternal(ctx context.Context, p *submitParsedBeefParams)`
- `engine.go:369` — `if err := e.identifyAdmissibleOutputsPerTopic(ctx, p, managers, inpoints, steak, topicInputs, dupeTopics); err != nil {` (same `ctx`)
- `engine.go:440-441` — `func (e *Engine) identifyAdmissibleOutputsPerTopic(ctx context.Context, p *submitParsedBeefParams, ...)`
- **`engine.go:465`** — `admit, err := managers[t].IdentifyAdmissibleOutputs(ctx, topicBeef, p.Txid, previousCoins)` — the call site, same `ctx` all the way from `Submit`.

**Decision: `ctx propagated: YES` → Task 10 uses the `context.WithValue`
strategy**, not the `sync.Map` fallback.

## Layout

```
overlay-go/
  go.mod
  cmd/overlay/main.go       — entrypoint stub, not wired up
  internal/mandala/doc.go   — package doc; domain-logic port target for later tasks
```
