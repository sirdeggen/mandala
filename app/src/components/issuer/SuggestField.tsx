import { useEffect, useMemo, useRef, useState } from 'react'
import { Landmark } from 'lucide-react'
import { Input } from '../ui/input'
import type { BackingRefSuggestion } from '@/content/banks'
import { cn } from '@/lib/utils'

/**
 * Text input with a suggestion popover. Focusing the field opens a pre-query
 * list of sensible presets; typing filters them. Picking one fills the field,
 * but any free-text value is still accepted. Used for the backing reference on
 * issuance and the settlement note on redemption - each passes its own preset
 * list and heading.
 */
export function SuggestField({
  id, value, onChange, suggestions, heading, placeholder, className,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  suggestions: BackingRefSuggestion[]
  /** Label above the pre-query preset list. */
  heading: string
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const matches = useMemo(() => {
    if (q === '') return suggestions
    return suggestions.filter(s =>
      s.label.toLowerCase().includes(q) ||
      s.value.toLowerCase().includes(q) ||
      s.hint.toLowerCase().includes(q)
    )
  }, [q, suggestions])

  // Close when clicking outside (blur would fire before an option's click).
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
            <Landmark className="size-3" />
            {q === '' ? heading : matches.length > 0 ? 'Matching presets' : 'No preset matches'}
          </p>
          {matches.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              Your text is fine as typed - it will be recorded against this action.
            </p>
          ) : (
            matches.map(s => (
              <button
                key={s.value}
                type="button"
                // Prevent the input blur that would otherwise close the list first.
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(s.value); setOpen(false) }}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  s.value === value && 'bg-accent'
                )}
              >
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-foreground">{s.label}</span>
                  <span className="block truncate font-mono text-[11px] text-subtle-foreground">{s.value}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-[10.5px] text-faint-foreground">{s.hint}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
