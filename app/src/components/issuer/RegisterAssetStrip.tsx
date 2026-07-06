import { useState } from 'react'
import { toast } from 'sonner'
import { useWallet } from '../../context/WalletContext'
import { useIssuerMutations } from '../../hooks/useIssuerMutations'
import { Input } from '../ui/input'
import { Spinner } from '../ui/spinner'

/**
 * "Register a new asset" — the rare genesis action, kept as a slim dashed
 * strip on the Overview page (most issuers run a single stablecoin).
 */
export default function RegisterAssetStrip() {
  const { wallet } = useWallet()
  const [label, setLabel] = useState('')
  const [ticker, setTicker] = useState('')
  const [decimals, setDecimals] = useState('0')
  const { register } = useIssuerMutations()

  const handleRegister = () => {
    if (wallet == null || label.trim() === '') return
    const dec = Number(decimals)
    if (!Number.isInteger(dec) || dec < 0) { toast.error('Decimals must be a non-negative integer'); return }
    register.mutate({ label, ticker, decimals: dec }, {
      onSuccess: () => { setLabel(''); setTicker(''); setDecimals('0') }
    })
  }

  const labelCls = 'block text-[11px] font-medium text-subtle-foreground mb-[7px]'

  return (
    <div
      className="rounded-[12px] border-dashed border p-[14px_18px]"
      style={{ background: '#EFE9DD', borderColor: 'rgba(27,30,36,.18)' }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="shrink-0">
          <p className="text-[13.5px] font-semibold leading-tight">Register a new asset</p>
          <p className="text-[11.5px] text-subtle-foreground mt-0.5">
            Rare — most issuers run a single stablecoin
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2 flex-1 sm:justify-end">
          <div className="flex flex-col min-w-[110px]">
            <label className={labelCls} htmlFor="reg-label">Label</label>
            <Input
              id="reg-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Gold Coin"
              className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
            />
          </div>
          <div className="flex flex-col min-w-[72px]">
            <label className={labelCls} htmlFor="reg-ticker">Ticker</label>
            <Input
              id="reg-ticker"
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              placeholder="USD"
              className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground"
            />
          </div>
          <div className="flex flex-col min-w-[64px]">
            <label className={labelCls} htmlFor="reg-decimals">Decimals</label>
            <Input
              id="reg-decimals"
              type="number"
              min="0"
              step="1"
              value={decimals}
              onChange={e => setDecimals(e.target.value)}
              placeholder="0"
              className="bg-white border border-[rgba(27,30,36,.14)] rounded-[8px] px-[11px] py-[8px] text-[12.5px] placeholder:text-subtle-foreground tabular-nums"
            />
          </div>
          <button
            onClick={handleRegister}
            disabled={register.isPending || label.trim() === ''}
            className="shrink-0 rounded-[8px] border px-4 py-[8px] text-[12.5px] font-medium transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#fff', borderColor: 'rgba(27,30,36,.2)', color: '#23405E' }}
          >
            {register.isPending && <Spinner size="sm" tone="current" />}
            {register.isPending ? 'Registering…' : 'Register asset'}
          </button>
        </div>
      </div>
    </div>
  )
}
