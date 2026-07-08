package httpapi

import (
	"context"
	"net/url"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/sirdeggen/mandala/overlay-go/internal/mandala"
)

// AdminStore is the narrow slice of *mandala.Store the /admin/* GET routes
// depend on (Appendix B §3). *mandala.Store satisfies it; tests substitute
// a stub so they never need Mongo.
type AdminStore interface {
	GetAssetState(ctx context.Context, assetID string) (mandala.AssetAdminState, error)
	FindAdminHistoryByAssetID(ctx context.Context, assetID string) ([]mandala.AdminHistoryEntry, error)
	PageAdminHistory(ctx context.Context, assetID string, limit, offset int64) ([]mandala.AdminHistoryEntry, error)
	AdminSummary(ctx context.Context, assetID string) (totalIssued, totalRedeemed, actionCount int64, err error)
}

var _ AdminStore = (*mandala.Store)(nil)

// Pinger is the narrow dependency /health/ready needs to prove Mongo
// connectivity. wiring wires this to app.Mongo.Client().Ping; tests inject
// a stub func so they never need a live Mongo connection.
type Pinger func(ctx context.Context) error

// registerAdminRoutes wires the four bespoke admin GET endpoints (Appendix B
// §3a-3d). /admin/activity (Appendix B §3e, Task 17) is registered
// separately via the WithActivity ServerOption (see server.go/activity.go)
// since it depends on the engine's raw-tx store, not just AdminStore.
func registerAdminRoutes(f *fiber.App, store AdminStore) {
	f.Get("/admin/asset-state/:assetId", assetStateHandler(store))
	f.Get("/admin/admin-history/:assetId", adminHistoryHandler(store))
	f.Get("/admin/admin-history-page/:assetId", adminHistoryPageHandler(store))
	f.Get("/admin/admin-summary/:assetId", adminSummaryHandler(store))
}

// registerHealthRoutes wires /health, /health/live (always ok — the process
// is up) and /health/ready (pings Mongo; 503 on failure). This is a
// simplified stand-in for OverlayExpress's full health-report machinery —
// the frontend never calls these routes (Appendix B §3 lists only the 5
// bespoke admin/lookup/submit calls), so the minimal {"status":...} shape
// the task calls for is all that's needed here.
func registerHealthRoutes(f *fiber.App, ping Pinger) {
	f.Get("/health", healthOKHandler)
	f.Get("/health/live", healthOKHandler)
	f.Get("/health/ready", healthReadyHandler(ping))
}

func healthOKHandler(c *fiber.Ctx) error {
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "ok"})
}

func healthReadyHandler(ping Pinger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if ping != nil {
			ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
			defer cancel()
			if err := ping(ctx); err != nil {
				return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "error"})
			}
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "ok"})
	}
}

// assetIDParam extracts and URL-decodes the :assetId path segment. Fiber's
// c.Params returns the RAW path segment (no automatic percent-decoding);
// assetIds are txid.vout pairs containing a literal '.' that
// encodeURIComponent may or may not have escaped (e.g. "ab..ab%2E0" for
// "ab..ab.0"), so both the plain and percent-encoded forms must resolve to
// the same store key.
func assetIDParam(c *fiber.Ctx) (string, error) {
	return url.PathUnescape(c.Params("assetId"))
}

// adminErrorResponse mirrors overlay/src/index.ts's 500 {"error": String(e)}
// shape used by every /admin/* GET route — deliberately different from
// /submit and /lookup's 400 {"status","message"} shape (Appendix B §3).
func adminErrorResponse(c *fiber.Ctx, err error) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
}

func assetStateHandler(store AdminStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if store == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "store unavailable"})
		}
		assetID, err := assetIDParam(c)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		state, err := store.GetAssetState(c.UserContext(), assetID)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		return c.Status(fiber.StatusOK).JSON(state)
	}
}

func adminHistoryHandler(store AdminStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if store == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "store unavailable"})
		}
		assetID, err := assetIDParam(c)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		rows, err := store.FindAdminHistoryByAssetID(c.UserContext(), assetID)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		return c.Status(fiber.StatusOK).JSON(nonNilHistory(rows))
	}
}

// adminHistoryPageHandler implements Appendix B §3c. Query params are
// parsed here and handed to the store un-clamped (aside from the
// missing/unparseable -> 0 fallback, which the store's own clamp already
// maps to its 100 default) — Store.PageAdminHistory owns the [1,500] limit
// clamp and the >=0 offset clamp (overlay-go/internal/mandala/storage.go),
// so this handler does not duplicate that logic.
func adminHistoryPageHandler(store AdminStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if store == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "store unavailable"})
		}
		assetID, err := assetIDParam(c)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		limit := queryInt64(c, "limit")
		offset := queryInt64(c, "offset")
		rows, err := store.PageAdminHistory(c.UserContext(), assetID, limit, offset)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		return c.Status(fiber.StatusOK).JSON(nonNilHistory(rows))
	}
}

func adminSummaryHandler(store AdminStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if store == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "store unavailable"})
		}
		assetID, err := assetIDParam(c)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		issued, redeemed, count, err := store.AdminSummary(c.UserContext(), assetID)
		if err != nil {
			return adminErrorResponse(c, err)
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"totalIssued":   issued,
			"totalRedeemed": redeemed,
			"actionCount":   count,
		})
	}
}

// nonNilHistory normalizes a nil history slice to an empty one — the wire
// contract requires JSON `[]`, never `null` (Appendix B §3b/§3c).
func nonNilHistory(rows []mandala.AdminHistoryEntry) []mandala.AdminHistoryEntry {
	if rows == nil {
		return []mandala.AdminHistoryEntry{}
	}
	return rows
}

// queryInt64 parses an integer query param, returning 0 (the store's
// "use the default" sentinel) when absent or unparseable — matching the TS
// route's `Number(req.query.limit ?? 100) || 100` behavior for the missing
// and NaN cases.
func queryInt64(c *fiber.Ctx, key string) int64 {
	raw := c.Query(key)
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return n
}
