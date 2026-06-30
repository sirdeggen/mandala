import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { BASKET } from '../../lib/mandala/constants'
import { resolveAssetState } from '../../lib/mandala/adminState'
import { formatCurrency } from '../../lib/mandala/amount'
import { resolveAssetMetadata } from '../../lib/mandala/metadata'
import { LockingScript } from '@bsv/sdk'
import { MandalaToken } from '@bsv/templates'

interface Props {
  assetId: string
}

export default function AlertBanners({ assetId }: Props) {
  const { wallet } = useWallet()
  const [isPaused, setIsPaused] = useState(false)
  const [frozenAmount, setFrozenAmount] = useState(0)
  const [decimals, setDecimals] = useState(0)
  const [ticker, setTicker] = useState<string | undefined>()

  useEffect(() => {
    if (!assetId) return
    void load()
  }, [assetId, wallet])

  const load = async () => {
    const [state, meta] = await Promise.all([
      resolveAssetState(assetId),
      resolveAssetMetadata(assetId)
    ])

    setIsPaused(state?.isPaused ?? false)
    setDecimals(Number(meta?.decimals) || 0)
    setTicker(typeof (meta as any)?.ticker === 'string' ? (meta as any).ticker : undefined)

    if (state == null || wallet == null) return

    // Compute frozen amount: sum amounts of the holder's outputs whose outpoint
    // is in state.frozenOutpoints.
    const frozenSet = new Set(state.frozenOutpoints.map(fp => fp.outpoint))
    if (frozenSet.size === 0) { setFrozenAmount(0); return }

    try {
      const res = await wallet.listOutputs({
        basket: BASKET,
        include: 'locking scripts',
        limit: 1000
      })

      let total = 0
      for (const o of res.outputs) {
        const opStr = o.outpoint as string
        if (!frozenSet.has(opStr)) continue
        try {
          const decoded = MandalaToken.decode(LockingScript.fromHex(o.lockingScript as string))
          if (decoded.assetId === assetId) total += decoded.amount
        } catch { /* not a mandala output */ }
      }
      setFrozenAmount(total)
    } catch (e) {
      console.error('AlertBanners: error computing frozen amount', e)
    }
  }

  if (!isPaused && frozenAmount === 0) return null

  return (
    <div className="space-y-2">
      {isPaused && (
        <div className="flex items-start gap-3 rounded-[--radius-md] bg-warning/10 px-4 py-3 text-[13px] text-warning-foreground">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Transfers temporarily disabled by the issuer.</span>
        </div>
      )}
      {frozenAmount > 0 && (
        <div className="flex items-start gap-3 rounded-[--radius-md] bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {formatCurrency(frozenAmount, decimals, ticker)} of your balance has been frozen.
            Please contact support to dispute.
          </span>
        </div>
      )}
    </div>
  )
}
