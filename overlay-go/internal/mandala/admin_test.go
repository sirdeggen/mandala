package mandala

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/bsv-blockchain/go-sdk/script"
)

type adminVectors struct {
	AdminScripts []struct {
		PublicData map[string]any `json:"publicData"`
		PubKeyHash []byte         `json:"pubKeyHash"`
		ScriptHex  string         `json:"scriptHex"`
	} `json:"adminScripts"`
	Commitments []struct {
		Details map[string]any `json:"details"`
		Hash    string         `json:"hash"`
	} `json:"commitments"`
}

func loadAdminVectors(t *testing.T) adminVectors {
	t.Helper()
	b, err := os.ReadFile("../../testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v adminVectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDecodeAdminGoldenVectors(t *testing.T) {
	for i, av := range loadAdminVectors(t).AdminScripts {
		s, err := script.NewFromHex(av.ScriptHex)
		if err != nil {
			t.Fatal(err)
		}
		d, err := DecodeAdmin(s)
		if err != nil {
			t.Fatalf("vector %d: %v", i, err)
		}
		if (av.PublicData == nil) != (d.PublicData == nil) {
			t.Fatalf("vector %d: publicData presence mismatch", i)
		}
		if av.PublicData != nil && d.PublicData["label"] != av.PublicData["label"] {
			t.Fatalf("vector %d: publicData mismatch: %+v", i, d.PublicData)
		}
	}
}

func TestCommitmentMatchesTS(t *testing.T) {
	for i, cv := range loadAdminVectors(t).Commitments {
		got, err := Commitment(cv.Details)
		if err != nil {
			t.Fatal(err)
		}
		if got != cv.Hash {
			t.Fatalf("vector %d: got %s want %s", i, got, cv.Hash)
		}
	}
}

func TestDecodeAdminRejectsTokenScript(t *testing.T) {
	v := loadVectors(t)
	s, _ := script.NewFromHex(v.TokenScripts[0].ScriptHex)
	if _, err := DecodeAdmin(s); err == nil {
		t.Fatal("expected error for 8-chunk token script")
	}
}
