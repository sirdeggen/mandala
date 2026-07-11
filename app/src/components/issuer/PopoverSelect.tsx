import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface SelectOption<T extends string | number> { value: T; label: string }

/** Popover-based dropdown (matches the app's other custom menus), a drop-in for
 *  a native <select>. */
export function PopoverSelect<T extends string | number>({ value, options, onChange, className, align = 'start' }: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  className?: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-input-border bg-input px-3 text-[13px] text-foreground outline-none transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
          className,
        )}
      >
        <span className="truncate">{current?.label ?? ''}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align={align} className="max-h-72 min-w-44 overflow-y-auto p-1">
        {options.map(o => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => { onChange(o.value); setOpen(false) }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent',
              o.value === value && 'bg-accent font-medium',
            )}
          >
            <Check className={cn('size-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
