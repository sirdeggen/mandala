import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useWallet } from '../context/WalletContext'
import { AdminAsset } from '../lib/mandala/assets'
import { registerAsset, issueTokens, redeemTokens } from '../lib/mandala/issuerOps'
import { reconcileWallet } from '../lib/mandala/reconcile'
import { formatAmount } from '../lib/mandala/amount'
import { registerFlight, BusyError } from '../lib/mandala/singleFlight'
import { guardIssueSubmit, guardRedeemSubmit, guardRegisterSubmit } from '../lib/mandala/submitGuards'
import { adminAssetsKey } from './useAdminAssets'
import { holderDataKey, HolderData } from './useHolderData'

/**
 * Issuer operations as optimistic mutations. Issue/redeem update the issuer's
 * own FT balance in the holder-data cache instantly and roll back if the
 * overlay rejects; every mutation invalidates the shared admin-assets query
 * and runs a background reconcile so half-finished state self-heals.
 *
 * Register is single-flight (registerFlight). Issue/redeem serialize per-asset
 * admin-auth inside issuerOps (withAdminAuthGate) so a double-click cannot
 * spend the same priorOutpoint twice.
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
      const gate = guardRegisterSubmit({
        label: vars.label,
        ticker: vars.ticker,
        decimals: vars.decimals,
        walletReady: true
      })
      if (!gate.ok) throw new Error(gate.reason)
      return registerFlight.run(() =>
        registerAsset({ wallet: wallet as any, identityKey, ...vars })
      )
    },
    onSuccess: (res, vars) => toast.success(`Registered ${vars.label.trim()} (${res.assetId})`),
    onError: e => {
      if (e instanceof BusyError) return // silent no-op for double-click
      toast.error(`Register failed: ${String(e)}`)
    },
    onSettled: settle
  })

  const issue = useMutation<{ txid: string }, Error, { asset: AdminAsset; amount: number }, { prev?: HolderData }>({
    mutationFn: async ({ asset, amount }) => {
      if (wallet == null || identityKey == null) throw new Error('Wallet not ready')
      const gate = guardIssueSubmit({ assetId: asset.assetId, amount, walletReady: true })
      if (!gate.ok) throw new Error(gate.reason)
      return issueTokens({ wallet: wallet as any, identityKey, asset, amount })
    },
    onMutate: ({ asset, amount }) => adjustBalance(asset.assetId, amount),
    onSuccess: (_r, { asset, amount }) =>
      toast.success(`Issued ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(holderKey, ctx.prev)
      if (e instanceof BusyError) return
      toast.error(`Issue failed: ${String(e)}`)
    },
    onSettled: settle
  })

  const redeem = useMutation<{ txid: string }, Error, { asset: AdminAsset; amount: number }, { prev?: HolderData }>({
    mutationFn: async ({ asset, amount }) => {
      if (wallet == null || identityKey == null) throw new Error('Wallet not ready')
      // Enforce balance at the mutation boundary even when the UI guard is
      // bypassed (direct mutate). Prefer live holder-data cache; if that query
      // has loaded but this asset is absent, treat balance as 0.
      const holder = qc.getQueryData<HolderData>(holderKey)
      const balance = holder == null
        ? undefined
        : (holder.assets.find(a => a.assetId === asset.assetId)?.balance ?? 0)
      const gate = guardRedeemSubmit({
        assetId: asset.assetId,
        amount,
        balance,
        walletReady: true
      })
      if (!gate.ok) throw new Error(gate.reason)
      return redeemTokens({
        wallet: wallet as any,
        identityKey,
        asset,
        amount,
        balance
      })
    },
    onMutate: ({ asset, amount }) => adjustBalance(asset.assetId, -amount),
    onSuccess: (_r, { asset, amount }) =>
      toast.success(`Redeemed (burned) ${formatAmount(amount, Number(asset.metadata?.decimals) || 0)} ${asset.label}`),
    onError: (e, _v, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(holderKey, ctx.prev)
      if (e instanceof BusyError) return
      toast.error(`Redeem failed: ${String(e)}`)
    },
    onSettled: settle
  })

  return { register, issue, redeem }
}
