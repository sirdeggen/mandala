/**
 * Company settings - the issuer entity's details, separate from personal Account
 * settings. Editing is restricted to company admins (issuer role); everyone else
 * gets a read-only view. Links through to the own-organisation manager in
 * Relationships for members & permissions.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Building2, Lock, ArrowRight, Users } from 'lucide-react'
import { useOnboarding, updateProfile, isReviewerRole } from '../../lib/onboarding'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const COUNTRIES = [
  'Switzerland', 'Germany', 'France', 'Netherlands', 'Ireland', 'Luxembourg',
  'Spain', 'Italy', 'Belgium', 'Austria', 'United Kingdom', 'United States', 'Other',
]

export default function CompanySettings() {
  const { entity, role } = useOnboarding()
  const navigate = useNavigate()
  const isAdmin = !isReviewerRole(role)

  const [legalName, setLegalName] = useState(entity?.legalName ?? '')
  const [country, setCountry] = useState(entity?.country ?? '')
  const [address, setAddress] = useState(entity?.address ?? '')

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

      {/* Link to the org manager in Relationships */}
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
    </div>
  )
}
