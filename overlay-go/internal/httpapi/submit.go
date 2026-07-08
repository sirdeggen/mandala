package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"log"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/overlay"
	"github.com/gofiber/fiber/v2"

	"github.com/sirdeggen/mandala/overlay-go/internal/arcade"
	"github.com/sirdeggen/mandala/overlay-go/internal/mandala"
)

// Submitter is the narrow slice of *engine.Engine that POST /submit
// depends on (signature per overlay-go/README.md "Pinned API notes" —
// engine.Submit, including the upstream SumbitMode typo). *engine.Engine
// satisfies it; tests substitute a stub so they never need Mongo or real
// topic managers.
type Submitter interface {
	Submit(ctx context.Context, taggedBEEF overlay.TaggedBEEF, mode engine.SumbitMode, onSteakReady engine.OnSteakReady) (overlay.Steak, error)
}

var _ Submitter = (*engine.Engine)(nil)

// PrepareSubmitCompensation is the Arcade-path compensation seam for the
// pinned go-overlay-services v1.3.2 engine's submit ordering (validate →
// mark inputs spent + notify OutputSpent → broadcast → fold): a failed
// broadcast aborts Submit AFTER the inputs were marked spent and the mandala
// projections destroyed, and the engine never unwinds that. The handler
// calls prepare BEFORE Engine.Submit (it must snapshot the restorable state
// while it still exists); the returned compensate closure is invoked only
// when Submit fails with a broadcast-classified error
// (arcade.IsBroadcastFailureErr). A nil compensate return means "nothing to
// compensate" (e.g. the BEEF won't survive Submit's own parse step anyway).
// Wired by wiring.Build when Arcade is enabled; nil otherwise.
type PrepareSubmitCompensation func(ctx context.Context, beef []byte) (compensate func(context.Context) error, err error)

func registerSubmitRoutes(f *fiber.App, s Submitter, prepare PrepareSubmitCompensation) {
	f.Post("/submit", submitHandler(s, prepare))
}

// submitHandler implements Appendix B §1: parse X-Topics, split the
// optionally-framed body into beef + off-chain values, decode the
// off-chain payload and thread it onto ctx (the topic manager reads it
// from there) as well as onto TaggedBEEF.OffChainValues (the lookup
// service reads it from there), submit, and respond with either the bare
// STEAK map or a {status:"error"} shape.
func submitHandler(s Submitter, prepare PrepareSubmitCompensation) fiber.Handler {
	return func(c *fiber.Ctx) error {
		topicsHeader := c.Get("X-Topics")
		if topicsHeader == "" {
			return errorResponse(c, fiber.StatusBadRequest, "X-Topics header is required")
		}
		var topics []string
		if err := json.Unmarshal([]byte(topicsHeader), &topics); err != nil {
			return errorResponse(c, fiber.StatusBadRequest, "X-Topics header must be a JSON array of strings")
		}

		body := c.Body()
		var beef, offChain []byte
		if c.Get("x-includes-off-chain-values") == "true" {
			r := bytes.NewReader(body)
			beefLen, err := readVarInt(r)
			if err != nil {
				return errorResponse(c, fiber.StatusBadRequest, "invalid off-chain values framing: "+err.Error())
			}
			consumed := len(body) - r.Len()
			if beefLen > uint64(len(body)-consumed) {
				return errorResponse(c, fiber.StatusBadRequest, "invalid off-chain values framing: beef length exceeds body")
			}
			beef = body[consumed : consumed+int(beefLen)]
			offChain = body[consumed+int(beefLen):]
		} else {
			beef = body
		}

		payload, err := mandala.DecodeLinkagePayload(offChain)
		if err != nil {
			return errorResponse(c, fiber.StatusBadRequest, "invalid off-chain values payload: "+err.Error())
		}
		ctx := mandala.WithPayload(c.UserContext(), payload)

		// Snapshot restorable state BEFORE Submit: the engine's OutputSpent
		// notifications delete the mandala token rows mid-Submit, so a
		// post-failure snapshot would find nothing left to restore. If the
		// snapshot itself fails, refuse to submit — a broadcast failure
		// afterwards would be uncompensatable.
		var compensate func(context.Context) error
		if prepare != nil {
			var prepErr error
			if compensate, prepErr = prepare(ctx, beef); prepErr != nil {
				return errorResponse(c, fiber.StatusInternalServerError,
					"broadcast-failure compensation unavailable: "+prepErr.Error())
			}
		}

		steak, err := s.Submit(ctx, overlay.TaggedBEEF{
			Beef:           beef,
			Topics:         topics,
			OffChainValues: offChain,
		}, engine.SubmitModeCurrent, nil)
		if err != nil {
			// Broadcast failures are the one error path the pinned engine
			// takes after marking inputs spent (see PrepareSubmitCompensation)
			// — undo that marking. Every other Submit error either happened
			// before markSpentAndNotify (nothing to undo) or is a mid-commit
			// storage fault with no clean inverse (compensating those could
			// resurrect state the commit already deleted).
			if compensate != nil && arcade.IsBroadcastFailureErr(err) {
				if cerr := compensate(ctx); cerr != nil {
					log.Printf("submit: broadcast-failure compensation failed (state may need manual repair): submit=%v compensation=%v", err, cerr)
				}
			}
			return errorResponse(c, fiber.StatusBadRequest, err.Error())
		}

		return c.Status(fiber.StatusOK).JSON(steakToWire(steak))
	}
}

func errorResponse(c *fiber.Ctx, status int, message string) error {
	return c.Status(status).JSON(fiber.Map{
		"status":  "error",
		"message": message,
	})
}

// wireAdmittance mirrors the TS SDK's AdmittanceInstructions wire shape —
// camelCase keys, arrays never null (Appendix B §1). go-sdk's
// overlay.AdmittanceInstructions carries no json tags at all (so its
// default encoding is PascalCase field names) and lets a nil slice
// marshal to `null`; neither matches the wire contract, hence this local
// mirror rather than marshaling the SDK type directly.
type wireAdmittance struct {
	OutputsToAdmit []uint32 `json:"outputsToAdmit"`
	CoinsToRetain  []uint32 `json:"coinsToRetain"`
	CoinsRemoved   []uint32 `json:"coinsRemoved,omitempty"`
}

// steakToWire converts an overlay.Steak into the bare, camelCase JSON map
// the frontend's SHIPBroadcaster expects, normalizing nil slices to `[]`.
func steakToWire(steak overlay.Steak) map[string]wireAdmittance {
	out := make(map[string]wireAdmittance, len(steak))
	for topic, ai := range steak {
		if ai == nil {
			ai = &overlay.AdmittanceInstructions{}
		}
		out[topic] = wireAdmittance{
			OutputsToAdmit: nonNilUint32(ai.OutputsToAdmit),
			CoinsToRetain:  nonNilUint32(ai.CoinsToRetain),
			CoinsRemoved:   ai.CoinsRemoved,
		}
	}
	return out
}

func nonNilUint32(s []uint32) []uint32 {
	if s == nil {
		return []uint32{}
	}
	return s
}

// readVarInt reads a Bitcoin VarInt (little-endian) from r: the leading
// byte is either a literal value (<0xfd), or a 0xfd/0xfe/0xff prefix
// introducing a 2/4/8-byte little-endian length.
func readVarInt(r *bytes.Reader) (uint64, error) {
	first, err := r.ReadByte()
	if err != nil {
		return 0, err
	}
	switch first {
	case 0xfd:
		var v uint16
		if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
			return 0, err
		}
		return uint64(v), nil
	case 0xfe:
		var v uint32
		if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
			return 0, err
		}
		return uint64(v), nil
	case 0xff:
		var v uint64
		if err := binary.Read(r, binary.LittleEndian, &v); err != nil {
			return 0, err
		}
		return v, nil
	default:
		return uint64(first), nil
	}
}
