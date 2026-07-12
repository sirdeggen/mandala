import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, ArrowRight, Building2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { useEntities, personByKey, SYSTEM_ROLE_LABEL } from '../../lib/entities'
import { cn } from '@/lib/utils'

const trunc = (k: string) => (k.length > 12 ? `${k.slice(0, 5)}…${k.slice(-5)}` : k)

/**
 * A clickable identity key (sigil + short form / resolved name) that opens a
 * popover linking it to the relationship manager. If the key belongs to a person
 * at one of your relationships, it shows who they are and links straight to that
 * organisation; otherwise it offers to open Relationships.
 */
export function IdentityKeyPopover({ value, size = 16, className, children }: {
  value: string
  size?: number
  className?: string
  /** Custom trigger content; defaults to sigil + resolved name / short key. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const match = personByKey(useEntities(), value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={value}
        className={cn('inline-flex items-center gap-1.5 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50', className)}
      >
        {children ?? (
          <>
            <IdentitySigil value={value} size={size} className="rounded" />
            {match != null
              ? <span className="text-[11.5px] font-medium text-foreground">{match.person.name}</span>
              : <span className="font-mono text-[11px] text-subtle-foreground">{trunc(value)}</span>}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <RelationshipLink identityKey={value} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function RelationshipLink({ identityKey, onDone }: { identityKey: string; onDone: () => void }) {
  const navigate = useNavigate()
  const match = personByKey(useEntities(), identityKey)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard?.writeText(identityKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => { /* ignore */ })
  }

  const keyRow = (
    <button type="button" onClick={copy} className="flex items-center gap-1 font-mono text-[10.5px] text-subtle-foreground transition-colors hover:text-foreground">
      {trunc(identityKey)} {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  )

  if (match != null) {
    const { entity, person } = match
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <IdentitySigil value={identityKey} size={30} className="rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-foreground">{person.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{SYSTEM_ROLE_LABEL[person.systemRole]} · {entity.name}</div>
          </div>
        </div>
        {keyRow}
        <button
          type="button"
          onClick={() => { onDone(); navigate(`/issuer/relationships?rel=${entity.id}`) }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Building2 className="size-3.5" /> Open {entity.name} <ArrowRight className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <IdentitySigil value={identityKey} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-foreground">Not in your relationships</div>
          {keyRow}
        </div>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">This counterparty isn’t linked to an institution in your relationships.</p>
      <button
        type="button"
        onClick={() => { onDone(); navigate('/issuer/relationships') }}
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        Open Relationships <ArrowRight className="size-3.5" />
      </button>
    </div>
  )
}
