import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
  /** Optional succinct subheading shown under the label in the menu. */
  description?: string
}

/** Popover-based dropdown (matches the app's other custom menus), a drop-in for
 *  a native <select>. */
export function PopoverSelect<T extends string | number>({ value, options, onChange, className, align = 'start', disabled }: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  className?: string
  align?: 'start' | 'end'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-input-border bg-input px-3 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align={align} className="max-h-80 min-w-44 overflow-y-auto p-1">
        {options.map(o => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => { onChange(o.value); setOpen(false) }}
            className={cn(
              'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent',
              o.value === value && 'bg-accent',
            )}
          >
            <Check className={cn('mt-0.5 size-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
            <span className="min-w-0">
              <span className={cn('block truncate', o.value === value && 'font-medium')}>{o.label}</span>
              {o.description != null && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{o.description}</span>}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** Multi-select variant. `values` is the selected set; an empty set means the
 *  `placeholder` "all" state. Toggling keeps the popover open. */
export function PopoverMultiSelect<T extends string | number>({ values, options, onChange, placeholder = 'All', summaryNoun = 'selected', className, align = 'start' }: {
  values: T[]
  options: SelectOption<T>[]
  onChange: (v: T[]) => void
  /** Label shown (and header row) when nothing is selected. */
  placeholder?: string
  /** Plural noun for the ">1 selected" summary, e.g. 'instruments'. */
  summaryNoun?: string
  className?: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const label = values.length === 0
    ? placeholder
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? '')
      : `${values.length} ${summaryNoun}`
  const toggle = (v: T) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-input-border bg-input px-3 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align={align} className="max-h-72 min-w-52 overflow-y-auto p-1">
        <button
          type="button"
          onClick={() => onChange([])}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent',
            values.length === 0 && 'bg-accent font-medium',
          )}
        >
          <Check className={cn('size-3.5 shrink-0', values.length === 0 ? 'opacity-100' : 'opacity-0')} />
          <span className="truncate">{placeholder}</span>
        </button>
        <div className="my-1 h-px bg-border" />
        {options.map(o => {
          const on = values.includes(o.value)
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => toggle(o.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent',
                on && 'font-medium',
              )}
            >
              <Check className={cn('size-3.5 shrink-0', on ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{o.label}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
