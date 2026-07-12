/**
 * Cryptographic sign-off for compliance events - reserve attestations,
 * redemption-at-par confirmations, and sensitive control actions. A signer's
 * wallet (identity key) produces an ECDSA signature over a canonical digest of
 * exactly what is being signed off, so a "signed" flag becomes attributable,
 * non-repudiable, tamper-evident evidence: altering any signed field fails
 * verification. Signatures are made with counterparty 'anyone' so any party can
 * verify against the signer's Entity ID.
 */
import { Utils, type WalletClient, type WalletProtocol } from '@bsv/sdk'
import type { Attestation, RedemptionRequest, ControlAction } from './compliance'

const PROTOCOL: WalletProtocol = [1, 'underwrite compliance']

/** Sign a canonical statement with the signer's wallet; returns hex signature. */
export async function signStatement(wallet: WalletClient, keyID: string, message: string): Promise<string> {
  const { signature } = await wallet.createSignature({
    data: Utils.toArray(message, 'utf8'),
    protocolID: PROTOCOL,
    keyID,
    counterparty: 'anyone',
  })
  return Utils.toHex(signature)
}

/**
 * Verify a statement's signature against the signer's identity key. Tries both
 * `forSelf` modes so it verifies whether the viewer is a third party or the
 * original signer (the demo often uses one wallet with a toggled role).
 */
export async function verifyStatement(wallet: WalletClient, keyID: string, message: string, signerKey: string, signature: string): Promise<boolean> {
  const data = Utils.toArray(message, 'utf8')
  const sig = Utils.toArray(signature, 'hex')
  for (const forSelf of [false, true]) {
    try {
      const res = await wallet.verifySignature({ data, signature: sig, protocolID: PROTOCOL, keyID, counterparty: signerKey, forSelf })
      if (res.valid === true) return true
    } catch { /* try the other mode */ }
  }
  return false
}

// ── Reserve attestations ──────────────────────────────────────────────────────

export function attestationMessage(att: Pick<Attestation, 'id' | 'assetId' | 'period' | 'currency' | 'reservesTotal' | 'circulation' | 'lines' | 'evidence'>): string {
  return JSON.stringify({
    kind: 'attestation',
    id: att.id,
    assetId: att.assetId,
    period: att.period,
    currency: att.currency,
    reservesTotal: att.reservesTotal,
    circulation: att.circulation,
    evidence: att.evidence ?? '',
    lines: [...att.lines]
      .map(l => ({ c: l.assetClass, a: l.amount, at: canonicalAttrs(l.attributes) }))
      .sort((x, y) => x.c.localeCompare(y.c) || (x.a - y.a)),
  })
}

/** Attributes as a key-sorted array so the digest is order-independent. */
function canonicalAttrs(attrs?: Record<string, string>): [string, string][] {
  if (attrs == null) return []
  return Object.keys(attrs).sort().map(k => [k, attrs[k]] as [string, string])
}

export async function signAttestation(wallet: WalletClient, att: Attestation): Promise<string> {
  return signStatement(wallet, `attestation:${att.id}`, attestationMessage(att))
}

export async function verifyAttestationSignature(wallet: WalletClient, att: Attestation): Promise<boolean> {
  if (att.signature == null || att.auditorKey == null) return false
  return verifyStatement(wallet, `attestation:${att.id}`, attestationMessage(att), att.auditorKey, att.signature)
}

// ── Redemption at-par confirmations ───────────────────────────────────────────

export function redemptionMessage(r: Pick<RedemptionRequest, 'id' | 'assetId' | 'holderKey' | 'amount' | 'currency' | 'status' | 'requestedAt' | 'processedAt'>): string {
  return JSON.stringify({
    kind: 'redemption',
    id: r.id,
    assetId: r.assetId,
    holderKey: r.holderKey,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    requestedAt: r.requestedAt,
    processedAt: r.processedAt ?? '',
  })
}

export async function signRedemption(wallet: WalletClient, r: RedemptionRequest): Promise<string> {
  return signStatement(wallet, `redemption:${r.id}`, redemptionMessage(r))
}

export async function verifyRedemptionSignature(wallet: WalletClient, r: RedemptionRequest): Promise<boolean> {
  if (r.auditorSignature == null || r.auditorKey == null) return false
  return verifyStatement(wallet, `redemption:${r.id}`, redemptionMessage(r), r.auditorKey, r.auditorSignature)
}

// ── Control actions (freezes, reissue, policy changes …) ──────────────────────

export function actionMessage(a: Pick<ControlAction, 'id' | 'assetId' | 'kind' | 'detail' | 'reason' | 'actorKey' | 'createdAt'>): string {
  return JSON.stringify({
    kind: 'control-action',
    id: a.id,
    assetId: a.assetId,
    action: a.kind,
    detail: a.detail,
    reason: a.reason,
    actorKey: a.actorKey,
    createdAt: a.createdAt,
  })
}

export async function signAction(wallet: WalletClient, a: ControlAction): Promise<string> {
  return signStatement(wallet, `action:${a.id}`, actionMessage(a))
}

export async function verifyActionSignature(wallet: WalletClient, a: ControlAction): Promise<boolean> {
  if (a.signature == null || a.auditorKey == null) return false
  return verifyStatement(wallet, `action:${a.id}`, actionMessage(a), a.auditorKey, a.signature)
}
