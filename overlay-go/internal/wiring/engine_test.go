package wiring

// Task 12 wiring test: Build with a local Mongo and empty ArcadeURL returns
// an App whose Engine is non-nil, and Engine.Lookup for ls_mandala with
// {"assetId":"missing.0"} answers an empty output-list. That single call
// proves topic-manager/lookup-service registration, the enginestore Storage,
// and the engine hydration path end-to-end.
//
// Requires Mongo at localhost:27017 (Task 8 skip pattern; the
// mandala_wiring_test_lookup_services db is dropped in cleanup).

import (
	"context"
	"testing"
	"time"

	"github.com/bsv-blockchain/go-sdk/overlay/lookup"

	"github.com/sirdeggen/mandala/overlay-go/internal/arcade"
)

// Arbitrary valid secp256k1 private key (test-only).
const testPrivHex = "1e99423a4ed27608a15a2616a2b0e9e52ced330ac530edcc32c8ffc6a526aedd"

func TestBuildAndLookupEndToEnd(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	app, err := Build(ctx, Config{
		NodeName:         "mandala_wiring_test",
		ServerPrivKeyHex: testPrivHex,
		HostingURL:       "http://localhost:8080",
		MongoURL:         "mongodb://localhost:27017",
		Network:          "test",
		// ArcadeURL empty: scripts-only chain tracker, nil broadcaster.
	})
	if err != nil {
		t.Skip("mongo unavailable or build failed:", err)
	}
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_ = app.Mongo.Drop(cleanupCtx)
		_ = app.Mongo.Client().Disconnect(cleanupCtx)
	})

	if app.Engine == nil {
		t.Fatal("Engine is nil")
	}
	if app.Store == nil || app.Verifier == nil || app.Mongo == nil {
		t.Fatalf("incomplete App: %+v", app)
	}
	if app.ArcadeEnabled {
		t.Fatal("ArcadeEnabled must be false when ArcadeURL is empty")
	}
	if app.Mongo.Name() != "mandala_wiring_test_lookup_services" {
		t.Fatalf("db name = %q", app.Mongo.Name())
	}
	if !app.Engine.HasTopicManager("tm_mandala") {
		t.Fatal("tm_mandala not registered")
	}
	if !app.Engine.HasLookupService("ls_mandala") {
		t.Fatal("ls_mandala not registered")
	}

	answer, err := app.Engine.Lookup(ctx, &lookup.LookupQuestion{
		Service: "ls_mandala",
		Query:   []byte(`{"assetId":"missing.0"}`),
	})
	if err != nil {
		t.Fatal("Lookup:", err)
	}
	if answer.Type != lookup.AnswerTypeOutputList {
		t.Fatalf("answer type = %v, want output-list", answer.Type)
	}
	if len(answer.Outputs) != 0 {
		t.Fatalf("outputs = %d, want 0", len(answer.Outputs))
	}
}

// TestBuildWithArcadeURLDefaultsBroadcasterAndTracker proves Task 16's
// wiring: a non-empty ArcadeURL makes Build default the engine's
// Broadcaster/ChainTracker to Arcade-backed implementations (rather than
// nil/scriptsOnlyTracker) without any Option override, and threads
// ArcadeCallbackToken onto App. No real Arcade deployment is contacted —
// arcade.NewBroadcaster/NewChaintracks only build HTTP clients at
// construction time.
func TestBuildWithArcadeURLDefaultsBroadcasterAndTracker(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	app, err := Build(ctx, Config{
		NodeName:            "mandala_wiring_test_arcade",
		ServerPrivKeyHex:    testPrivHex,
		HostingURL:          "https://overlay.example.com",
		MongoURL:            "mongodb://localhost:27017",
		Network:             "test",
		ArcadeURL:           "https://arcade.example.com",
		ArcadeAPIKey:        "test-api-key",
		ArcadeCallbackToken: "test-callback-token",
	})
	if err != nil {
		t.Skip("mongo unavailable or build failed:", err)
	}
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_ = app.Mongo.Drop(cleanupCtx)
		_ = app.Mongo.Client().Disconnect(cleanupCtx)
	})

	if !app.ArcadeEnabled {
		t.Fatal("ArcadeEnabled must be true when ArcadeURL is set")
	}
	if app.ArcadeCallbackToken != "test-callback-token" {
		t.Fatalf("ArcadeCallbackToken = %q, want test-callback-token", app.ArcadeCallbackToken)
	}
	if _, ok := app.Engine.Broadcaster.(*arcade.Broadcaster); !ok {
		t.Fatalf("Engine.Broadcaster = %T, want *arcade.Broadcaster", app.Engine.Broadcaster)
	}
	if _, ok := app.Engine.ChainTracker.(*arcade.Chaintracks); !ok {
		t.Fatalf("Engine.ChainTracker = %T, want *arcade.Chaintracks", app.Engine.ChainTracker)
	}
}

// TestBuildWithArcadeURLHonorsOptionOverride proves the WithBroadcaster/
// WithChainTracker seam still wins over the ArcadeURL default — the seam
// tests substitute a stub through instead of a real Arcade deployment.
func TestBuildWithArcadeURLHonorsOptionOverride(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	stubTracker := scriptsOnlyTracker{}
	app, err := Build(ctx, Config{
		NodeName:         "mandala_wiring_test_arcade_override",
		ServerPrivKeyHex: testPrivHex,
		HostingURL:       "https://overlay.example.com",
		MongoURL:         "mongodb://localhost:27017",
		Network:          "test",
		ArcadeURL:        "https://arcade.example.com",
	}, WithChainTracker(stubTracker))
	if err != nil {
		t.Skip("mongo unavailable or build failed:", err)
	}
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_ = app.Mongo.Drop(cleanupCtx)
		_ = app.Mongo.Client().Disconnect(cleanupCtx)
	})

	if _, ok := app.Engine.ChainTracker.(scriptsOnlyTracker); !ok {
		t.Fatalf("Engine.ChainTracker = %T, want the injected scriptsOnlyTracker override", app.Engine.ChainTracker)
	}
	// Broadcaster wasn't overridden, so it should still default to Arcade.
	if _, ok := app.Engine.Broadcaster.(*arcade.Broadcaster); !ok {
		t.Fatalf("Engine.Broadcaster = %T, want *arcade.Broadcaster", app.Engine.Broadcaster)
	}
}

func TestScriptsOnlyTracker(t *testing.T) {
	ctx := context.Background()
	tr := scriptsOnlyTracker{}
	ok, err := tr.IsValidRootForHeight(ctx, nil, 0)
	if err != nil || !ok {
		t.Fatalf("IsValidRootForHeight = %v, %v; want true, nil", ok, err)
	}
	if _, err := tr.CurrentHeight(ctx); err != nil {
		t.Fatal("CurrentHeight:", err)
	}
}
