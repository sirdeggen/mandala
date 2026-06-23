import { Utils, WalletProtocol } from '@bsv/sdk'

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

export type MandalaActionKind = 'register' | 'issue' | 'redeem' | 'recover'

export interface MandalaActionDetails {
  kind: MandalaActionKind
  assetId?: string
  amount?: number
  priorOutpoint?: string
  [k: string]: unknown
}

export interface MandalaLinkagePayload {
  inputs: Array<{ index: number, linkage: SpecificLinkage }>
  outputs: Array<{ index: number, linkage: SpecificLinkage }>
  admin?: Array<{ index: number, actionDetails: MandalaActionDetails }>
}

export const encodeLinkagePayload = (payload: MandalaLinkagePayload): number[] =>
  Utils.toArray(JSON.stringify(payload), 'utf8')
