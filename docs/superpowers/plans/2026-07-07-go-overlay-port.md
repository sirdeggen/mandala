# Go Overlay Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement the Mandala overlay service as a Go server (`overlay-go/`) that the unchanged frontend can talk to, with Mongo storage and full Arcade parity.

**Architecture:** go-overlay-services engine + a custom Fiber HTTP layer that reproduces the TS wire contract byte-for-byte; mandala domain logic (token/admin codecs, linkage crypto, topic gates, lookup projections, reducer) ported per the spec appendices; Mongo throughout (b-open-io/overlay for engine storage, mongo-go-driver for mandala collections).

**Tech Stack:** Go 1.25, `github.com/bsv-blockchain/go-overlay-services` v1.3.x, `github.com/bsv-blockchain/go-sdk` v1.2.x, `github.com/b-open-io/overlay` v3.x, `go.mongodb.org/mongo-driver/v2`, `github.com/gofiber/fiber/v2`.

**Spec:** `docs/superpowers/specs/2026-07-07-go-overlay-port-design.md`
**Appendix A (byte layouts, crypto, gates, reducer, storage ops):** `docs/superpowers/specs/2026-07-07-go-overlay-port-appendix-a-port-spec.md`
**Appendix B (wire contract):** `docs/superpowers/specs/2026-07-07-go-overlay-port-appendix-b-wire-contract.md`

## Global Constraints

- Frontend app is NEVER modified. The wire contract in Appendix B is the acceptance bar.
- Module path: `github.com/sirdeggen/mandala/overlay-go`. All Go code lives under `overlay-go/`.
- Rejection semantics: a tx the overlay did not fold must never produce HTTP 200 with non-empty `outputsToAdmit` for `tm_mandala`. Topic rejections → HTTP 400 `{"status":"error","message":...}`.
- Mongo collections/indexes must byte-match Appendix A §5 (same names: `mandalaTokens`, `mandalaLinkageRecords`, `mandalaBalances`, `mandalaMetadata`, `mandalaAssetStates`, `mandalaAdminHistory`, `mandalaCounters`). Database name: `${NODE_NAME}_lookup_services`.
- Env vars: `NODE_NAME`, `SERVER_PRIVATE_KEY`, `HOSTING_URL`, `MONGO_URL`, `NETWORK`, optional `ARCADE_URL`, `ARCADE_API_KEY`, `CHAINTRACKS_URL` (default `${ARCADE_URL}/chaintracks`), `CHAINTRACKS_API_PREFIX` (default `/v2`). Port 8080.
- Tests that need Mongo dial `mongodb://localhost:27017` (the repo's compose Mongo) and `t.Skip` when unreachable within 2s. Everything else must run offline.
- TDD: every task writes its failing test first, watches it fail, then implements.
- Amounts are `int64` everywhere; reject values > 9007199254740991 (JS max-safe) at decode boundaries.
- Exact library APIs (go-sdk `ProtoWallet`, engine `Config`, b-open-io constructors) were researched from source but MUST be reconciled against `go doc` output in Task 1; later tasks then compile against the pinned versions. If a signature differs, keep the plan's semantics and adapt the call shape.

---

### Task 1: Module scaffold, pinned deps, ctx-propagation spike

**Files:**
- Create: `overlay-go/go.mod`, `overlay-go/cmd/overlay/main.go`, `overlay-go/README.md`
- Create: `overlay-go/internal/mandala/doc.go`

**Interfaces:**
- Produces: a compiling module every later task builds inside; a recorded YES/NO decision (in `overlay-go/README.md`) on whether `Engine.Submit`'s ctx reaches `TopicManager.IdentifyAdmissibleOutputs`, choosing `ctxvals` (Task 10) strategy.

- [ ] **Step 1: Scaffold module**

```bash
mkdir -p overlay-go/cmd/overlay overlay-go/internal/mandala
cd overlay-go
go mod init github.com/sirdeggen/mandala/overlay-go
go get github.com/bsv-blockchain/go-overlay-services@v1.3.2
go get github.com/bsv-blockchain/go-sdk@latest
go get github.com/b-open-io/overlay@latest
go get go.mongodb.org/mongo-driver/v2@latest
go get github.com/gofiber/fiber/v2@latest
```

`cmd/overlay/main.go`:

```go
package main

import "fmt"

func main() {
	fmt.Println("mandala overlay-go: not wired yet")
}
```

`internal/mandala/doc.go`:

```go
// Package mandala ports the @bsv/overlay-topics mandala domain logic to Go.
// Byte layouts, crypto, and gate semantics: docs/superpowers/specs/
// 2026-07-07-go-overlay-port-appendix-a-port-spec.md
package mandala
```

- [ ] **Step 2: Verify it builds**

Run: `cd overlay-go && go build ./...`
Expected: exit 0.

- [ ] **Step 3: Reconcile researched APIs against the pinned modules**

Run and paste key signatures into `overlay-go/README.md` under "## Pinned API notes":

```bash
go doc github.com/bsv-blockchain/go-overlay-services/pkg/core/engine TopicManager
go doc github.com/bsv-blockchain/go-overlay-services/pkg/core/engine LookupService
go doc github.com/bsv-blockchain/go-overlay-services/pkg/core/engine Config
go doc github.com/bsv-blockchain/go-overlay-services/pkg/core/engine Engine.Submit
go doc github.com/bsv-blockchain/go-sdk/overlay TaggedBEEF
go doc github.com/bsv-blockchain/go-sdk/overlay AdmittanceInstructions
go doc github.com/bsv-blockchain/go-sdk/wallet NewProtoWallet
go doc github.com/bsv-blockchain/go-sdk/wallet ProtoWallet.Decrypt
go doc github.com/b-open-io/overlay/storage | head -80
```

Expected: signatures matching the spec's research; if b-open-io v3 no longer implements `engine.Storage` from go-overlay-services v1.3.2, pin the latest tag that does (try v2.x tags) and record the chosen version in README. If none is compatible, STOP and flag — the fallback (own Mongo engine.Storage) is a spec-level decision.

- [ ] **Step 4: ctx-propagation spike**

Read the engine source at the pinned version (module cache: `$(go env GOMODCACHE)/github.com/bsv-blockchain/go-overlay-services@v1.3.2/pkg/core/engine/engine.go`). Find the `IdentifyAdmissibleOutputs` call site inside `Submit`/`SubmitParsedBeef`. Record in README:
- `ctx propagated: YES` → Task 10 uses `context.WithValue`.
- `ctx propagated: NO` → Task 10 uses the `sync.Map` fallback (code for both is in Task 10).

- [ ] **Step 5: Commit**

```bash
git add overlay-go
git commit -m "feat(overlay-go): scaffold Go overlay module, pin deps"
```

---

### Task 2: Golden vectors generated from the TS packages

**Files:**
- Create: `overlay-go/testdata/gen/gen.mjs`, `overlay-go/testdata/gen/package.json`
- Create (generated, committed): `overlay-go/testdata/vectors.json`

**Interfaces:**
- Produces: `overlay-go/testdata/vectors.json` with fields `tokenScripts[]`, `adminScripts[]`, `assetIds[]`, `commitments[]`, `linkage` — consumed by Tasks 3, 4, 6.

- [ ] **Step 1: Write the generator**

`overlay-go/testdata/gen/package.json`:

```json
{
  "name": "mandala-go-vectors",
  "private": true,
  "type": "module",
  "dependencies": {
    "@bsv/sdk": "2.1.6",
    "@bsv/templates": "^1.9.0"
  }
}
```

`overlay-go/testdata/gen/gen.mjs`:

```js
// Emits golden vectors for the Go port. Run: npm install && node gen.mjs
import { writeFileSync } from 'node:fs'
import { PrivateKey, ProtoWallet, Hash, Utils } from '@bsv/sdk'
import { MandalaToken, MandalaAdmin, commitment } from '@bsv/templates'

const TXID = 'ab'.repeat(32)
const ASSET = `${TXID}.0`
const PKH = Array.from({ length: 20 }, (_, i) => i + 1)

// --- token scripts across amount encodings ---
const amounts = [1, 16, 17, 255, 256, 65535, 4294967296, 9007199254740991]
const tokenScripts = amounts.map(amount => ({
  assetId: ASSET, amount,
  pubKeyHash: PKH,
  scriptHex: new MandalaToken().lock(ASSET, amount, PKH).toHex()
}))

// --- assetId encodings, incl. nonzero vout ---
const assetIds = [ASSET, `${'01'.repeat(32)}.7`, `${'ff'.repeat(32)}.4294967295`]

// --- admin scripts: plain + publicData variants ---
const adminScripts = [
  { publicData: null, pubKeyHash: PKH, scriptHex: new MandalaAdmin().lock(PKH).toHex() },
  {
    publicData: { label: 'Test Coin', decimals: 2 }, pubKeyHash: PKH,
    scriptHex: new MandalaAdmin().lock(PKH, { label: 'Test Coin', decimals: 2 }).toHex()
  }
]

// --- commitment canonical-JSON cases ---
const commitmentCases = [
  { kind: 'register', assetId: ASSET },
  { kind: 'issue', assetId: ASSET, amount: 1000, priorOutpoint: `${TXID}.0` },
  { z: 1, a: [3, { b: 'x', A: null }], nested: { deep: { key: 'väl' } } },
  { kind: 'freezeOutput', outpoint: `${TXID}.3`, amount: 0 }
]
const commitments = commitmentCases.map(details => ({ details, hash: commitment(details) }))

// --- linkage fixture: prover reveals, Go verifier must decrypt + match pkh ---
const proverPriv = new PrivateKey(42)
const verifierPriv = new PrivateKey(69)
const holderPriv = new PrivateKey(1337) // counterparty the child key was derived FOR
const prover = new ProtoWallet(proverPriv)
const protocolID = [2, 'mandala token']
const keyID = 'xfer-golden-1'
const counterparty = holderPriv.toPublicKey().toString()
const { publicKey: derived } = await prover.getPublicKey({ protocolID, keyID, counterparty })
const reveal = await prover.revealSpecificKeyLinkage({
  counterparty, verifier: verifierPriv.toPublicKey().toString(), protocolID, keyID
})
const linkage = {
  verifierPrivHex: verifierPriv.toHex(),
  proverIdentityKey: proverPriv.toPublicKey().toString(),
  counterparty, protocolID, keyID,
  encryptedLinkage: reveal.encryptedLinkage,
  encryptedLinkageProof: reveal.encryptedLinkageProof,
  proofType: reveal.proofType,
  expectedDerivedKey: derived,
  expectedPubKeyHash: Hash.hash160(Utils.toArray(derived, 'hex'))
}

writeFileSync('../vectors.json', JSON.stringify(
  { tokenScripts, assetIds, adminScripts, commitments, linkage }, null, 2))
console.log('wrote ../vectors.json')
```

Note: if `@bsv/templates` does not export `commitment` or `MandalaAdmin.lock(pkh, publicData)` under those exact names, check `app/node_modules/@bsv/templates/src/MandalaAdmin.ts` and `mandala-signing.ts` for the real export names (`commitment` lives in mandala-signing per Appendix A §1.4) and adjust imports only.

- [ ] **Step 2: Run the generator**

Run: `cd overlay-go/testdata/gen && npm install && node gen.mjs`
Expected: `wrote ../vectors.json`; file contains all five top-level keys, `linkage.expectedPubKeyHash` is a 20-number array.

- [ ] **Step 3: Commit (vectors are committed; gen deps are not)**

```bash
echo "node_modules/" > overlay-go/testdata/gen/.gitignore
git add overlay-go/testdata
git commit -m "test(overlay-go): golden vectors generated from TS packages"
```

---

### Task 3: MandalaToken script codec

**Files:**
- Create: `overlay-go/internal/mandala/token.go`
- Test: `overlay-go/internal/mandala/token_test.go`

**Interfaces:**
- Produces:
  - `type TokenDecoded struct { AssetID string; Amount int64; PubKeyHash [20]byte }`
  - `func DecodeToken(s *script.Script) (*TokenDecoded, error)`
  - `func EncodeAssetID(assetID string) ([]byte, error)` / `func DecodeAssetID(b []byte) (string, error)`
  - `func LockToken(assetID string, amount int64, pubKeyHash []byte) (*script.Script, error)` (needed by tests and activity)
- Consumes: `github.com/bsv-blockchain/go-sdk/script` (`script.NewFromHex`, `(*Script).Chunks()`).

- [ ] **Step 1: Write the failing test**

`token_test.go`:

```go
package mandala

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/bsv-blockchain/go-sdk/script"
)

type vectors struct {
	TokenScripts []struct {
		AssetID    string `json:"assetId"`
		Amount     int64  `json:"amount"`
		PubKeyHash []byte `json:"pubKeyHash"`
		ScriptHex  string `json:"scriptHex"`
	} `json:"tokenScripts"`
	AssetIDs []string `json:"assetIds"`
}

func loadVectors(t *testing.T) vectors {
	t.Helper()
	b, err := os.ReadFile("../../testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vectors
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestDecodeTokenGoldenVectors(t *testing.T) {
	for _, tv := range loadVectors(t).TokenScripts {
		s, err := script.NewFromHex(tv.ScriptHex)
		if err != nil {
			t.Fatal(err)
		}
		d, err := DecodeToken(s)
		if err != nil {
			t.Fatalf("amount %d: %v", tv.Amount, err)
		}
		if d.AssetID != tv.AssetID || d.Amount != tv.Amount {
			t.Fatalf("amount %d: got %+v", tv.Amount, d)
		}
	}
}

func TestLockRoundTripsThroughDecode(t *testing.T) {
	for _, tv := range loadVectors(t).TokenScripts {
		s, err := LockToken(tv.AssetID, tv.Amount, tv.PubKeyHash)
		if err != nil {
			t.Fatal(err)
		}
		if s.String() != tv.ScriptHex { // byte-identical to the TS encoder
			t.Fatalf("amount %d: encode mismatch", tv.Amount)
		}
	}
}

func TestAssetIDRoundTrip(t *testing.T) {
	for _, id := range loadVectors(t).AssetIDs {
		b, err := EncodeAssetID(id)
		if err != nil {
			t.Fatal(err)
		}
		if len(b) != 36 {
			t.Fatalf("want 36 bytes, got %d", len(b))
		}
		back, err := DecodeAssetID(b)
		if err != nil || back != id {
			t.Fatalf("round trip %q -> %q (%v)", id, back, err)
		}
	}
}

func TestDecodeTokenRejectsNonToken(t *testing.T) {
	s, _ := script.NewFromHex("006a") // OP_FALSE OP_RETURN
	if _, err := DecodeToken(s); err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Token|AssetID' -v`
Expected: FAIL — `DecodeToken` undefined.

- [ ] **Step 3: Implement**

`token.go` (layout per Appendix A §1.2–1.3 — 8 chunks: push36 assetId, scriptnum amount, OP_2DROP, then P2PKH; decode accepts OP_1..OP_16 amount opcodes and data-form script numbers; assetId = reversed txid ‖ LE uint32 vout):

```go
package mandala

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/bsv-blockchain/go-sdk/script"
)

const maxSafeAmount = int64(9007199254740991)

type TokenDecoded struct {
	AssetID    string
	Amount     int64
	PubKeyHash [20]byte
}

func EncodeAssetID(assetID string) ([]byte, error) {
	dot := strings.LastIndexByte(assetID, '.')
	if dot < 0 {
		return nil, fmt.Errorf("assetId missing vout: %q", assetID)
	}
	txidHex, voutStr := assetID[:dot], assetID[dot+1:]
	if len(txidHex) != 64 {
		return nil, fmt.Errorf("assetId txid must be 64 hex chars")
	}
	txid, err := hex.DecodeString(txidHex)
	if err != nil {
		return nil, err
	}
	vout, err := strconv.ParseUint(voutStr, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("assetId vout: %w", err)
	}
	out := make([]byte, 36)
	for i := 0; i < 32; i++ { // display order -> internal order
		out[i] = txid[31-i]
	}
	binary.LittleEndian.PutUint32(out[32:], uint32(vout))
	return out, nil
}

func DecodeAssetID(b []byte) (string, error) {
	if len(b) != 36 {
		return "", fmt.Errorf("assetId must be 36 bytes, got %d", len(b))
	}
	rev := make([]byte, 32)
	for i := 0; i < 32; i++ {
		rev[i] = b[31-i]
	}
	vout := binary.LittleEndian.Uint32(b[32:])
	return fmt.Sprintf("%s.%d", hex.EncodeToString(rev), vout), nil
}

// decodeScriptNumChunk accepts OP_0/OP_1NEGATE/OP_1..OP_16 opcode forms and
// little-endian sign-magnitude data forms (Appendix A §1.1).
func decodeScriptNumChunk(op byte, data []byte) (int64, error) {
	switch {
	case op == script.Op0:
		return 0, nil
	case op == script.Op1NEGATE:
		return -1, nil
	case op >= script.Op1 && op <= script.Op16:
		return int64(op-script.Op1) + 1, nil
	}
	if len(data) == 0 {
		return 0, nil
	}
	if len(data) > 8 {
		return 0, fmt.Errorf("script number too large")
	}
	var n int64
	for i := len(data) - 1; i >= 0; i-- {
		b := data[i]
		if i == len(data)-1 {
			n = int64(b & 0x7f)
		} else {
			n = n<<8 | int64(b)
		}
	}
	if data[len(data)-1]&0x80 != 0 {
		n = -n
	}
	return n, nil
}

func encodeScriptNum(n int64) []byte {
	if n == 0 {
		return nil
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var out []byte
	for n > 0 {
		out = append(out, byte(n&0xff))
		n >>= 8
	}
	if out[len(out)-1]&0x80 != 0 {
		if neg {
			out = append(out, 0x80)
		} else {
			out = append(out, 0x00)
		}
	} else if neg {
		out[len(out)-1] |= 0x80
	}
	return out
}

func DecodeToken(s *script.Script) (*TokenDecoded, error) {
	chunks, err := s.Chunks()
	if err != nil {
		return nil, err
	}
	if len(chunks) != 8 {
		return nil, fmt.Errorf("not a mandala token: %d chunks", len(chunks))
	}
	if chunks[2].Op != script.Op2DROP || chunks[3].Op != script.OpDUP ||
		chunks[4].Op != script.OpHASH160 || chunks[6].Op != script.OpEQUALVERIFY ||
		chunks[7].Op != script.OpCHECKSIG {
		return nil, fmt.Errorf("not a mandala token: opcode shape")
	}
	if len(chunks[0].Data) != 36 {
		return nil, fmt.Errorf("not a mandala token: assetId push")
	}
	assetID, err := DecodeAssetID(chunks[0].Data)
	if err != nil {
		return nil, err
	}
	amount, err := decodeScriptNumChunk(chunks[1].Op, chunks[1].Data)
	if err != nil {
		return nil, err
	}
	if amount < 1 || amount > maxSafeAmount {
		return nil, fmt.Errorf("invalid token amount %d", amount)
	}
	if len(chunks[5].Data) != 20 {
		return nil, fmt.Errorf("not a mandala token: pkh push")
	}
	d := &TokenDecoded{AssetID: assetID, Amount: amount}
	copy(d.PubKeyHash[:], chunks[5].Data)
	return d, nil
}

func LockToken(assetID string, amount int64, pubKeyHash []byte) (*script.Script, error) {
	if len(pubKeyHash) != 20 {
		return nil, fmt.Errorf("pubKeyHash must be 20 bytes")
	}
	if amount < 1 || amount > maxSafeAmount {
		return nil, fmt.Errorf("amount out of range")
	}
	aid, err := EncodeAssetID(assetID)
	if err != nil {
		return nil, err
	}
	s := &script.Script{}
	_ = s.AppendPushData(aid)
	if amount >= 1 && amount <= 16 { // minimal-push opcode form
		_ = s.AppendOpcodes(script.Op1 + byte(amount-1))
	} else {
		_ = s.AppendPushData(encodeScriptNum(amount))
	}
	_ = s.AppendOpcodes(script.Op2DROP, script.OpDUP, script.OpHASH160)
	_ = s.AppendPushData(pubKeyHash)
	_ = s.AppendOpcodes(script.OpEQUALVERIFY, script.OpCHECKSIG)
	return s, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Token|AssetID' -v`
Expected: PASS (all four tests). If `script.Op2DROP`-style constant names differ in go-sdk, fix names via `go doc github.com/bsv-blockchain/go-sdk/script | grep -i op2drop` — values are fixed by Bitcoin (0x6d etc.).

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): MandalaToken codec against golden vectors"
```

---

### Task 4: MandalaAdmin codec + canonical-JSON commitment

**Files:**
- Create: `overlay-go/internal/mandala/admin.go`
- Test: `overlay-go/internal/mandala/admin_test.go`

**Interfaces:**
- Produces:
  - `type AdminDecoded struct { PubKeyHash [20]byte; PublicData map[string]any }`
  - `func DecodeAdmin(s *script.Script) (*AdminDecoded, error)`
  - `func Commitment(details map[string]any) (string, error)` — lowercase-hex SHA256 of canonical JSON (Appendix A §1.4)
- Consumes: `DecodeAssetID` conventions from Task 3 (same package).

- [ ] **Step 1: Write the failing test**

`admin_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Admin|Commitment' -v`
Expected: FAIL — `DecodeAdmin` undefined.

- [ ] **Step 3: Implement**

`admin.go`. Canonical JSON gotcha: JSON round-trip gives `float64` numbers; JS `JSON.stringify(2)` is `2`, `JSON.stringify(2.5)` is `2.5` — format floats with `strconv.FormatFloat(f, 'g', -1, 64)` and integers without a point. Key order: plain byte-wise string sort (JS code-unit order == Go `sort.Strings` for these keys).

```go
package mandala

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/bsv-blockchain/go-sdk/script"
)

type AdminDecoded struct {
	PubKeyHash [20]byte
	PublicData map[string]any
}

func DecodeAdmin(s *script.Script) (*AdminDecoded, error) {
	chunks, err := s.Chunks()
	if err != nil {
		return nil, err
	}
	d := &AdminDecoded{}
	p2pkh := chunks
	if len(chunks) == 7 { // publicData variant: <push json> OP_DROP <p2pkh...>
		if chunks[1].Op != script.OpDROP || len(chunks[0].Data) == 0 {
			return nil, fmt.Errorf("not a mandala admin output")
		}
		var pd map[string]any
		if err := json.Unmarshal(chunks[0].Data, &pd); err != nil {
			return nil, fmt.Errorf("admin publicData: %w", err)
		}
		d.PublicData = pd
		p2pkh = chunks[2:]
	} else if len(chunks) != 5 {
		return nil, fmt.Errorf("not a mandala admin output: %d chunks", len(chunks))
	}
	if p2pkh[0].Op != script.OpDUP || p2pkh[1].Op != script.OpHASH160 ||
		p2pkh[3].Op != script.OpEQUALVERIFY || p2pkh[4].Op != script.OpCHECKSIG ||
		len(p2pkh[2].Data) != 20 {
		return nil, fmt.Errorf("not a mandala admin output: p2pkh shape")
	}
	copy(d.PubKeyHash[:], p2pkh[2].Data)
	return d, nil
}

// canonicalize matches the TS commitment() canonical form: objects get
// byte-sorted keys, arrays keep order, primitives use JS JSON.stringify
// formatting (Appendix A §1.4).
func canonicalize(v any, b *strings.Builder) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		enc, err := json.Marshal(x)
		if err != nil {
			return err
		}
		b.Write(enc)
	case float64:
		if x == math.Trunc(x) && math.Abs(x) < 1e21 {
			b.WriteString(strconv.FormatFloat(x, 'f', -1, 64))
		} else {
			b.WriteString(strconv.FormatFloat(x, 'g', -1, 64))
		}
	case json.Number:
		b.WriteString(x.String())
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalize(e, b); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			enc, _ := json.Marshal(k)
			b.Write(enc)
			b.WriteByte(':')
			if err := canonicalize(x[k], b); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("commitment: unsupported type %T", v)
	}
	return nil
}

func Commitment(details map[string]any) (string, error) {
	var b strings.Builder
	if err := canonicalize(details, &b); err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:]), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Admin|Commitment' -v`
Expected: PASS. The unicode key case (`väl`) proves string escaping matches JS.

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): MandalaAdmin codec + canonical-JSON commitment"
```

---

### Task 5: Linkage payload types + decode

**Files:**
- Create: `overlay-go/internal/mandala/payload.go`
- Test: `overlay-go/internal/mandala/payload_test.go`

**Interfaces:**
- Produces:
  - `type SpecificLinkage struct { Prover, Verifier, Counterparty string; ProtocolID ProtocolID; KeyID string; EncryptedLinkage, EncryptedLinkageProof []byte; ProofType int }` with JSON tags matching the TS field names exactly (`prover`, `verifier`, `counterparty`, `protocolID`, `keyID`, `encryptedLinkage`, `encryptedLinkageProof`, `proofType`)
  - `type ProtocolID struct { SecurityLevel int; Name string }` marshaling to/from the JSON tuple `[2,"mandala token"]`
  - `type ActionDetails map[string]any` with helpers `Kind() string`, `Str(key string) (string, bool)`, `Num(key string) (int64, bool)`
  - `type LinkagePayload struct { Inputs, Outputs []IndexedLinkage; Admin []IndexedAdmin }`
  - `func DecodeLinkagePayload(b []byte) (*LinkagePayload, error)` — nil/empty input → empty payload (Appendix A §0.5)
- Note: `EncryptedLinkage` arrives as a JSON **number array**, not base64 — needs a custom `[]byte`-alias type `NumBytes` with UnmarshalJSON/MarshalJSON reading/writing `[1,2,3]`.

- [ ] **Step 1: Write the failing test**

`payload_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run Payload -v`
Expected: FAIL — types undefined.

- [ ] **Step 3: Implement**

`payload.go`:

```go
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run Payload -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): off-chain linkage payload types"
```

---

### Task 6: verifyKeyLinkage (BRC-42/43/72 verifier side)

**Files:**
- Create: `overlay-go/internal/mandala/linkage.go`
- Test: `overlay-go/internal/mandala/linkage_test.go`

**Interfaces:**
- Produces:
  - `type Verifier struct { ... }` / `func NewVerifier(privHex string) (*Verifier, error)` — wraps a go-sdk `ProtoWallet` + identity key
  - `func (v *Verifier) IdentityKey() string`
  - `func (v *Verifier) VerifyKeyLinkage(ctx context.Context, l *SpecificLinkage) (identityKey string, pubKeyHash []byte, err error)` — Appendix A §2.5
  - `func (v *Verifier) LinkageControlsPKH(ctx context.Context, l *SpecificLinkage, pkh []byte) bool` — false on any error
- Consumes: Task 5 types; go-sdk `wallet.ProtoWallet.Decrypt`, `ec` point ops, `hash.Hash160`.

- [ ] **Step 1: Write the failing test**

`linkage_test.go` (uses the golden fixture — a real TS `revealSpecificKeyLinkage` output — plus a pure-Go round-trip with go-sdk as prover):

```go
package mandala

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"
)

type linkageVector struct {
	Linkage struct {
		VerifierPrivHex       string   `json:"verifierPrivHex"`
		ProverIdentityKey     string   `json:"proverIdentityKey"`
		Counterparty          string   `json:"counterparty"`
		ProtocolID            [2]any   `json:"protocolID"`
		KeyID                 string   `json:"keyID"`
		EncryptedLinkage      NumBytes `json:"encryptedLinkage"`
		EncryptedLinkageProof NumBytes `json:"encryptedLinkageProof"`
		ProofType             int      `json:"proofType"`
		ExpectedDerivedKey    string   `json:"expectedDerivedKey"`
		ExpectedPubKeyHash    NumBytes `json:"expectedPubKeyHash"`
	} `json:"linkage"`
}

func TestVerifyKeyLinkageGoldenVector(t *testing.T) {
	b, err := os.ReadFile("../../testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v linkageVector
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	lv := v.Linkage
	ver, err := NewVerifier(lv.VerifierPrivHex)
	if err != nil {
		t.Fatal(err)
	}
	l := &SpecificLinkage{
		Prover:           lv.ProverIdentityKey,
		Verifier:         ver.IdentityKey(),
		Counterparty:     lv.Counterparty,
		ProtocolID:       ProtocolID{SecurityLevel: 2, Name: "mandala token"},
		KeyID:            lv.KeyID,
		EncryptedLinkage: lv.EncryptedLinkage,
		ProofType:        lv.ProofType,
	}
	identity, pkh, err := ver.VerifyKeyLinkage(context.Background(), l)
	if err != nil {
		t.Fatal(err)
	}
	if identity != lv.Counterparty {
		t.Fatalf("identity: %s", identity)
	}
	if !bytes.Equal(pkh, lv.ExpectedPubKeyHash) {
		t.Fatalf("pkh mismatch: %x vs %x", pkh, []byte(lv.ExpectedPubKeyHash))
	}
	if !ver.LinkageControlsPKH(context.Background(), l, lv.ExpectedPubKeyHash) {
		t.Fatal("LinkageControlsPKH must be true for the golden pkh")
	}
	if ver.LinkageControlsPKH(context.Background(), l, make([]byte, 20)) {
		t.Fatal("LinkageControlsPKH must be false for a wrong pkh")
	}
}

func TestVerifyKeyLinkageTamperedCiphertextFails(t *testing.T) {
	b, _ := os.ReadFile("../../testdata/vectors.json")
	var v linkageVector
	_ = json.Unmarshal(b, &v)
	ver, _ := NewVerifier(v.Linkage.VerifierPrivHex)
	bad := make(NumBytes, len(v.Linkage.EncryptedLinkage))
	copy(bad, v.Linkage.EncryptedLinkage)
	bad[40] ^= 0xff // flip a ciphertext byte past the 32-byte IV
	l := &SpecificLinkage{
		Prover: v.Linkage.ProverIdentityKey, Counterparty: v.Linkage.Counterparty,
		ProtocolID: ProtocolID{2, "mandala token"}, KeyID: v.Linkage.KeyID,
		EncryptedLinkage: bad,
	}
	if _, _, err := ver.VerifyKeyLinkage(context.Background(), l); err == nil {
		t.Fatal("tampered ciphertext must fail GCM auth")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run Linkage -v`
Expected: FAIL — `NewVerifier` undefined.

- [ ] **Step 3: Implement**

`linkage.go`. Algorithm (Appendix A §2.5): decrypt `encryptedLinkage` as the verifier with wrapper protocol `[2, "specific linkage revelation <origLevel> <origName>"]`, original keyID, counterparty = **prover**; then `derived = Point(counterparty) + (L mod n)·G`; `pkh = hash160(compressed derived)`. go-sdk's ProtoWallet.Decrypt implements BRC-2 (32-byte GCM nonce) internally.

```go
package mandala

import (
	"context"
	"fmt"
	"math/big"

	ec "github.com/bsv-blockchain/go-sdk/primitives/ec"
	"github.com/bsv-blockchain/go-sdk/primitives/hash"
	"github.com/bsv-blockchain/go-sdk/wallet"
)

type Verifier struct {
	pw       *wallet.ProtoWallet
	identity string
}

func NewVerifier(privHex string) (*Verifier, error) {
	priv, err := ec.PrivateKeyFromHex(privHex)
	if err != nil {
		return nil, fmt.Errorf("verifier key: %w", err)
	}
	pw, err := wallet.NewProtoWallet(wallet.ProtoWalletArgs{
		Type: wallet.ProtoWalletArgsTypePrivateKey, PrivateKey: priv,
	})
	if err != nil {
		return nil, err
	}
	return &Verifier{pw: pw, identity: priv.PubKey().ToDERHex()}, nil
}

func (v *Verifier) IdentityKey() string { return v.identity }

func (v *Verifier) VerifyKeyLinkage(ctx context.Context, l *SpecificLinkage) (string, []byte, error) {
	proverPub, err := ec.PublicKeyFromString(l.Prover)
	if err != nil {
		return "", nil, fmt.Errorf("prover key: %w", err)
	}
	wrapper := wallet.Protocol{
		SecurityLevel: wallet.SecurityLevelEveryAppAndCounterparty, // 2
		Protocol: fmt.Sprintf("specific linkage revelation %d %s",
			l.ProtocolID.SecurityLevel, l.ProtocolID.Name),
	}
	dec, err := v.pw.Decrypt(ctx, wallet.DecryptArgs{
		EncryptionArgs: wallet.EncryptionArgs{
			ProtocolID: wrapper,
			KeyID:      l.KeyID,
			Counterparty: wallet.Counterparty{
				Type: wallet.CounterpartyTypeOther, Counterparty: proverPub,
			},
		},
		Ciphertext: []byte(l.EncryptedLinkage),
	}, "")
	if err != nil {
		return "", nil, fmt.Errorf("linkage decrypt: %w", err)
	}
	counterPub, err := ec.PublicKeyFromString(l.Counterparty)
	if err != nil {
		return "", nil, fmt.Errorf("counterparty key: %w", err)
	}
	// derived = counterparty + (L mod n)·G
	curve := ec.S256()
	scalar := new(big.Int).SetBytes(dec.Plaintext)
	scalar.Mod(scalar, curve.Params().N)
	lx, ly := curve.ScalarBaseMult(scalar.Bytes())
	dx, dy := curve.Add(counterPub.X, counterPub.Y, lx, ly)
	derived := &ec.PublicKey{Curve: curve, X: dx, Y: dy}
	pkh := hash.Hash160(derived.Compressed())
	return l.Counterparty, pkh, nil
}

func (v *Verifier) LinkageControlsPKH(ctx context.Context, l *SpecificLinkage, pkh []byte) bool {
	if l == nil || len(pkh) != 20 {
		return false
	}
	_, got, err := v.VerifyKeyLinkage(ctx, l)
	if err != nil || len(got) != len(pkh) {
		return false
	}
	for i := range got {
		if got[i] != pkh[i] {
			return false
		}
	}
	return true
}
```

API reconciliation notes (Task 1 README): `Decrypt`'s originator param, `wallet.Counterparty` shape, `PublicKey.Compressed()` vs `.Compressed()` naming, and whether `PublicKeyFromString` lives in `ec` — adjust to `go doc` reality, semantics fixed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run Linkage -v`
Expected: PASS — decrypting a ciphertext produced by the real TS SDK proves the whole BRC-42/43/2 chain (invoice-number normalization, 32-byte nonce, child-key ECDH) end to end.

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): BRC-72 verifier-side key-linkage verification"
```

---

### Task 7: AssetAdminState reducer

**Files:**
- Create: `overlay-go/internal/mandala/reducer.go`
- Test: `overlay-go/internal/mandala/reducer_test.go`

**Interfaces:**
- Produces:
  - `type FrozenRef struct { Outpoint string; Amount int64; Owner string }` (JSON: `outpoint`, `amount`, `owner`)
  - `type AssetAdminState struct { AssetID string; IssuerIdentityKey string; IsPaused bool; AccessMode string; BlockedIdentities, AllowedIdentities []string; FrozenOutpoints []FrozenRef; EvictedOutpoints []string; LastProcessedHeight, LastProcessedOffset, LastAdmitSeq int64 }` — JSON tags exactly `assetId`, `issuerIdentityKey`, `isPaused`, `accessMode`, `blockedIdentities`, `allowedIdentities`, `frozenOutpoints`, `evictedOutpoints`, `lastProcessedHeight`, `lastProcessedOffset`, `lastAdmitSeq`. Slices initialized non-nil (JSON `[]`, never `null` — the app parses arrays).
  - `func DefaultAssetState(assetID string) AssetAdminState` (accessMode `"denylist"`)
  - `type FoldContext struct { Issuer string; FrozenAmount int64; FrozenOwner string; HasFrozenRow bool }`
  - `func FoldAction(prev AssetAdminState, details ActionDetails, ctx FoldContext) AssetAdminState` — pure, copy-on-write (Appendix A §6)

- [ ] **Step 1: Write the failing test**

`reducer_test.go` (table across every kind + idempotence of unique-append):

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Fold|Reissue' -v`
Expected: FAIL — undefined.

- [ ] **Step 3: Implement**

`reducer.go` (Appendix A §6, verbatim table):

```go
package mandala

type FrozenRef struct {
	Outpoint string `json:"outpoint" bson:"outpoint"`
	Amount   int64  `json:"amount" bson:"amount"`
	Owner    string `json:"owner" bson:"owner"`
}

type AssetAdminState struct {
	AssetID             string      `json:"assetId" bson:"assetId"`
	IssuerIdentityKey   string      `json:"issuerIdentityKey" bson:"issuerIdentityKey"`
	IsPaused            bool        `json:"isPaused" bson:"isPaused"`
	AccessMode          string      `json:"accessMode" bson:"accessMode"`
	BlockedIdentities   []string    `json:"blockedIdentities" bson:"blockedIdentities"`
	AllowedIdentities   []string    `json:"allowedIdentities" bson:"allowedIdentities"`
	FrozenOutpoints     []FrozenRef `json:"frozenOutpoints" bson:"frozenOutpoints"`
	EvictedOutpoints    []string    `json:"evictedOutpoints" bson:"evictedOutpoints"`
	LastProcessedHeight int64       `json:"lastProcessedHeight" bson:"lastProcessedHeight"`
	LastProcessedOffset int64       `json:"lastProcessedOffset" bson:"lastProcessedOffset"`
	LastAdmitSeq        int64       `json:"lastAdmitSeq" bson:"lastAdmitSeq"`
}

type FoldContext struct {
	Issuer       string
	FrozenAmount int64
	FrozenOwner  string
	HasFrozenRow bool
}

func DefaultAssetState(assetID string) AssetAdminState {
	return AssetAdminState{
		AssetID: assetID, AccessMode: "denylist",
		BlockedIdentities: []string{}, AllowedIdentities: []string{},
		FrozenOutpoints: []FrozenRef{}, EvictedOutpoints: []string{},
	}
}

func uniqueAppend(xs []string, x string) []string {
	for _, e := range xs {
		if e == x {
			return append([]string(nil), xs...)
		}
	}
	out := make([]string, 0, len(xs)+1)
	return append(append(out, xs...), x)
}

func remove(xs []string, x string) []string {
	out := make([]string, 0, len(xs))
	for _, e := range xs {
		if e != x {
			out = append(out, e)
		}
	}
	return out
}

func removeFrozen(xs []FrozenRef, outpoint string) []FrozenRef {
	out := make([]FrozenRef, 0, len(xs))
	for _, e := range xs {
		if e.Outpoint != outpoint {
			out = append(out, e)
		}
	}
	return out
}

func FoldAction(prev AssetAdminState, details ActionDetails, ctx FoldContext) AssetAdminState {
	s := prev // value copy; slice fields replaced below before any change
	switch details.Kind() {
	case "register":
		if ctx.Issuer != "" {
			s.IssuerIdentityKey = ctx.Issuer
		}
	case "pause":
		s.IsPaused = true
	case "unpause":
		s.IsPaused = false
	case "blockIdentity":
		if k, ok := details.Str("identityKey"); ok {
			s.BlockedIdentities = uniqueAppend(prev.BlockedIdentities, k)
		}
	case "unblockIdentity":
		if k, ok := details.Str("identityKey"); ok {
			s.BlockedIdentities = remove(prev.BlockedIdentities, k)
		}
	case "allowIdentity":
		if k, ok := details.Str("identityKey"); ok {
			s.AllowedIdentities = uniqueAppend(prev.AllowedIdentities, k)
		}
	case "unallowIdentity":
		if k, ok := details.Str("identityKey"); ok {
			s.AllowedIdentities = remove(prev.AllowedIdentities, k)
		}
	case "setAccessMode":
		if m, ok := details.Str("mode"); ok && (m == "denylist" || m == "allowlist") {
			s.AccessMode = m
		}
	case "freezeOutput":
		if op, ok := details.Str("outpoint"); ok {
			s.FrozenOutpoints = append(removeFrozen(prev.FrozenOutpoints, op),
				FrozenRef{Outpoint: op, Amount: ctx.FrozenAmount, Owner: ctx.FrozenOwner})
		}
	case "unfreezeOutput":
		if op, ok := details.Str("outpoint"); ok {
			s.FrozenOutpoints = removeFrozen(prev.FrozenOutpoints, op)
		}
	case "reissue":
		if op, ok := details.Str("outpoint"); ok {
			s.FrozenOutpoints = removeFrozen(prev.FrozenOutpoints, op)
			s.EvictedOutpoints = uniqueAppend(prev.EvictedOutpoints, op)
		}
	}
	return s
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Fold|Reissue' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): asset admin-state reducer"
```

---

### Task 8: Mongo projection storage (MandalaStorageManager port)

**Files:**
- Create: `overlay-go/internal/mandala/storage.go`
- Test: `overlay-go/internal/mandala/storage_test.go`

**Interfaces:**
- Produces `type Store struct{ ... }`, `func NewStore(db *mongo.Database) *Store`, and methods matching Appendix A §5 exactly:
  - `StoreToken(ctx, TokenRow) error` · `GetTokenRow(ctx, txid string, vout uint32) (*TokenRow, error)` (nil, nil when absent) · `DeleteToken(ctx, txid, vout)` · `FindByAssetID(ctx, assetID) ([]Outpoint, error)` (filters evicted) · `FindByOutpoint(ctx, txid, vout) ([]Outpoint, error)`
  - `StoreLinkage(ctx, LinkageRow) error` · `ListLinkage(ctx, limit int64, before *time.Time) ([]LinkageRow, error)` (newest-first, createdAt <= before) · `FindLinkageByOutpoints(ctx, []Outpoint) ([]LinkageRow, error)`
  - `AdjustBalance(ctx, identityKey string, delta int64) error` · `GetBalance(ctx, identityKey) (int64, error)`
  - `StoreMetadata(ctx, MetadataRow) error` · `FindMetadataByAssetID(ctx, assetID) ([]Outpoint, error)` · `DeleteMetadata(ctx, txid, vout) error`
  - `GetAssetState(ctx, assetID) (AssetAdminState, error)` (default when absent) · `PutAssetState(ctx, AssetAdminState) error`
  - `AppendAdminHistory(ctx, AdminHistoryEntry) error` · `FindAdminHistoryByAssetID(ctx, assetID) ([]AdminHistoryEntry, error)` (sorted height, offset, admitSeq asc) · `PageAdminHistory(ctx, assetID, limit, offset int64) ([]AdminHistoryEntry, error)` (newest-first by admitSeq) · `AdminSummary(ctx, assetID) (totalIssued, totalRedeemed, actionCount int64, err error)`
  - `NextAdmitSeq(ctx) (int64, error)`
  - Row types: `TokenRow{Txid string; OutputIndex uint32; AssetID string; Amount int64; IdentityKey string; CreatedAt time.Time}` · `LinkageRow{Txid; OutputIndex; IdentityKey; Linkage SpecificLinkage; CreatedAt}` · `MetadataRow{Txid; OutputIndex; AssetID}` · `AdminHistoryEntry{AssetID string; Txid string; OutputIndex uint32; Height int64; Offset int64; AdmitSeq int64; ActionDetails ActionDetails; CreatedAt time.Time}` — bson field names camelCase identical to TS (`txid`, `outputIndex`, `assetId`, `identityKey`, `createdAt`, `actionDetails`, `admitSeq`, `height`, `offset`, `linkage`, `balance`).
- Index creation on `NewStore` (idempotent `CreateMany`): per Appendix A §5 table, plus the two boot-time indexes from `overlay/src/index.ts:112-118` (`mandalaLinkageRecords {createdAt:-1}`, `mandalaAdminHistory {assetId:1, admitSeq:-1}`). No TTL on linkage.

- [ ] **Step 1: Write the failing test**

`storage_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'TokenLifecycle|Evicted|AdminHistory|StateDefault' -v`
Expected: FAIL (compile) — `NewStore` undefined. (With no local Mongo the tests skip — implementation still requires compile success first.)

- [ ] **Step 3: Implement**

`storage.go` — mechanical Mongo CRUD per the interface block above. Key details (full op semantics in Appendix A §5):

```go
package mandala

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Outpoint struct {
	Txid        string `bson:"txid" json:"txid"`
	OutputIndex uint32 `bson:"outputIndex" json:"outputIndex"`
}

type TokenRow struct {
	Txid        string    `bson:"txid"`
	OutputIndex uint32    `bson:"outputIndex"`
	AssetID     string    `bson:"assetId"`
	Amount      int64     `bson:"amount"`
	IdentityKey string    `bson:"identityKey"`
	CreatedAt   time.Time `bson:"createdAt"`
}

type LinkageRow struct {
	Txid        string          `bson:"txid"`
	OutputIndex uint32          `bson:"outputIndex"`
	IdentityKey string          `bson:"identityKey"`
	Linkage     SpecificLinkage `bson:"linkage"`
	CreatedAt   time.Time       `bson:"createdAt"`
}

type MetadataRow struct {
	Txid        string `bson:"txid"`
	OutputIndex uint32 `bson:"outputIndex"`
	AssetID     string `bson:"assetId"`
}

type AdminHistoryEntry struct {
	AssetID       string        `bson:"assetId" json:"assetId"`
	Txid          string        `bson:"txid" json:"txid"`
	OutputIndex   uint32        `bson:"outputIndex" json:"outputIndex"`
	Height        int64         `bson:"height" json:"height"`
	Offset        int64         `bson:"offset" json:"offset"`
	AdmitSeq      int64         `bson:"admitSeq" json:"admitSeq"`
	ActionDetails ActionDetails `bson:"actionDetails" json:"actionDetails"`
	CreatedAt     time.Time     `bson:"createdAt" json:"createdAt"`
}

type Store struct {
	tokens, linkage, balances, metadata, states, history, counters *mongo.Collection
}

func NewStore(db *mongo.Database) *Store {
	s := &Store{
		tokens:   db.Collection("mandalaTokens"),
		linkage:  db.Collection("mandalaLinkageRecords"),
		balances: db.Collection("mandalaBalances"),
		metadata: db.Collection("mandalaMetadata"),
		states:   db.Collection("mandalaAssetStates"),
		history:  db.Collection("mandalaAdminHistory"),
		counters: db.Collection("mandalaCounters"),
	}
	ctx := context.Background()
	uniq := options.Index().SetUnique(true)
	outpointKeys := bson.D{{Key: "txid", Value: 1}, {Key: "outputIndex", Value: 1}}
	_, _ = s.tokens.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: outpointKeys, Options: uniq},
		{Keys: bson.D{{Key: "assetId", Value: 1}}},
		{Keys: bson.D{{Key: "identityKey", Value: 1}}},
	})
	_, _ = s.linkage.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: outpointKeys},
		{Keys: bson.D{{Key: "identityKey", Value: 1}}},
		{Keys: bson.D{{Key: "createdAt", Value: -1}}}, // activity paging; NO TTL
	})
	_, _ = s.balances.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "identityKey", Value: 1}}, Options: uniq},
	})
	_, _ = s.metadata.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: outpointKeys, Options: uniq},
		{Keys: bson.D{{Key: "assetId", Value: 1}}},
	})
	_, _ = s.states.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "assetId", Value: 1}}, Options: uniq},
	})
	_, _ = s.history.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "assetId", Value: 1}, {Key: "height", Value: 1}, {Key: "offset", Value: 1}, {Key: "admitSeq", Value: 1}}},
		{Keys: bson.D{{Key: "assetId", Value: 1}, {Key: "admitSeq", Value: -1}}},
	})
	return s
}
```

Method bodies (same file — representative set; the rest follow the identical pattern):

```go
func (s *Store) StoreToken(ctx context.Context, r TokenRow) error {
	_, err := s.tokens.InsertOne(ctx, r)
	return err
}

func (s *Store) GetTokenRow(ctx context.Context, txid string, vout uint32) (*TokenRow, error) {
	var r TokenRow
	err := s.tokens.FindOne(ctx, bson.D{{Key: "txid", Value: txid}, {Key: "outputIndex", Value: vout}}).Decode(&r)
	if err == mongo.ErrNoDocuments {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) AdjustBalance(ctx context.Context, identityKey string, delta int64) error {
	_, err := s.balances.UpdateOne(ctx,
		bson.D{{Key: "identityKey", Value: identityKey}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "balance", Value: delta}}}},
		options.UpdateOne().SetUpsert(true))
	return err
}

func (s *Store) FindByAssetID(ctx context.Context, assetID string) ([]Outpoint, error) {
	st, err := s.GetAssetState(ctx, assetID)
	if err != nil {
		return nil, err
	}
	evicted := map[string]bool{}
	for _, op := range st.EvictedOutpoints {
		evicted[op] = true
	}
	cur, err := s.tokens.Find(ctx, bson.D{{Key: "assetId", Value: assetID}})
	if err != nil {
		return nil, err
	}
	var rows []Outpoint
	if err := cur.All(ctx, &rows); err != nil {
		return nil, err
	}
	out := make([]Outpoint, 0, len(rows))
	for _, r := range rows {
		if !evicted[fmtOutpoint(r.Txid, r.OutputIndex)] {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *Store) GetAssetState(ctx context.Context, assetID string) (AssetAdminState, error) {
	var st AssetAdminState
	err := s.states.FindOne(ctx, bson.D{{Key: "assetId", Value: assetID}}).Decode(&st)
	if err == mongo.ErrNoDocuments {
		return DefaultAssetState(assetID), nil
	}
	return st, err
}

func (s *Store) PutAssetState(ctx context.Context, st AssetAdminState) error {
	_, err := s.states.UpdateOne(ctx,
		bson.D{{Key: "assetId", Value: st.AssetID}},
		bson.D{{Key: "$set", Value: st}},
		options.UpdateOne().SetUpsert(true))
	return err
}

func (s *Store) NextAdmitSeq(ctx context.Context) (int64, error) {
	var doc struct {
		Seq int64 `bson:"seq"`
	}
	err := s.counters.FindOneAndUpdate(ctx,
		bson.D{{Key: "_id", Value: "admitSeq"}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "seq", Value: 1}}}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&doc)
	if err != nil {
		return 1, nil // TS fallback
	}
	return doc.Seq, nil
}

func fmtOutpoint(txid string, vout uint32) string {
	return fmt.Sprintf("%s.%d", txid, vout)
}
```

Also implement (same patterns, no surprises): `StoreLinkage` (InsertOne), `ListLinkage` (Find sort `createdAt:-1` limit; `before` → filter `createdAt: {$lte: before}`), `FindLinkageByOutpoints` (`$or` of outpoint pairs; empty input → empty result, no query), `DeleteToken`/`DeleteMetadata` (DeleteOne), `FindByOutpoint` (Find + project), `StoreMetadata` (upsert by outpoint), `FindMetadataByAssetID` (Find), `FindAdminHistoryByAssetID` (sort `height:1, offset:1, admitSeq:1`), `PageAdminHistory` (sort `admitSeq:-1`, skip offset, limit clamp [1,500]), `AdminSummary` (aggregate: match assetId → group by `actionDetails.kind` summing `actionDetails.amount` and counting; totalIssued = `issue` sum, totalRedeemed = `redeem` sum, actionCount = total docs — reissue excluded from totals per `overlay/src/index.ts:182-193`).

- [ ] **Step 4: Run tests (compose Mongo up first)**

Run: `docker compose up -d mongodb 2>/dev/null; cd overlay-go && go test ./internal/mandala/ -run 'TokenLifecycle|Evicted|AdminHistory|StateDefault' -v`
Expected: PASS (or SKIP if Mongo genuinely absent — then start it; these must pass before commit).

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): Mongo projection store (MandalaStorageManager port)"
```

---

### Task 9: Topic manager (gates, conservation, admin verification)

**Files:**
- Create: `overlay-go/internal/mandala/topic_manager.go`, `overlay-go/internal/mandala/adminwallet.go`
- Test: `overlay-go/internal/mandala/topic_manager_test.go`

**Interfaces:**
- Produces:
  - `type StateStore interface { GetAssetState(ctx, assetID string) (AssetAdminState, error); GetTokenRow(ctx, txid string, vout uint32) (*TokenRow, error) }` (satisfied by `*Store`)
  - `type ScreeningProvider interface { IsSanctioned(ctx, identityKey string) (bool, error) }` + `type NoSanctions struct{}` always-false impl
  - `type AdminWallet struct{...}` / `func NewAdminWallet(privHex string) (*AdminWallet, error)` with `func (w *AdminWallet) ExpectedPKH(details ActionDetails) ([20]byte, error)` — derive `hash160(derivePublicKey(ADMIN_PROTOCOL, Commitment(details), counterparty, forSelf=false))`; counterparty = `details["counterparty"]` string else `"self"` (Appendix A §1.4/§3.2c). Uses go-sdk `wallet.KeyDeriver`.
  - `type TopicManager struct{...}` / `func NewTopicManager(v *Verifier, aw *AdminWallet, screen ScreeningProvider, state StateStore) *TopicManager` implementing go-overlay-services `engine.TopicManager`:
    - `IdentifyAdmissibleOutputs(ctx, beef *transaction.Beef, txid *chainhash.Hash, previousCoins []uint32) (overlay.AdmittanceInstructions, error)` — reads the linkage payload via `PayloadFromContext(ctx)` (Task 10)
    - `IdentifyNeededInputs(ctx, beef, txid) ([]*transaction.Outpoint, error)` — returns nil, nil (parity: TS manager doesn't request extra inputs)
    - `GetDocumentation() string`, `GetMetaData() *overlay.MetaData` (name `tm_mandala`)
- Gate order and every rule: Appendix A §3.1–3.7 verbatim, including: missing output linkage = silent skip; bad `payload.inputs` linkage **throws** in sanctions screening but is **tolerated** in sender resolution; conservation `out == in + issued` per asset over admitted outputs and previousCoins inputs only; control-gate universe scans ALL tx inputs; issuer key excluded from access parties; reissue guards (frozen ref exists, exact amount, zero FT inputs of the asset).

- [ ] **Step 1: Write the failing test**

`topic_manager_test.go` — pure-Go fixtures: build txs with `LockToken`, real linkages produced by a go-sdk ProtoWallet prover (same mechanism the golden vector proved compatible in Task 6), fake StateStore/Screening:

```go
package mandala

import (
	"context"
	"testing"

	ec "github.com/bsv-blockchain/go-sdk/primitives/ec"
	"github.com/bsv-blockchain/go-sdk/transaction"
	"github.com/bsv-blockchain/go-sdk/wallet"
)

type fakeState struct {
	states map[string]AssetAdminState
	tokens map[string]*TokenRow
}

func (f *fakeState) GetAssetState(_ context.Context, id string) (AssetAdminState, error) {
	if s, ok := f.states[id]; ok {
		return s, nil
	}
	return DefaultAssetState(id), nil
}
func (f *fakeState) GetTokenRow(_ context.Context, txid string, vout uint32) (*TokenRow, error) {
	return f.tokens[fmtOutpoint(txid, vout)], nil
}

type sanctioned map[string]bool

func (s sanctioned) IsSanctioned(_ context.Context, k string) (bool, error) { return s[k], nil }

// harness: one FT input (100 units, previously admitted) -> recipient 60 + change 40.
// Returns the beef, txid, previousCoins, and a payload builder the tests mutate.
type harness struct {
	verifier *Verifier
	tm       *TopicManager
	beef     *transaction.Beef
	txid     *chainhash.Hash // github.com/bsv-blockchain/go-sdk/chainhash
	payload  *LinkagePayload
	state    *fakeState
}

func newHarness(t *testing.T) *harness {
	// Full builder ~80 lines: creates prover/holder/verifier keys, locks a
	// source tx output with LockToken via the prover-derived pkh, builds the
	// spending tx with two outputs (recipient + change), assembles a Beef with
	// both txs, and produces real linkages with ProtoWallet.RevealSpecificKeyLinkage
	// for each output and the input. Implemented in this test file; see
	// Appendix A §0.5 for payload shape. (The implementer writes this once;
	// every gate test reuses it.)
	t.Helper()
	// ... construction ...
	return nil // replaced by real construction
}

func TestAdmitsBalancedTransferWithLinkage(t *testing.T) {
	h := newHarness(t)
	res, err := h.tm.IdentifyAdmissibleOutputs(withPayload(context.Background(), h.payload), h.beef, h.txid, []uint32{0})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.OutputsToAdmit) != 2 {
		t.Fatalf("admit: %v", res.OutputsToAdmit)
	}
}

func TestMissingOutputLinkageBreaksConservation(t *testing.T) {
	h := newHarness(t)
	h.payload.Outputs = h.payload.Outputs[:1] // drop the change linkage
	_, err := h.tm.IdentifyAdmissibleOutputs(withPayload(context.Background(), h.payload), h.beef, h.txid, []uint32{0})
	if err == nil {
		t.Fatal("expected conservation violation")
	}
}

func TestPauseBlocksPeerTransferButNotAdmin(t *testing.T) { /* set state.IsPaused, expect error; then add verified admin output for the asset, expect pass — construction mirrors harness */
}

func TestDenylistRejectsBlockedParty(t *testing.T)  { /* block recipient identity, expect control-gate error */ }
func TestAllowlistRejectsUnlisted(t *testing.T)     { /* accessMode allowlist, empty allowed, expect error */ }
func TestFrozenInputRejectsAllTxs(t *testing.T)     { /* freeze the source outpoint, expect gate-1 error */ }
func TestSanctionedSenderRejects(t *testing.T)      { /* screening returns true for input identity */ }
func TestReissueGuards(t *testing.T)                { /* reissue admin action: not-frozen target, wrong amount, FT-input-present — each must reject */ }
```

The five one-line stubs above are real tests the implementer fills using the harness — each asserts a specific error path listed in Appendix A §3.6. They are named here so review can check coverage; leaving any unimplemented fails the task.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd overlay-go && go test ./internal/mandala/ -run 'Admits|Pause|Denylist|Allowlist|Frozen|Sanctioned|Reissue|MissingOutput' -v`
Expected: FAIL — `TopicManager` undefined.

- [ ] **Step 3: Implement**

`adminwallet.go`:

```go
package mandala

import (
	"fmt"

	ec "github.com/bsv-blockchain/go-sdk/primitives/ec"
	"github.com/bsv-blockchain/go-sdk/primitives/hash"
	"github.com/bsv-blockchain/go-sdk/wallet"
)

type AdminWallet struct {
	deriver *wallet.KeyDeriver
	rootPub *ec.PublicKey
}

func NewAdminWallet(privHex string) (*AdminWallet, error) {
	priv, err := ec.PrivateKeyFromHex(privHex)
	if err != nil {
		return nil, err
	}
	return &AdminWallet{deriver: wallet.NewKeyDeriver(priv), rootPub: priv.PubKey()}, nil
}

var adminProtocol = wallet.Protocol{SecurityLevel: 2, Protocol: "mandala admin"}

func (w *AdminWallet) ExpectedPKH(details ActionDetails) ([20]byte, error) {
	var out [20]byte
	keyID, err := Commitment(map[string]any(details))
	if err != nil {
		return out, err
	}
	cp := wallet.Counterparty{Type: wallet.CounterpartyTypeSelf}
	if s, ok := details.Str("counterparty"); ok {
		pub, err := ec.PublicKeyFromString(s)
		if err != nil {
			return out, fmt.Errorf("admin counterparty: %w", err)
		}
		cp = wallet.Counterparty{Type: wallet.CounterpartyTypeOther, Counterparty: pub}
	}
	pub, err := w.deriver.DerivePublicKey(adminProtocol, keyID, cp, false)
	if err != nil {
		return out, err
	}
	copy(out[:], hash.Hash160(pub.Compressed()))
	return out, nil
}
```

`topic_manager.go` — the full §3 pipeline. Complete skeleton with every gate; helper bodies follow the appendix line-by-line:

```go
package mandala

import (
	"context"
	"fmt"

	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/overlay"
	"github.com/bsv-blockchain/go-sdk/transaction"
)

type StateStore interface {
	GetAssetState(ctx context.Context, assetID string) (AssetAdminState, error)
	GetTokenRow(ctx context.Context, txid string, vout uint32) (*TokenRow, error)
}

type ScreeningProvider interface {
	IsSanctioned(ctx context.Context, identityKey string) (bool, error)
}

type NoSanctions struct{}

func (NoSanctions) IsSanctioned(context.Context, string) (bool, error) { return false, nil }

type TopicManager struct {
	verifier *Verifier
	admin    *AdminWallet
	screen   ScreeningProvider
	state    StateStore
}

func NewTopicManager(v *Verifier, aw *AdminWallet, sp ScreeningProvider, st StateStore) *TopicManager {
	return &TopicManager{verifier: v, admin: aw, screen: sp, state: st}
}

type ftOut struct {
	index       uint32
	assetID     string
	amount      int64
	pubKeyHash  [20]byte
	identityKey string // set on admission
}

func (m *TopicManager) IdentifyAdmissibleOutputs(ctx context.Context, beef *transaction.Beef, txid *chainhash.Hash, previousCoins []uint32) (overlay.AdmittanceInstructions, error) {
	var none overlay.AdmittanceInstructions
	tx := beef.FindTransaction(txid.String())
	if tx == nil {
		return none, fmt.Errorf("tm_mandala: tx not in beef")
	}
	payload := PayloadFromContext(ctx) // Task 10; empty payload when absent

	// §3.2 classify: FT outputs + verified admin outputs
	adminByIndex := map[uint32]ActionDetails{}
	for _, a := range payload.Admin {
		adminByIndex[a.Index] = a.ActionDetails
	}
	var fts []ftOut
	adminIdx := []uint32{}
	verifiedAdminByAsset := map[string]ActionDetails{}
	authorizedIssuance := map[string]int64{}
	for i, out := range tx.Outputs {
		idx := uint32(i)
		if d, err := DecodeToken(out.LockingScript); err == nil {
			fts = append(fts, ftOut{index: idx, assetID: d.AssetID, amount: d.Amount, pubKeyHash: d.PubKeyHash})
			continue
		}
		details, ok := adminByIndex[idx]
		if !ok {
			continue
		}
		if !m.verifyAdminOutput(tx, idx, details) { // pkh re-derivation + priorOutpoint spend
			continue
		}
		adminIdx = append(adminIdx, idx)
		if assetID, ok := details.Str("assetId"); ok {
			verifiedAdminByAsset[assetID] = details
			amt, _ := details.Num("amount")
			switch details.Kind() {
			case "issue", "reissue":
				authorizedIssuance[assetID] += amt
			case "redeem":
				authorizedIssuance[assetID] -= amt
			}
		}
	}

	// §3.3 verify FT outputs via linkage (missing linkage -> silent skip)
	outLinkByIndex := map[uint32]*SpecificLinkage{}
	for _, o := range payload.Outputs {
		outLinkByIndex[o.Index] = o.Linkage
	}
	admitted := fts[:0]
	for _, f := range fts {
		l := outLinkByIndex[f.index]
		if l == nil {
			continue
		}
		if m.verifier.LinkageControlsPKH(ctx, l, f.pubKeyHash[:]) {
			f.identityKey = l.Counterparty
			admitted = append(admitted, f)
		}
	}

	// §3.4 conservation over previousCoins
	if err := m.conservation(tx, previousCoins, admitted, authorizedIssuance); err != nil {
		return none, err
	}
	// §3.5 sanctions (input linkage errors PROPAGATE here)
	if err := m.sanctions(ctx, payload, admitted); err != nil {
		return none, err
	}
	// §3.6 control gates (input linkage errors tolerated in sender resolution)
	if err := m.controlGates(ctx, tx, payload, admitted, verifiedAdminByAsset); err != nil {
		return none, err
	}

	admit := make([]uint32, 0, len(admitted)+len(adminIdx))
	for _, f := range admitted {
		admit = append(admit, f.index)
	}
	admit = append(admit, adminIdx...)
	sortUint32(admit)
	return overlay.AdmittanceInstructions{OutputsToAdmit: admit, CoinsToRetain: previousCoins}, nil
}
```

Helper requirements (bodies in same file; each maps to an appendix clause):
- `verifyAdminOutput(tx, idx, details) bool` — `DecodeAdmin` + `admin.ExpectedPKH(details)` byte-equal + priorOutpoint check: `kind=="register"` → true, else `details.priorOutpoint` must equal some input's `"<sourceTXID>.<sourceOutputIndex>"` (use `tx.Inputs[i].SourceTXID` string form; fall back to `SourceTransaction.TxID()` when set).
- `conservation` — inTotals from `previousCoins` source outputs that `DecodeToken`; for every assetId in outTotals require `out == in + issued`; error text starts `"conservation violated"`.
- `sanctions` — set of admitted identity keys ∪ `VerifyKeyLinkage` over every `payload.Inputs` (error → return error); any sanctioned → `"sanctioned party involved in transfer"`.
- `controlGates` — asset universe = admitted assetIds ∪ every input source-output that decodes as token (ALL inputs); frozen∪evicted vs input outpoints (Gate 1, all txs); pause (Gate 2, `verifiedAdminByAsset[X]==nil` only); access mode (Gate 3, parties = admitted-FT identities for X + lazily-resolved senders, minus `state.IssuerIdentityKey`); reissue guards (a/b/c per §3.6).
- `IdentifyNeededInputs` returns `nil, nil`; `GetMetaData` returns `&overlay.MetaData{Name: "tm_mandala"}`; `GetDocumentation` returns a one-paragraph string.
- `sortUint32` — `slices.Sort`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd overlay-go && go test ./internal/mandala/ -v`
Expected: PASS — whole package green (Tasks 3–9 tests).

- [ ] **Step 5: Commit**

```bash
git add overlay-go/internal/mandala
git commit -m "feat(overlay-go): tm_mandala topic manager with full gate parity"
```

---

### Task 10: offChainValues context threading

**Files:**
- Create: `overlay-go/internal/mandala/ctxvals.go`
- Test: `overlay-go/internal/mandala/ctxvals_test.go`

**Interfaces:**
- Produces: `func WithPayload(ctx context.Context, p *LinkagePayload) context.Context` and `func PayloadFromContext(ctx context.Context) *LinkagePayload` (never nil — empty payload fallback). Plus, ONLY IF Task 1 recorded `ctx propagated: NO`: `type PayloadRegistry struct{ m sync.Map }` with `Put(txid string, p *LinkagePayload)`, `Take(txid string) *LinkagePayload` and a `PayloadFromContext` that falls back to the registry via a txid also stashed in ctx by the submit handler.
- The test alias `withPayload` used in Task 9's tests = `WithPayload`.

- [ ] **Step 1: Write the failing test**

```go
package mandala

import (
	"context"
	"testing"
)

func TestPayloadContextRoundTrip(t *testing.T) {
	p := &LinkagePayload{Admin: []IndexedAdmin{{Index: 3}}}
	ctx := WithPayload(context.Background(), p)
	got := PayloadFromContext(ctx)
	if len(got.Admin) != 1 || got.Admin[0].Index != 3 {
		t.Fatalf("%+v", got)
	}
}

func TestPayloadFromBareContextIsEmptyNotNil(t *testing.T) {
	got := PayloadFromContext(context.Background())
	if got == nil || len(got.Inputs)+len(got.Outputs)+len(got.Admin) != 0 {
		t.Fatalf("%+v", got)
	}
}
```

- [ ] **Step 2: Run to verify fail** — `go test ./internal/mandala/ -run PayloadContext -v` → FAIL undefined.

- [ ] **Step 3: Implement**

```go
package mandala

import "context"

type payloadKey struct{}

func WithPayload(ctx context.Context, p *LinkagePayload) context.Context {
	return context.WithValue(ctx, payloadKey{}, p)
}

func PayloadFromContext(ctx context.Context) *LinkagePayload {
	if p, ok := ctx.Value(payloadKey{}).(*LinkagePayload); ok && p != nil {
		return p
	}
	return &LinkagePayload{}
}
```

If Task 1 recorded `ctx propagated: NO`, additionally implement the txid-keyed `PayloadRegistry` and have the submit handler (Task 13) `Put` before `Engine.Submit` and `Take` inside `PayloadFromContext` — the registry is package-level state constructed in Task 13's wiring.

- [ ] **Step 4: Verify pass** — `go test ./internal/mandala/ -run PayloadContext -v` → PASS.

- [ ] **Step 5: Commit** — `git add overlay-go && git commit -m "feat(overlay-go): offChainValues context threading"`

---

### Task 11: Lookup service (ls_mandala)

**Files:**
- Create: `overlay-go/internal/mandala/lookup_service.go`
- Test: `overlay-go/internal/mandala/lookup_service_test.go`

**Interfaces:**
- Produces `type LookupService struct{...}` / `func NewLookupService(v *Verifier, store *Store) *LookupService` implementing go-overlay-services `engine.LookupService`:
  - `OutputAdmittedByTopic(ctx, payload *engine.OutputAdmittedByTopic) error` — Appendix A §4.1: FT case (store token, adjust balance, store linkage — a linkage verification error here propagates); admin case (metadata upsert when publicData present; admin history append with `txOrdering` height/offset + `NextAdmitSeq`; fold state with FoldContext sourced from actionDetails/`GetTokenRow`).
  - `OutputSpent(ctx, payload *engine.OutputSpent) error` — balance decrement then delete token.
  - `OutputEvicted(ctx, outpoint *transaction.Outpoint) error` — delete token + metadata.
  - `OutputNoLongerRetainedInHistory`, `OutputBlockHeightUpdated` — no-ops returning nil.
  - `Lookup(ctx, q *lookup.LookupQuestion) (*lookup.LookupAnswer, error)` — 5 query shapes in Appendix A §4.5 precedence order; unknown → error `"Unsupported query"`. Non-UTXO shapes (`assetStateAssetId`, `adminHistoryAssetId`) are NOT served here in the Go port — the app never uses them via /lookup (Appendix B §1c); return the outpoint-shaped answers for `metadataAssetId`, `assetId`, `txid+outputIndex`, and `"Unsupported query"` otherwise. Record this intentional narrowing in GetDocumentation.
  - `txOrdering(tx *transaction.Transaction) (height, offset int64)` — no merkle path → `(9007199254740991, 0)`; else blockHeight + level-0 leaf offset whose hash matches txid with the txid flag set.
  - All topic checks: ignore payloads whose `Topic != "tm_mandala"`.
- Consumes: Task 8 `Store`, Task 6 `Verifier`, Task 5 payload decode.

- [ ] **Step 1: Write the failing test** — Mongo-backed (skip pattern from Task 8). Cases: (a) admitted FT output with linkage → token row + balance + linkage row written; (b) admitted FT without offChainValues → token row with empty identityKey, no balance change; (c) admitted register admin output with publicData → metadata row + history entry + state with issuer set; (d) `OutputSpent` decrements balance and deletes row; (e) `Lookup{assetId}` excludes evicted; (f) `Lookup` unknown query errors. Build AtomicBEEF fixtures with go-sdk (`tx.AtomicBEEF()`), locking scripts from `LockToken` and a publicData admin script built by porting the 7-chunk form with `script.AppendPushData(json)` + OP_DROP + P2PKH (helper `LockAdmin(pkh, publicData)` added to `admin.go` in this task, exported for tests and Task 15 fixtures).

Test code follows the exact structure of Task 8's tests (testDB helper, one function per case, assertions on collections through Store getters). Write all six cases before implementing.

- [ ] **Step 2: Verify fail** — `go test ./internal/mandala/ -run LookupService -v` → FAIL undefined.

- [ ] **Step 3: Implement** `lookup_service.go` per Appendix A §4 and `LockAdmin` in `admin.go`. Key snippets:

```go
func (l *LookupService) OutputAdmittedByTopic(ctx context.Context, p *engine.OutputAdmittedByTopic) error {
	if p.Topic != "tm_mandala" {
		return nil
	}
	_, tx, txidHash, err := transaction.ParseBeef(p.AtomicBEEF)
	if err != nil {
		return err
	}
	txid := txidHash.String()
	out := tx.Outputs[p.OutputIndex]
	if d, err := DecodeToken(out.LockingScript); err == nil {
		payload, err := DecodeLinkagePayload(p.OffChainValues)
		if err != nil {
			return err
		}
		identity := ""
		var matched *SpecificLinkage
		for _, o := range payload.Outputs {
			if o.Index == p.OutputIndex && o.Linkage != nil {
				id, _, err := l.verifier.VerifyKeyLinkage(ctx, o.Linkage)
				if err != nil {
					return err // propagates, engine call fails (TS parity)
				}
				identity, matched = id, o.Linkage
				break
			}
		}
		if err := l.store.StoreToken(ctx, TokenRow{Txid: txid, OutputIndex: p.OutputIndex,
			AssetID: d.AssetID, Amount: d.Amount, IdentityKey: identity, CreatedAt: time.Now()}); err != nil {
			return err
		}
		if identity != "" {
			if err := l.store.AdjustBalance(ctx, identity, d.Amount); err != nil {
				return err
			}
			if matched != nil {
				return l.store.StoreLinkage(ctx, LinkageRow{Txid: txid, OutputIndex: p.OutputIndex,
					IdentityKey: identity, Linkage: *matched, CreatedAt: time.Now()})
			}
		}
		return nil
	}
	return l.indexAdminOutput(ctx, tx, txid, p.OutputIndex, p.OffChainValues)
}
```

`indexAdminOutput` per §4.1 admin case: DecodeAdmin (fail → nil); publicData → `StoreMetadata({txid, vout, assetId: txid.vout})`; find `admin[]` entry (missing → nil); assetId = details.assetId else `txid.vout`; `txOrdering`; `NextAdmitSeq`; `AppendAdminHistory`; FoldContext (register issuer from details.issuer; freezeOutput → `GetTokenRow(split(details.outpoint))`); `GetAssetState` → `FoldAction` → set lastProcessed fields → `PutAssetState`.

- [ ] **Step 4: Verify pass** — `go test ./internal/mandala/ -run LookupService -v` (Mongo up) → PASS.

- [ ] **Step 5: Commit** — `git add overlay-go && git commit -m "feat(overlay-go): ls_mandala lookup service"`

---

### Task 12: Engine wiring (in-repo Mongo engine.Storage, chain tracker, ProtoWallet)

> **AMENDED after Task 1:** b-open-io/overlay implements go-overlay-services v1.3.2's
> `engine.Storage` at NO published tag (max v0.3.0; missing FindOutpointsByMerkleState /
> ReconcileMerkleRoot / LoadAncillaryBeef; BEEF-store type mismatch). The spec's fallback
> governs: write `overlay-go/internal/enginestore` — a Mongo implementation of the full
> `engine.Storage` interface exactly as recorded in `overlay-go/README.md` "Pinned API
> notes" (interface method list + `engine.Output` field shapes are pinned there). Store
> outputs in collection `engineOutputs` (unique index topic+txid+outputIndex), applied
> transactions in `engineAppliedTransactions` (unique topic+txid), BEEF bytes inline on
> the output document (`beef` binary field; `LoadBeef`/`SaveBeef` per pinned signatures).
> Implement every interface method with a focused Mongo query; no caching, no extra
> features (YAGNI). TDD: one test per method group (insert/find, spend/consume,
> merkle-state reconcile, applied-tx dedupe) against the Task 8 skip-pattern Mongo.
> Drop the b-open-io dependency from go.mod in this task.

**Files:**
- Create: `overlay-go/internal/enginestore/enginestore.go`
- Create: `overlay-go/internal/wiring/engine.go`
- Test: `overlay-go/internal/enginestore/enginestore_test.go`, `overlay-go/internal/wiring/engine_test.go`

**Interfaces:**
- Produces: `type App struct { Engine *engine.Engine; Store *mandala.Store; Verifier *mandala.Verifier; Mongo *mongo.Database; ArcadeEnabled bool }` and `func Build(ctx context.Context, cfg Config) (*App, error)` where `Config { NodeName, ServerPrivKeyHex, HostingURL, MongoURL, Network, ArcadeURL, ArcadeAPIKey, ChaintracksURL, ChaintracksPrefix string }`. Also `enginestore.New(db *mongo.Database) engine.Storage`.
- Behavior:
  - Mongo client → db `${NodeName}_lookup_services`; `mandala.NewStore`.
  - Engine storage: `enginestore.New(db)` (in-repo, above).
  - ChainTracker: `ArcadeURL == ""` → scripts-only permissive tracker (`type scriptsOnlyTracker struct{}` with `IsValidRootForHeight(...) (bool, error) { return true, nil }` — mirror of TS `'scripts only'`); else the Task 16 chaintracks client.
  - Broadcaster: nil when no Arcade; else Task 16's Arcade broadcaster (broadcast-before-fold, failure rejects).
  - `engine.NewEngine(engine.Config{Managers: {"tm_mandala": tm}, LookupServices: {"ls_mandala": ls}, Storage: st, ChainTracker: ct, Broadcaster: bc, HostingURL: cfg.HostingURL})` — no advertiser, no sync config (GASP off).
- Note: Tasks 12 and 16 are mutually referenced; Build takes the broadcaster/tracker as optional constructor params so Task 12 lands first with nils and Task 16 fills them.

- [ ] **Step 1: Write the failing test** — `Build` with a local Mongo (skip pattern) and empty ArcadeURL returns an App whose Engine is non-nil and whose `Engine.Lookup` with `{Service:"ls_mandala", Query: {"assetId":"missing.0"}}` returns an empty output-list (proves lookup service registration end-to-end).

- [ ] **Step 2: Verify fail** — compile error.

- [ ] **Step 3: Implement** per the interface block; consult `overlay-go/README.md` pinned API notes for exact b-open-io constructor names recorded in Task 1.

- [ ] **Step 4: Verify pass** — `go test ./internal/wiring/ -v` (Mongo up) → PASS.

- [ ] **Step 5: Commit** — `git add overlay-go && git commit -m "feat(overlay-go): engine wiring with Mongo storage"`

---

### Task 13: HTTP /submit

**Files:**
- Create: `overlay-go/internal/httpapi/server.go`, `overlay-go/internal/httpapi/submit.go`
- Test: `overlay-go/internal/httpapi/submit_test.go`

**Interfaces:**
- Produces: `func New(app *wiring.App) *fiber.App` — constructs the Fiber app with global middleware (CORS wildcard incl. `Access-Control-Allow-Private-Network: true`, OPTIONS → 200; 1GB body limit; TS-shaped 404 `{"status":"error","code":"ERR_ROUTE_NOT_FOUND","description":"Route not found."}`) and mounts all routes (later tasks add theirs to this same constructor).
- `POST /submit` handler (Appendix B §1):
  - `X-Topics` header (case-insensitive): JSON string array; missing/invalid → 400 `{"status":"error","message":...}`.
  - Body `application/octet-stream`. If header `x-includes-off-chain-values == "true"`: read Bitcoin VarInt length, split `beef = body[n:n+len]`, `offChain = rest`; else whole body is beef.
  - Decode payload (`mandala.DecodeLinkagePayload`), build ctx via `mandala.WithPayload` (+ registry Put when Task 1 chose fallback), call `app.Engine.Submit(ctx, overlay.TaggedBEEF{Beef, Topics, OffChainValues}, engine.SubmitModeCurrent, nil)` (mode constant per pinned API notes).
  - Success → 200, body = **bare STEAK map** JSON: `{"tm_mandala": {"outputsToAdmit": [...], "coinsToRetain": [...]}}` (marshal `overlay.Steak` directly — verify field tags produce camelCase; if the SDK type's JSON tags differ, marshal a local mirror struct).
  - Engine/topic error → 400 `{"status":"error","message": err.Error()}`.
- VarInt reader: 0xfd/0xfe/0xff prefixes, little-endian — implement `readVarInt(r *bytes.Reader) (uint64, error)` in `submit.go`.

- [ ] **Step 1: Write the failing test** — httptest against `New` with a stub engine: (a) missing X-Topics → 400 with `status:"error"`; (b) framed body with off-chain flag: handler splits at the varint boundary and the stub receives exactly the beef bytes and offChain bytes (assert both); (c) stub returns a Steak → response is the bare map with `outputsToAdmit`; (d) stub returns error → 400. Stub via a `Submitter` interface in `server.go` (`Submit(ctx, overlay.TaggedBEEF, ...) (overlay.Steak, error)`) that `*engine.Engine` satisfies; `New` takes the interface.

- [ ] **Step 2: Verify fail** → undefined.

- [ ] **Step 3: Implement.** Fiber specifics: `app.Use(cors)` custom middleware setting the five headers + short-circuiting OPTIONS; `fiber.Config{BodyLimit: 1 << 30}`.

- [ ] **Step 4: Verify pass** — `go test ./internal/httpapi/ -run Submit -v` → PASS.

- [ ] **Step 5: Commit** — `git add overlay-go && git commit -m "feat(overlay-go): /submit with off-chain values framing and bare STEAK response"`

---

### Task 14: HTTP /lookup

**Files:**
- Create: `overlay-go/internal/httpapi/lookup.go`
- Test: `overlay-go/internal/httpapi/lookup_test.go`

**Interfaces:**
- `POST /lookup` (Appendix B §2): body must be JSON with string `service` and present `query`, else 400. Call `Engine.Lookup`. Respond `Content-Type: application/json` with `{"type":"output-list","outputs":[{"beef":[…ints…],"outputIndex":n}]}` — BEEF bytes as JSON **number arrays** (use `mandala.NumBytes`). Ignore the `X-Aggregation` header (JSON is the resolver's accepted fallback since it switches on response content-type). Engine error → 400 `{"status":"error","message":...}`.
- Extends `New` from Task 13 via a `Lookuper` interface.

- [ ] **Step 1: Write the failing test** — (a) invalid body → 400; (b) stub returns an answer with a 3-byte beef → response JSON contains `"beef":[1,2,3]` and `"type":"output-list"`; (c) header `X-Aggregation: yes` still yields JSON (content-type asserted).

- [ ] **Step 2: Verify fail.** — undefined.

- [ ] **Step 3: Implement** — marshal via a local `struct{ Type string `json:"type"`; Outputs []struct{ Beef mandala.NumBytes `json:"beef"`; OutputIndex uint32 `json:"outputIndex"` } `json:"outputs"` }`.

- [ ] **Step 4: Verify pass** — `go test ./internal/httpapi/ -run Lookup -v` → PASS.

- [ ] **Step 5: Commit** — `git add overlay-go && git commit -m "feat(overlay-go): /lookup JSON output-list"`

---

### Task 15: Admin GET endpoints

**Files:**
- Create: `overlay-go/internal/httpapi/admin.go`
- Test: `overlay-go/internal/httpapi/admin_test.go`

**Interfaces (Appendix B §3; all extend `New`, all read the URL-encoded `:assetId` path param):**
- `GET /admin/asset-state/:assetId` → `Store.GetAssetState` → 200 JSON `AssetAdminState`; error → 500 `{"error": msg}`.
- `GET /admin/admin-history/:assetId` → `FindAdminHistoryByAssetID` → 200 JSON array (never null — empty `[]`).
- `GET /admin/admin-history-page/:assetId?limit&offset` → `PageAdminHistory` (limit default 100, clamp [1,500]; offset default 0) → 200 JSON array.
- `GET /admin/admin-summary/:assetId` → `AdminSummary` → `{"totalIssued":n,"totalRedeemed":n,"actionCount":n}`.
- Health: `GET /health`, `/health/live`, `/health/ready` → 200 `{"status":"ok"}` (ready pings Mongo, 503 on failure).

- [ ] **Step 1: Write the failing test** — httptest with a Mongo-backed Store (skip pattern): seed two history entries via Store, hit all four endpoints, assert exact JSON field names (`assetId`, `actionDetails`, `admitSeq`, `totalIssued`…), the URL-encoded assetId round-trip (`ab..ab%2E0` and plain `ab..ab.0` both resolve), and empty-array (not null) for an unknown asset.

- [ ] **Step 2: Verify fail.** **Step 3: Implement.** **Step 4: Verify pass** (`go test ./internal/httpapi/ -run Admin -v`). **Step 5: Commit** — `git commit -m "feat(overlay-go): admin state/history/summary endpoints"`.

---

### Task 16: Arcade broadcaster + chaintracks tracker + /arc-ingest

**Files:**
- Create: `overlay-go/internal/arcade/broadcaster.go`, `overlay-go/internal/arcade/chaintracks.go`
- Create: `overlay-go/internal/httpapi/arcingest.go`
- Test: `overlay-go/internal/arcade/broadcaster_test.go`, `overlay-go/internal/httpapi/arcingest_test.go`

**Interfaces (Appendix B / spec §internal/arcade; TS reference `overlay-express/src/ArcadeProvider.ts`):**
- `func NewBroadcaster(baseURL, apiKey, callbackURL, callbackToken string, client *http.Client) *Broadcaster` implementing the engine's broadcaster interface (per pinned API notes; semantics: called before fold; error → submit rejected).
  - POST `{base}/tx` JSON `{"rawTx": <EF-format hex; plain hex fallback when source txs absent>}`; headers `Authorization: Bearer <key>`, `X-CallbackUrl`, `X-CallbackToken` (when set).
  - Classify the response body's `txStatus` EVEN ON HTTP 200: `DOUBLE_SPEND_ATTEMPTED|REJECTED|INVALID|MALFORMED|MINED_IN_STALE_BLOCK` or containing `ORPHAN` → terminal failure error.
- `func NewChaintracks(baseURL, prefix string, client *http.Client) *Chaintracks` implementing go-sdk `chaintracker.ChainTracker`: `IsValidRootForHeight(root, height)` via `GET {base}{prefix}/header/height/{h}` → compare `merkleRoot`; `CurrentHeight` via `GET {base}{prefix}/height`.
- `POST /arc-ingest` (registered only when Arcade configured): token check (`Authorization: Bearer` or `x-callback-token`) when a token is configured; body `{txid, merklePath?, blockHeight?, txStatus?}`; terminal status → evict (engine call per pinned notes); merklePath hex → `transaction.NewMerklePathFromHex` → `Engine.HandleNewMerkleProof`; no proof → 202; else 200.

- [ ] **Step 1: Write the failing tests** — broadcaster against `httptest.NewServer`: (a) success 200 `{"txStatus":"SEEN_ON_NETWORK"}` → nil error, request had Bearer + X-CallbackUrl headers and `rawTx` hex; (b) 200 `{"txStatus":"REJECTED"}` → error; (c) 500 → error. Chaintracks: header endpoint returning a root → IsValidRootForHeight true/false. arc-ingest: bad token → 401; merklePath → stubbed engine receives proof; terminal status → evict path taken; no proof → 202.

- [ ] **Step 2: Verify fail.** **Step 3: Implement.** **Step 4: Verify pass** (`go test ./internal/arcade/ ./internal/httpapi/ -v`). **Step 5: Commit** — `git commit -m "feat(overlay-go): Arcade broadcast + chaintracks + /arc-ingest"`.

---

### Task 17: Activity feed + /admin/activity

**Files:**
- Create: `overlay-go/internal/activity/activity.go`
- Modify: `overlay-go/internal/httpapi/admin.go` (add route)
- Test: `overlay-go/internal/activity/activity_test.go`

**Interfaces (port of `overlay/src/activity.ts` — keep behavior identical to the TS file at HEAD, incl. `GROUP_OVERLAP = 9`):**
- `type Deps struct { ListLinkage func(ctx, limit int64, before *time.Time) ([]mandala.LinkageRow, error); FindLinkageByOutpoints func(ctx, []mandala.Outpoint) ([]mandala.LinkageRow, error); FindRawTxs func(ctx, txids []string) (map[string]string, error) }` — first two from `mandala.Store`; `FindRawTxs` from engine storage (b-open-io exposes raw/BEEF reads; adapter written in wiring).
- `func SummarizeTx(p SummarizeParams) *Entry` — pure classifier: issue / transfer (largest external output, sum external amounts) / redeem / self (Appendix: activity.ts:100-138).
- `func Build(ctx, deps Deps, opts Opts) (Page, error)` — `Opts{AssetID string; Limit int64; Before *time.Time}`; limit clamp [1,500] default 100; fetch `limit+9` rows; group by txid newest-first; when more rows exist and >1 group, drop the last group whole and cursor to its newest `createdAt` (inclusive); decode FT outputs of each raw tx; resolve senders by joining input source outpoints to linkage rows + decoding source raw txs; entries sorted by `when` desc.
- `Page{Entries []Entry; NextCursor *string}` with JSON exactly `{entries:[{txid,when,assetId,kind,from,to,amount,proofs:[{outputIndex,identityKey,keyID,counterparty,proofType}]}], nextCursor}` (`from`/`to` null via `*string`).
- Route: `GET /admin/activity?assetId&limit&before` → 200 Page; invalid `before` → 400.

- [ ] **Step 1: Write the failing tests** — port the TS test suite `overlay/src/activity.test.ts` case-for-case (all 8 `summarizeTx` cases + the 4 pagination cases including the 9-row max-split transfer at limit 1 and the clamp test asserting `limit+9` request sizes). Fake deps in-memory exactly like the TS `pagingDeps`.

- [ ] **Step 2: Verify fail.** **Step 3: Implement.** **Step 4: Verify pass** (`go test ./internal/activity/ -v`). **Step 5: Commit** — `git commit -m "feat(overlay-go): activity feed with complete-group pagination"`.

---

### Task 18: main.go, Dockerfile, compose switch

**Files:**
- Modify: `overlay-go/cmd/overlay/main.go`
- Create: `overlay-go/Dockerfile`, `overlay-go/.env.example`
- Modify: `docker-compose.yml` (repo root — read it first; service names must match existing ones)

**Interfaces:**
- `main.go`: read env per Global Constraints (fail fast on missing required vars with a clear message naming the var); `wiring.Build`; `httpapi.New`; `Listen(":8080")`. Log one boot line: node name, network, arcade on/off, mongo db name.
- `Dockerfile`: multi-stage — `golang:1.25` build (`CGO_ENABLED=0 go build -o /overlay ./cmd/overlay`), `gcr.io/distroless/static` runtime, `EXPOSE 8080`.
- Compose: add `overlay-go` service (build `./overlay-go`, env from `.env`, `ports: 8081:8080`, depends_on mongodb) and point the app's `VITE_OVERLAY_URL` at it. Keep the TS `overlay` service defined; add a comment noting either can serve the app.

- [ ] **Step 1: Wire main.go** (no test — covered by Step 3 smoke).
- [ ] **Step 2: Build image** — `docker compose build overlay-go` → success.
- [ ] **Step 3: Smoke** — `docker compose up -d mongodb overlay-go && curl -s localhost:8081/health` → `{"status":"ok"}`; `curl -s -X POST localhost:8081/submit -H 'content-type: application/octet-stream' --data-binary ''` → 400 with `status:"error"` (missing topics); `curl -s localhost:8081/nope` → the TS-shaped 404 JSON.
- [ ] **Step 4: Commit** — `git commit -m "feat(overlay-go): server entrypoint, Dockerfile, compose service"`.

---

### Task 19: End-to-end parity run

**Files:**
- Modify: `docs/PROJECT-STATE.md` (add overlay-go section: env, how to run, parity status)

- [ ] **Step 1: Bring up the stack against overlay-go** — `docker compose up -d mongodb overlay-go`, run the app dev server with `VITE_OVERLAY_URL=http://localhost:8081` (note: metadata lookups require https in `networkPreset:'mainnet'` — for local dev the app's existing local config already handles this the same way it does for the TS overlay; verify with the TS overlay's local setup first if lookups fail).
- [ ] **Step 2: Full demo flow from the unchanged app** — register asset → issue → holder send (multi-output split change; verify STEAK admits all outputs) → receive on second identity → freeze holder outpoint → reissue → redeem → pause + attempt send (must be rejected by overlay, app shows error, inputs released) → access-mode allowlist test → activity page (pagination past a split-change tx) → admin history + summary views.
- [ ] **Step 3: Cross-check projections** — `mongosh mandala_lookup_services` vs the TS overlay's collections after the same flow on the TS stack: token rows, balances, asset states must match field-for-field.
- [ ] **Step 4: Update docs + commit** — record parity results and any deviations in `docs/PROJECT-STATE.md`; `git commit -m "docs: overlay-go parity run results"`.

---

## Plan Self-Review Notes

- **Spec coverage:** submit/lookup/admin×5/arc-ingest/health endpoints (Tasks 13–17), engine + storage (8, 12), domain logic (3–7, 9–11), Arcade (16), config/deploy (18), e2e (19). Non-goals (GASP/SHIP/BASM/UI/auth) intentionally absent.
- **Known reconciliation points** (all flagged in-task): go-sdk `Decrypt`/`Counterparty`/opcode-constant names (Tasks 1, 3, 6), engine `Config`/Submit-mode/broadcaster-interface names (12, 13, 16), b-open-io constructors (12), ctx propagation (1 → 10/13).
- **Type consistency:** `mandala.Outpoint`/`TokenRow`/`LinkageRow`/`AdminHistoryEntry` defined once (Task 8) and consumed by 11/15/17; `ActionDetails` (Task 5) consumed by 7/9/11; `NumBytes` (5) consumed by 14.

