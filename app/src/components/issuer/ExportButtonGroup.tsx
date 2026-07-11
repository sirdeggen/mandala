import { FileText, Sheet, FileType } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ExportFormat } from '../../lib/exports'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ITEMS: { format: ExportFormat; Icon: LucideIcon; title: string }[] = [
  { format: 'csv', Icon: FileText, title: 'Export CSV' },
  { format: 'xls', Icon: Sheet, title: 'Export spreadsheet (.xls)' },
  { format: 'pdf', Icon: FileType, title: 'Export PDF' },
]

/** Icon-only segmented control for the three export formats (CSV / .xls / PDF). */
export function ExportButtonGroup({ onExport, disabled, primary }: {
  onExport: (format: ExportFormat) => void
  disabled?: boolean
  /** Emphasise the group (used on the download-all row). */
  primary?: boolean
}) {
  return (
    <div className={cn('inline-flex divide-x divide-border overflow-hidden rounded-md border border-border', primary && 'shadow-[var(--shadow-card)]')}>
      {ITEMS.map(({ format, Icon, title }) => (
        <Tooltip key={format}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={title}
              disabled={disabled}
              onClick={() => onExport(format)}
              className={cn(
                'grid size-8 place-items-center transition-colors disabled:opacity-40',
                primary
                  ? 'bg-card text-foreground hover:bg-muted'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="size-4" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}
