// Package httpapi is the HTTP entry point the unchanged TS frontend talks
// to: a Fiber app exposing POST /submit (this task) plus, in later tasks,
// /lookup and the /admin/* read endpoints — all mounted on the same
// constructor so the global middleware (CORS, body limit, 404 fallback)
// applies uniformly.
package httpapi

import (
	"github.com/gofiber/fiber/v2"

	"github.com/sirdeggen/mandala/overlay-go/internal/wiring"
)

// bodyLimit mirrors the TS overlay's express.raw({limit: '1gb'}) body cap
// (Appendix B §4).
const bodyLimit = 1 << 30

// New builds the production Fiber app from a fully wired App (Mongo, the
// engine, topic/lookup services already constructed by wiring.Build).
func New(app *wiring.App) *fiber.App {
	return newServer(app.Engine)
}

// newServer assembles the Fiber app from narrow per-route interfaces
// (currently just Submitter) so tests can stub dependencies without a
// wiring.App or a live Mongo connection. Later tasks add their own
// registerXRoutes call here (and extend this parameter list) for
// /lookup and /admin/*; the global middleware wraps whatever routes are
// registered.
func newServer(submitter Submitter) *fiber.App {
	f := fiber.New(fiber.Config{
		BodyLimit: bodyLimit,
	})

	f.Use(corsMiddleware)

	registerSubmitRoutes(f, submitter)

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
