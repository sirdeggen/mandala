package mandala

import (
	"context"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func testDB(t *testing.T) *mongo.Database {
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
	db := client.Database("mandala_go_test")
	t.Cleanup(func() { _ = db.Drop(context.Background()) })
	return db
}

func TestTokenLifecycleAndBalances(t *testing.T) {
	ctx := context.Background()
	s := NewStore(testDB(t))
	row := TokenRow{Txid: "aa", OutputIndex: 1, AssetID: "a.0", Amount: 40, IdentityKey: "02k", CreatedAt: time.Now()}
	if err := s.StoreToken(ctx, row); err != nil {
		t.Fatal(err)
	}
	if err := s.StoreToken(ctx, row); err == nil {
		t.Fatal("duplicate outpoint must violate unique index")
	}
	got, err := s.GetTokenRow(ctx, "aa", 1)
	if err != nil || got == nil || got.Amount != 40 {
		t.Fatalf("%+v %v", got, err)
	}
	_ = s.AdjustBalance(ctx, "02k", 40)
	_ = s.AdjustBalance(ctx, "02k", -15)
	if b, _ := s.GetBalance(ctx, "02k"); b != 25 {
		t.Fatalf("balance %d", b)
	}
	if err := s.DeleteToken(ctx, "aa", 1); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.GetTokenRow(ctx, "aa", 1); got != nil {
		t.Fatal("token not deleted")
	}
}

func TestFindByAssetIDExcludesEvicted(t *testing.T) {
	ctx := context.Background()
	s := NewStore(testDB(t))
	_ = s.StoreToken(ctx, TokenRow{Txid: "t1", OutputIndex: 0, AssetID: "a.0", Amount: 1, CreatedAt: time.Now()})
	_ = s.StoreToken(ctx, TokenRow{Txid: "t2", OutputIndex: 0, AssetID: "a.0", Amount: 1, CreatedAt: time.Now()})
	st := DefaultAssetState("a.0")
	st.EvictedOutpoints = []string{"t2.0"}
	_ = s.PutAssetState(ctx, st)
	ops, err := s.FindByAssetID(ctx, "a.0")
	if err != nil || len(ops) != 1 || ops[0].Txid != "t1" {
		t.Fatalf("%+v %v", ops, err)
	}
}

func TestAdminHistoryOrderingAndSummary(t *testing.T) {
	ctx := context.Background()
	s := NewStore(testDB(t))
	seq1, _ := s.NextAdmitSeq(ctx)
	seq2, _ := s.NextAdmitSeq(ctx)
	if seq2 != seq1+1 {
		t.Fatalf("admitSeq not monotonic: %d %d", seq1, seq2)
	}
	unconfirmed := int64(9007199254740991)
	_ = s.AppendAdminHistory(ctx, AdminHistoryEntry{AssetID: "a.0", Txid: "t2", Height: unconfirmed, AdmitSeq: seq2,
		ActionDetails: ActionDetails{"kind": "issue", "amount": float64(100)}, CreatedAt: time.Now()})
	_ = s.AppendAdminHistory(ctx, AdminHistoryEntry{AssetID: "a.0", Txid: "t1", Height: 10, Offset: 3, AdmitSeq: seq1,
		ActionDetails: ActionDetails{"kind": "redeem", "amount": float64(30)}, CreatedAt: time.Now()})
	hist, err := s.FindAdminHistoryByAssetID(ctx, "a.0")
	if err != nil || len(hist) != 2 || hist[0].Txid != "t1" {
		t.Fatalf("sorted history: %+v %v", hist, err)
	}
	page, _ := s.PageAdminHistory(ctx, "a.0", 1, 0)
	if len(page) != 1 || page[0].AdmitSeq != seq2 {
		t.Fatalf("page newest-first: %+v", page)
	}
	iss, red, count, err := s.AdminSummary(ctx, "a.0")
	if err != nil || iss != 100 || red != 30 || count != 2 {
		t.Fatalf("summary %d %d %d %v", iss, red, count, err)
	}
}

func TestGetAssetStateDefault(t *testing.T) {
	s := NewStore(testDB(t))
	st, err := s.GetAssetState(context.Background(), "missing.0")
	if err != nil || st.AccessMode != "denylist" || st.BlockedIdentities == nil {
		t.Fatalf("%+v %v", st, err)
	}
}
