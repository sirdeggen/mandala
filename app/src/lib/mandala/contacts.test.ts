// app/src/lib/mandala/contacts.test.ts
import { it, expect } from 'vitest'
import { deriveContacts } from './contacts'

const h = (counterparty: string, when: number) => ({ txid: 't', assetId: 'x.0', direction: 'sent' as const, amount: 1, counterparty, when, kind: 'transfer' })

it('dedups by identity key, orders by recency then frequency, drops empties', () => {
  const rows = [h('02a', 100), h('02b', 50), h('02a', 200), h('', 999)]
  const contacts = deriveContacts(rows as any)
  expect(contacts.map(c => c.identityKey)).toEqual(['02a', '02b'])
  expect(contacts[0]).toEqual({ identityKey: '02a', lastSeen: 200, count: 2 })
})
