// Package wiring assembles the mandala overlay engine: Mongo, the mandala
// domain store/verifier, tm_mandala + ls_mandala, the in-repo engine.Storage
// (enginestore) and the chain tracker/broadcaster seams Task 16 fills with
// Arcade implementations. No advertiser, no GASP sync config (GASP off).
package wiring

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/overlay"
	"github.com/bsv-blockchain/go-sdk/transaction"
	"github.com/bsv-blockchain/go-sdk/transaction/chaintracker"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/sirdeggen/mandala/overlay-go/internal/arcade"
	"github.com/sirdeggen/mandala/overlay-go/internal/enginestore"
	"github.com/sirdeggen/mandala/overlay-go/internal/mandala"
)

// defaultChaintracksPrefix mirrors overlay/src/index.ts's
// `process.env.CHAINTRACKS_API_PREFIX ?? '/v2'`.
const defaultChaintracksPrefix = "/v2"

// Config is the node configuration (mirrors the TS overlay's env surface —
// overlay/src/index.ts's ARCADE_URL/ARCADE_API_KEY/CHAINTRACKS_URL/
// CHAINTRACKS_API_PREFIX). ArcadeCallbackURL/ArcadeCallbackToken have no TS
// env-var counterpart in that file (it never calls configureArcCallbackToken
// and lets OverlayExpress derive callbackUrl from its own advertisable
// FQDN); leaving both empty here reproduces that no-token, no-callback-url
// default.
type Config struct {
	NodeName            string
	ServerPrivKeyHex    string
	HostingURL          string
	MongoURL            string
	Network             string
	ArcadeURL           string
	ArcadeAPIKey        string
	ArcadeCallbackURL   string
	ArcadeCallbackToken string
	ChaintracksURL      string
	ChaintracksPrefix   string
}

// App is the wired application: the overlay engine plus the mandala domain
// handles the HTTP layer (Task 13) serves from.
type App struct {
	Engine              *engine.Engine
	Store               *mandala.Store
	Verifier            *mandala.Verifier
	Mongo               *mongo.Database
	ArcadeEnabled       bool
	ArcadeCallbackToken string

	// PrepareSubmitCompensation compensates for the pinned v1.3.2 engine's
	// submit ordering (inputs marked spent + mandala projections destroyed
	// BEFORE broadcast; a failed broadcast aborts without unwinding). The
	// submit handler calls it with the raw BEEF before Engine.Submit; the
	// returned closure — run only on a broadcast-classified Submit error —
	// unmarks the engine-side spends (UnmarkSpentBySpendTxid) and restores
	// the snapshotted mandala token rows/balances (RestoreTokens). Set only
	// when Arcade is enabled (without a broadcaster, broadcast cannot fail).
	PrepareSubmitCompensation func(ctx context.Context, beef []byte) (func(context.Context) error, error)

	// EvictTx implements the TS /arc-ingest route's
	// Engine.evictAppliedTransaction for terminal Arcade statuses: notify
	// ls_mandala's OutputEvicted for each of the txid's outputs, then delete
	// the engine's output docs and applied-transaction records. Set only
	// when Arcade is enabled (the /arc-ingest route is only mounted then).
	EvictTx func(ctx context.Context, txid string) error
}

// buildOptions carries the Task 16 injection seams.
type buildOptions struct {
	broadcaster transaction.Broadcaster
	tracker     chaintracker.ChainTracker
}

// Option customizes Build without changing its signature (Task 12 lands with
// nils; Task 16 injects the Arcade broadcaster and chaintracks tracker).
type Option func(*buildOptions)

// WithBroadcaster injects a transaction broadcaster (Task 16: Arcade,
// broadcast-before-fold, failure rejects the submit).
func WithBroadcaster(b transaction.Broadcaster) Option {
	return func(o *buildOptions) { o.broadcaster = b }
}

// WithChainTracker injects a chain tracker (Task 16: chaintracks client).
func WithChainTracker(ct chaintracker.ChainTracker) Option {
	return func(o *buildOptions) { o.tracker = ct }
}

// scriptsOnlyTracker is the permissive ChainTracker used when no Arcade is
// configured — the Go mirror of the TS engine's 'scripts only' mode: every
// merkle root is accepted, so SPV degrades to script checks.
type scriptsOnlyTracker struct{}

var _ chaintracker.ChainTracker = scriptsOnlyTracker{}

// IsValidRootForHeight always accepts.
func (scriptsOnlyTracker) IsValidRootForHeight(context.Context, *chainhash.Hash, uint32) (bool, error) {
	return true, nil
}

// CurrentHeight reports 0 — nothing in the engine consults it, and 'scripts
// only' mode has no chain view to answer from.
func (scriptsOnlyTracker) CurrentHeight(context.Context) (uint32, error) {
	return 0, nil
}

// Build connects Mongo (db ${NodeName}_lookup_services — same db handle for
// the mandala Store and the engine storage), wires tm_mandala/ls_mandala and
// returns the assembled App. With an empty ArcadeURL the chain tracker is
// scripts-only and the broadcaster nil. With a non-empty ArcadeURL, Build
// defaults the tracker/broadcaster to Arcade-backed implementations
// (overlay/src/index.ts's ARCADE_URL branch) unless opts already injected
// them — the WithBroadcaster/WithChainTracker seam exists so tests can
// substitute a stub instead of hitting a real Arcade deployment.
func Build(ctx context.Context, cfg Config, opts ...Option) (*App, error) {
	var o buildOptions
	for _, opt := range opts {
		opt(&o)
	}

	if cfg.ArcadeURL != "" {
		if o.broadcaster == nil {
			callbackURL := cfg.ArcadeCallbackURL
			if callbackURL == "" && cfg.HostingURL != "" {
				callbackURL = strings.TrimRight(cfg.HostingURL, "/") + "/arc-ingest"
			}
			o.broadcaster = arcade.NewBroadcaster(cfg.ArcadeURL, cfg.ArcadeAPIKey, callbackURL, cfg.ArcadeCallbackToken, nil)
		}
		if o.tracker == nil {
			chaintracksURL := cfg.ChaintracksURL
			if chaintracksURL == "" {
				chaintracksURL = strings.TrimRight(cfg.ArcadeURL, "/") + "/chaintracks"
			}
			prefix := cfg.ChaintracksPrefix
			if prefix == "" {
				prefix = defaultChaintracksPrefix
			}
			o.tracker = arcade.NewChaintracks(chaintracksURL, prefix, nil)
		}
	}

	client, err := mongo.Connect(options.Client().ApplyURI(cfg.MongoURL))
	if err != nil {
		return nil, fmt.Errorf("wiring: mongo connect: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("wiring: mongo ping: %w", err)
	}
	db := client.Database(cfg.NodeName + "_lookup_services")

	store := mandala.NewStore(db)
	verifier, err := mandala.NewVerifier(cfg.ServerPrivKeyHex)
	if err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("wiring: verifier: %w", err)
	}
	adminWallet, err := mandala.NewAdminWallet(cfg.ServerPrivKeyHex)
	if err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("wiring: admin wallet: %w", err)
	}

	tm := mandala.NewTopicManager(verifier, adminWallet, mandala.NoSanctions{}, store)
	ls := mandala.NewLookupService(verifier, store)

	tracker := o.tracker
	if tracker == nil {
		tracker = scriptsOnlyTracker{}
	}

	es := enginestore.New(db)
	eng := engine.NewEngine(&engine.Config{
		Managers:       map[string]engine.TopicManager{"tm_mandala": tm},
		LookupServices: map[string]engine.LookupService{"ls_mandala": ls},
		Storage:        es,
		ChainTracker:   tracker,
		Broadcaster:    o.broadcaster,
		HostingURL:     cfg.HostingURL,
	})

	app := &App{
		Engine:              eng,
		Store:               store,
		Verifier:            verifier,
		Mongo:               db,
		ArcadeEnabled:       cfg.ArcadeURL != "",
		ArcadeCallbackToken: cfg.ArcadeCallbackToken,
	}
	if app.ArcadeEnabled {
		app.PrepareSubmitCompensation = prepareSubmitCompensation(store, es)
		app.EvictTx = evictTx(es, ls)
	}
	return app, nil
}

// prepareSubmitCompensation builds the App.PrepareSubmitCompensation closure
// over the mandala store (token-row snapshot/restore) and the concrete
// engine store (spend unmarking) — the two projections the pinned engine
// mutates before a broadcast can fail (see App.PrepareSubmitCompensation).
func prepareSubmitCompensation(store *mandala.Store, es *enginestore.Store) func(context.Context, []byte) (func(context.Context) error, error) {
	return func(ctx context.Context, beefBytes []byte) (func(context.Context) error, error) {
		_, tx, txid, err := transaction.ParseBeef(beefBytes)
		if err != nil || tx == nil {
			// Engine.Submit parses the same bytes first thing and will
			// reject them before markSpentAndNotify runs — nothing will be
			// mutated, so there is nothing to compensate.
			return nil, nil
		}
		outpoints := make([]mandala.Outpoint, 0, len(tx.Inputs))
		for _, in := range tx.Inputs {
			if in.SourceTXID == nil {
				continue
			}
			outpoints = append(outpoints, mandala.Outpoint{Txid: in.SourceTXID.String(), OutputIndex: in.SourceTxOutIndex})
		}
		snapshot, err := store.SnapshotTokens(ctx, outpoints)
		if err != nil {
			return nil, fmt.Errorf("wiring: snapshot token rows for %s: %w", txid.String(), err)
		}
		spendTxid := txid.String()
		return func(ctx context.Context) error {
			// A duplicate resubmit of an already-committed tx can reach this
			// closure too: go-overlay-services v1.3.2's per-topic dupe gate
			// lets a resubmit past validation, and a broadcast failure on
			// THAT attempt is classified the same as a genuine one. But a
			// genuine broadcast failure can never have an applied-transaction
			// record for this txid — commitAdmittedOutputs (which writes it)
			// only runs after a successful broadcast. If the record exists,
			// the original submit already committed: unmarking the spend and
			// restoring the snapshotted token rows here would corrupt that
			// committed state (resurrecting rows the original commit
			// correctly deleted, flipping its retained input back to
			// unspent). Skip compensation entirely in that case.
			committed, err := es.DoesAppliedTransactionExist(ctx, &overlay.AppliedTransaction{
				Txid:  txid,
				Topic: "tm_mandala",
			})
			if err != nil {
				return fmt.Errorf("wiring: check applied-transaction record for %s: %w", spendTxid, err)
			}
			if committed {
				log.Printf("wiring: skipping compensation: tx already committed (duplicate resubmit): %s", spendTxid)
				return nil
			}
			if _, err := es.UnmarkSpentBySpendTxid(ctx, spendTxid); err != nil {
				return fmt.Errorf("wiring: unmark spends of %s: %w", spendTxid, err)
			}
			if err := store.RestoreTokens(ctx, snapshot); err != nil {
				return fmt.Errorf("wiring: restore token rows spent by %s: %w", spendTxid, err)
			}
			return nil
		}, nil
	}
}

// evictTx builds the App.EvictTx closure: the Go equivalent of the TS
// Engine.evictAppliedTransaction (notify OutputEvicted per output, then
// delete the outputs and the applied-transaction records), assembled from
// the concrete stores because the pinned engine exposes no eviction API.
func evictTx(es *enginestore.Store, ls *mandala.LookupService) func(context.Context, string) error {
	return func(ctx context.Context, txid string) error {
		outpoints, err := es.FindOutputsByTxid(ctx, txid)
		if err != nil {
			return fmt.Errorf("wiring: find outputs of %s: %w", txid, err)
		}
		for _, op := range outpoints {
			if err := ls.OutputEvicted(ctx, op); err != nil {
				return fmt.Errorf("wiring: notify eviction of %s: %w", op.String(), err)
			}
		}
		if err := es.DeleteOutputsByTxid(ctx, txid); err != nil {
			return fmt.Errorf("wiring: delete outputs of %s: %w", txid, err)
		}
		if err := es.DeleteAppliedTransactionsByTxid(ctx, txid); err != nil {
			return fmt.Errorf("wiring: delete applied tx records of %s: %w", txid, err)
		}
		return nil
	}
}
