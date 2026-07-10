import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  ICON_GROUPS, ICON_BY_NAME, iconColor, defaultIconName,
  useInstrumentIconName, setInstrumentIcon,
} from '@/lib/instrumentIcons'
import { cn } from '@/lib/utils'

/** Mix a hex color toward white by `amount` (0–1) for a soft tinted ground. */
function tintToWhite(hex: string, amount: number): string {
  const ch = (start: number): number => {
    const c = parseInt(hex.slice(start, start + 2), 16)
    return Math.round(c + (255 - c) * amount)
  }
  return `rgb(${ch(1)} ${ch(3)} ${ch(5)})`
}

/**
 * Instrument identity tile - a curated Lucide glyph over a deterministic ground.
 * With `image` (the instrument's type photo) it becomes a premium tile: the
 * photo, a semi-transparent matte in the instrument's theme colour, and the
 * glyph in white on top. Without `image` it falls back to a soft tinted ground
 * with a coloured glyph. The colour is stable so the instrument keeps identity.
 */
export function InstrumentIcon({
  assetId, size = 40, className, image,
}: {
  assetId: string
  size?: number
  className?: string
  /** Type background photo (see lib/instrumentCategory). */
  image?: string
}) {
  const name = useInstrumentIconName(assetId)
  const Icon = ICON_BY_NAME[name] ?? ICON_BY_NAME[defaultIconName(assetId)]!
  const color = iconColor(assetId)
  const glyph = { width: Math.round(size * 0.5), height: Math.round(size * 0.5) }

  if (image != null) {
    return (
      <div
        className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-lg', className)}
        style={{ width: size, height: size }}
        role="img"
        aria-hidden="true"
      >
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ backgroundColor: color, opacity: 0.62 }} />
        <Icon className="relative text-white" style={glyph} strokeWidth={2} />
      </div>
    )
  }

  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-lg', className)}
      style={{ width: size, height: size, background: tintToWhite(color, 0.86), color }}
      role="img"
      aria-hidden="true"
    >
      <Icon style={glyph} strokeWidth={2} />
    </div>
  )
}

/**
 * Editable instrument tile - the same tile, but clicking it opens a picker of
 * the curated icon set. Do not nest inside another `<button>` (it renders one).
 */
export function EditableInstrumentIcon({
  assetId, size = 40, className, image,
}: {
  assetId: string
  size?: number
  className?: string
  image?: string
}) {
  const [open, setOpen] = useState(false)
  const current = useInstrumentIconName(assetId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="group relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label="Change instrument icon"
      >
        <InstrumentIcon assetId={assetId} size={size} className={className} image={image} />
        <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg text-[9px] font-semibold uppercase tracking-wide text-primary-foreground opacity-0 transition-opacity group-hover:bg-foreground/45 group-hover:opacity-100">
          Edit
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-2">
        <p className="px-1 pb-1 text-[11px] font-semibold text-muted-foreground">Change icon</p>
        {ICON_GROUPS.map(group => (
          <div key={group.label} className="mb-1">
            <p className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint-foreground">
              {group.label}
            </p>
            <div className="grid grid-cols-6 gap-1">
              {group.icons.map(({ name, Icon }) => {
                const active = name === current
                return (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Set icon ${name}`}
                    onClick={() => { setInstrumentIcon(assetId, name); setOpen(false) }}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent',
                      active && 'bg-accent ring-1 ring-foreground/20'
                    )}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
