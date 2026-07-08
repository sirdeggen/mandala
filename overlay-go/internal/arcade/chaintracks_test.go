package arcade

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/bsv-blockchain/go-sdk/chainhash"
)

func mustHash(t *testing.T, hex string) *chainhash.Hash {
	t.Helper()
	h, err := chainhash.NewHashFromHex(hex)
	if err != nil {
		t.Fatalf("NewHashFromHex(%q): %v", hex, err)
	}
	return h
}

func TestChaintracksIsValidRootForHeightMatch(t *testing.T) {
	root := mustHash(t, "00000000000000000000000000000000000000000000000000000000000abc")
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"height":100,"hash":"deadbeef","merkleRoot":"` + root.String() + `"}`))
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL, "/v2", nil)
	ok, err := ct.IsValidRootForHeight(context.Background(), root, 100)
	if err != nil {
		t.Fatalf("IsValidRootForHeight error: %v", err)
	}
	if !ok {
		t.Fatal("IsValidRootForHeight = false, want true for matching root")
	}
	if gotPath != "/v2/header/height/100" {
		t.Fatalf("request path = %q, want /v2/header/height/100", gotPath)
	}
}

func TestChaintracksIsValidRootForHeightMismatch(t *testing.T) {
	root := mustHash(t, "00000000000000000000000000000000000000000000000000000000000abc")
	other := mustHash(t, "00000000000000000000000000000000000000000000000000000000000def")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"height":100,"hash":"deadbeef","merkleRoot":"` + root.String() + `"}`))
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL, "/v2", nil)
	ok, err := ct.IsValidRootForHeight(context.Background(), other, 100)
	if err != nil {
		t.Fatalf("IsValidRootForHeight error: %v", err)
	}
	if ok {
		t.Fatal("IsValidRootForHeight = true, want false for mismatched root")
	}
}

func TestChaintracksIsValidRootForHeightNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL, "/v2", nil)
	root := mustHash(t, "00000000000000000000000000000000000000000000000000000000000abc")
	ok, err := ct.IsValidRootForHeight(context.Background(), root, 999999)
	if err != nil {
		t.Fatalf("IsValidRootForHeight error: %v", err)
	}
	if ok {
		t.Fatal("IsValidRootForHeight = true, want false for unknown height (404)")
	}
}

func TestChaintracksCurrentHeight(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/height" {
			t.Errorf("request path = %q, want /v2/height", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"height":12345}`))
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL, "/v2", nil)
	height, err := ct.CurrentHeight(context.Background())
	if err != nil {
		t.Fatalf("CurrentHeight error: %v", err)
	}
	if height != 12345 {
		t.Fatalf("CurrentHeight = %d, want 12345", height)
	}
}

func TestChaintracksCurrentHeightError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL, "/v2", nil)
	if _, err := ct.CurrentHeight(context.Background()); err == nil {
		t.Fatal("expected an error for HTTP 500")
	}
}

func TestNewChaintracksTrimsBaseURLAndNormalizesPrefix(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"height":1}`))
	}))
	defer srv.Close()

	ct := NewChaintracks(srv.URL+"/", "v2/", nil)
	if _, err := ct.CurrentHeight(context.Background()); err != nil {
		t.Fatalf("CurrentHeight error: %v", err)
	}
	if gotPath != "/v2/height" {
		t.Fatalf("request path = %q, want /v2/height", gotPath)
	}
}
