import { Utils, WalletProtocol } from '@bsv/sdk'
import type { MandalaActionDetails } from '@bsv/templates'
export type { MandalaActionKind, MandalaActionDetails } from '@bsv/templates'

export interface SpecificLinkage {
  prover: string
  verifier: string
  counterparty: string
  protocolID: WalletProtocol
  keyID: string
  encryptedLinkage: number[]
  encryptedLinkageProof: number[]
  proofType: number
}

export interface MandalaLinkagePayload {
  inputs: Array<{ index: number, linkage: SpecificLinkage }>
  outputs: Array<{ index: number, linkage: SpecificLinkage }>
  admin?: Array<{ index: number, actionDetails: MandalaActionDetails }>
}

export const encodeLinkagePayload = (payload: MandalaLinkagePayload): number[] =>
  Utils.toArray(JSON.stringify(payload), 'utf8')
