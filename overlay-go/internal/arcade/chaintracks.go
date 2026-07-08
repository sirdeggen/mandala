package arcade

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/transaction/chaintracker"
)

// chaintracksHeader is the subset of go-chaintracks's header response this
// package reads (ChaintracksProvider.ts's ChaintracksHeader).
type chaintracksHeader struct {
	Height     uint32 `json:"height"`
	Hash       string `json:"hash"`
	MerkleRoot string `json:"merkleRoot"`
}

// Chaintracks is a go-chaintracks-compatible HTTP client implementing
// go-sdk's chaintracker.ChainTracker — the Go mirror of
// ChaintracksProvider.ts's isValidRootForHeight/currentHeight pair.
type Chaintracks struct {
	baseURL string
	client  *http.Client
}

var _ chaintracker.ChainTracker = (*Chaintracks)(nil)

// NewChaintracks builds a Chaintracks client against {baseURL}{prefix}
// (e.g. baseURL "https://arcade.example/chaintracks", prefix "/v2"). A
// trailing slash on baseURL and a missing/trailing slash on prefix are
// normalized the same way ChaintracksProvider.ts's trimUrl/trimPrefix do;
// client defaults to http.DefaultClient when nil.
func NewChaintracks(baseURL, prefix string, client *http.Client) *Chaintracks {
	if client == nil {
		client = http.DefaultClient
	}
	return &Chaintracks{
		baseURL: trimTrailingSlash(baseURL) + normalizePrefix(prefix),
		client:  client,
	}
}

func trimTrailingSlash(s string) string {
	return strings.TrimRight(s, "/")
}

func normalizePrefix(prefix string) string {
	if prefix == "" {
		return ""
	}
	if !strings.HasPrefix(prefix, "/") {
		prefix = "/" + prefix
	}
	return strings.TrimRight(prefix, "/")
}

// IsValidRootForHeight fetches the header at height and reports whether its
// merkleRoot matches root. An unknown height (HTTP 404) is a non-error
// false, matching ChaintracksProvider.ts's isValidRootForHeight, which
// treats findHeaderForHeight()'s undefined the same way.
func (c *Chaintracks) IsValidRootForHeight(ctx context.Context, root *chainhash.Hash, height uint32) (bool, error) {
	header, err := c.headerForHeight(ctx, height)
	if err != nil {
		return false, err
	}
	if header == nil || root == nil {
		return false, nil
	}
	return header.MerkleRoot == root.String(), nil
}

// headerForHeight fetches {baseURL}/header/height/{height}; a 404 reports
// (nil, nil) — no error, just "no such header".
func (c *Chaintracks) headerForHeight(ctx context.Context, height uint32) (*chaintracksHeader, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/header/height/%d", c.baseURL, height), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("chaintracks: header lookup for height %d failed: %s", height, resp.Status)
	}

	var header chaintracksHeader
	if err := json.NewDecoder(resp.Body).Decode(&header); err != nil {
		return nil, fmt.Errorf("chaintracks: decode header response for height %d: %w", height, err)
	}
	return &header, nil
}

// CurrentHeight fetches {baseURL}/height.
func (c *Chaintracks) CurrentHeight(ctx context.Context) (uint32, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/height", nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, fmt.Errorf("chaintracks: height lookup failed: %s", resp.Status)
	}

	var data struct {
		Height uint32 `json:"height"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return 0, fmt.Errorf("chaintracks: decode height response: %w", err)
	}
	return data.Height, nil
}
