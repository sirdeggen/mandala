import { describe, it, expect } from 'vitest'
import { ProtoWallet, PrivateKey, Transaction } from '@bsv/sdk'
import { MandalaAdmin } from '@bsv/templates'
import { parseMetadataFromBeef } from './metadata'

describe('parseMetadataFromBeef', () => {
  it('decodes publicData from output 0 of a genesis tx', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromRandom())
    const lock = await MandalaAdmin.lock({ wallet: wallet as any, data: { kind: 'register' }, publicData: { label: 'Gold', ticker: 'GLD' } })
    const tx = new Transaction()
    tx.addOutput({ lockingScript: lock, satoshis: 1 })
    const meta = parseMetadataFromBeef(tx.toBEEF(), 0)
    expect(meta).toEqual({ label: 'Gold', ticker: 'GLD' })
  })

  it('returns null when output has no publicData', async () => {
    const wallet = new ProtoWallet(PrivateKey.fromRandom())
    const lock = await MandalaAdmin.lock({ wallet: wallet as any, data: { kind: 'register' } })
    const tx = new Transaction()
    tx.addOutput({ lockingScript: lock, satoshis: 1 })
    expect(parseMetadataFromBeef(tx.toBEEF(), 0)).toBeNull()
  })
})
