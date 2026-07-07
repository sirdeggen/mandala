package mandala

import (
	"encoding/json"
	"fmt"
	"math"
)

// NumBytes is a []byte that marshals as a JSON number array (TS number[]).
type NumBytes []byte

func (n *NumBytes) UnmarshalJSON(b []byte) error {
	var ints []int
	if err := json.Unmarshal(b, &ints); err != nil {
		return err
	}
	out := make([]byte, len(ints))
	for i, v := range ints {
		if v < 0 || v > 255 {
			return fmt.Errorf("byte out of range: %d", v)
		}
		out[i] = byte(v)
	}
	*n = out
	return nil
}

func (n NumBytes) MarshalJSON() ([]byte, error) {
	ints := make([]int, len(n))
	for i, b := range n {
		ints[i] = int(b)
	}
	return json.Marshal(ints)
}

type ProtocolID struct {
	SecurityLevel int
	Name          string
}

func (p *ProtocolID) UnmarshalJSON(b []byte) error {
	var arr [2]json.RawMessage
	if err := json.Unmarshal(b, &arr); err != nil {
		return err
	}
	if err := json.Unmarshal(arr[0], &p.SecurityLevel); err != nil {
		return err
	}
	return json.Unmarshal(arr[1], &p.Name)
}

func (p ProtocolID) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]any{p.SecurityLevel, p.Name})
}

type SpecificLinkage struct {
	Prover                string     `json:"prover"`
	Verifier              string     `json:"verifier"`
	Counterparty          string     `json:"counterparty"`
	ProtocolID            ProtocolID `json:"protocolID"`
	KeyID                 string     `json:"keyID"`
	EncryptedLinkage      NumBytes   `json:"encryptedLinkage"`
	EncryptedLinkageProof NumBytes   `json:"encryptedLinkageProof"`
	ProofType             int        `json:"proofType"`
}

type ActionDetails map[string]any

func (d ActionDetails) Kind() string {
	s, _ := d["kind"].(string)
	return s
}

func (d ActionDetails) Str(key string) (string, bool) {
	s, ok := d[key].(string)
	return s, ok
}

func (d ActionDetails) Num(key string) (int64, bool) {
	f, ok := d[key].(float64)
	if !ok || f != math.Trunc(f) {
		return 0, false
	}
	return int64(f), true
}

type IndexedLinkage struct {
	Index   uint32           `json:"index"`
	Linkage *SpecificLinkage `json:"linkage"`
}

type IndexedAdmin struct {
	Index         uint32        `json:"index"`
	ActionDetails ActionDetails `json:"actionDetails"`
}

type LinkagePayload struct {
	Inputs  []IndexedLinkage `json:"inputs"`
	Outputs []IndexedLinkage `json:"outputs"`
	Admin   []IndexedAdmin   `json:"admin,omitempty"`
}

func DecodeLinkagePayload(b []byte) (*LinkagePayload, error) {
	if len(b) == 0 {
		return &LinkagePayload{}, nil
	}
	var p LinkagePayload
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, fmt.Errorf("linkage payload: %w", err)
	}
	return &p, nil
}
