import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ClipboardCheck, UserRound, ArrowRight, ShieldCheck, ChevronsUpDown, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandMark } from '@/components/ui/BrandMark'
import { UserAvatar } from '@/components/ui/user-avatar'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { cn } from '@/lib/utils'
import { CompanyAvatar } from '@/components/ui/company-avatar'
import { completeOnboarding, type OnboardingRole } from '@/lib/onboarding'
import { useWallet } from '@/context/WalletContext'

/**
 * First-run onboarding - role → name → (issuer) entity details. Modelled on the
 * Acctual onboarding pattern (grey canvas, a white inset panel with rounded top
 * corners, a left rail carrying the brand up top and the signed-in account down
 * in the bottom-left) but rebuilt in Underwrite's neutral theme and framed
 * around issuing a regulated stablecoin. Persists via completeOnboarding(); the
 * entry gate in TokenDemo unmounts it once done.
 */

type Step = 'role' | 'details'

const COUNTRIES = [
  'Switzerland', 'Germany', 'France', 'Netherlands', 'Ireland', 'Luxembourg',
  'Spain', 'Italy', 'Belgium', 'Austria', 'United Kingdom', 'United States', 'Other'
]

/**
 * Mock postal-code -> street/city lookup. A production build would call an
 * address-autocomplete provider (Loqate, Google, national post APIs); for the
 * demo we infer plausible values so the issuer only types a postal code.
 * Exact matches come from the table; anything else falls back to a deterministic
 * street on the selected country's principal city.
 */
const POSTAL_DB: Record<string, { street: string; city: string }> = {
  '8001': { street: 'Bahnhofstrasse 45', city: 'Zürich' },
  '8002': { street: 'Seestrasse 12', city: 'Zürich' },
  '3011': { street: 'Marktgasse 28', city: 'Bern' },
  '1204': { street: 'Rue du Rhône 65', city: 'Genève' },
  '4051': { street: 'Freie Strasse 30', city: 'Basel' },
  '10115': { street: 'Invalidenstraße 112', city: 'Berlin' },
  '60311': { street: 'Zeil 90', city: 'Frankfurt am Main' },
  '75001': { street: 'Rue de Rivoli 15', city: 'Paris' },
  '1011': { street: 'Damrak 70', city: 'Amsterdam' },
  '1050': { street: 'Avenue Louise 250', city: 'Brussels' },
}

const CITY_BY_COUNTRY: Record<string, string> = {
  Switzerland: 'Zürich', Germany: 'Berlin', France: 'Paris', Netherlands: 'Amsterdam',
  Ireland: 'Dublin', Luxembourg: 'Luxembourg', Spain: 'Madrid', Italy: 'Milan',
  Belgium: 'Brussels', Austria: 'Vienna', 'United Kingdom': 'London', 'United States': 'New York',
}
const STREETS = ['High Street', 'Market Square', 'Central Avenue', 'Kirchgasse', 'Hauptstrasse', 'Parkway']

function inferAddress(country: string, postal: string): { street: string; city: string } {
  const exact = POSTAL_DB[postal.toUpperCase()]
  if (exact) return exact
  const hash = [...postal].reduce((h, c) => h + c.charCodeAt(0), 0)
  return {
    street: `${STREETS[hash % STREETS.length]} ${(hash % 80) + 1}`,
    city: CITY_BY_COUNTRY[country] ?? 'City centre',
  }
}

const ROLES: { id: OnboardingRole, title: string, blurb: string, Icon: typeof Building2 }[] = [
  { id: 'issuer', title: 'Issuer', blurb: 'Licensed company or entity', Icon: Building2 },
  { id: 'auditor', title: 'Auditor', blurb: 'Licensed auditing professional', Icon: ClipboardCheck },
  { id: 'individual', title: 'Individual', blurb: 'Checking an instrument for yourself', Icon: UserRound }
]

export default function OnboardingWizard() {
  const { identityKey } = useWallet()
  const [step, setStep] = useState<Step>('role')
  const [role, setRole] = useState<OnboardingRole | null>(null)
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [country, setCountry] = useState('')
  const [postalCode, setPostalCode] = useState('')

  // Auto-infer street + city from the postal code (mock lookup for the demo).
  const inferred = useMemo(
    () => (postalCode.trim().length >= 4 ? inferAddress(country, postalCode.trim()) : null),
    [country, postalCode],
  )

  // Individuals just view instruments, so they don't provide a name.
  const canContinueRole = role != null && (role === 'individual' || name.trim().length > 0)

  function complete() {
    completeOnboarding({
      role,
      name: name.trim(),
      email: '',
      title: '',
      entity: role === 'issuer'
        ? { legalName: legalName.trim() || name.trim(), country, address: inferred ? `${inferred.street}, ${inferred.city} ${postalCode.trim()}` : postalCode.trim() }
        : null
    })
  }

  function submitRole(e: React.FormEvent) {
    e.preventDefault()
    if (!canContinueRole) return
    // Individuals have no entity details to collect - go straight in.
    if (role === 'individual') { complete(); return }
    setStep('details')
  }

  function finish(e: React.FormEvent) {
    e.preventDefault()
    complete()
  }

  const entityPlaceholder = 'Your Organisation'
  const previewIsPlaceholder = legalName.trim() === ''
  const previewName = previewIsPlaceholder ? entityPlaceholder : legalName.trim()

  return (
    <div className="flex min-h-screen w-full bg-muted text-foreground">
      {/* Left rail - brand up top, signed-in account down in the bottom-left */}
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col justify-between px-7 py-7 lg:flex">
        <BrandMark size="md" wordmark />
        <div className="space-y-5">
          <nav className="flex flex-col items-start gap-1.5 text-[14px] text-muted-foreground">
            <Link to="/help/getting-started" className="rounded px-1 py-0.5 transition-colors hover:text-foreground">Guides</Link>
          </nav>
          <AccountChip name={name} identityKey={identityKey} role={role} />
        </div>
      </aside>

      {/* Content column - white inset panel with rounded top corners */}
      <div className="flex min-h-screen w-full flex-col">
        {/* mobile brand header (rail is hidden below lg) */}
        <header className="flex items-center px-5 pt-5 lg:hidden">
          <BrandMark size="md" wordmark />
        </header>

        <main className="mt-3 flex flex-1 flex-col rounded-t-2xl border border-b-0 border-border bg-card px-6 py-10 shadow-[var(--shadow-card)] sm:px-10 lg:mt-4 lg:px-16 xl:px-20">
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col-reverse items-start gap-10 pt-2 xl:flex-row xl:items-center xl:gap-16">
        {/* form */}
        <div className="w-full max-w-[440px]">
          {step === 'role' && (
            <form onSubmit={submitRole} className="animate-in">
              <div className="mb-6 space-y-1.5">
                <h1 className="display text-3xl font-medium leading-none">What is your role?</h1>
                <p className="text-[15px] text-muted-foreground">So we set up your workspace the right way.</p>
              </div>

              <div className="flex flex-col gap-3">
                {ROLES.map(({ id, title, blurb, Icon }) => {
                  const active = role === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRole(id)}
                      className={cn(
                        'group grid flex-1 grid-cols-[24px_minmax(0,1fr)] items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors duration-200',
                        active ? 'border-foreground shadow-[var(--shadow-card)]' : 'border-border hover:border-muted-foreground'
                      )}
                    >
                      <Icon className={cn('h-6 w-6 transition-colors', active ? 'text-foreground' : 'text-faint-foreground group-hover:text-muted-foreground')} />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[15px] font-medium text-foreground">{title}</span>
                        <span className="text-[13px] leading-snug text-muted-foreground">{blurb}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              {role != null && role !== 'individual' && (
                <div className="animate-in mt-3 space-y-2">
                  <Label htmlFor="ob-name">Your name</Label>
                  <Input
                    id="ob-name"
                    autoFocus
                    autoComplete="off"
                    placeholder="e.g. Anna Weber"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
              )}

              <Button type="submit" className="mt-6 w-full" disabled={!canContinueRole}>
                Continue <ArrowRight />
              </Button>
            </form>
          )}

          {step === 'details' && (
            <form onSubmit={finish} className="animate-in">
              <div className="mb-6 space-y-1.5">
                <h1 className="display text-3xl font-medium leading-none">
                  {role === 'issuer' ? 'Make it yours' : 'Your firm'}
                </h1>
                <p className="text-[15px] text-muted-foreground">
                  {role === 'issuer'
                    ? 'Add your issuing entity details. This is what holders and auditors will see.'
                    : 'Tell us who you audit for. This appears on your reconciliation reports.'}
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ob-legal">{role === 'issuer' ? 'Legal entity name' : 'Auditing firm'}</Label>
                  <Input
                    id="ob-legal"
                    autoComplete="off"
                    placeholder="Your Organisation"
                    value={legalName}
                    onChange={e => setLegalName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ob-country">Country</Label>
                  <select
                    id="ob-country"
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className="h-11 w-full rounded border border-input-border bg-input px-3 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <option value="" disabled>Select country…</option>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {role === 'issuer' && (
                  <div className="space-y-2">
                    <Label htmlFor="ob-postal">Postal code</Label>
                    <Input
                      id="ob-postal"
                      autoComplete="off"
                      placeholder="e.g. 8001"
                      value={postalCode}
                      onChange={e => setPostalCode(e.target.value)}
                    />
                    {inferred && (
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-success" />
                        <span className="truncate">{inferred.street}, {inferred.city}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Button type="submit" className="mt-6 w-full">Enter Underwrite</Button>
              <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => setStep('role')}>Back</Button>
            </form>
          )}
        </div>

        {/* live preview */}
        <div className="relative w-full max-w-[380px] xl:pt-2">
          {/* ambient blurred oval behind the card */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
            <div className="h-[118%] w-[68%] rounded-[50%] bg-muted-foreground/25 blur-3xl" />
          </div>
          <PreviewCard step={step} entityName={previewName} placeholder={previewIsPlaceholder} country={country} role={role} identityKey={identityKey} name={name} />
        </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/** Signed-in account chip pinned to the rail's bottom-left - the wallet
 *  identity plus whatever name/role the user has entered so far, mirroring
 *  Acctual's bottom-left account switcher. */
function AccountChip({ name, identityKey, role }: {
  name: string
  identityKey: string | null
  role: OnboardingRole | null
}) {
  const seed = identityKey ?? name ?? 'account'
  const primary = name.trim() || (identityKey ? `${identityKey.slice(0, 8)}…${identityKey.slice(-4)}` : 'Your account')
  const secondary = role ? (role === 'issuer' ? 'Issuer' : 'Auditor') : 'Not signed in'

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left shadow-[var(--shadow-card)] outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <UserAvatar seed={seed} size={30} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold leading-tight text-foreground">{primary}</div>
        <div className="mt-[2px] truncate text-[10.5px] leading-none text-muted-foreground">{secondary}</div>
      </div>
      <ChevronsUpDown className="size-4 shrink-0 text-faint-foreground" />
    </button>
  )
}

/** A stand-in preview that fills in as the user goes. On the first (role) step
 *  it previews the signed-in user (their identity sigil); once entity details
 *  are being added it becomes the stablecoin / attestation card. */
function PreviewCard({ step, entityName, placeholder, country, role, identityKey, name }: {
  step: Step
  entityName: string
  placeholder: boolean
  country: string
  role: OnboardingRole | null
  identityKey: string | null
  name: string
}) {
  const roleLabel = role === 'issuer' ? 'Issuer' : role === 'auditor' ? 'Auditor' : role === 'individual' ? 'Individual' : 'Select a role'

  if (step === 'role') {
    const primary = name.trim() !== '' ? name.trim() : (identityKey != null ? `${identityKey.slice(0, 8)}…${identityKey.slice(-4)}` : 'Your account')
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[1px] text-faint-foreground">User login</span>
          <ShieldCheck className="h-4 w-4 text-success" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <IdentitySigil value={identityKey ?? name ?? 'user'} size={40} className="rounded-full" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-foreground">{primary}</p>
            <p className="truncate text-[13px] text-muted-foreground">{roleLabel}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[1px] text-faint-foreground">
          {role === 'auditor' ? 'Reserve attestation' : 'Stablecoin'}
        </span>
        <ShieldCheck className="h-4 w-4 text-success" />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <CompanyAvatar name={entityName} size={40} className="rounded-lg" />
        <div className="min-w-0">
          <p className={cn('truncate text-[15px] font-medium', placeholder ? 'text-muted-foreground' : 'text-foreground')}>{entityName}</p>
          {country && <p className="truncate text-[13px] text-muted-foreground">{country}</p>}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
        <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
        <p className="text-[12px] leading-snug text-balance text-muted-foreground">
          {role === 'auditor'
            ? 'Verify every issued unit against on-chain reserves, in real time.'
            : role === 'issuer'
              ? 'Every unit you issue is reconciled on-chain against reserves, auditor-ready from day one.'
              : 'On-chain settlement reconciled against reserves, auditor-ready from day one.'}
        </p>
      </div>
    </div>
  )
}
