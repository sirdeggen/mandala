import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { AdminAsset } from '../lib/mandala/assets'
import { registerAsset, issueTokens, redeemTokens } from '../lib/mandala/issuerOps'
import { reconcileWallet } from '../lib/mandala/reconcile'
import { formatAmount } from '../lib/mandala/amount'
import { adminAssetsKey } from './useAdminAssets'
import { holderDataKey, HolderData } from './useHolderData'

/**
 * Issuer operations as optimistic mutations. Issue/redeem update the issuer's
 * own FT balance in the holder-data cache instantly and roll back if the
 * overlay rejects; every mutation invalidates the shared admin-assets query
 * and runs a background reconcile so half-finished state self-heals.
 */
export function useIssuerMutations() {
  const { wallet, identityKey } = useWallet()
  const qc = useQueryClient()
  const holderKey = holderDataKey(identityKey)

  const settle = () => {
    void qc.invalidateQueries({ queryKey: adminAssetsKey(identityKey) })
    void qc.invalidateQueries({ queryKey: holderKey })
    if (wallet != null) void reconcileWallet(wallet as any).catch(() => {})
  }

  const adjustBalance = async (assetId: string, delta: number) => {
    await qc.cancelQueries({ queryKey: holderKey })
    const prev = qc.getQueryData<HolderData>(holderKey)
    if (prev != null) {
      qc.setQueryData<HolderData>(holderKey, {
        ...prev,
        assets: prev.assets.map(a =>
          a.assetId === assetId ? { ...a, balance: a.balance + delta } : a
        )
      })
    }
    return { prev }
  }

  const register = useMutation({
    mutationFn: async (vars: { label: string; ticker: string; decimals: number }) => {
      if (wallet == null || identityKey == null) throw new Error('Wallet not ready')
      return registerAsset({ wallet: wallet as any, identityKey, ...vars })
    },
    onSuccess: (res, vars) => toast.success(`Registered ${vars.label.trim()} (${res.assetId})`),
    onError: e => toast.error(`Register failed: ${String(e)}`),
    onSettled: settle
  })

  const issue = useMutation<{ txid: string }, Error, { asset: AdminAsset; amount: number }, { prev?: HolderData }>({
    mutationFn: async ({ asset, amount }) => {
      if (wallet == null || identityKey == null) throw new Error('Wallet not ready')
      return issueTokens({ wallet: wallet as any, identityKey, asset, amount })
    },
    onMutate: ({ asset, amount }) => adjustBalance(asset.assetId, amount),
    onSuccess: (_r, { asset, amount }) =>
      toast.success(`Issued ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(holderKey, ctx.prev)
      toast.error(`Issue failed: ${String(e)}`)
    },
    onSettled: settle
  })

  const redeem = useMutation<{ txid: string }, Error, { asset: AdminAsset; amount: number }, { prev?: HolderData }>({
    mutationFn: async ({ asset, amount }) => {
      if (wallet == null || identityKey == null) throw new Error('Wallet not ready')
      return redeemTokens({ wallet: wallet as any, identityKey, asset, amount })
    },
    onMutate: ({ asset, amount }) => adjustBalance(asset.assetId, -amount),
    onSuccess: (_r, { asset, amount }) =>
      toast.success(`Redeemed (burned) ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(holderKey, ctx.prev)
      toast.error(`Redeem failed: ${String(e)}`)
    },
    onSettled: settle
  })

  return { register, issue, redeem }
}
