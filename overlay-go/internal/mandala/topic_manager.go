package mandala

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"slices"

	"github.com/bsv-blockchain/go-overlay-services/pkg/core/engine"
	"github.com/bsv-blockchain/go-sdk/chainhash"
	"github.com/bsv-blockchain/go-sdk/overlay"
	"github.com/bsv-blockchain/go-sdk/transaction"
)

// StateStore is the tm_mandala view of the mandala state store: per-asset
// admin state plus token-row lookup. Satisfied by *Store.
type StateStore interface {
	GetAssetState(ctx context.Context, assetID string) (AssetAdminState, error)
	GetTokenRow(ctx context.Context, txid string, vout uint32) (*TokenRow, error)
}

// ScreeningProvider answers sanctions checks against identity keys.
type ScreeningProvider interface {
	IsSanctioned(ctx context.Context, identityKey string) (bool, error)
}

// NoSanctions is the always-clear ScreeningProvider.
type NoSanctions struct{}

// IsSanctioned always reports false.
func (NoSanctions) IsSanctioned(context.Context, string) (bool, error) { return false, nil }

// TopicManager is the tm_mandala consensus core: it classifies outputs,
// verifies FT outputs by BRC-72 key linkage, enforces per-asset conservation,
// screens sanctions, and applies the per-asset control gates (Appendix A §3).
type TopicManager struct {
	verifier *Verifier
	admin    *AdminWallet
	screen   ScreeningProvider
	state    StateStore
}

var _ engine.TopicManager = (*TopicManager)(nil)

// NewTopicManager wires the tm_mandala dependencies together.
func NewTopicManager(v *Verifier, aw *AdminWallet, sp ScreeningProvider, st StateStore) *TopicManager {
	return &TopicManager{verifier: v, admin: aw, screen: sp, state: st}
}

// ftOut is a classified MandalaToken output; identityKey is set on admission
// (from the verified output linkage's counterparty).
type ftOut struct {
	index       uint32
	assetID     string
	amount      int64
	pubKeyHash  [20]byte
	identityKey string
}

// IdentifyAdmissibleOutputs runs the full §3 admission pipeline. Rejections
// are errors (never silently-empty instructions): the engine treats a thrown
// topic as failed, which keeps rejected transfers off the network.
func (m *TopicManager) IdentifyAdmissibleOutputs(ctx context.Context, beef *transaction.Beef, txid *chainhash.Hash, previousCoins []uint32) (overlay.AdmittanceInstructions, error) {
	var none overlay.AdmittanceInstructions
	if beef == nil || txid == nil {
		return none, m.reject(errors.New("tm_mandala: missing beef or txid"))
	}
	// §3.1 parse: the tx (with source transactions) from the beef, the
	// off-chain linkage payload from ctx (empty payload when absent).
	tx := beef.FindTransaction(txid.String())
	if tx == nil {
		return none, m.reject(fmt.Errorf("tm_mandala: transaction %s not found in beef", txid))
	}
	payload := PayloadFromContext(ctx)

	// §3.2 classify outputs: FT outputs by script shape, admin outputs via
	// verified payload.admin details (pkh re-derivation + priorOutpoint).
	adminByIndex := map[uint32]ActionDetails{}
	for _, a := range payload.Admin {
		adminByIndex[a.Index] = a.ActionDetails
	}
	var fts []ftOut
	var adminIdx []uint32
	// assetId -> actionDetails, populated ONLY from verified admin outputs.
	// This — never the raw payload — is the source of the control-gate admin
	// exemption, so a forged admin entry cannot bypass the pause/access gates.
	verifiedAdminByAsset := map[string]ActionDetails{}
	authorizedIssuance := map[string]int64{}
	for i, out := range tx.Outputs {
		idx := uint32(i)
		if out.LockingScript == nil {
			continue
		}
		if d, err := DecodeToken(out.LockingScript); err == nil {
			// Token value lives in the script payload, never in the output's
			// satoshis: every token output must carry exactly 1 satoshi, so
			// sats cannot be stranded inside token outputs (TS parity:
			// MandalaTopicManager.classifyOutputs throws, rejecting the tx).
			if out.Satoshis != 1 {
				return none, m.reject(fmt.Errorf("token output %d must carry exactly 1 satoshi", idx))
			}
			fts = append(fts, ftOut{index: idx, assetID: d.AssetID, amount: d.Amount, pubKeyHash: d.PubKeyHash})
			continue
		}
		details, ok := adminByIndex[idx]
		if !ok || details == nil {
			continue
		}
		admin, err := m.verifyAdminOutput(tx, idx, details)
		if err != nil {
			return none, m.reject(err)
		}
		if !admin {
			continue
		}
		// Same 1-satoshi rule for admin-auth outputs — enforced only AFTER
		// verifyAdminOutput admits: an admin output is a bare P2PKH, so
		// checking earlier would reject ordinary wallet change.
		if out.Satoshis != 1 {
			return none, m.reject(fmt.Errorf("admin output %d must carry exactly 1 satoshi", idx))
		}
		adminIdx = append(adminIdx, idx)
		if assetID, ok := details.Str("assetId"); ok {
			verifiedAdminByAsset[assetID] = details
			// §3.2f issuance credit: issue/reissue mint +amount; redeem
			// credits -amount so partial burns satisfy out == in + issued.
			amt, _ := details.Num("amount") // missing amount -> 0
			switch details.Kind() {
			case "issue", "reissue":
				authorizedIssuance[assetID] += amt
			case "redeem":
				authorizedIssuance[assetID] -= amt
			}
		}
	}

	// §3.3 verify FT outputs by key linkage. Missing linkage -> silent skip;
	// a clean pkh MISMATCH -> silent skip; a verification ERROR (tampered
	// ciphertext, bad point, malformed linkage) PROPAGATES and rejects the
	// whole tx (§2.5 "errors propagate as failure"; TS parity: verifyFtOutputs
	// calls verifyKeyLinkage directly, uncaught — linkageControlsPubKeyHash's
	// error-swallowing is not used in the output-admission loop).
	outLinkByIndex := map[uint32]*SpecificLinkage{}
	for _, o := range payload.Outputs {
		outLinkByIndex[o.Index] = o.Linkage
	}
	admitted := make([]ftOut, 0, len(fts))
	for _, f := range fts {
		l := outLinkByIndex[f.index]
		if l == nil {
			continue
		}
		identity, pkh, err := m.verifier.VerifyKeyLinkage(ctx, l)
		if err != nil {
			return none, m.reject(fmt.Errorf("output %d linkage verification: %w", f.index, err))
		}
		if !bytes.Equal(pkh, f.pubKeyHash[:]) {
			continue
		}
		f.identityKey = identity
		admitted = append(admitted, f)
	}

	// §3.4 conservation over previousCoins source outputs.
	if !m.conservationHolds(tx, previousCoins, admitted, authorizedIssuance) {
		return none, m.reject(errors.New("conservation violated: outputs exceed authorized inputs/issuance"))
	}

	// §3.5 sanctions screening — input linkage errors PROPAGATE here.
	if err := m.anySanctioned(ctx, payload, admitted); err != nil {
		return none, m.reject(err)
	}

	// §3.6 control gates — input linkage errors are TOLERATED in sender
	// resolution (deliberate asymmetry with §3.5).
	pass, err := m.controlGatePasses(ctx, tx, payload, admitted, verifiedAdminByAsset)
	if err != nil {
		return none, m.reject(err)
	}
	if !pass {
		return none, m.reject(errors.New("control gate rejected the transaction (paused asset or access mode)"))
	}

	// §3.7 result: admitted FT indices ∪ admitted admin indices, ascending.
	admit := make([]uint32, 0, len(admitted)+len(adminIdx))
	for _, f := range admitted {
		admit = append(admit, f.index)
	}
	admit = append(admit, adminIdx...)
	slices.Sort(admit)
	return overlay.AdmittanceInstructions{OutputsToAdmit: admit, CoinsToRetain: previousCoins}, nil
}

// reject logs a warning with the rejection reason before returning it (TS
// parity: the TS manager console.warns and rethrows).
func (m *TopicManager) reject(err error) error {
	log.Printf("[tm_mandala] identifyAdmissibleOutputs rejected: %v", err)
	return err
}

// verifyAdminOutput implements §3.2a-e: MandalaAdmin.decode, pkh
// re-derivation via the admin wallet (Commitment(details) keyID), and the
// priorOutpoint-spent check (register exempt).
//
// A non-nil error means key DERIVATION failed (e.g. malformed
// details.counterparty hex) and must reject the whole tx (TS parity:
// adminWallet.getPublicKey is awaited uncaught in verifyAdminOutput). Script
// decode failure (not admin-shaped) is shape classification, not
// verification, and stays a silent (false, nil) skip — as does a clean pkh
// mismatch or an unspent priorOutpoint.
func (m *TopicManager) verifyAdminOutput(tx *transaction.Transaction, idx uint32, details ActionDetails) (bool, error) {
	decoded, err := DecodeAdmin(tx.Outputs[idx].LockingScript)
	if err != nil {
		return false, nil
	}
	expected, err := m.admin.ExpectedPKH(details)
	if err != nil {
		return false, fmt.Errorf("admin output %d key derivation: %w", idx, err)
	}
	if expected != decoded.PubKeyHash {
		return false, nil
	}
	return priorOutpointSpent(tx, details), nil
}

// priorOutpointSpent chains every admin action to spending the previous
// admin-auth output: kind "register" is exempt; otherwise details.priorOutpoint
// must equal some tx input's "<sourceTXID>.<sourceOutputIndex>".
func priorOutpointSpent(tx *transaction.Transaction, details ActionDetails) bool {
	if details.Kind() == "register" {
		return true
	}
	prior, ok := details.Str("priorOutpoint")
	if !ok {
		return false
	}
	for _, in := range tx.Inputs {
		if inputOutpointString(in) == prior {
			return true
		}
	}
	return false
}

// inputOutpointString renders an input's outpoint as
// "<txid>.<sourceOutputIndex>" where txid is SourceTXID, else the source
// tx's computed id, else the empty string (TS parity — §0.2, §3.6).
func inputOutpointString(in *transaction.TransactionInput) string {
	txid := ""
	if in.SourceTXID != nil {
		txid = in.SourceTXID.String()
	} else if in.SourceTransaction != nil {
		txid = in.SourceTransaction.TxID().String()
	}
	return fmtOutpoint(txid, in.SourceTxOutIndex)
}

// sourceOutput resolves an input's source output, or nil when the source
// transaction or output is absent (TS: input?.sourceTransaction?.outputs[i]).
func sourceOutput(in *transaction.TransactionInput) *transaction.TransactionOutput {
	if in == nil || in.SourceTransaction == nil {
		return nil
	}
	if int(in.SourceTxOutIndex) >= len(in.SourceTransaction.Outputs) {
		return nil
	}
	return in.SourceTransaction.Outputs[in.SourceTxOutIndex]
}

// ftInputAssetID decodes an input's source output as a MandalaToken,
// reporting its assetId, or ok=false for non-token/unresolvable inputs.
func ftInputAssetID(in *transaction.TransactionInput) (string, bool) {
	src := sourceOutput(in)
	if src == nil || src.LockingScript == nil {
		return "", false
	}
	d, err := DecodeToken(src.LockingScript)
	if err != nil {
		return "", false
	}
	return d.AssetID, true
}

// conservationHolds implements §3.4: inTotals only over previousCoins source
// outputs that decode as tokens; for every assetId present in outTotals
// require out == in + authorizedIssuance. Assets appearing only on the input
// side are unconstrained (consume-only, e.g. full redeem).
func (m *TopicManager) conservationHolds(tx *transaction.Transaction, previousCoins []uint32, admitted []ftOut, issued map[string]int64) bool {
	outTotals := map[string]int64{}
	for _, f := range admitted {
		outTotals[f.assetID] += f.amount
	}
	inTotals := map[string]int64{}
	for _, ci := range previousCoins {
		if int(ci) >= len(tx.Inputs) {
			continue
		}
		src := sourceOutput(tx.Inputs[ci])
		if src == nil || src.LockingScript == nil {
			continue
		}
		d, err := DecodeToken(src.LockingScript)
		if err != nil {
			continue // non-token previous coin
		}
		inTotals[d.AssetID] += d.Amount
	}
	for assetID, outAmt := range outTotals {
		if outAmt != inTotals[assetID]+issued[assetID] {
			return false
		}
	}
	return true
}

// anySanctioned implements §3.5: the identity set is all admitted-FT identity
// keys plus verifyKeyLinkage(inp.linkage).identityKey for EVERY payload.Inputs
// entry. A linkage verification error is NOT caught here — it propagates and
// rejects the whole tx (asymmetric with §3.6 sender resolution).
func (m *TopicManager) anySanctioned(ctx context.Context, payload *LinkagePayload, admitted []ftOut) error {
	seen := map[string]bool{}
	keys := make([]string, 0, len(admitted)+len(payload.Inputs))
	add := func(k string) {
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	for _, f := range admitted {
		add(f.identityKey)
	}
	for _, inp := range payload.Inputs {
		identity, _, err := m.verifier.VerifyKeyLinkage(ctx, inp.Linkage)
		if err != nil {
			return fmt.Errorf("input linkage verification failed during sanctions screening: %w", err)
		}
		add(identity)
	}
	for _, k := range keys {
		hit, err := m.screen.IsSanctioned(ctx, k)
		if err != nil {
			return err
		}
		if hit {
			return errors.New("sanctioned party involved in transfer")
		}
	}
	return nil
}

// controlGatePasses implements §3.6. The asset universe is the admitted-FT
// assetIds plus the assetId of EVERY tx input whose source output decodes as
// a MandalaToken (all inputs, not just previousCoins). Senders are resolved
// lazily, once, from payload.Inputs — errors skipped (unverifiable input
// linkage is simply not counted as a party). A StateStore error propagates.
func (m *TopicManager) controlGatePasses(ctx context.Context, tx *transaction.Transaction, payload *LinkagePayload, admitted []ftOut, verifiedAdminByAsset map[string]ActionDetails) (bool, error) {
	seen := map[string]bool{}
	var assets []string
	addAsset := func(id string) {
		if !seen[id] {
			seen[id] = true
			assets = append(assets, id)
		}
	}
	for _, f := range admitted {
		addAsset(f.assetID)
	}
	for _, in := range tx.Inputs {
		if id, ok := ftInputAssetID(in); ok {
			addAsset(id)
		}
	}

	inputOutpoints := make([]string, len(tx.Inputs))
	for i, in := range tx.Inputs {
		inputOutpoints[i] = inputOutpointString(in)
	}

	var senders []string
	sendersResolved := false
	resolveSenders := func() []string {
		if sendersResolved {
			return senders
		}
		sendersResolved = true
		for _, inp := range payload.Inputs {
			identity, _, err := m.verifier.VerifyKeyLinkage(ctx, inp.Linkage)
			if err != nil {
				continue // tolerated: unverifiable input ⇒ not counted as a party
			}
			senders = append(senders, identity)
		}
		return senders
	}

	for _, assetID := range assets {
		state, err := m.state.GetAssetState(ctx, assetID)
		if err != nil {
			return false, fmt.Errorf("tm_mandala: asset state for %s: %w", assetID, err)
		}
		if !assetGatePasses(state, tx, assetID, admitted, verifiedAdminByAsset, inputOutpoints, resolveSenders) {
			return false, nil
		}
	}
	return true, nil
}

// assetGatePasses runs the per-asset gates. A tx is an "issuer admin action
// for X" iff it carries a VERIFIED admin output with actionDetails.assetId ==
// X; otherwise its movement of X is a peer transfer.
func assetGatePasses(state AssetAdminState, tx *transaction.Transaction, assetID string, admitted []ftOut, verifiedAdminByAsset map[string]ActionDetails, inputOutpoints []string, resolveSenders func() []string) bool {
	frozen := map[string]bool{}
	for _, f := range state.FrozenOutpoints {
		frozen[f.Outpoint] = true
	}
	for _, op := range state.EvictedOutpoints {
		frozen[op] = true
	}
	// Gate 1: frozen/evicted input spend — ALL txs, admin included (blocks
	// even redeems of frozen coins; only unfreeze or reissue resolves).
	for _, op := range inputOutpoints {
		if frozen[op] {
			return false
		}
	}

	adminAction, isAdmin := verifiedAdminByAsset[assetID]

	// Gate 2: pause — peer transfers only; verified admin actions on X exempt.
	if state.IsPaused && !isAdmin {
		return false
	}

	// Gate 3: access mode — peer transfers only. Parties are the admitted-FT
	// identity keys for X plus the lazily-resolved senders, minus the issuer.
	if !isAdmin {
		var parties []string
		for _, f := range admitted {
			if f.assetID == assetID {
				parties = append(parties, f.identityKey)
			}
		}
		for _, s := range resolveSenders() {
			parties = append(parties, s)
		}
		filtered := make([]string, 0, len(parties))
		for _, k := range parties {
			if k != state.IssuerIdentityKey {
				filtered = append(filtered, k)
			}
		}
		if accessModeRejects(state, filtered) {
			return false
		}
	}

	// Reissue guards (a/b/c).
	if isAdmin && adminAction.Kind() == "reissue" && reissueGuardFails(state, tx, assetID, adminAction) {
		return false
	}
	return true
}

// accessModeRejects: denylist rejects when any party is blocked; any other
// accessMode value is treated as allowlist, rejecting when any party is not
// explicitly allowed.
func accessModeRejects(state AssetAdminState, parties []string) bool {
	if state.AccessMode == "denylist" {
		for _, k := range parties {
			if slices.Contains(state.BlockedIdentities, k) {
				return true
			}
		}
		return false
	}
	for _, k := range parties {
		if !slices.Contains(state.AllowedIdentities, k) {
			return true
		}
	}
	return false
}

// reissueGuardFails: (a) the target outpoint must currently be frozen;
// (b) the minted amount must exactly match the frozen ref's amount;
// (c) the tx must carry ZERO FT inputs of the asset (the frozen coin is
// evicted, never spent).
func reissueGuardFails(state AssetAdminState, tx *transaction.Transaction, assetID string, adminAction ActionDetails) bool {
	op, _ := adminAction.Str("outpoint") // non-string -> "" (matches nothing)
	var ref *FrozenRef
	for i := range state.FrozenOutpoints {
		if state.FrozenOutpoints[i].Outpoint == op {
			ref = &state.FrozenOutpoints[i]
			break
		}
	}
	if ref == nil {
		return true // (a)
	}
	amt, ok := adminAction.Num("amount")
	if !ok || ref.Amount != amt {
		return true // (b)
	}
	for _, in := range tx.Inputs {
		if id, ok := ftInputAssetID(in); ok && id == assetID {
			return true // (c)
		}
	}
	return false
}

// IdentifyNeededInputs never requests extra inputs (TS parity: the TS manager
// does not implement identifyNeededInputs).
func (m *TopicManager) IdentifyNeededInputs(context.Context, *transaction.Beef, *chainhash.Hash) ([]*transaction.Outpoint, error) {
	return nil, nil
}

// GetDocumentation describes the topic's admission rules.
func (m *TopicManager) GetDocumentation() string {
	return "tm_mandala admits BRC-92 Mandala fungible-token outputs whose BRC-72 " +
		"specific key linkages verify against the on-chain pubKeyHashes, plus " +
		"admin-auth outputs whose action details re-derive the admin lock key and " +
		"chain to a spent prior authorization. Transfers must conserve per-asset " +
		"supply (out == in + authorized issuance), pass sanctions screening of " +
		"every involved identity, and clear the per-asset control gates: no " +
		"frozen/evicted inputs, no peer transfers while paused, and access-mode " +
		"(denylist/allowlist) party checks; reissues must target a frozen outpoint " +
		"with the exact frozen amount and carry no FT inputs of the asset."
}

// GetMetaData names the topic.
func (m *TopicManager) GetMetaData() *overlay.MetaData {
	return &overlay.MetaData{
		Name:        "tm_mandala",
		Description: "BRC-92 Mandala regulated fungible-token transfers with key-linkage verification and sanctions screening.",
	}
}
