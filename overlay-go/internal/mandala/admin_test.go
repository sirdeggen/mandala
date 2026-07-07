package mandala

import (
	"bytes"
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
		if !bytes.Equal(d.PubKeyHash[:], av.PubKeyHash) {
			t.Fatalf("vector %d: pubKeyHash mismatch: got %x want %x", i, d.PubKeyHash[:], av.PubKeyHash)
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

// TestLockAdminRoundTrip builds both MandalaAdmin script shapes (plain P2PKH
// and the 7-chunk publicData-prefixed variant) with LockAdmin and verifies
// DecodeAdmin recovers the exact pubKeyHash and publicData.
func TestLockAdminRoundTrip(t *testing.T) {
	pkh := [20]byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
		0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14}

	t.Run("plain 5-chunk P2PKH", func(t *testing.T) {
		s, err := LockAdmin(pkh[:], nil)
		if err != nil {
			t.Fatal(err)
		}
		chunks, err := s.Chunks()
		if err != nil {
			t.Fatal(err)
		}
		if len(chunks) != 5 {
			t.Fatalf("want 5 chunks, got %d", len(chunks))
		}
		d, err := DecodeAdmin(s)
		if err != nil {
			t.Fatal(err)
		}
		if d.PubKeyHash != pkh {
			t.Fatalf("pubKeyHash mismatch: got %x want %x", d.PubKeyHash, pkh)
		}
		if d.PublicData != nil {
			t.Fatalf("expected nil publicData, got %+v", d.PublicData)
		}
	})

	t.Run("7-chunk publicData variant", func(t *testing.T) {
		publicData := map[string]any{
			"txid":    "deadbeef",
			"vout":    float64(3),
			"assetId": "deadbeef.3",
		}
		s, err := LockAdmin(pkh[:], publicData)
		if err != nil {
			t.Fatal(err)
		}
		chunks, err := s.Chunks()
		if err != nil {
			t.Fatal(err)
		}
		if len(chunks) != 7 {
			t.Fatalf("want 7 chunks, got %d", len(chunks))
		}
		if chunks[1].Op != script.OpDROP {
			t.Fatalf("chunk 1 op: got %x want OP_DROP", chunks[1].Op)
		}
		d, err := DecodeAdmin(s)
		if err != nil {
			t.Fatal(err)
		}
		if d.PubKeyHash != pkh {
			t.Fatalf("pubKeyHash mismatch: got %x want %x", d.PubKeyHash, pkh)
		}
		if d.PublicData == nil {
			t.Fatal("expected non-nil publicData")
		}
		for k, want := range publicData {
			if got := d.PublicData[k]; got != want {
				t.Fatalf("publicData[%q]: got %v want %v", k, got, want)
			}
		}
	})

	t.Run("rejects short pubKeyHash", func(t *testing.T) {
		if _, err := LockAdmin(pkh[:19], nil); err == nil {
			t.Fatal("expected error for short pubKeyHash")
		}
	})
}
