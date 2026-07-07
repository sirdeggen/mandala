package mandala

import (
	"reflect"
	"testing"
)

func TestFoldActionTable(t *testing.T) {
	s0 := DefaultAssetState("a.0")
	cases := []struct {
		name    string
		details ActionDetails
		ctx     FoldContext
		check   func(t *testing.T, s AssetAdminState)
	}{
		{"register sets issuer", ActionDetails{"kind": "register"}, FoldContext{Issuer: "02iss"},
			func(t *testing.T, s AssetAdminState) {
				if s.IssuerIdentityKey != "02iss" {
					t.Fatal(s.IssuerIdentityKey)
				}
			}},
		{"pause", ActionDetails{"kind": "pause"}, FoldContext{},
			func(t *testing.T, s AssetAdminState) {
				if !s.IsPaused {
					t.Fatal("not paused")
				}
			}},
		{"block unique-append", ActionDetails{"kind": "blockIdentity", "identityKey": "02x"}, FoldContext{},
			func(t *testing.T, s AssetAdminState) {
				s2 := FoldAction(s, ActionDetails{"kind": "blockIdentity", "identityKey": "02x"}, FoldContext{})
				if len(s2.BlockedIdentities) != 1 {
					t.Fatal(s2.BlockedIdentities)
				}
			}},
		{"setAccessMode allowlist", ActionDetails{"kind": "setAccessMode", "mode": "allowlist"}, FoldContext{},
			func(t *testing.T, s AssetAdminState) {
				if s.AccessMode != "allowlist" {
					t.Fatal(s.AccessMode)
				}
			}},
		{"setAccessMode invalid ignored", ActionDetails{"kind": "setAccessMode", "mode": "wat"}, FoldContext{},
			func(t *testing.T, s AssetAdminState) {
				if s.AccessMode != "denylist" {
					t.Fatal(s.AccessMode)
				}
			}},
		{"freeze records amount+owner", ActionDetails{"kind": "freezeOutput", "outpoint": "t.1"},
			FoldContext{FrozenAmount: 40, FrozenOwner: "02own", HasFrozenRow: true},
			func(t *testing.T, s AssetAdminState) {
				want := []FrozenRef{{Outpoint: "t.1", Amount: 40, Owner: "02own"}}
				if !reflect.DeepEqual(s.FrozenOutpoints, want) {
					t.Fatalf("%+v", s.FrozenOutpoints)
				}
			}},
		{"issue is a no-op", ActionDetails{"kind": "issue", "amount": float64(5)}, FoldContext{},
			func(t *testing.T, s AssetAdminState) {
				if !reflect.DeepEqual(s, s0) {
					t.Fatal("issue must not change state")
				}
			}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.check(t, FoldAction(s0, c.details, c.ctx))
		})
	}
}

func TestReissueEvictsAndUnfreezes(t *testing.T) {
	s := DefaultAssetState("a.0")
	s = FoldAction(s, ActionDetails{"kind": "freezeOutput", "outpoint": "t.1"},
		FoldContext{FrozenAmount: 40, FrozenOwner: "02own", HasFrozenRow: true})
	s = FoldAction(s, ActionDetails{"kind": "reissue", "outpoint": "t.1"}, FoldContext{})
	if len(s.FrozenOutpoints) != 0 {
		t.Fatalf("frozen not cleared: %+v", s.FrozenOutpoints)
	}
	if len(s.EvictedOutpoints) != 1 || s.EvictedOutpoints[0] != "t.1" {
		t.Fatalf("evicted: %+v", s.EvictedOutpoints)
	}
}

func TestFoldIsPure(t *testing.T) {
	s := DefaultAssetState("a.0")
	s = FoldAction(s, ActionDetails{"kind": "blockIdentity", "identityKey": "02x"}, FoldContext{})
	before := append([]string(nil), s.BlockedIdentities...)
	_ = FoldAction(s, ActionDetails{"kind": "blockIdentity", "identityKey": "02y"}, FoldContext{})
	if !reflect.DeepEqual(before, s.BlockedIdentities) {
		t.Fatal("FoldAction mutated its input")
	}
}
