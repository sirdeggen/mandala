import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { transferTokens, TransferResult } from '../lib/mandala/transfer'
import { reconcileWallet } from '../lib/mandala/reconcile'
import { reconcileBans } from '../lib/mandala/reconcileBans'
import { holderDataKey, HolderData } from './useHolderData'
import { contactsKey } from './useContactsData'

export interface SendVars {
  assetId: string
  amount: number
  recipientKey: string
}

/**
 * Optimistic send. On mutate the balance drops and a pending history row
 * appears instantly; the pipeline (build → sign → overlay submit) runs behind
 * it. The overlay is the commit point — a rejection aborts the wallet action
 * (inputs released, see submitAndBroadcast) and rolls the cache back. The
 * network broadcast continues in the background under journal protection.
 */
export function useSendMutation() {
  const { wallet, messageBoxClient, identityKey } = useWallet()
  const qc = useQueryClient()
  const key = holderDataKey(identityKey)

  return useMutation<TransferResult, Error, SendVars, { prev?: HolderData }>({
    mutationFn: async vars => {
      if (wallet == null || messageBoxClient == null || identityKey == null) {
        throw new Error('Wallet not ready')
      }
      return transferTokens({
        wallet: wallet as any,
        messageBoxClient,
        identityKey,
        assetId: vars.assetId,
        amount: vars.amount,
        recipientKey: vars.recipientKey
      })
    },

    onMutate: async vars => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<HolderData>(key)
      if (prev != null) {
        qc.setQueryData<HolderData>(key, {
          ...prev,
          assets: prev.assets.map(a =>
            a.assetId === vars.assetId ? { ...a, balance: a.balance - vars.amount } : a
          ),
          history: [
            ...prev.history,
            {
              txid: `pending-${Date.now()}`,
              assetId: vars.assetId,
              direction: 'sent',
              amount: vars.amount,
              counterparty: vars.recipientKey,
              when: Date.now(),
              kind: 'transfer'
            }
          ]
        })
      }
      return { prev }
    },

    onError: (_e, _vars, ctx) => {
      // Overlay rejected (or build failed) — the wallet action was aborted and
      // inputs released; restore the pre-send snapshot.
      if (ctx?.prev != null) qc.setQueryData(key, ctx.prev)
    },

    onSuccess: res => {
      if (!res.notified) {
        toast.warning('Sent, but the recipient could not be notified — they may need to refresh.')
      }
    },

    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: contactsKey(identityKey) })
      // Self-heal any half-finished state (stuck aborts, pending broadcasts)
      // without waiting for the next page load.
      if (wallet != null) void reconcileWallet(wallet as any).catch(() => {})
      if (wallet != null) void reconcileBans(wallet as any, [vars.assetId]).catch(() => {})
    }
  })
}
