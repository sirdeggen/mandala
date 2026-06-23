import { describe, it, expect } from 'vitest'
import { Hash, PrivateKey, Utils } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { outpoint, decodeBalances } from './tokens'

describe('tokens helpers', () => {
  it('formats outpoints', () => {
    expect(outpoint('ab', 2)).toBe('ab.2')
  })

  it('sums balances by assetId and skips non-token scripts', () => {
    const pkh = Hash.hash160(PrivateKey.fromRandom().toPublicKey().encode(true) as number[])
    const assetA = `${'a'.repeat(64)}.0`
    const lsA1 = new MandalaToken().lock(assetA, 30, pkh).toHex()
    const lsA2 = new MandalaToken().lock(assetA, 20, pkh).toHex()
    const balances = decodeBalances([
      { txid: 't1', outputIndex: 0, lockingScript: lsA1 },
      { txid: 't2', outputIndex: 0, lockingScript: lsA2 },
      { txid: 't3', outputIndex: 0, lockingScript: '006a' } // not a token
    ])
    expect(balances).toEqual([{ assetId: assetA, amount: 50 }])
  })
})
