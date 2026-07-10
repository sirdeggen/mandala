import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Wallet, ScanFace, FileText, Plus, Check, ArrowRight, X, ShieldCheck } from 'lucide-react'
import { AdminAsset } from '@bsv/mandala/assets'
import { guardRegisterSubmit } from '@bsv/mandala/submitGuards'
import { registerFlight } from '@bsv/mandala/singleFlight'
import { useWallet } from '../../context/WalletContext'
import { useIssuerMutations } from '../../hooks/useIssuerMutations'
import { useOnboarding } from '../../lib/onboarding'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Spinner } from '../ui/spinner'
import { Sheet, SheetContent, SheetClose } from '../ui/sheet'
import { cn } from '@/lib/utils'

type Tab = 'draft' | 'issued' | 'circulating' | 'expired'
type Section = 'overview' | 'treasury' | 'operations' | 'activity' | 'banking'

interface Props {
  assets: AdminAsset[]
  onReload: () => void
  onSelectAsset: (assetId: string) => void
  goSection: (section: Section) => void
}

// ── Getting-started setup strip ───────────────────────────────────────────────

function SetupStrip({
  name, verified, hasBacking, hasInstrument, onBacking, onVerify, onIssue,
}: {
  name: string
  verified: boolean
  hasBacking: boolean
  hasInstrument: boolean
  onBacking: () => void
  onVerify: () => void
  onIssue: () => void
}) {
  const steps = [
    {
      done: hasBacking, onClick: onBacking, Icon: Wallet,
      title: 'Add a way to back your instrument',
      blurb: 'Your bank or asset account, which holds the assets backing your instruments.',
    },
    {
      done: verified, onClick: onVerify, Icon: ScanFace,
      title: 'Get verified',
      blurb: 'Verify ownership of your reserves. Takes about 5 minutes.',
    },
    {
      done: hasInstrument, onClick: onIssue, Icon: FileText,
      title: 'Issue your first reserve-backed instrument',
      blurb: 'Create a provable, compliant instrument tradable at near-zero fees.',
    },
  ]
  const completed = steps.filter(s => s.done).length
  const pct = Math.round((completed / steps.length) * 100)

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div className="flex items-end justify-between">
        <p className="text-[18px] font-medium tracking-[-0.4px] text-foreground">
          Hey {name || 'there'}. Let's get you set up to issue instruments.
        </p>
        <p className="shrink-0 text-[13px] text-muted-foreground">Step {completed}/{steps.length}</p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(({ done, onClick, Icon, title, blurb }) => (
          <button
            key={title}
            type="button"
            onClick={onClick}
            className={cn(
              'group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors',
              done ? 'border-success/40' : 'border-border hover:border-muted-foreground'
            )}
          >
            <div className="flex items-center justify-between">
              <Icon className="size-6 text-muted-foreground" strokeWidth={1.6} />
              {done && (
                <span className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              )}
            </div>
            <p className="text-[15px] font-medium text-foreground">{title}</p>
            <p className="text-[13px] leading-snug text-muted-foreground">{blurb}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Issue-instrument drawer (right slide-over) ────────────────────────────────

function IssueInstrumentDrawer({
  open, onOpenChange, onIssued,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onIssued: (assetId: string) => void
}) {
  const { wallet } = useWallet()
  const { register } = useIssuerMutations()
  const [label, setLabel] = useState('')
  const [ticker, setTicker] = useState('')
  const [decimals, setDecimals] = useState('2')
  const startedRef = useRef(false)

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
            <div className="space-y-2">
              <Label htmlFor="ins-label">Instrument name</Label>
              <Input id="ins-label" autoFocus placeholder="e.g. Euro Deposit Token" value={label} onChange={e => setLabel(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ins-ticker">Ticker</Label>
                <Input id="ins-ticker" placeholder="EUR" value={ticker} onChange={e => setTicker(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ins-decimals">Decimals</Label>
                <Input id="ins-decimals" type="number" min="0" step="1" className="tabular" value={decimals} onChange={e => setDecimals(e.target.value)} />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <p className="text-[12px] leading-snug text-muted-foreground">
                Registering mints a genesis transaction on-chain — its outpoint becomes the instrument's permanent asset ID. You can issue units into circulation right after.
              </p>
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

// ── Instrument card + empty state ─────────────────────────────────────────────

function tickerOf(a: AdminAsset): string {
  return String(a.metadata?.ticker ?? a.label.slice(0, 3)).toUpperCase()
}
function symbolOf(t: string): string {
  return ({ USD: '$', EUR: '€', GBP: '£', CHF: 'Fr' } as Record<string, string>)[t] ?? t.slice(0, 2)
}

function InstrumentCard({ asset, onOpen }: { asset: AdminAsset; onOpen: () => void }) {
  const ticker = tickerOf(asset)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-muted-foreground"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[14px] font-semibold text-foreground">
          {symbolOf(ticker)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-foreground">{asset.label}</p>
          <p className="truncate text-[12px] text-muted-foreground">{ticker}</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-foreground" />
      </div>
      <p className="truncate font-mono text-[11px] text-faint-foreground">{asset.assetId}</p>
    </button>
  )
}

function EmptyState({ onIssue }: { onIssue: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-14 text-center">
      {/* Ghost instrument preview */}
      <div className="relative w-[300px] rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between text-[8px] font-bold text-faint-foreground">
          <span>INSTRUMENT</span><span>RESERVE</span><span>STATUS</span>
        </div>
        <div className="my-2 h-px w-full bg-border" />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="size-6 rounded-full bg-muted" />
            <div className="h-2.5 w-24 rounded bg-muted" />
            <div className="h-2 w-16 rounded bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-2.5 w-20 rounded bg-muted" />
            <div className="h-2 w-14 rounded bg-muted" />
            <div className="h-2 w-16 rounded bg-muted" />
          </div>
        </div>
      </div>
      <div className="max-w-sm space-y-1">
        <p className="text-[16px] font-medium text-foreground">Issue an instrument</p>
        <p className="text-balance text-[14px] text-muted-foreground">
          Prepare a reserve-backed instrument for circulation.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onIssue} className="gap-2"><Plus className="size-4" />Issue instrument</Button>
      </div>
    </div>
  )
}

// ── InstrumentsHome ───────────────────────────────────────────────────────────

export default function InstrumentsHome({ assets, onReload, onSelectAsset, goSection }: Props) {
  const { identityKey } = useWallet()
  const { name } = useOnboarding()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('issued')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const verified = identityKey != null
  const hasInstrument = assets.length > 0
  const hasBacking = hasInstrument // reserves are tracked once an instrument exists
  const setupComplete = verified && hasInstrument && hasBacking

  const counts: Record<Tab, number> = useMemo(() => ({
    draft: 0,
    issued: assets.length,
    circulating: assets.length, // circulation tracked per-instrument on its page
    expired: 0,
  }), [assets.length])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'draft', label: 'Draft' },
    { id: 'issued', label: 'Issued' },
    { id: 'circulating', label: 'Circulating' },
    { id: 'expired', label: 'Expired' },
  ]

  const openInstrument = (assetId: string) => {
    onSelectAsset(assetId)
    goSection('treasury')
  }

  const listForTab = tab === 'issued' || tab === 'circulating' ? assets : []

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-foreground">Instruments</h1>
        <Button onClick={() => setDrawerOpen(true)} className="gap-2 shrink-0">
          <Plus className="size-4" />Issue instrument
        </Button>
      </div>

      {!setupComplete && (
        <SetupStrip
          name={name}
          verified={verified}
          hasBacking={hasBacking}
          hasInstrument={hasInstrument}
          onBacking={() => goSection('banking')}
          onVerify={() => { if (!verified) navigate('/') }}
          onIssue={() => setDrawerOpen(true)}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-5 border-b border-border">
        {TABS.map(({ id, label }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'group -mb-px flex items-center gap-2 border-b-[1.5px] pb-3 pt-2 text-[14px] font-medium transition-colors',
                active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              <span className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}>
                {counts[id]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div className="pt-6">
        {listForTab.length === 0 ? (
          <EmptyState onIssue={() => setDrawerOpen(true)} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listForTab.map(a => (
              <InstrumentCard key={a.assetId} asset={a} onOpen={() => openInstrument(a.assetId)} />
            ))}
          </div>
        )}
      </div>

      <IssueInstrumentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onIssued={(id) => { onReload(); if (id) onSelectAsset(id) }}
      />
    </div>
  )
}
