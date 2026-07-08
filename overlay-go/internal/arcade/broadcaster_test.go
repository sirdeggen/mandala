package arcade

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/transaction"
)

// simpleTx builds a minimal, input-free transaction — enough to exercise
// EFHex() successfully (the EF-format loop over zero inputs never hits the
// "missing source transaction" case) without needing a real UTXO.
func simpleTx(t *testing.T) *transaction.Transaction {
	t.Helper()
	tx := transaction.NewTransaction()
	if err := tx.AddOpReturnOutput([]byte("mandala-test")); err != nil {
		t.Fatalf("AddOpReturnOutput: %v", err)
	}
	return tx
}

// txMissingSourceOutput builds a transaction with one input that has
// neither a SourceTransaction nor a source output attached, forcing EF() to
// fail with ErrEmptyPreviousTx so rawTxForArcade must fall back to Hex().
func txMissingSourceOutput(t *testing.T) *transaction.Transaction {
	t.Helper()
	txid, err := chainhash.NewHashFromHex("0000000000000000000000000000000000000000000000000000000000000abc")
	if err != nil {
		t.Fatalf("NewHashFromHex: %v", err)
	}
	tx := transaction.NewTransaction()
	tx.AddInput(&transaction.TransactionInput{
		SourceTXID:       txid,
		SourceTxOutIndex: 0,
		SequenceNumber:   0xffffffff,
	})
	if err := tx.AddOpReturnOutput([]byte("mandala-test")); err != nil {
		t.Fatalf("AddOpReturnOutput: %v", err)
	}
	return tx
}

func TestRawTxForArcadePrefersEFHex(t *testing.T) {
	tx := simpleTx(t)
	want, err := tx.EFHex()
	if err != nil {
		t.Fatalf("EFHex: %v", err)
	}
	if got := rawTxForArcade(tx); got != want {
		t.Fatalf("rawTxForArcade = %q, want EF hex %q", got, want)
	}
}

func TestRawTxForArcadeFallsBackToPlainHexWithoutSourceTx(t *testing.T) {
	tx := txMissingSourceOutput(t)
	if _, err := tx.EFHex(); err == nil {
		t.Fatal("expected EFHex to fail for input missing a source transaction")
	}
	if got, want := rawTxForArcade(tx), tx.Hex(); got != want {
		t.Fatalf("rawTxForArcade = %q, want plain hex %q", got, want)
	}
}

func TestIsTerminalStatus(t *testing.T) {
	cases := []struct {
		status, extraInfo string
		want              bool
	}{
		{"SEEN_ON_NETWORK", "", false},
		{"MINED", "", false},
		{"seen_on_network", "", false},
		{"REJECTED", "", true},
		{"rejected", "", true},
		{"DOUBLE_SPEND_ATTEMPTED", "", true},
		{"INVALID", "", true},
		{"MALFORMED", "", true},
		{"MINED_IN_STALE_BLOCK", "", true},
		{"SEEN_ON_NETWORK", "seen orphaned parent", true},
		{"SOME_ORPHAN_STATUS", "", true},
		{"", "", false},
	}
	for _, c := range cases {
		if got := IsTerminalStatus(c.status, c.extraInfo); got != c.want {
			t.Errorf("IsTerminalStatus(%q, %q) = %v, want %v", c.status, c.extraInfo, got, c.want)
		}
	}
}

// arcTxServer builds an httptest.Server standing in for Arcade's POST /tx,
// recording the last request it saw and answering with the given status
// code and JSON body.
func arcTxServer(t *testing.T, status int, body string) (*httptest.Server, **http.Request, *[]byte) {
	t.Helper()
	var gotReq *http.Request
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReq = r.Clone(r.Context())
		b, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		gotBody = b
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	return srv, &gotReq, &gotBody
}

func TestBroadcastSuccess(t *testing.T) {
	srv, reqPtr, bodyPtr := arcTxServer(t, http.StatusOK, `{"txid":"abc123","txStatus":"SEEN_ON_NETWORK"}`)
	defer srv.Close()

	b := NewBroadcaster(srv.URL, "secret-key", "https://example.com/arc-ingest", "callback-token", nil)
	success, failure := b.Broadcast(simpleTx(t))
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if success == nil {
		t.Fatal("expected success, got nil")
	}
	if success.Txid != "abc123" {
		t.Fatalf("success.Txid = %q, want %q", success.Txid, "abc123")
	}

	req := *reqPtr
	if req.Method != http.MethodPost || req.URL.Path != "/tx" {
		t.Fatalf("request = %s %s, want POST /tx", req.Method, req.URL.Path)
	}
	if got := req.Header.Get("Authorization"); got != "Bearer secret-key" {
		t.Errorf("Authorization = %q, want Bearer secret-key", got)
	}
	if got := req.Header.Get("X-CallbackUrl"); got != "https://example.com/arc-ingest" {
		t.Errorf("X-CallbackUrl = %q", got)
	}
	if got := req.Header.Get("X-CallbackToken"); got != "callback-token" {
		t.Errorf("X-CallbackToken = %q", got)
	}

	var payload map[string]any
	if err := json.Unmarshal(*bodyPtr, &payload); err != nil {
		t.Fatalf("request body not JSON: %v", err)
	}
	rawTx, _ := payload["rawTx"].(string)
	if rawTx == "" {
		t.Fatal("request body missing non-empty rawTx")
	}
	if _, err := hex.DecodeString(rawTx); err != nil {
		t.Fatalf("rawTx is not hex: %v", err)
	}
}

func TestBroadcastOmitsHeadersWhenUnconfigured(t *testing.T) {
	srv, reqPtr, _ := arcTxServer(t, http.StatusOK, `{"txid":"abc123","txStatus":"SEEN_ON_NETWORK"}`)
	defer srv.Close()

	b := NewBroadcaster(srv.URL, "", "", "", nil)
	if _, failure := b.Broadcast(simpleTx(t)); failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}

	req := *reqPtr
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization = %q, want empty", got)
	}
	if got := req.Header.Get("X-CallbackUrl"); got != "" {
		t.Errorf("X-CallbackUrl = %q, want empty", got)
	}
	if got := req.Header.Get("X-CallbackToken"); got != "" {
		t.Errorf("X-CallbackToken = %q, want empty", got)
	}
}

func TestBroadcastTerminalStatusIsFailureEvenOnHTTP200(t *testing.T) {
	srv, _, _ := arcTxServer(t, http.StatusOK, `{"txid":"abc123","txStatus":"REJECTED","extraInfo":"double spend"}`)
	defer srv.Close()

	b := NewBroadcaster(srv.URL, "", "", "", nil)
	success, failure := b.Broadcast(simpleTx(t))
	if success != nil {
		t.Fatalf("expected no success for REJECTED, got %+v", success)
	}
	if failure == nil {
		t.Fatal("expected a failure for REJECTED txStatus on HTTP 200")
	}
}

func TestBroadcastHTTP500IsFailure(t *testing.T) {
	srv, _, _ := arcTxServer(t, http.StatusInternalServerError, `{"error":"boom"}`)
	defer srv.Close()

	b := NewBroadcaster(srv.URL, "", "", "", nil)
	success, failure := b.Broadcast(simpleTx(t))
	if success != nil {
		t.Fatalf("expected no success for HTTP 500, got %+v", success)
	}
	if failure == nil {
		t.Fatal("expected a failure for HTTP 500")
	}
}

func TestBroadcastCtxMatchesBroadcast(t *testing.T) {
	srv, _, _ := arcTxServer(t, http.StatusOK, `{"txid":"abc123","txStatus":"SEEN_ON_NETWORK"}`)
	defer srv.Close()

	b := NewBroadcaster(srv.URL, "", "", "", nil)
	success, failure := b.BroadcastCtx(context.Background(), simpleTx(t))
	if failure != nil {
		t.Fatalf("unexpected failure: %+v", failure)
	}
	if success == nil || success.Txid != "abc123" {
		t.Fatalf("success = %+v", success)
	}
}
