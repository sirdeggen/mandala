import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BadgeCheck, Copy, Check, ChevronDown } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { useOnboarding, updateProfile } from '../../lib/onboarding'
import { UserAvatar } from '@/components/ui/user-avatar'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { WHITELISTED_CATEGORIES } from '@/content/issuerBadge'
import { cn } from '@/lib/utils'

/**
 * Account settings - mirrors the Acctual settings layout (Settings header + a
 * tab bar over a single-column body) but rendered inside Underwrite's existing
 * sidebar + white-inset chrome. Profile edits persist to the onboarding store;
 * the wallet-derived Badge sits in a collapsible section under the profile form.
 */

type Tab = 'profile' | 'company'

export default function AccountSettings() {
  const { role } = useOnboarding()
  const [searchParams, setSearchParams] = useSearchParams()

  const TABS: { id: Tab, label: string }[] = [
    { id: 'profile', label: 'Profile' },
    ...(role === 'issuer' ? [{ id: 'company' as const, label: 'Company' }] : []),
  ]

  const paramTab = searchParams.get('tab')
  const tab: Tab = TABS.some(t => t.id === paramTab) ? (paramTab as Tab) : 'profile'
  const setTab = (id: Tab) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    next.set('tab', id)
    return next
  }, { replace: true })

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-8 font-heading text-[32px] font-medium leading-[40px] tracking-[-0.03em] text-foreground">
        Settings
      </h1>

      {/* Tab bar */}
      <div className="flex gap-5 overflow-x-auto border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-[1.5px] pb-3 pt-2 text-[14px] font-medium transition-colors',
              tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pt-8">
        {tab === 'profile' && <ProfilePanel />}
        {tab === 'company' && <CompanyPanel />}
      </div>
    </div>
  )
}

// ── Collapsible disclosure ────────────────────────────────────────────────────

function Disclosure({ title, children, defaultOpen = false }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="text-[14px] font-medium text-foreground">{title}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-5 border-t border-border px-4 py-5">{children}</div>}
    </div>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfilePanel() {
  const { identityKey } = useWallet()
  const { name, email } = useOnboarding()
  const [nameDraft, setNameDraft] = useState(name)
  const [emailDraft, setEmailDraft] = useState(email)

  const dirty = nameDraft.trim() !== name || emailDraft.trim() !== email
  const seed = identityKey ?? name ?? 'user'

  function save(e: React.FormEvent) {
    e.preventDefault()
    updateProfile({ name: nameDraft.trim(), email: emailDraft.trim() })
    toast.success('Profile updated')
  }

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="space-y-6">
        <div className="flex items-center gap-4">
          <UserAvatar seed={seed} size={56} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-foreground">{nameDraft.trim() || 'Your account'}</p>
            <p className="text-[13px] text-muted-foreground">Your avatar is generated from your Badge.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="set-name">Name</Label>
          <Input id="set-name" placeholder="Your name" autoComplete="off" value={nameDraft} onChange={e => setNameDraft(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="set-email">Email</Label>
          <Input id="set-email" type="email" placeholder="you@company.com" autoComplete="off" value={emailDraft} onChange={e => setEmailDraft(e.target.value)} />
        </div>

        <Button type="submit" disabled={!dirty}>Update</Button>
      </form>

      <Disclosure title="Badge & authorisation">
        <BadgePanel identityKey={identityKey} />
      </Disclosure>
    </div>
  )
}

// ── Badge (wallet-derived identity + whitelist) ───────────────────────────────

function shortKey(key: string): string {
  return key.length <= 12 ? key : `${key.slice(0, 5)}…${key.slice(-5)}`
}

function BadgePanel({ identityKey }: { identityKey: string | null }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (identityKey == null) return
    try {
      await navigator.clipboard.writeText(identityKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Badge ID</Label>
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
          {identityKey != null
            ? <IdentitySigil value={identityKey} size={32} className="rounded-md" />
            : <div className="size-8 shrink-0 rounded-md bg-muted" />}
          <code
            title={identityKey ?? undefined}
            className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground"
          >
            {identityKey != null ? shortKey(identityKey) : '-'}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={identityKey == null}
            aria-label="Copy Badge ID"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          Your Badge is your on-chain identity, authenticated by your BRC-100 wallet - there's no password to manage. To sign out, disconnect in your wallet.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Whitelisted for issuing</Label>
        <p className="text-[12.5px] text-muted-foreground">
          This Badge is authorised to issue the following categories of instruments.
        </p>
        <TooltipProvider delayDuration={120}>
          <div className="flex flex-wrap gap-2 pt-1">
            {WHITELISTED_CATEGORIES.map(cat => (
              <Tooltip key={cat.label}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-success/30 bg-success/5 px-2.5 py-1 text-[12.5px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <BadgeCheck className="size-3.5 text-success" strokeWidth={2.4} />
                    {cat.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-left">
                  <p className="font-medium">{cat.type}</p>
                  <p className="mt-1 text-primary-foreground/75">Requirements met: {cat.requirementsMet}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>
    </div>
  )
}

// ── Company (issuer entity details) ───────────────────────────────────────────

const COUNTRIES = [
  'Switzerland', 'Germany', 'France', 'Netherlands', 'Ireland', 'Luxembourg',
  'Spain', 'Italy', 'Belgium', 'Austria', 'United Kingdom', 'United States', 'Other',
]

function CompanyPanel() {
  const { entity } = useOnboarding()
  const [legalName, setLegalName] = useState(entity?.legalName ?? '')
  const [country, setCountry] = useState(entity?.country ?? '')
  const [address, setAddress] = useState(entity?.address ?? '')

  const dirty =
    legalName.trim() !== (entity?.legalName ?? '') ||
    country !== (entity?.country ?? '') ||
    address.trim() !== (entity?.address ?? '')

  function save(e: React.FormEvent) {
    e.preventDefault()
    updateProfile({ entity: { legalName: legalName.trim(), country, address: address.trim() } })
    toast.success('Company details updated')
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="set-legal">Legal entity name</Label>
        <Input id="set-legal" placeholder="Acme Digital Money Ltd" autoComplete="off" value={legalName} onChange={e => setLegalName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="set-country">Country</Label>
        <select
          id="set-country"
          value={country}
          onChange={e => setCountry(e.target.value)}
          className="h-11 w-full rounded border border-input-border bg-input px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <option value="" disabled>Select country…</option>
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="set-address">Registered address</Label>
        <Input id="set-address" placeholder="Street, city, postal code" autoComplete="off" value={address} onChange={e => setAddress(e.target.value)} />
      </div>

      <Button type="submit" disabled={!dirty}>Update</Button>
    </form>
  )
}
