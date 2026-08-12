import { useEffect, useRef, useState } from 'react'
import { Plus, X, ListPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '../ui/input'
import { useTermsPresets, addTermsPreset, removeTermsPreset } from '../../lib/redemptionTermsPresets'
import { cn } from '@/lib/utils'

/**
 * Text field backed by a user-editable preset list. Focusing opens a popover of
 * saved presets (filtered as you type); picking one fills the field. A "+"
 * button inside the input saves the current text as a new preset, and each
 * preset row has an "x" to remove it. Presets persist locally.
 */
export function EditablePresetField({
  id, value, onChange, placeholder, className, disabled,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const presets = useTermsPresets()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const matches = q === '' ? presets : presets.filter(p => p.toLowerCase().includes(q))
  const canSave = value.trim() !== '' && !presets.includes(value.trim())

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const saveCurrent = () => {
    if (!canSave) return
    addTermsPreset(value)
    toast.success('Saved as a preset')
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        className={cn('pr-10', className)}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
      />
      {/* Add-current-as-preset button, inside the input */}
      <button
        type="button"
        disabled={disabled || !canSave}
        onMouseDown={e => e.preventDefault()}
        onClick={saveCurrent}
        aria-label="Save current text as a preset"
        title={canSave ? 'Save as a preset' : 'Type something new to save as a preset'}
        className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground outline-none transition-colors enabled:hover:bg-muted enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-[var(--shadow-card)]">
          <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
            <ListPlus className="size-3" />
            {q === '' ? 'Saved presets' : matches.length > 0 ? 'Matching presets' : 'No preset matches'}
          </p>
          {matches.length === 0 ? (
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={saveCurrent}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-primary transition-colors hover:bg-accent"
            >
              <Plus className="size-3.5" /> Save “{value.trim()}” as a preset
            </button>
          ) : (
            matches.map(p => (
              <div key={p} className="group/preset flex items-start gap-1 rounded-md pr-1 transition-colors hover:bg-accent">
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(p); setOpen(false) }}
                  className={cn('min-w-0 flex-1 px-2 py-1.5 text-left text-[12.5px] text-foreground', p === value && 'font-medium')}
                >
                  {p}
                </button>
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => removeTermsPreset(p)}
                  aria-label="Remove preset"
                  className="mt-1 grid size-6 shrink-0 place-items-center rounded text-faint-foreground opacity-0 transition hover:bg-background hover:text-destructive focus-visible:opacity-100 group-hover/preset:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
