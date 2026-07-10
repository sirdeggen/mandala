import { cn } from '@/lib/utils'

interface BrandMarkProps {
  /** sm = 28px tile (mobile header), md = 30px tile (desktop nav) */
  size?: 'sm' | 'md'
  /** Show the "Underwrite" wordmark beside the tile */
  wordmark?: boolean
  /** Optional sub-label beneath the wordmark, e.g. "ISSUER CONSOLE" */
  sublabel?: string
  className?: string
}

/**
 * Underwrite brand mark - a 4-fold quaternary knot rendered in the tile's
 * foreground on a near-black tile, plus the optional "Underwrite" wordmark and
 * sub-label.
 *
 * Mark anatomy:
 *   • tile: near-black `bg-primary` (#171717), rounded square
 *   • knot: 4 petal paths rotated 0/90/180/270° about the centre,
 *           stroke `--primary-foreground` (near-white), stroke-linejoin round.
 *   Reads legibly down to ~16px.
 */
export function BrandMark({ size = 'md', wordmark = false, sublabel, className }: BrandMarkProps) {
  const isSm = size === 'sm'

  const tileSize = isSm ? 'h-7 w-7' : 'h-[30px] w-[30px]'
  const tileRound = 'rounded-md'
  const wordSize = isSm ? 'text-[24px]' : 'text-[22px]'

  return (
    <div className={cn('flex items-center gap-[9px]', className)}>
      {/* Underwrite logo mark */}
      <img
        src="/icon-192.png"
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 object-contain', tileSize, tileRound)}
      />

      {/* Wordmark + optional sub-label */}
      {(wordmark || sublabel) && (
        <div>
          {wordmark && (
            <div className={cn('font-handwritten font-bold leading-none tracking-[-0.2px]', wordSize)}>
              Underwrite
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
