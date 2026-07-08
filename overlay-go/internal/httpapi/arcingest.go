package httpapi

import (
	"context"
	"log"
	"strings"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/transaction"
	"github.com/gofiber/fiber/v2"

	"github.com/sirdeggen/mandala/overlay-go/internal/arcade"
)

// MerkleProofHandler is the narrow slice of *engine.Engine that POST
// /arc-ingest depends on for proof ingestion (engine.HandleNewMerkleProof
// per overlay-go/README.md "Pinned API notes"). *engine.Engine satisfies
// it; tests substitute a stub so they never need Mongo or a real engine.
type MerkleProofHandler interface {
	HandleNewMerkleProof(ctx context.Context, txid *chainhash.Hash, proof *transaction.MerklePath) error
}

var _ MerkleProofHandler = (*engine.Engine)(nil)

// registerArcIngestRoutes wires POST /arc-ingest (OverlayExpress.ts
// ~1578-1653) — the Arcade broadcast-status/proof callback. Callers
// register this only when Arcade is configured (see WithArcade); a
// non-empty callbackToken gates every request behind
// "Authorization: Bearer <token>" or "x-callback-token: <token>".
func registerArcIngestRoutes(f *fiber.App, h MerkleProofHandler, callbackToken string) {
	f.Post("/arc-ingest", arcIngestHandler(h, callbackToken))
}

// arcIngestBody mirrors the JSON body Arcade posts to /arc-ingest
// (OverlayExpress.ts destructures txid, merklePath, blockHeight, txStatus,
// extraInfo from req.body).
type arcIngestBody struct {
	Txid        string `json:"txid"`
	MerklePath  string `json:"merklePath"`
	BlockHeight *int64 `json:"blockHeight"`
	TxStatus    string `json:"txStatus"`
	ExtraInfo   string `json:"extraInfo"`
}

// arcIngestHandler implements OverlayExpress.ts's /arc-ingest route: token
// check, then classify by txStatus/merklePath presence.
//
// A terminal txStatus is logged and acknowledged (200) rather than fed to
// an eviction call: go-overlay-services v1.3.2's *engine.Engine exposes no
// evictAppliedTransaction (or evict/delete-shaped) public method — that
// call is a BASMCapableEngine extension unique to this project's TS fork of
// @bsv/overlay, not part of the upstream engine either TS or Go builds on
// (see task-16-report.md). Nothing in this handler evicts state; it simply
// stops Arcade from retrying the callback.
func arcIngestHandler(h MerkleProofHandler, callbackToken string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if callbackToken != "" && !hasValidCallbackToken(c, callbackToken) {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"status":  "error",
				"message": "Unauthorized callback",
			})
		}

		var body arcIngestBody
		if err := c.BodyParser(&body); err != nil {
			return errorResponse(c, fiber.StatusBadRequest, "invalid request body: "+err.Error())
		}
		if body.Txid == "" {
			return errorResponse(c, fiber.StatusBadRequest, "Provider callback is missing txid")
		}

		if arcade.IsTerminalStatus(body.TxStatus, body.ExtraInfo) {
			log.Printf("arc-ingest: terminal status %q for txid %s (no engine eviction hook available)", body.TxStatus, body.Txid)
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"status":  "success",
				"message": "Terminal transaction status received",
			})
		}

		if body.MerklePath == "" {
			return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
				"status":  "success",
				"message": "Transaction status received without proof",
			})
		}

		txid, err := chainhash.NewHashFromHex(body.Txid)
		if err != nil {
			return errorResponse(c, fiber.StatusBadRequest, "invalid txid: "+err.Error())
		}
		proof, err := transaction.NewMerklePathFromHex(body.MerklePath)
		if err != nil {
			return errorResponse(c, fiber.StatusBadRequest, "invalid merklePath: "+err.Error())
		}
		if err := h.HandleNewMerkleProof(c.UserContext(), txid, proof); err != nil {
			return errorResponse(c, fiber.StatusBadRequest, err.Error())
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":  "success",
			"message": "Transaction status updated",
		})
	}
}

// hasValidCallbackToken checks the Authorization: Bearer <token> and
// x-callback-token: <token> header forms Arcade may present (either one
// matching is sufficient), mirroring OverlayExpress.ts's /arc-ingest token
// check.
func hasValidCallbackToken(c *fiber.Ctx, token string) bool {
	auth := c.Get(fiber.HeaderAuthorization)
	bearer := strings.TrimPrefix(auth, "Bearer ")
	if bearer == token {
		return true
	}
	return c.Get("x-callback-token") == token
}
