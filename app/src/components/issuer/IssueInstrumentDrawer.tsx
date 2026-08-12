import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, X, Info, ChevronDown, ArrowUpRight, PlayCircle } from 'lucide-react'
import { guardRegisterSubmit } from '@bsv/mandala/submitGuards'
import { registerFlight } from '@bsv/mandala/singleFlight'
import { useWallet } from '../../context/WalletContext'
import { useIssuerMutations } from '../../hooks/useIssuerMutations'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Spinner } from '../ui/spinner'
import { Sheet, SheetContent, SheetClose } from '../ui/sheet'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import { CURRENCY_TICKERS } from '@/content/currencyTickers'
import { INSTRUMENT_TEMPLATES } from '@/content/instrumentTemplates'
import { Check } from 'lucide-react'

const CUSTOM_TEMPLATE = INSTRUMENT_TEMPLATES.find(t => t.id === 'custom') ?? INSTRUMENT_TEMPLATES[INSTRUMENT_TEMPLATES.length - 1]

export interface IssuePrefill {
  templateId?: string
  label?: string
  ticker?: string
  decimals?: number
}

/** Preview what N decimals looks like, e.g. "4" → "0.0000". */
function decimalsExample(decimals: string): string {
  const n = Number(decimals)
  if (!Number.isFinite(n) || n <= 0) return '0'
  return `0.${'0'.repeat(Math.min(Math.floor(n), 12))}`
}

/**
 * Issue-instrument drawer (right slide-over). Optionally pre-filled from a
 * starter template - `prefill` is applied to the form each time the drawer
 * opens, so the same component serves both the blank "Issue instrument" button
 * and template-driven flows from the home gallery.
 */
export default function IssueInstrumentDrawer({
  open, onOpenChange, onIssued, prefill,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onIssued: (assetId: string) => void
  prefill?: IssuePrefill
}) {
  const { wallet } = useWallet()
  const { register } = useIssuerMutations()
  const [label, setLabel] = useState('')
  const [ticker, setTicker] = useState('')
  const [decimals, setDecimals] = useState('2')
  const [templateId, setTemplateId] = useState('custom')
  const [tplOpen, setTplOpen] = useState(false)
  const startedRef = useRef(false)

  // Apply the template each time the drawer opens (fresh values per open); with
  // no template it falls back to Custom.
  useEffect(() => {
    if (!open) return
    setTemplateId(prefill?.templateId ?? 'custom')
    setLabel(prefill?.label ?? '')
    setTicker(prefill?.ticker ?? '')
    setDecimals(prefill?.decimals != null ? String(prefill.decimals) : '2')
  }, [open, prefill])

  const selectedTemplate = INSTRUMENT_TEMPLATES.find(t => t.id === templateId) ?? CUSTOM_TEMPLATE

  const applyTemplate = (t: typeof INSTRUMENT_TEMPLATES[number]) => {
    setTemplateId(t.id)
    setLabel(t.name)
    setTicker(t.ticker)
    setDecimals(String(t.decimals))
    setTplOpen(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (startedRef.current || register.isPending || registerFlight.isHeld()) return
    const dec = Number(decimals)
    const gate = guardRegisterSubmit({ label, ticker, decimals: dec, walletReady: wallet != null })
    if (!gate.ok) { toast.error(gate.reason); return }
    startedRef.current = true
    register.mutate({ label, ticker, decimals: dec }, {
      onSuccess: (res: any) => {
        toast.success(`${label} issued`)
        setLabel(''); setTicker(''); setDecimals('2')
        onOpenChange(false)
        const newId = typeof res?.assetId === 'string' ? res.assetId : ''
        if (newId) onIssued(newId)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not issue instrument'),
      onSettled: () => { startedRef.current = false },
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-[440px] gap-0 rounded-none border-l border-border md:m-3 md:mb-3 md:h-[calc(100%-24px)] md:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-5">
          <div>
            <h2 className="font-heading text-[18px] font-medium tracking-[-0.3px]">Issue an instrument</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Prepare an instrument for circulation.</p>
          </div>
          <SheetClose className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
            {/* Selected starter template - switch via the popover. */}
            <Popover open={tplOpen} onOpenChange={setTplOpen}>
              <PopoverTrigger className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60">
                <img src={selectedTemplate.image} alt="" className="size-9 shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">Starter template</div>
                  <div className="truncate text-[13.5px] font-semibold text-foreground">{selectedTemplate.name || 'Custom instrument'}</div>
                </div>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-80 w-[380px] overflow-y-auto p-1">
                <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">Start from a template</p>
                {INSTRUMENT_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <img src={t.image} alt="" className="size-7 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">{t.name || 'Custom instrument'}</span>
                      <span className="block truncate text-[11px] text-subtle-foreground">{t.category}{t.ticker ? ` · ${t.ticker}` : ''}</span>
                    </span>
                    {t.id === templateId && <Check className="size-3.5 shrink-0 text-success" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Instructional intro - what registering does, a link to the full
                guide, and a slot for a short tutorial video. Sits above the
                inputs so first-time issuers get oriented before filling them in. */}
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5">
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-[12px] leading-snug text-muted-foreground">
                    Registering records the instrument on-chain and assigns its permanent identifier. You can issue units right after.
                  </p>
                  <Link
                    to="/help/for-issuers/issuing-your-first-instrument"
                    className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primary hover:underline"
                  >
                    Learn more <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>
              {/* Selected instrument's template image as a subtly-animated
                  "video" background (a still with a slow ken-burns pan). */}
              <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted">
                <img
                  key={selectedTemplate.id}
                  src={selectedTemplate.image}
                  alt=""
                  className="animate-kenburns absolute inset-0 h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/90 text-neutral-900">
                    <PlayCircle className="size-4" strokeWidth={2} />
                  </span>
                  <span className="text-[12.5px] font-semibold text-white drop-shadow">
                    {selectedTemplate.name || 'Custom instrument'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ins-label">Instrument name</Label>
              <Input id="ins-label" autoFocus placeholder="e.g. Euro Deposit Token" value={label} onChange={e => setLabel(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ins-ticker">Ticker</Label>
                <div className="relative">
                  <Input id="ins-ticker" placeholder="EUR" value={ticker} onChange={e => setTicker(e.target.value)} className="pr-9" />
                  <Popover>
                    <PopoverTrigger
                      type="button"
                      aria-label="Choose a common ticker"
                      className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <ChevronDown className="size-4" />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-1">
                      <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">Common tickers</p>
                      <div className="max-h-64 overflow-y-auto">
                        {CURRENCY_TICKERS.map(t => (
                          <button
                            key={t.code}
                            type="button"
                            onClick={() => { setTicker(t.code); setDecimals(String(t.decimals)) }}
                            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                          >
                            <span className="font-mono text-[13px] font-medium text-foreground">{t.code}</span>
                            <span className="truncate text-[12px] text-muted-foreground">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ins-decimals">Decimals</Label>
                <div className="relative">
                  <Input id="ins-decimals" type="number" min="0" step="1" className="tabular pr-24" value={decimals} onChange={e => setDecimals(e.target.value)} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 tabular text-[12px] text-muted-foreground">
                    {decimalsExample(decimals)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-6 py-4">
            <Button type="submit" disabled={register.isPending || label.trim() === ''} className="gap-2">
              {register.isPending ? <Spinner size="sm" tone="current" /> : <Plus className="size-4" />}
              {register.isPending ? 'Issuing…' : 'Issue instrument'}
            </Button>
            <SheetClose asChild>
              <Button type="button" variant="ghost">Cancel</Button>
            </SheetClose>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
