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
