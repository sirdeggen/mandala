import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { BadgeCheck, Copy, Check, ChevronDown, Plug, X, Plus, Camera } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { useOnboarding, updateProfile, isReviewerRole } from '../../lib/onboarding'
import { useActiveIntegration } from '../../lib/integrations'
import { useUserAvatar, setUserAvatar } from '../../lib/userAvatar'
import {
  SYSTEM_ROLE_LABEL, PERMISSION_LABEL, PERMISSION_DESCRIPTION, ROLE_DEFAULT_PERMISSIONS, ALL_PERMISSIONS,
} from '../../lib/entities'
import { UserAvatar } from '@/components/ui/user-avatar'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { WHITELISTED_CATEGORIES } from '@/content/issuerBadge'
import { cn } from '@/lib/utils'

/**
 * Account settings - mirrors the Acctual settings layout (Settings header + a
 * tab bar over a single-column body) but rendered inside Underwrite's existing
 * sidebar + white-inset chrome. Profile edits persist to the onboarding store;
 * the wallet-derived Badge sits in a collapsible section under the profile form.
 */

export default function AccountSettings() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-8 font-heading text-[32px] font-medium leading-[40px] tracking-[-0.03em] text-foreground">
        Account settings
      </h1>
      <ProfilePanel />
    </div>
  )
}

// ── Collapsible disclosure ────────────────────────────────────────────────────

function Disclosure({ title, children, summary, defaultOpen = false }: {
  title: string
  children: React.ReactNode
  /** One-line summary shown in the header while collapsed. */
  summary?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-foreground">{title}</span>
          {!open && summary != null && <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-5 border-t border-border px-4 py-5">{children}</div>}
    </div>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfilePanel() {
  const { identityKey } = useWallet()
  const { name, email, title, role } = useOnboarding()
  const [nameDraft, setNameDraft] = useState(name)
  const [emailDraft, setEmailDraft] = useState(email)
  const [titleDraft, setTitleDraft] = useState(title)
  const avatar = useUserAvatar()
  const fileRef = useRef<HTMLInputElement>(null)

  const dirty = nameDraft.trim() !== name || emailDraft.trim() !== email || titleDraft.trim() !== title
  const seed = identityKey ?? name ?? 'user'

  // The user's access within their organisation, derived from their role and
  // assigned by a company admin (read-only here).
  const isAdmin = !isReviewerRole(role)
  const systemRole = isAdmin ? 'admin' : 'auditor'
  const permissions = ROLE_DEFAULT_PERMISSIONS[systemRole]
  const licensing = useActiveIntegration('licensing')

  function save(e: React.FormEvent) {
    e.preventDefault()
    updateProfile({ name: nameDraft.trim(), email: emailDraft.trim(), title: titleDraft.trim() })
    toast.success('Profile updated')
  }

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file == null) return
    if (!file.type.startsWith('image/')) { toast.error('Choose an image file.'); return }
    const reader = new FileReader()
    reader.onload = () => { setUserAvatar(String(reader.result)); toast.success('Photo updated') }
    reader.onerror = () => toast.error('Could not read that image.')
    reader.readAsDataURL(file)
  }

  const profileSummary = `${nameDraft.trim() || 'Your account'}${titleDraft.trim() !== '' ? ` · ${titleDraft.trim()}` : ''}`
  const accessSummary = `${SYSTEM_ROLE_LABEL[systemRole]} · ${permissions.length} permission${permissions.length === 1 ? '' : 's'}`
  const badgeSummary = identityKey != null
    ? `${shortKey(identityKey)} · ${licensing != null ? `Authorised by ${licensing.providerName}` : 'Not yet authorised'}`
    : 'No Badge connected'

  return (
    <div className="space-y-4">
      <Disclosure title="Profile" defaultOpen summary={profileSummary}>
      <form onSubmit={save} className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="group relative size-14 shrink-0">
            <UserAvatar seed={seed} src={avatar} size={56} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Upload a profile photo"
              className="absolute inset-0 grid place-items-center rounded-full bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white focus-visible:bg-black/40 focus-visible:text-white focus-visible:outline-none"
            >
              <Camera className="size-5" />
            </button>
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground">
              <Plus className="size-3" strokeWidth={3} />
            </span>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-foreground">{nameDraft.trim() || 'Your account'}</p>
            <p className="text-[13px] text-muted-foreground">
              {avatar != null
                ? <>Custom photo · <button type="button" onClick={() => { setUserAvatar(null); toast.success('Photo removed') }} className="font-medium text-primary hover:underline">Remove</button></>
                : 'Click your avatar to upload a photo.'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="set-name">Name</Label>
          <Input id="set-name" placeholder="Your name" autoComplete="off" value={nameDraft} onChange={e => setNameDraft(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="set-title">Job title</Label>
          <Input id="set-title" placeholder="e.g. Head of Issuance" autoComplete="off" value={titleDraft} onChange={e => setTitleDraft(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="set-email">Email <span className="font-normal text-muted-foreground">· private</span></Label>
          <Input id="set-email" type="email" placeholder="you@company.com" autoComplete="off" value={emailDraft} onChange={e => setEmailDraft(e.target.value)} />
        </div>

        <Button type="submit" disabled={!dirty}>Update</Button>
      </form>
      </Disclosure>

      {/* Access - role, status & permissions within the organisation (read-only) */}
      <Disclosure title="Access" summary={accessSummary}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">{SYSTEM_ROLE_LABEL[systemRole]}</span>
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success"><span className="size-1.5 rounded-full bg-current" /> Active</span>
        </div>
        <div className="space-y-0.5">
          {ALL_PERMISSIONS.map(perm => {
            const on = permissions.includes(perm)
            return (
              <div key={perm} className="flex items-start gap-2.5 py-1.5">
                <span className={cn('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input-border bg-input')}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className={cn('min-w-0', !on && 'opacity-50')}>
                  <span className="block text-[13px] font-medium text-foreground">{PERMISSION_LABEL[perm]}</span>
                  <span className="block text-[11.5px] leading-snug text-muted-foreground">{PERMISSION_DESCRIPTION[perm]}</span>
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-[11.5px] text-faint-foreground">Your role and permissions are assigned by your company administrator.</p>
      </Disclosure>

      <Disclosure title="Badge & authorisation" summary={badgeSummary}>
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
  const licensing = useActiveIntegration('licensing')
  const navigate = useNavigate()
  const [requestOpen, setRequestOpen] = useState(false)
  const granted = licensing != null

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
        <Label>Entity ID</Label>
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
            aria-label="Copy Entity ID"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
        </div>
        <p className="text-balance text-[12.5px] text-muted-foreground">
          Your Badge is a cryptographically verified digital identifier, authenticated by your wallet. There's no password to manage; to sign out, disconnect in your wallet.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Whitelisted for issuing</Label>
          {granted && (
            <button type="button" onClick={() => setRequestOpen(true)} className="text-[12px] font-medium text-primary hover:underline">
              Request additional categories
            </button>
          )}
        </div>

        {granted ? (
          <p className="text-balance text-[12.5px] text-muted-foreground">
            Authorised by <span className="font-medium text-foreground">{licensing!.providerName}</span>. This Badge may issue the categories below. Authorisation is granted by the licensing authority, not self-assigned.
          </p>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5">
            <p className="text-[12.5px] text-muted-foreground">
              Not yet authorised. Whitelisting is granted by an external licensing authority — connect one to authorise this Badge to issue.
            </p>
            <button type="button" onClick={() => navigate('/issuer/integrations')} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
              <Plug className="size-3" /> Connect a licensing authority
            </button>
          </div>
        )}

        <TooltipProvider delayDuration={120}>
          <div className="flex flex-wrap gap-2 pt-1">
            {WHITELISTED_CATEGORIES.map(cat => (
              <Tooltip key={cat.label}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className={cn(
                      'inline-flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                      granted ? 'border-success/30 bg-success/5 text-foreground' : 'border-border bg-muted/40 text-muted-foreground'
                    )}
                  >
                    <BadgeCheck className={cn('size-3.5', granted ? 'text-success' : 'text-faint-foreground')} strokeWidth={2.4} />
                    {cat.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-left">
                  <p className="font-medium">{cat.type}</p>
                  <p className="mt-1 text-primary-foreground/75">
                    {granted ? <>Granted by {licensing!.providerName}. Requirements met: {cat.requirementsMet}</> : <>Requires: {cat.requirementsMet}</>}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>

      <RequestCategoriesSheet open={requestOpen} authority={licensing?.providerName ?? ''} onClose={() => setRequestOpen(false)} />
    </div>
  )
}

// ── Request additional issuance categories (right-side sheet) ──────────────────

function RequestCategoriesSheet({ open, authority, onClose }: { open: boolean; authority: string; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetTitle className="sr-only">Request additional categories</SheetTitle>
        {open && <RequestCategoriesBody authority={authority} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function RequestCategoriesBody({ authority, onClose }: { authority: string; onClose: () => void }) {
  const [category, setCategory] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const submit = () => {
    if (category.trim() === '') { toast.error('Name the category you need authorised.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error('Enter a valid work email.'); return }
    setSubmitting(true)
    window.setTimeout(() => { setSubmitting(false); setDone(true) }, 650)
  }

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-foreground">{done ? 'Request received' : 'Request additional categories'}</div>
        {!done && authority !== '' && <div className="truncate text-[12px] text-muted-foreground">Routed to {authority}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  )

  if (done) {
    return (
      <>
        {header}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-success/10 text-success">
            <Check className="size-7" strokeWidth={2.5} />
          </span>
          <h3 className="mt-4 text-[16px] font-semibold text-foreground">Request submitted</h3>
          <p className="mt-1.5 max-w-xs text-balance text-[13px] leading-relaxed text-muted-foreground">
            {authority !== '' ? <>{authority} will review authorisation for <span className="font-medium text-foreground">{category.trim()}</span> and follow up at <span className="font-medium text-foreground">{email.trim()}</span>.</> : <>We’ll review <span className="font-medium text-foreground">{category.trim()}</span> and follow up at <span className="font-medium text-foreground">{email.trim()}</span>.</>}
          </p>
          <Button variant="outline" onClick={onClose} className="mt-6 h-9 px-5 text-[13px]">Done</Button>
        </div>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          Ask your licensing authority to authorise this Badge for another instrument category.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="rc-cat">Instrument category</Label>
          <Input id="rc-cat" autoFocus value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Asset-referenced tokens" className="h-10 text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-email">Work email</Label>
          <Input id="rc-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@bank.example" className="h-10 text-[13px]" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-note">Supporting detail (optional)</Label>
          <textarea
            id="rc-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Licence reference, reserve model, intended use…"
            className="w-full resize-none rounded-md border border-input-border bg-input px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </div>
      </div>
      <div className="border-t border-border px-5 py-3">
        <Button onClick={submit} loading={submitting} loadingText="Submitting…" size="lg" className="w-full">
          Submit request
        </Button>
      </div>
    </>
  )
}

