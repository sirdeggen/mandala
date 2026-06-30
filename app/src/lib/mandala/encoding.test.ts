import { describe, it, expect } from 'vitest'
import { Utils } from '@bsv/sdk'
import { encodeLinkagePayload, MandalaLinkagePayload } from './encoding'
import type { MandalaActionDetails } from './encoding'

it('accepts the new stablecoin action kinds (type + runtime)', () => {
  const d: MandalaActionDetails = { kind: 'reissue', assetId: 'x.0', outpoint: 'y.1', amount: 5, recipient: '02ab' }
  const bytes = encodeLinkagePayload({ inputs: [], outputs: [], admin: [{ index: 0, actionDetails: d }] })
  expect(bytes.length).toBeGreaterThan(0)
})

describe('encodeLinkagePayload', () => {
  it('encodes to JSON-UTF8 bytes that round-trip', () => {
    const payload: MandalaLinkagePayload = {
      inputs: [],
      outputs: [{ index: 0, linkage: {
        prover: 'aa', verifier: 'bb', counterparty: 'cc',
        protocolID: [2, 'mandala token'], keyID: 'k',
        encryptedLinkage: [1, 2, 3], encryptedLinkageProof: [4, 5], proofType: 0
      } }],
      admin: [{ index: 1, actionDetails: { kind: 'issue', assetId: 'x.0', amount: 5, priorOutpoint: 'y.0' } }]
    }
    const bytes = encodeLinkagePayload(payload)
    const decoded = JSON.parse(Utils.toUTF8(bytes))
    expect(decoded).toEqual(payload)
  })
})
