import { useEffect, useMemo, useRef, useState } from 'react'
import { Users } from 'lucide-react'
import { Input } from '../ui/input'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { useContactsData } from '../../hooks/useContactsData'
import { cn } from '@/lib/utils'

interface Relationship {
  identityKey: string
  name: string
  /** Transaction count with this counterparty - drives the "most used" order. */
  count: number
}

const trunc = (k: string) => (k.length > 12 ? `${k.slice(0, 5)}…${k.slice(-5)}` : k)

/**
 * Entity ID field with a relationship autocomplete. Focusing shows the most-used
 * relationships (saved contacts + counterparties seen in history); typing
 * matches on name or Entity ID. Picking one fills the Entity ID and reports the
 * name back so the caller can populate its holder-name field. Free-text Badge
 * IDs are still accepted.
 */
export function RelationshipField({
  id, value, onChange, onSelect, placeholder, className,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onSelect: (r: { identityKey: string; name: string }) => void
  placeholder?: string
  className?: string
}) {
  const { data } = useContactsData()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Merge saved contacts (names) with derived counterparties (usage counts).
  const relationships = useMemo((): Relationship[] => {
    const map = new Map<string, Relationship>()
    for (const d of data?.derived ?? []) {
      map.set(d.identityKey, { identityKey: d.identityKey, name: '', count: d.count })
    }
    for (const s of data?.saved ?? []) {
      const ex = map.get(s.identityKey)
      map.set(s.identityKey, { identityKey: s.identityKey, name: s.name, count: ex?.count ?? 0 })
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [data])

  const q = value.trim().toLowerCase()
  const matches = useMemo(() => {
    if (q === '') return relationships.slice(0, 8)
    return relationships.filter(r =>
      r.name.toLowerCase().includes(q) || r.identityKey.toLowerCase().includes(q)
    )
  }, [q, relationships])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className={className}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-card)]">
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
            <Users className="size-3" />
            {q === '' ? 'Most-used relationships' : matches.length > 0 ? 'Matching relationships' : 'No matches'}
          </p>
          {matches.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              No matching relationship - screen this Entity ID as typed.
            </p>
          ) : (
            matches.map(r => (
              <button
                key={r.identityKey}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onSelect({ identityKey: r.identityKey, name: r.name }); setOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  r.identityKey === value && 'bg-accent'
                )}
              >
                <IdentitySigil value={r.identityKey} size={26} className="rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">{r.name || 'Unnamed relationship'}</span>
                  <span className="block truncate font-mono text-[11px] text-subtle-foreground">{trunc(r.identityKey)}</span>
                </span>
                {r.count > 0 && (
                  <span className="shrink-0 text-[10.5px] text-faint-foreground">{r.count}×</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
