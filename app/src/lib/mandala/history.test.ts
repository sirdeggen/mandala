import { describe, it, expect } from 'vitest'
import { parseActionsToHistory, exportTransactionsCsv } from './history'

const actions = [
  {
    txid: 't1',
    description: 'Send tokens',
    satoshis: 0,
    status: 'completed',
    isOutgoing: true,
    version: 1,
    lockTime: 0,
    labels: ['mandala', 'transfer'],
    outputs: [
      {
        outputIndex: 0,
        outputDescription: 'FT to recipient',
        basket: 'mandala',
        satoshis: 1,
        spendable: false,
        tags: ['mandala', 'sent', 'x.0'],
        customInstructions: JSON.stringify({
          keyID: 'k',
          counterparty: '02recip',
          direction: 'sent',
          recipient: '02recip',
          assetId: 'x.0'
        })
      }
    ]
  },
  {
    txid: 't2',
    description: 'Receive tokens',
    satoshis: 0,
    status: 'completed',
    isOutgoing: false,
    version: 1,
    lockTime: 0,
    labels: ['mandala', 'receive'],
    outputs: [
      {
        outputIndex: 0,
        outputDescription: 'received FT',
        basket: 'mandala',
        satoshis: 1,
        spendable: true,
        tags: ['mandala', 'received', 'x.0'],
        customInstructions: JSON.stringify({
          keyID: 'k',
          counterparty: '02sender',
          assetId: 'x.0'
        })
      }
    ]
  },
  {
    txid: 't3',
    description: 'Issue tokens',
    satoshis: 0,
    status: 'completed',
    isOutgoing: true,
    version: 1,
    lockTime: 0,
    labels: ['mandala', 'issue'],
    outputs: [
      {
        outputIndex: 0,
        outputDescription: 'issued FT',
        basket: 'mandala',
        satoshis: 1,
        spendable: true,
        tags: ['mandala', 'issued', 'y.0'],
        customInstructions: JSON.stringify({
          keyID: 'k2',
          counterparty: '02holder',
          assetId: 'y.0'
        })
      }
    ]
  },
  {
    txid: 't4',
    description: 'Redeem tokens',
    satoshis: 0,
    status: 'completed',
    isOutgoing: true,
    version: 1,
    lockTime: 0,
    labels: ['mandala', 'redeem'],
    outputs: [
      {
        outputIndex: 0,
        outputDescription: 'redeem FT',
        basket: 'mandala',
        satoshis: 1,
        spendable: false,
        tags: ['mandala', 'redeemed', 'y.0'],
        customInstructions: JSON.stringify({
          keyID: 'k3',
          counterparty: '02issuer',
          assetId: 'y.0'
        })
      }
    ]
  },
  {
    txid: 't5',
    description: 'Transfer receive side',
    satoshis: 0,
    status: 'completed',
    isOutgoing: false,
    version: 1,
    lockTime: 0,
    labels: ['mandala', 'transfer'],
    outputs: [
      {
        outputIndex: 0,
        outputDescription: 'FT received from sender',
        basket: 'mandala',
        satoshis: 1,
        spendable: true,
        tags: ['mandala', 'received', 'x.0'],
        customInstructions: JSON.stringify({
          keyID: 'k4',
          counterparty: '02sender2',
          direction: 'received',
          assetId: 'x.0'
        })
      }
    ]
  }
]

describe('parseActionsToHistory', () => {
  it('classifies sent vs received and extracts counterparty + assetId', () => {
    const rows = parseActionsToHistory(actions as any)
    const sent = rows.find(r => r.txid === 't1')!
    const recv = rows.find(r => r.txid === 't2')!
    expect(sent.direction).toBe('sent')
    expect(sent.counterparty).toBe('02recip')
    expect(sent.assetId).toBe('x.0')
    expect(recv.direction).toBe('received')
    expect(recv.counterparty).toBe('02sender')
  })

  it('classifies issue and redeem correctly', () => {
    const rows = parseActionsToHistory(actions as any)
    const issued = rows.find(r => r.txid === 't3')!
    const redeemed = rows.find(r => r.txid === 't4')!
    expect(issued.direction).toBe('issued')
    expect(issued.assetId).toBe('y.0')
    expect(redeemed.direction).toBe('redeemed')
    expect(redeemed.assetId).toBe('y.0')
  })

  it('classifies transfer receive side as received', () => {
    const rows = parseActionsToHistory(actions as any)
    const recv = rows.find(r => r.txid === 't5')!
    expect(recv.direction).toBe('received')
    expect(recv.counterparty).toBe('02sender2')
    expect(recv.assetId).toBe('x.0')
  })

  it('skips outputs with no assetId', () => {
    const noAsset = [
      {
        txid: 'bad',
        description: 'No asset',
        satoshis: 0,
        status: 'completed',
        isOutgoing: false,
        version: 1,
        lockTime: 0,
        labels: ['mandala', 'transfer'],
        outputs: [
          {
            outputIndex: 0,
            outputDescription: 'no asset output',
            basket: 'mandala',
            satoshis: 1,
            spendable: true,
            tags: ['mandala'],
            customInstructions: JSON.stringify({ keyID: 'k' })
          }
        ]
      }
    ]
    const rows = parseActionsToHistory(noAsset as any)
    expect(rows.find(r => r.txid === 'bad')).toBeUndefined()
  })

  it('returns correct kind label from labels', () => {
    const rows = parseActionsToHistory(actions as any)
    expect(rows.find(r => r.txid === 't1')!.kind).toBe('transfer')
    expect(rows.find(r => r.txid === 't3')!.kind).toBe('issue')
    expect(rows.find(r => r.txid === 't4')!.kind).toBe('redeem')
  })
})

describe('exportTransactionsCsv', () => {
  it('CSV has a header and one row per history entry', () => {
    const rows = parseActionsToHistory(actions as any)
    const csv = exportTransactionsCsv(rows)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(rows.length + 1) // header + N data rows
    expect(lines[0]).toContain('txid')
    expect(lines[0]).toContain('direction')
    expect(lines[0]).toContain('counterparty')
  })

  it('CSV header + 2 rows for the basic fixture (2 actions)', () => {
    const twoActions = actions.slice(0, 2)
    const csv = exportTransactionsCsv(parseActionsToHistory(twoActions as any))
    expect(csv.split('\n')).toHaveLength(3) // header + 2
  })

  it('escapes double quotes in CSV fields', () => {
    const rows = [
      {
        txid: 'tx-"quoted"',
        assetId: 'a.0',
        direction: 'sent' as const,
        amount: 0,
        counterparty: 'addr"with"quotes',
        when: 0,
        kind: 'transfer'
      }
    ]
    const csv = exportTransactionsCsv(rows)
    expect(csv).toContain('"tx-""quoted"""')
    expect(csv).toContain('"addr""with""quotes"')
  })

  it('handles empty rows', () => {
    const csv = exportTransactionsCsv([])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('txid')
  })
})
