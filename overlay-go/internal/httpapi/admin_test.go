package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/sirdeggen/mandala/overlay-go/internal/mandala"
)

// testAdminDB connects to a dedicated test database (dropped in cleanup) so
// the httpapi package's Mongo-backed admin tests never collide with the
// mandala/enginestore packages' own test databases. Skips (not fails) when
// Mongo is unreachable, matching the pattern used throughout this repo.
func testAdminDB(t *testing.T) *mongo.Database {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	client, err := mongo.Connect(options.Client().ApplyURI("mongodb://localhost:27017"))
	if err != nil {
		t.Skip("mongo unavailable:", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		t.Skip("mongo unavailable:", err)
	}
	db := client.Database("mandala_go_httpadmin_test")
	t.Cleanup(func() { _ = db.Drop(context.Background()) })
	return db
}

// seedHistory appends an "issue 100" then a "redeem 30" admin-history entry
// for assetID via the real Store (NextAdmitSeq'd, so admitSeq ordering is
// realistic), returning the two admitSeqs in insertion order.
func seedHistory(t *testing.T, store *mandala.Store, assetID string) (seq1, seq2 int64) {
	t.Helper()
	ctx := context.Background()
	var err error
	seq1, err = store.NextAdmitSeq(ctx)
	if err != nil {
		t.Fatal(err)
	}
	seq2, err = store.NextAdmitSeq(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.AppendAdminHistory(ctx, mandala.AdminHistoryEntry{
		AssetID: assetID, Txid: "t1", OutputIndex: 0, Height: 10, Offset: 0, AdmitSeq: seq1,
		ActionDetails: mandala.ActionDetails{"kind": "issue", "amount": float64(100)},
		CreatedAt:     time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendAdminHistory(ctx, mandala.AdminHistoryEntry{
		AssetID: assetID, Txid: "t2", OutputIndex: 1, Height: 11, Offset: 0, AdmitSeq: seq2,
		ActionDetails: mandala.ActionDetails{"kind": "redeem", "amount": float64(30)},
		CreatedAt:     time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	return seq1, seq2
}

func TestAdminAssetState_DefaultShapeForUnknownAsset(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/asset-state/unknown-asset.0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	var state mandala.AssetAdminState
	raw := readRawBody(t, resp)
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, raw)
	}
	if state.AssetID != "unknown-asset.0" {
		t.Fatalf("assetId = %q, want unknown-asset.0", state.AssetID)
	}
	if state.AccessMode != "denylist" {
		t.Fatalf("accessMode = %q, want denylist", state.AccessMode)
	}
	if state.IsPaused {
		t.Fatalf("isPaused = true, want false for unknown asset")
	}
	// Non-nil, non-null empty arrays — not omitted, not `null`.
	for _, want := range []string{`"blockedIdentities":[]`, `"allowedIdentities":[]`, `"frozenOutpoints":[]`, `"evictedOutpoints":[]`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("body = %s, want to contain %s", raw, want)
		}
	}
}

func TestAdminAssetState_Error(t *testing.T) {
	stub := &stubAdminStore{stateErr: errors.New("boom")}
	app := newServer(&stubSubmitter{}, &stubLookuper{}, stub, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/asset-state/a.0", nil))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	body := decodeJSON(t, resp)
	if _, ok := body["error"]; !ok {
		t.Fatalf("body = %v, want an \"error\" field (not status/message)", body)
	}
	if _, ok := body["status"]; ok {
		t.Fatalf("body = %v, admin routes must use {error} shape, not {status,message}", body)
	}
}

func TestAdminHistory_SeededEntriesAndFieldNames(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	seedHistory(t, store, "asset-a.0")
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history/asset-a.0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	var rows []map[string]any
	raw := readRawBody(t, resp)
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, raw)
	}
	if len(rows) != 2 {
		t.Fatalf("len(rows) = %d, want 2 (body: %s)", len(rows), raw)
	}
	for _, field := range []string{"assetId", "txid", "outputIndex", "height", "offset", "admitSeq", "actionDetails"} {
		if _, ok := rows[0][field]; !ok {
			t.Fatalf("row missing field %q: %+v", field, rows[0])
		}
	}
	actionDetails, ok := rows[0]["actionDetails"].(map[string]any)
	if !ok {
		t.Fatalf("actionDetails not an object: %+v", rows[0]["actionDetails"])
	}
	if actionDetails["kind"] != "issue" {
		t.Fatalf("first row (height-ordered) kind = %v, want issue", actionDetails["kind"])
	}
}

func TestAdminHistory_EmptyArrayNotNullForUnknownAsset(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history/no-such-asset.0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw := readRawBody(t, resp)
	if strings.TrimSpace(string(raw)) != "[]" {
		t.Fatalf("body = %s, want exactly [] (never null)", raw)
	}
}

func TestAdminHistory_Error(t *testing.T) {
	stub := &stubAdminStore{historyErr: errors.New("boom")}
	app := newServer(&stubSubmitter{}, &stubLookuper{}, stub, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history/a.0", nil))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	body := decodeJSON(t, resp)
	if _, ok := body["error"]; !ok {
		t.Fatalf("body = %v, want an \"error\" field", body)
	}
}

func TestAdminHistoryPage_NewestFirstAndLimit(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	_, seq2 := seedHistory(t, store, "asset-b.0")
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history-page/asset-b.0?limit=1&offset=0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	var rows []mandala.AdminHistoryEntry
	raw := readRawBody(t, resp)
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, raw)
	}
	if len(rows) != 1 {
		t.Fatalf("len(rows) = %d, want 1 (limit=1)", len(rows))
	}
	if rows[0].AdmitSeq != seq2 {
		t.Fatalf("admitSeq = %d, want newest (%d)", rows[0].AdmitSeq, seq2)
	}
}

func TestAdminHistoryPage_DefaultsAndEmptyArray(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history-page/no-such-asset.0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw := readRawBody(t, resp)
	if strings.TrimSpace(string(raw)) != "[]" {
		t.Fatalf("body = %s, want exactly [] (never null) with no limit/offset given", raw)
	}
}

func TestAdminHistoryPage_Error(t *testing.T) {
	stub := &stubAdminStore{pageErr: errors.New("boom")}
	app := newServer(&stubSubmitter{}, &stubLookuper{}, stub, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history-page/a.0", nil))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
}

func TestAdminSummary_IssueRedeemMath(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	seedHistory(t, store, "asset-c.0")
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-summary/asset-c.0", nil))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	body := decodeJSON(t, resp)
	if got := body["totalIssued"]; got != float64(100) {
		t.Fatalf("totalIssued = %v, want 100", got)
	}
	if got := body["totalRedeemed"]; got != float64(30) {
		t.Fatalf("totalRedeemed = %v, want 30", got)
	}
	if got := body["actionCount"]; got != float64(2) {
		t.Fatalf("actionCount = %v, want 2", got)
	}
}

func TestAdminSummary_Error(t *testing.T) {
	stub := &stubAdminStore{summaryErr: errors.New("boom")}
	app := newServer(&stubSubmitter{}, &stubLookuper{}, stub, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-summary/a.0", nil))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	body := decodeJSON(t, resp)
	if _, ok := body["error"]; !ok {
		t.Fatalf("body = %v, want an \"error\" field", body)
	}
}

// TestAdminAssetID_URLEncodedRoundTrip asserts that a percent-encoded '.'
// in the :assetId path segment (as encodeURIComponent may produce, e.g.
// when re-encoding a txid.vout string) resolves to the exact same store
// key as the plain, unencoded form. Fiber's c.Params returns the raw path
// segment; assetIDParam must url.PathUnescape it.
func TestAdminAssetID_URLEncodedRoundTrip(t *testing.T) {
	store := mandala.NewStore(testAdminDB(t))
	const assetID = "ab..ab.0"
	seedHistory(t, store, assetID)
	app := newServer(&stubSubmitter{}, &stubLookuper{}, store, nil)

	plain := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history/ab..ab.0", nil))
	if plain.StatusCode != http.StatusOK {
		t.Fatalf("plain: status = %d, want 200 (body: %s)", plain.StatusCode, readRawBody(t, plain))
	}
	plainBody := readRawBody(t, plain)
	var plainRows []map[string]any
	if err := json.Unmarshal(plainBody, &plainRows); err != nil {
		t.Fatalf("plain unmarshal: %v (body: %s)", err, plainBody)
	}
	if len(plainRows) != 2 {
		t.Fatalf("plain: len(rows) = %d, want 2 (body: %s)", len(plainRows), plainBody)
	}

	encoded := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/admin-history/ab..ab%2E0", nil))
	if encoded.StatusCode != http.StatusOK {
		t.Fatalf("encoded: status = %d, want 200 (body: %s)", encoded.StatusCode, readRawBody(t, encoded))
	}
	encodedBody := readRawBody(t, encoded)
	var encodedRows []map[string]any
	if err := json.Unmarshal(encodedBody, &encodedRows); err != nil {
		t.Fatalf("encoded unmarshal: %v (body: %s)", err, encodedBody)
	}
	if len(encodedRows) != 2 {
		t.Fatalf("encoded (%%2E): len(rows) = %d, want 2 (body: %s)", len(encodedRows), encodedBody)
	}

	if string(plainBody) != string(encodedBody) {
		t.Fatalf("plain and %%2E-encoded assetId paths returned different bodies:\nplain:   %s\nencoded: %s", plainBody, encodedBody)
	}
}

func TestHealth_OK(t *testing.T) {
	app := newServer(&stubSubmitter{}, &stubLookuper{}, nil, nil)

	for _, path := range []string{"/health", "/health/live", "/health/ready"} {
		t.Run(path, func(t *testing.T) {
			resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, path, nil))
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
			}
			body := decodeJSON(t, resp)
			if body["status"] != "ok" {
				t.Fatalf("body = %v, want status:ok", body)
			}
		})
	}
}

func TestHealthReady_PingFailureIs503(t *testing.T) {
	app := newServer(&stubSubmitter{}, &stubLookuper{}, nil, func(context.Context) error {
		return errors.New("mongo down")
	})

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	body := decodeJSON(t, resp)
	if body["status"] != "error" {
		t.Fatalf("body = %v, want status:error", body)
	}
}

// stubAdminStore is an AdminStore test double for exercising the 500-error
// paths without needing a real Store failure mode.
type stubAdminStore struct {
	stateErr   error
	historyErr error
	pageErr    error
	summaryErr error
}

func (s *stubAdminStore) GetAssetState(context.Context, string) (mandala.AssetAdminState, error) {
	return mandala.AssetAdminState{}, s.stateErr
}

func (s *stubAdminStore) FindAdminHistoryByAssetID(context.Context, string) ([]mandala.AdminHistoryEntry, error) {
	return nil, s.historyErr
}

func (s *stubAdminStore) PageAdminHistory(context.Context, string, int64, int64) ([]mandala.AdminHistoryEntry, error) {
	return nil, s.pageErr
}

func (s *stubAdminStore) AdminSummary(context.Context, string) (int64, int64, int64, error) {
	return 0, 0, 0, s.summaryErr
}

// TestHealthReady_TimeoutBeforeBlockingPing asserts that /health/ready
// wraps the context with an explicit 2-second timeout before calling the
// Pinger. A pinger that blocks indefinitely (or longer than 2s) must not
// hang the handler — it should return 503 quickly.
func TestHealthReady_TimeoutBeforeBlockingPing(t *testing.T) {
	blockingPinger := func(ctx context.Context) error {
		// Simulate a blocking operation by sleeping much longer than the expected timeout
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Second):
			return nil
		}
	}

	app := newServer(&stubSubmitter{}, &stubLookuper{}, nil, blockingPinger)

	start := time.Now()
	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	elapsed := time.Since(start)

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	body := decodeJSON(t, resp)
	if body["status"] != "error" {
		t.Fatalf("body = %v, want status:error", body)
	}
	// Assert handler returned promptly (well under 5s wall-clock)
	if elapsed > 5*time.Second {
		t.Fatalf("handler took %v, want < 5s (timeout not working)", elapsed)
	}
}

// TestAdminAssetState_NilStoreReturns500 asserts that a nil AdminStore
// returns 500 with {"error": "store unavailable"} rather than panicking.
func TestAdminAssetState_NilStoreReturns500(t *testing.T) {
	app := newServer(&stubSubmitter{}, &stubLookuper{}, nil, nil)

	resp := doRequest(t, app, httptest.NewRequest(http.MethodGet, "/admin/asset-state/a.0", nil))
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", resp.StatusCode)
	}
	body := decodeJSON(t, resp)
	if body["error"] != "store unavailable" {
		t.Fatalf("body = %v, want error:store unavailable", body)
	}
}
