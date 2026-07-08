// Package httpapi is the HTTP entry point the unchanged TS frontend talks
// to: a Fiber app exposing POST /submit, POST /lookup, the five bespoke
// /admin/* read endpoints (including /admin/activity, Task 17), and
// /health* — all mounted on the same constructor so the global middleware
// (CORS, body limit, 404 fallback) applies uniformly.
package httpapi

import (
	"context"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/overlay/lookup"
	"github.com/gofiber/fiber/v2"

	"github.com/sirdeggen/mandala/overlay-go/internal/wiring"
)

// bodyLimit mirrors the TS overlay's express.raw({limit: '1gb'}) body cap
// (Appendix B §4).
const bodyLimit = 1 << 30

// Lookuper is the narrow slice of *engine.Engine that POST /lookup depends
// on (signature per overlay-go/README.md "Pinned API notes" —
// engine.Lookup). *engine.Engine satisfies it; tests substitute a stub so
// they never need Mongo or real lookup services.
type Lookuper interface {
	Lookup(ctx context.Context, question *lookup.LookupQuestion) (*lookup.LookupAnswer, error)
}

var _ Lookuper = (*engine.Engine)(nil)

// New builds the production Fiber app from a fully wired App (Mongo, the
// engine, topic/lookup services already constructed by wiring.Build).
// /arc-ingest is mounted only when Task 16's Arcade wiring set
// app.ArcadeEnabled (WithArcade below). /admin/activity (Task 17) is always
// mounted — app.Store and app.FindRawTxs are unconditionally wired
// regardless of Arcade.
func New(app *wiring.App) *fiber.App {
	opts := []ServerOption{WithActivity(app.Store, app.FindRawTxs)}
	if app.ArcadeEnabled {
		opts = append(opts,
			WithArcade(app.Engine, app.ArcadeCallbackToken, app.EvictTx),
			WithBroadcastCompensation(app.PrepareSubmitCompensation))
	}
	return newServer(app.Engine, app.Engine, app.Store, func(ctx context.Context) error {
		return app.Mongo.Client().Ping(ctx, nil)
	}, opts...)
}

// serverOptions carries newServer's optional seams — Arcade's /arc-ingest
// route with its terminal-status eviction hook (Tasks 16/18) and the
// submit broadcast-failure compensation seam (Task 18). A struct (rather
// than more positional params) keeps every pre-Task-16 newServer call site
// source-compatible.
type serverOptions struct {
	arcadeEnabled       bool
	merkleHandler       MerkleProofHandler
	arcCallbackToken    string
	evictTx             EvictTx
	prepareCompensation PrepareSubmitCompensation
	activityLinkage     ActivityLinkage
	activityFindRawTxs  FindRawTxsFunc
}

// ServerOption customizes newServer without changing its required
// parameters (mirrors wiring.Option's shape/rationale).
type ServerOption func(*serverOptions)

// WithArcade mounts POST /arc-ingest, delegating merkle-proof ingestion to
// handler and gating requests behind callbackToken when it's non-empty
// (empty disables the token check, matching OverlayExpress.ts's default).
// evict handles terminal txStatus callbacks (nil degrades to log-only).
func WithArcade(handler MerkleProofHandler, callbackToken string, evict EvictTx) ServerOption {
	return func(o *serverOptions) {
		o.arcadeEnabled = true
		o.merkleHandler = handler
		o.arcCallbackToken = callbackToken
		o.evictTx = evict
	}
}

// WithBroadcastCompensation threads the pre-Submit snapshot / post-failure
// compensation closure into POST /submit (see PrepareSubmitCompensation).
func WithBroadcastCompensation(prepare PrepareSubmitCompensation) ServerOption {
	return func(o *serverOptions) {
		o.prepareCompensation = prepare
	}
}

// WithActivity mounts GET /admin/activity (Task 17), reading linkage rows
// through linkage and raw tx hex through findRawTxs. Kept as an option
// rather than a required newServer parameter so the package's many existing
// stub-based tests don't all need updating; New(app) always supplies it in
// production.
func WithActivity(linkage ActivityLinkage, findRawTxs FindRawTxsFunc) ServerOption {
	return func(o *serverOptions) {
		o.activityLinkage = linkage
		o.activityFindRawTxs = findRawTxs
	}
}

// newServer assembles the Fiber app from narrow per-route interfaces
// (Submitter, Lookuper, AdminStore, Pinger) so tests can stub dependencies
// without a wiring.App or a live Mongo connection. The global middleware
// wraps whatever routes are registered.
func newServer(submitter Submitter, lookuper Lookuper, store AdminStore, ping Pinger, opts ...ServerOption) *fiber.App {
	var o serverOptions
	for _, opt := range opts {
		opt(&o)
	}

	f := fiber.New(fiber.Config{
		BodyLimit: bodyLimit,
	})

	f.Use(corsMiddleware)

	registerSubmitRoutes(f, submitter, o.prepareCompensation)
	registerLookupRoutes(f, lookuper)
	registerAdminRoutes(f, store)
	registerHealthRoutes(f, ping)
	if o.activityLinkage != nil {
		registerActivityRoute(f, o.activityLinkage, o.activityFindRawTxs)
	}
	if o.arcadeEnabled {
		registerArcIngestRoutes(f, o.merkleHandler, o.arcCallbackToken, o.evictTx)
	}

	// Registered last: Fiber falls through to this catch-all only when no
	// earlier route matched the method+path, giving the TS-shaped 404 body
	// instead of Fiber's default plain-text response (Appendix B §4).
	f.Use(notFoundMiddleware)

	return f
}

// corsMiddleware sets wildcard CORS headers on every response and
// short-circuits OPTIONS preflight requests with 200 (Appendix B §4) — the
// browser's custom-header preflight (X-Topics, x-includes-off-chain-values,
// X-Aggregation) fails without this.
func corsMiddleware(c *fiber.Ctx) error {
	c.Set("Access-Control-Allow-Origin", "*")
	c.Set("Access-Control-Allow-Headers", "*")
	c.Set("Access-Control-Allow-Methods", "*")
	c.Set("Access-Control-Expose-Headers", "*")
	c.Set("Access-Control-Allow-Private-Network", "true")

	if c.Method() == fiber.MethodOptions {
		return c.SendStatus(fiber.StatusOK)
	}
	return c.Next()
}

// notFoundMiddleware answers any request no earlier route matched with the
// TS overlay's exact 404 shape (Appendix B §4).
func notFoundMiddleware(c *fiber.Ctx) error {
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
		"status":      "error",
		"code":        "ERR_ROUTE_NOT_FOUND",
		"description": "Route not found.",
	})
}
