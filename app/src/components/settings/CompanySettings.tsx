/**
 * Company settings - the issuer entity's details, separate from personal Account
 * settings. Editing is restricted to company admins (issuer role); everyone else
 * gets a read-only view. Links through to the own-organisation manager in
 * Relationships for members & permissions.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, Lock, ArrowRight, Users, Plus, Camera, Globe, Copy, Check, ExternalLink } from 'lucide-react'
import { useOnboarding, updateProfile, isReviewerRole } from '../../lib/onboarding'
import { useCompanyLogo, setCompanyLogo } from '../../lib/companyLogo'
import { useWallet } from '../../context/WalletContext'
import { useEntityTransparency, setEntityPublished, setEntityListed } from '../../lib/orgTransparency'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const COUNTRIES = [
  'Switzerland', 'Germany', 'France', 'Netherlands', 'Ireland', 'Luxembourg',
  'Spain', 'Italy', 'Belgium', 'Austria', 'United Kingdom', 'United States', 'Other',
]

export default function CompanySettings() {
  const { entity, role } = useOnboarding()
  const navigate = useNavigate()
  const isAdmin = !isReviewerRole(role)
  const logo = useCompanyLogo()
  const logoRef = useRef<HTMLInputElement>(null)

  const [legalName, setLegalName] = useState(entity?.legalName ?? '')
  const [country, setCountry] = useState(entity?.country ?? '')
  const [address, setAddress] = useState(entity?.address ?? '')

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file == null) return
    if (!file.type.startsWith('image/')) { toast.error('Choose an image file.'); return }
    const reader = new FileReader()
    reader.onload = () => { setCompanyLogo(String(reader.result)); toast.success('Logo updated') }
    reader.onerror = () => toast.error('Could not read that image.')
    reader.readAsDataURL(file)
  }

  const dirty =
    legalName.trim() !== (entity?.legalName ?? '') ||
    country !== (entity?.country ?? '') ||
    address.trim() !== (entity?.address ?? '')

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    updateProfile({ entity: { legalName: legalName.trim(), country, address: address.trim() } })
    toast.success('Company details updated')
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="mb-2 font-heading text-[32px] font-medium leading-[40px] tracking-[-0.03em] text-foreground">
        Company
      </h1>
      <p className="mb-8 text-[14px] text-muted-foreground">
        Your issuing entity’s registered details. These are shared across everyone in your organisation.
      </p>

      {!isAdmin && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px] leading-snug text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>Only company administrators can edit these settings. You have read-only access.</span>
        </div>
      )}

      {/* Company details */}
      <form onSubmit={save} className="space-y-6">
        <div className="space-y-2">
          <Label>Company logo</Label>
          <div className="flex items-center gap-4">
            <div className="group relative size-16 shrink-0">
              <span className="grid size-16 place-items-center overflow-hidden rounded-xl border border-border bg-card">
                {logo != null
                  ? <img src={logo} alt="" className="h-[70%] w-[70%] object-contain" />
                  : <CompanyAvatar name={entity?.legalName || 'Your organisation'} size={64} />}
              </span>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={() => logoRef.current?.click()}
                    aria-label="Upload a company logo"
                    className="absolute inset-0 grid place-items-center rounded-xl bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white focus-visible:bg-black/40 focus-visible:text-white focus-visible:outline-none"
                  >
                    <Camera className="size-5" />
                  </button>
                  <span className="pointer-events-none absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground">
                    <Plus className="size-3" strokeWidth={3} />
                  </span>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
                </>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {!isAdmin
                ? 'Your company logo.'
                : logo != null
                  ? <>Shown on your organisation across the platform. <button type="button" onClick={() => { setCompanyLogo(null); toast.success('Logo removed') }} className="font-medium text-primary hover:underline">Remove</button></>
                  : 'Click the tile to upload your company logo.'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="co-legal">Legal entity name</Label>
          <Input id="co-legal" placeholder="Acme Digital Money Ltd" autoComplete="off" value={legalName} onChange={e => setLegalName(e.target.value)} disabled={!isAdmin} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="co-country">Country</Label>
          <select
            id="co-country"
            value={country}
            onChange={e => setCountry(e.target.value)}
            disabled={!isAdmin}
            className="h-11 w-full rounded border border-input-border bg-input px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="" disabled>Select country…</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="co-address">Registered address</Label>
          <Input id="co-address" placeholder="Street, city, postal code" autoComplete="off" value={address} onChange={e => setAddress(e.target.value)} disabled={!isAdmin} />
        </div>

        {isAdmin && <Button type="submit" disabled={!dirty}>Update</Button>}
      </form>

      {/* Link to the org manager in Relationships - issuers only */}
      {isAdmin && (
      <div className="mt-10 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Users className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-foreground">Members & permissions</div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              Manage the people at your organisation with platform access and what each can do.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/issuer/relationships?rel=self')}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Building2 className="size-3.5" /> Open your organisation
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      )}

      {isAdmin && <EntityTransparencySettings />}
    </div>
  )
}

// ── Public transparency (entity page + directory listing) ─────────────────────

function EntityTransparencySettings() {
  const { identityKey } = useWallet()
  const { published, listed } = useEntityTransparency(identityKey ?? '')
  const [copied, setCopied] = useState(false)

  const relPath = `/transparency/${encodeURIComponent(identityKey ?? '')}`
  const url = typeof window !== 'undefined' ? `${window.location.origin}${relPath}` : relPath

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { toast.error('Could not copy the link.') }
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', published ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
          <Globe className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">Public transparency</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            Give your organisation a public proof-of-reserves page, and optionally list it in the public
            directory so anyone can find it.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <ToggleRow
          label="Publish transparency page"
          hint="Your entity page and its published instruments are visible to anyone with the link."
          checked={published}
          onChange={() => setEntityPublished(identityKey, !published)}
        />
        <ToggleRow
          label="List in public directory"
          hint="Show your organisation in the searchable directory at /transparency."
          checked={listed}
          disabled={!published}
          onChange={() => setEntityListed(identityKey, !listed)}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-[12px] text-muted-foreground">{url}</code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted">
          {copied ? <Check className="size-3.5 text-success" strokeWidth={3} /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a href={relPath} target="_blank" rel="noreferrer"
          className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[12.5px] font-medium transition-colors',
            published ? 'border-border text-foreground hover:bg-muted' : 'pointer-events-none border-border text-faint-foreground opacity-50')}
          aria-disabled={!published}>
          <ExternalLink className="size-3.5" /> Open
        </a>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, checked, disabled = false, onChange }: {
  label: string; hint: string; checked: boolean; disabled?: boolean; onChange: () => void
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-1.5', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn('relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed',
          checked ? 'bg-primary' : 'bg-muted-foreground/40')}
      >
        <span className={cn('inline-block size-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-[2px]')} />
      </button>
    </div>
  )
}
