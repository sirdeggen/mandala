import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LockingScript } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'
import { useWallet } from '../context/WalletContext'
import { BASKET } from '../lib/mandala/constants'
import { loadHistory, HistoryRow } from '../lib/mandala/history'
import { listAdminAssets } from '../lib/mandala/assets'
import { resolveAssetMetadata } from '../lib/mandala/metadata'

export interface AssetMeta {
  label: string
  decimals: number
  ticker?: string
  issuer?: string
}

export interface AssetRow {
  assetId: string
  balance: number
  meta: AssetMeta
}

export interface HolderData {
  assets: AssetRow[]
  history: HistoryRow[]
  metas: Record<string, AssetMeta>
}

export const holderDataKey = (identityKey: string | null) =>
  ['holder-data', identityKey] as const

/**
 * Balances + history + resolved metadata in one query. Every holder view reads
 * this shape, so navigation between home / send / history renders instantly
 * from cache while a background refetch keeps it current.
 */
export function useHolderData() {
  const { wallet, identityKey } = useWallet()

  return useQuery({
    queryKey: holderDataKey(identityKey),
    enabled: wallet != null,
    queryFn: async (): Promise<HolderData> => {
      const w = wallet as any
      // Balances and history are independent reads — run them together.
      const [res, history] = await Promise.all([
        w.listOutputs({ basket: BASKET, include: 'locking scripts', limit: 1000 }),
        loadHistory(w)
      ])

      const totals = new Map<string, number>()
      for (const o of res.outputs) {
        try {
          const d = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
          totals.set(d.assetId, (totals.get(d.assetId) ?? 0) + d.amount)
        } catch { /* not a mandala FT */ }
      }

      // Metadata: own admin assets are authoritative (issuer running the holder
      // view); everything else resolves via the overlay, cached per asset.
      const metas: Record<string, AssetMeta> = {}
      try {
        for (const a of await listAdminAssets(w)) {
          metas[a.assetId] = {
            label: a.label,
            decimals: Number(a.metadata?.decimals) || 0,
            ticker: typeof a.metadata?.ticker === 'string' ? a.metadata.ticker : undefined,
            issuer: typeof a.metadata?.issuer === 'string' ? a.metadata.issuer : undefined
          }
        }
      } catch { /* holder wallets typically have none */ }

      const allAssetIds = new Set<string>([...totals.keys(), ...history.map(r => r.assetId)])
      await Promise.all([...allAssetIds].filter(id => metas[id] == null).map(async id => {
        const meta = await resolveAssetMetadata(id)
        metas[id] = {
          label: meta?.label ?? `${id.slice(0, 10)}…`,
          decimals: Number(meta?.decimals) || 0,
          ticker: typeof (meta as any)?.ticker === 'string' ? (meta as any).ticker : undefined,
          issuer: typeof meta?.issuer === 'string' ? meta.issuer : undefined
        }
      }))

      const assets: AssetRow[] = [...allAssetIds].map(assetId => ({
        assetId,
        balance: totals.get(assetId) ?? 0,
        meta: metas[assetId]
      }))
      // Non-zero balances first, then alphabetical.
      assets.sort((a, b) => {
        if (a.balance > 0 && b.balance === 0) return -1
        if (a.balance === 0 && b.balance > 0) return 1
        return a.meta.label.localeCompare(b.meta.label)
      })

      return { assets, history, metas }
    }
  })
}

/** Invalidate holder data from anywhere (post-mutation, incoming payment…). */
export function useInvalidateHolderData() {
  const qc = useQueryClient()
  const { identityKey } = useWallet()
  return () => qc.invalidateQueries({ queryKey: holderDataKey(identityKey) })
}
