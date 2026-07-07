// Package wiring assembles the mandala overlay engine: Mongo, the mandala
// domain store/verifier, tm_mandala + ls_mandala, the in-repo engine.Storage
// (enginestore) and the chain tracker/broadcaster seams Task 16 fills with
// Arcade implementations. No advertiser, no GASP sync config (GASP off).
package wiring

import (
	"context"
	"fmt"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/transaction"
	"github.com/bsv-blockchain/go-sdk/transaction/chaintracker"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/sirdeggen/mandala/overlay-go/internal/enginestore"
	"github.com/sirdeggen/mandala/overlay-go/internal/mandala"
)

// Config is the node configuration (mirrors the TS overlay's env surface).
type Config struct {
	NodeName          string
	ServerPrivKeyHex  string
	HostingURL        string
	MongoURL          string
	Network           string
	ArcadeURL         string
	ArcadeAPIKey      string
	ChaintracksURL    string
	ChaintracksPrefix string
}

// App is the wired application: the overlay engine plus the mandala domain
// handles the HTTP layer (Task 13) serves from.
type App struct {
	Engine        *engine.Engine
	Store         *mandala.Store
	Verifier      *mandala.Verifier
	Mongo         *mongo.Database
	ArcadeEnabled bool
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
// scripts-only and the broadcaster nil, unless options inject otherwise.
func Build(ctx context.Context, cfg Config, opts ...Option) (*App, error) {
	var o buildOptions
	for _, opt := range opts {
		opt(&o)
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

	eng := engine.NewEngine(&engine.Config{
		Managers:       map[string]engine.TopicManager{"tm_mandala": tm},
		LookupServices: map[string]engine.LookupService{"ls_mandala": ls},
		Storage:        enginestore.New(db),
		ChainTracker:   tracker,
		Broadcaster:    o.broadcaster,
		HostingURL:     cfg.HostingURL,
	})

	return &App{
		Engine:        eng,
		Store:         store,
		Verifier:      verifier,
		Mongo:         db,
		ArcadeEnabled: cfg.ArcadeURL != "",
	}, nil
}
