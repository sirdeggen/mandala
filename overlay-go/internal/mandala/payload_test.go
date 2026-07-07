package mandala

import "testing"

func TestDecodeLinkagePayload(t *testing.T) {
	raw := []byte(`{
	  "inputs":[{"index":0,"linkage":{"prover":"02aa","verifier":"02bb","counterparty":"02cc",
	    "protocolID":[2,"mandala token"],"keyID":"k1",
	    "encryptedLinkage":[1,2,3],"encryptedLinkageProof":[0],"proofType":0}}],
	  "outputs":[],
	  "admin":[{"index":1,"actionDetails":{"kind":"issue","assetId":"a.0","amount":100}}]
	}`)
	p, err := DecodeLinkagePayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Inputs) != 1 || p.Inputs[0].Index != 0 {
		t.Fatalf("inputs: %+v", p.Inputs)
	}
	l := p.Inputs[0].Linkage
	if l.ProtocolID.SecurityLevel != 2 || l.ProtocolID.Name != "mandala token" {
		t.Fatalf("protocolID: %+v", l.ProtocolID)
	}
	if string(l.EncryptedLinkage) != "\x01\x02\x03" {
		t.Fatalf("encryptedLinkage: %v", l.EncryptedLinkage)
	}
	if p.Admin[0].ActionDetails.Kind() != "issue" {
		t.Fatalf("admin kind: %+v", p.Admin[0].ActionDetails)
	}
	if n, ok := p.Admin[0].ActionDetails.Num("amount"); !ok || n != 100 {
		t.Fatalf("amount: %d %v", n, ok)
	}
}

func TestDecodeLinkagePayloadEmpty(t *testing.T) {
	for _, in := range [][]byte{nil, {}} {
		p, err := DecodeLinkagePayload(in)
		if err != nil || len(p.Inputs) != 0 || len(p.Outputs) != 0 || len(p.Admin) != 0 {
			t.Fatalf("empty payload: %+v %v", p, err)
		}
	}
}
