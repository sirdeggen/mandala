import { useState } from 'react'
import { Download } from 'lucide-react'
import { FORMAT_LABEL, type ExportFormat } from '../../lib/exports'
import { cn } from '@/lib/utils'

const FORMATS: ExportFormat[] = ['csv', 'xls', 'pdf']

/**
 * Per-file-type checkboxes (all selected by default) with a single "Download"
 * button. Emits the chosen formats so the caller can generate one file per type
 * and log them together as a single export.
 */
export function ExportFormatPicker({ onExport, disabled }: {
  onExport: (formats: ExportFormat[]) => void
  disabled?: boolean
}) {
  const [selected, setSelected] = useState<Set<ExportFormat>>(() => new Set(FORMATS))
  const toggle = (f: ExportFormat) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(f)) next.delete(f); else next.add(f)
    return next
  })

  return (
    <div className="inline-flex items-center gap-2.5">
      {FORMATS.map(f => (
        <label key={f} className={cn('inline-flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] font-medium', disabled && 'pointer-events-none opacity-50')}>
          <input
            type="checkbox"
            checked={selected.has(f)}
            onChange={() => toggle(f)}
            className="size-3.5 rounded border-input-border text-primary accent-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <span className="text-muted-foreground">{FORMAT_LABEL[f]}</span>
        </label>
      ))}
      <button
        type="button"
        onClick={() => selected.size > 0 && onExport([...selected])}
        disabled={disabled || selected.size === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <Download className="size-3.5" /> Download
      </button>
    </div>
  )
}
