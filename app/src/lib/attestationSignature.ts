/**
 * Cryptographic auditor signatures over reserve attestations. When an auditor
 * signs, their wallet (identity key) produces an ECDSA signature over a
 * canonical digest of exactly what is being attested (period, reserves,
 * circulation, composition). The signature is made with counterparty 'anyone',
 * so any party can later verify it against the auditor's Badge ID - turning a
 * "signed" status flag into attributable, tamper-evident, non-repudiable
 * evidence. If any attested field is altered, verification fails.
 */
import { Utils, type WalletClient, type WalletProtocol } from '@bsv/sdk'
import type { Attestation } from './compliance'

const PROTOCOL: WalletProtocol = [1, 'underwrite attestation']

/** Deterministic canonical representation of what an auditor attests to. */
export function attestationMessage(att: Pick<Attestation, 'id' | 'assetId' | 'period' | 'currency' | 'reservesTotal' | 'circulation' | 'lines'>): string {
  return JSON.stringify({
    id: att.id,
    assetId: att.assetId,
    period: att.period,
    currency: att.currency,
    reservesTotal: att.reservesTotal,
    circulation: att.circulation,
    lines: [...att.lines]
      .map(l => ({ c: l.assetClass, a: l.amount }))
      .sort((x, y) => x.c.localeCompare(y.c)),
  })
}

export interface AttestationSignature {
  /** The auditor's identity key (Badge ID) that produced the signature. */
  auditorKey: string
  /** Hex-encoded DER ECDSA signature. */
  signature: string
}

/** Sign an attestation with the auditor's wallet (verifiable by anyone). */
export async function signAttestation(wallet: WalletClient, att: Attestation, auditorKey: string): Promise<AttestationSignature> {
  const data = Utils.toArray(attestationMessage(att), 'utf8')
  const { signature } = await wallet.createSignature({
    data,
    protocolID: PROTOCOL,
    keyID: att.id,
    counterparty: 'anyone',
  })
  return { auditorKey, signature: Utils.toHex(signature) }
}

/** Verify an attestation's signature against its recorded auditor Badge ID. */
export async function verifyAttestationSignature(wallet: WalletClient, att: Attestation): Promise<boolean> {
  if (att.signature == null || att.auditorKey == null) return false
  try {
    const data = Utils.toArray(attestationMessage(att), 'utf8')
    const res = await wallet.verifySignature({
      data,
      signature: Utils.toArray(att.signature, 'hex'),
      protocolID: PROTOCOL,
      keyID: att.id,
      counterparty: att.auditorKey,
    })
    return res.valid === true
  } catch {
    return false
  }
}
