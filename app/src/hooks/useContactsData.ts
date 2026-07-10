import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '../context/WalletContext'
import { deriveContacts, Contact } from '@bsv/mandala/contacts'
import { listContacts, StoredContact } from '@bsv/mandala/contactsStore'
import { loadHistory } from '@bsv/mandala/history'

export interface ContactsData {
  /** Recency-ordered counterparties derived from transaction history. */
  derived: Contact[]
  /** Saved contacts (names / avatars / handles). */
  saved: StoredContact[]
}

export const contactsKey = (identityKey: string | null) =>
  ['contacts', identityKey] as const

export function useContactsData() {
  const { wallet, identityKey } = useWallet()
  return useQuery({
    queryKey: contactsKey(identityKey),
    enabled: wallet != null,
    queryFn: async (): Promise<ContactsData> => {
      const w = wallet as any
      // Independent reads; a saved-store failure never blocks the recency list.
      const [history, saved] = await Promise.all([
        loadHistory(w).catch(() => []),
        listContacts(w).catch(() => [])
      ])
      return { derived: deriveContacts(history), saved }
    }
  })
}

export function useInvalidateContacts() {
  const qc = useQueryClient()
  const { identityKey } = useWallet()
  return () => qc.invalidateQueries({ queryKey: contactsKey(identityKey) })
}
