import { describe, it, expect } from 'vitest'
import { buildAdminActionArgs, buildGlobalAdminActionArgs } from './assets'
import type { AdminAsset } from './assets'
import type { MandalaActionDetails } from './encoding'
import { BASKET } from './constants'

const fakeAsset: AdminAsset = {
  assetId: 'x'.repeat(64) + '.0',
  label: 'USD',
  authOutpoint: 'a'.repeat(64) + '.0',
  authDetails: { kind: 'issue', assetId: 'x'.repeat(64) + '.0', amount: 100, priorOutpoint: 'prev.0' },
  metadata: { decimals: 2 }
}

describe('buildAdminActionArgs (pure tx-shape builder)', () => {
  it('pause builds one prior-auth input + one next-auth output, no FT output', () => {
    const details: MandalaActionDetails = { kind: 'pause', assetId: fakeAsset.assetId, priorOutpoint: fakeAsset.authOutpoint }
    const args = buildAdminActionArgs(fakeAsset, details, 'fakeLockHex')

    // One prior-auth input
    expect(args.inputs).toHaveLength(1)
    expect(args.inputs[0]).toMatchObject({ outpoint: fakeAsset.authOutpoint, inputDescription: expect.stringContaining('auth') })

    // One next-auth output only (no FT output)
    expect(args.outputs).toHaveLength(1)
    expect(args.outputs[0]).toMatchObject({
      lockingScript: 'fakeLockHex',
      outputDescription: expect.stringContaining('auth'),
      basket: BASKET
    })

    // Description includes the kind
    expect(args.description).toContain('pause')
    expect(args.description).toContain('USD')
  })

  it('reissue builds one prior-auth input + FT output at index 0 + next-auth output at index 1', () => {
    const details: MandalaActionDetails = { kind: 'reissue', assetId: fakeAsset.assetId, amount: 500, priorOutpoint: fakeAsset.authOutpoint, recipient: '02recip' }
    const ftOutput = { lockingScript: 'ftLockHex', amount: 500, recipient: '02recip' }
    const args = buildAdminActionArgs(fakeAsset, details, 'authLockHex', ftOutput)

    // One prior-auth input
    expect(args.inputs).toHaveLength(1)
    expect(args.inputs[0]).toMatchObject({ outpoint: fakeAsset.authOutpoint })

    // Two outputs: FT at index 0, auth at index 1
    expect(args.outputs).toHaveLength(2)
    expect(args.outputs[0]).toMatchObject({ lockingScript: 'ftLockHex', outputDescription: expect.stringContaining('FT') })
    expect(args.outputs[1]).toMatchObject({ lockingScript: 'authLockHex', basket: BASKET })
  })

  it('sets randomizeOutputs: false', () => {
    const details: MandalaActionDetails = { kind: 'pause', assetId: fakeAsset.assetId }
    const args = buildAdminActionArgs(fakeAsset, details, 'lockHex')
    expect(args.options?.randomizeOutputs).toBe(false)
  })

  it('includes mandala and action kind labels', () => {
    const details: MandalaActionDetails = { kind: 'setAccessMode', assetId: fakeAsset.assetId, mode: 'allowlist' }
    const args = buildAdminActionArgs(fakeAsset, details, 'lockHex')
    expect(args.labels).toContain('mandala')
    expect(args.labels).toContain('setAccessMode')
  })
})

describe('buildGlobalAdminActionArgs (multi-asset pure builder)', () => {
  const assetA: AdminAsset = { ...fakeAsset, assetId: 'aaa.0', label: 'AAA', authOutpoint: 'aaOut.0', authDetails: { kind: 'issue' } }
  const assetB: AdminAsset = { ...fakeAsset, assetId: 'bbb.0', label: 'BBB', authOutpoint: 'bbOut.0', authDetails: { kind: 'issue' } }

  it('produces one input per asset and one output per asset', () => {
    const detailsFor = (a: AdminAsset): MandalaActionDetails => ({ kind: 'pause', assetId: a.assetId })
    const lockScripts = ['lockA', 'lockB']
    const args = buildGlobalAdminActionArgs([assetA, assetB], detailsFor, lockScripts)

    expect(args.inputs).toHaveLength(2)
    expect(args.inputs[0]).toMatchObject({ outpoint: assetA.authOutpoint })
    expect(args.inputs[1]).toMatchObject({ outpoint: assetB.authOutpoint })

    expect(args.outputs).toHaveLength(2)
    expect(args.outputs[0]).toMatchObject({ lockingScript: 'lockA', basket: BASKET })
    expect(args.outputs[1]).toMatchObject({ lockingScript: 'lockB', basket: BASKET })
  })

  it('uses the first asset kind in description and labels', () => {
    const detailsFor = (a: AdminAsset): MandalaActionDetails => ({ kind: 'unpause', assetId: a.assetId })
    const args = buildGlobalAdminActionArgs([assetA, assetB], detailsFor, ['lockA', 'lockB'])
    expect(args.description).toContain('unpause')
    expect(args.labels).toContain('unpause')
  })
})
