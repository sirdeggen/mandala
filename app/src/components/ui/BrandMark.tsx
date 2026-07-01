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
 * Mandala brand mark — the applied "ii · Quaternary" 4-fold Celtic knot
 * (Stablecoin UX Directions.dc.html · 2c) in brass on a navy tile, plus the
 * optional "Mandala" wordmark and sub-label.
 *
 * Mark anatomy (from 2c.html, applied lockup):
 *   • tile: navy `bg-primary` (#23405E), rounded square
 *   • knot: 4 petal paths rotated 0/90/180/270° about the centre,
 *           stroke brass (--brass #C9A96A), stroke-linejoin round.
 *   Reads legibly down to ~16px.
 */
export function BrandMark({ size = 'md', wordmark = false, sublabel, className }: BrandMarkProps) {
  const isSm = size === 'sm'

  const tileSize = isSm ? 'h-7 w-7' : 'h-[30px] w-[30px]'
  const tileRound = 'rounded-[8px]'
  const knotPx = isSm ? 19 : 21
  const wordSize = isSm ? 'text-[18px]' : 'text-[16px]'

  return (
    <div className={cn('flex items-center gap-[9px]', className)}>
      {/* Navy tile with the brass 4-fold quaternary knot */}
      <div className={cn('flex shrink-0 items-center justify-center bg-primary', tileSize, tileRound)}>
        <svg
          width={knotPx}
          height={knotPx}
          viewBox="0 0 48 48"
          fill="none"
          stroke="var(--brass)"
          strokeWidth={2.6}
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M24 8C16 14 16 24 24 30C32 24 32 14 24 8Z" />
          <path d="M24 8C16 14 16 24 24 30C32 24 32 14 24 8Z" transform="rotate(90 24 24)" />
          <path d="M24 8C16 14 16 24 24 30C32 24 32 14 24 8Z" transform="rotate(180 24 24)" />
          <path d="M24 8C16 14 16 24 24 30C32 24 32 14 24 8Z" transform="rotate(270 24 24)" />
        </svg>
      </div>

      {/* Wordmark + optional sub-label */}
      {(wordmark || sublabel) && (
        <div>
          {wordmark && (
            <div className={cn('font-semibold leading-none tracking-[-0.2px]', wordSize)}>
              Mandala
            </div>
          )}
          {sublabel && (
            <div
              className="mt-[3px] text-[9px] font-medium leading-none text-muted-foreground"
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
