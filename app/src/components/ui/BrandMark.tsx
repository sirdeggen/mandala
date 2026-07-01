import { cn } from '@/lib/utils'

interface BrandMarkProps {
  /** sm = 28px tile (mobile header), md = 30px tile (desktop nav) */
  size?: 'sm' | 'md'
  /** Show the "Mandala" wordmark beside the tile */
  wordmark?: boolean
  /** Optional sub-label beneath the wordmark, e.g. "ISSUER CONSOLE" */
  sublabel?: string
  className?: string
}

/**
 * Meridian brand mark — navy rounded-square tile holding a brass partial-circle
 * knot, plus optional wordmark "Mandala" and sub-label.
 *
 * Mark anatomy (from 1a.html lines 22 / 109):
 *   • tile: `border-radius:8px; background:#23405E` (--primary)
 *   • knot: `border:1.6-1.7px solid #C9A96A; border-radius:50%;
 *            border-right-color:transparent; transform:rotate(-45deg)`
 */
export function BrandMark({ size = 'md', wordmark = false, sublabel, className }: BrandMarkProps) {
  const isSm = size === 'sm'

  /* Tile dimensions match comp exactly:
     mobile header  → 28×28px tile, 11×11 knot, 1.6px border
     desktop nav    → 30×30px tile, 12×12 knot, 1.7px border  */
  const tileSize  = isSm ? 'h-7 w-7'   : 'h-[30px] w-[30px]'
  const tileRound = 'rounded-[8px]'
  const knotSize  = isSm ? 'h-[11px] w-[11px]' : 'h-3 w-3'
  const knotBorder = isSm ? '[border-width:1.6px]' : '[border-width:1.7px]'

  const wordSize  = isSm ? 'text-[18px]' : 'text-[16px]'

  return (
    <div className={cn('flex items-center gap-[9px]', className)}>
      {/* Tile */}
      <div
        className={cn(
          'flex shrink-0 items-center justify-center bg-primary',
          tileSize,
          tileRound,
        )}
      >
        {/* Brass knot: partial circle, right segment clipped, rotated −45° */}
        <div
          className={cn(
            'rounded-full border-solid',
            knotSize,
            knotBorder,
          )}
          style={{
            borderColor: 'var(--brass)',
            borderRightColor: 'transparent',
            transform: 'rotate(-45deg)',
          }}
        />
      </div>

      {/* Wordmark + optional sub-label */}
      {(wordmark || sublabel) && (
        <div>
          {wordmark && (
            <div
              className={cn(
                'font-semibold leading-none tracking-[0.3px]',
                wordSize,
              )}
            >
              Mandala
            </div>
          )}
          {sublabel && (
            <div
              className="mt-[3px] text-[9px] font-medium leading-none tracking-[1px] text-muted-foreground"
              style={{ letterSpacing: '1px' }}
            >
              {sublabel}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BrandMark
