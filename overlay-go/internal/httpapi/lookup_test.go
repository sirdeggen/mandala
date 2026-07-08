package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bsv-blockchain/go-sdk/overlay/lookup"
)

// stubLookuper is a Lookuper test double: it records what it was called
// with and returns canned results, so tests never need a real engine,
// lookup service, or Mongo.
type stubLookuper struct {
	answer *lookup.LookupAnswer
	err    error

	gotCtx     context.Context
	gotService string
	gotQuery   json.RawMessage
}

func (s *stubLookuper) Lookup(ctx context.Context, q *lookup.LookupQuestion) (*lookup.LookupAnswer, error) {
	s.gotCtx = ctx
	s.gotService = q.Service
	s.gotQuery = q.Query
	return s.answer, s.err
}

func lookupRequest(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/lookup", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestLookup_InvalidBody(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"missing service", `{"query":{"metadataAssetId":"abc.0"}}`},
		{"missing query", `{"service":"ls_mandala"}`},
		{"non-JSON", `not-json-at-all`},
		{"service wrong type", `{"service":123,"query":{"metadataAssetId":"abc.0"}}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := newServer(&stubSubmitter{}, &stubLookuper{})

			resp := doRequest(t, app, lookupRequest(tc.body))
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body: %s)", resp.StatusCode, readRawBody(t, resp))
			}
			body := decodeJSON(t, resp)
			if body["status"] != "error" {
				t.Fatalf("body = %v, want status:error", body)
			}
			if _, ok := body["message"]; !ok {
				t.Fatalf("body = %v, missing message field", body)
			}
		})
	}
}

func TestLookup_OutputListAnswer(t *testing.T) {
	stub := &stubLookuper{
		answer: &lookup.LookupAnswer{
			Type: lookup.AnswerTypeOutputList,
			Outputs: []*lookup.OutputListItem{
				{Beef: []byte{1, 2, 3}, OutputIndex: 7},
			},
		},
	}
	app := newServer(&stubSubmitter{}, stub)

	resp := doRequest(t, app, lookupRequest(`{"service":"ls_mandala","query":{"metadataAssetId":"abc.0"}}`))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}

	raw := readRawBody(t, resp)
	if !strings.Contains(string(raw), `"beef":[1,2,3]`) {
		t.Fatalf("body = %s, want to contain \"beef\":[1,2,3]", raw)
	}
	if !strings.Contains(string(raw), `"type":"output-list"`) {
		t.Fatalf("body = %s, want to contain \"type\":\"output-list\"", raw)
	}

	var decoded struct {
		Type    string `json:"type"`
		Outputs []struct {
			Beef        []int `json:"beef"`
			OutputIndex int   `json:"outputIndex"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if len(decoded.Outputs) != 1 {
		t.Fatalf("outputs = %v, want 1 item", decoded.Outputs)
	}
	if decoded.Outputs[0].OutputIndex != 7 {
		t.Fatalf("outputIndex = %d, want 7", decoded.Outputs[0].OutputIndex)
	}
}

func TestLookup_AggregationHeaderIgnored(t *testing.T) {
	stub := &stubLookuper{
		answer: &lookup.LookupAnswer{
			Type: lookup.AnswerTypeOutputList,
			Outputs: []*lookup.OutputListItem{
				{Beef: []byte{1, 2, 3}, OutputIndex: 7},
			},
		},
	}
	app := newServer(&stubSubmitter{}, stub)

	req := lookupRequest(`{"service":"ls_mandala","query":{"metadataAssetId":"abc.0"}}`)
	req.Header.Set("X-Aggregation", "yes")
	resp := doRequest(t, app, req)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json (X-Aggregation must be ignored)", ct)
	}

	raw := readRawBody(t, resp)
	if !strings.Contains(string(raw), `"beef":[1,2,3]`) {
		t.Fatalf("body = %s, want to contain \"beef\":[1,2,3] even with X-Aggregation set", raw)
	}
}

func TestLookup_ForwardsServiceAndRawQuery(t *testing.T) {
	stub := &stubLookuper{
		answer: &lookup.LookupAnswer{Type: lookup.AnswerTypeOutputList},
	}
	app := newServer(&stubSubmitter{}, stub)

	const query = `{"metadataAssetId":"deadbeef.3","extra":[1,2,3]}`
	body := `{"service":"ls_mandala","query":` + query + `}`
	resp := doRequest(t, app, lookupRequest(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}

	if stub.gotService != "ls_mandala" {
		t.Fatalf("gotService = %q, want ls_mandala", stub.gotService)
	}
	if string(stub.gotQuery) != query {
		t.Fatalf("gotQuery = %s, want verbatim %s", stub.gotQuery, query)
	}
	if stub.gotCtx == nil {
		t.Fatalf("gotCtx = nil, want a context")
	}
}

func TestLookup_EngineError(t *testing.T) {
	stub := &stubLookuper{err: errors.New("boom")}
	app := newServer(&stubSubmitter{}, stub)

	resp := doRequest(t, app, lookupRequest(`{"service":"ls_mandala","query":{"metadataAssetId":"abc.0"}}`))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}
	body := decodeJSON(t, resp)
	if body["status"] != "error" {
		t.Fatalf("body = %v, want status:error", body)
	}
	if _, ok := body["message"]; !ok {
		t.Fatalf("body = %v, missing message field", body)
	}
}

func TestLookup_EmptyOutputsIsEmptyArrayNotNull(t *testing.T) {
	stub := &stubLookuper{
		answer: &lookup.LookupAnswer{Type: lookup.AnswerTypeOutputList, Outputs: nil},
	}
	app := newServer(&stubSubmitter{}, stub)

	resp := doRequest(t, app, lookupRequest(`{"service":"ls_mandala","query":{"metadataAssetId":"abc.0"}}`))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", resp.StatusCode, readRawBody(t, resp))
	}

	raw := readRawBody(t, resp)
	if !strings.Contains(string(raw), `"outputs":[]`) {
		t.Fatalf("body = %s, want \"outputs\":[] (never null)", raw)
	}
}
