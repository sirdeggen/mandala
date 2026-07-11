import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { UserPlus, Check, Copy, ArrowRight } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { Input } from '../ui/input'
import { useWallet } from '../../context/WalletContext'
import { useContactsData, useInvalidateContacts } from '../../hooks/useContactsData'
import { saveContact } from '@bsv/mandala/contactsStore'
import { cn } from '@/lib/utils'

const trunc = (k: string) => (k.length > 12 ? `${k.slice(0, 5)}…${k.slice(-5)}` : k)

/**
 * A clickable identity key (sigil + short form) that opens a popover to add the
 * key to relationships (or update / open it if already saved). The data hooks
 * live in the content, which only mounts when the popover opens, so rendering
 * many of these in a table stays cheap.
 */
export function IdentityKeyPopover({ value, size = 16, className, children }: {
  value: string
  size?: number
  className?: string
  /** Custom trigger content; defaults to sigil + short key. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={value}
        className={cn('inline-flex items-center gap-1.5 rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50', className)}
      >
        {children ?? (
          <>
            <IdentitySigil value={value} size={size} className="rounded" />
            <span className="font-mono text-[11px] text-subtle-foreground">{trunc(value)}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <QuickAdd identityKey={value} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function QuickAdd({ identityKey, onDone }: { identityKey: string; onDone: () => void }) {
  const { wallet } = useWallet()
  const { data } = useContactsData()
  const invalidate = useInvalidateContacts()
  const navigate = useNavigate()
  const existing = data?.saved.find(c => c.identityKey === identityKey)
  const [name, setName] = useState(existing?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const save = async () => {
    if (wallet == null) { toast.error('Connect a wallet to save relationships.'); return }
    setSaving(true)
    try {
      await saveContact(wallet as never, { identityKey, name: name.trim() || 'Unnamed relationship' })
      invalidate()
      toast.success(existing ? 'Relationship updated' : 'Added to relationships')
      onDone()
    } catch {
      toast.error('Could not save relationship')
    } finally {
      setSaving(false)
    }
  }

  const copy = () => {
    navigator.clipboard?.writeText(identityKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => { /* ignore */ })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <IdentitySigil value={identityKey} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-foreground">{existing ? 'In your relationships' : 'Add to relationships'}</div>
          <button type="button" onClick={copy} className="flex items-center gap-1 font-mono text-[10.5px] text-subtle-foreground transition-colors hover:text-foreground">
            {trunc(identityKey)} {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="rel-name" className="text-[11px] font-medium text-muted-foreground">Name</label>
        <Input id="rel-name" value={name} onChange={e => setName(e.target.value)} placeholder="Relationship name" className="h-8 text-[12.5px]" autoFocus />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <UserPlus className="size-3.5" /> {existing ? 'Update' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => { onDone(); navigate('/issuer/relationships') }}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Open <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
