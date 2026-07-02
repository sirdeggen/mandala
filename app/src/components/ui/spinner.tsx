import { cn } from '@/lib/utils'

const SIZES = {
  sm: { box: 'h-4 w-4', border: 'border-[2px]' },
  md: { box: 'h-6 w-6', border: 'border-[2.5px]' },
  lg: { box: 'h-9 w-9', border: 'border-[2.5px]' },
} as const

export interface SpinnerProps {
  size?: keyof typeof SIZES
  /**
   * 'brand' — brass arc on a faint navy ring; for light/neutral surfaces
   * (cards, page loading states). 'current' — arc + ring in currentColor, so
   * it reads correctly inside colored buttons (primary/destructive/etc).
   */
  tone?: 'brand' | 'current'
  className?: string
}

/**
 * The app's one spinner: a static ring plus a spinning arc, rather than a
 * generic single-stroke wheel — this is the motif from the wallet-connecting
 * screen, reused everywhere something is in flight so the whole app feels
 * like one thing thinking, not a dozen ad hoc loaders.
 */
export function Spinner({ size = 'md', tone = 'brand', className }: SpinnerProps) {
  const { box, border } = SIZES[size]
  return (
    <span className={cn('relative inline-block shrink-0', box, className)} role="status" aria-label="Loading">
      <span className={cn('absolute inset-0 rounded-full', border, tone === 'brand' ? 'border-primary/15' : 'border-current/25')} />
      <span
        className={cn('absolute inset-0 animate-spin rounded-full border-solid', border)}
        style={{ borderColor: tone === 'brand' ? 'var(--brass)' : 'currentColor', borderRightColor: 'transparent' }}
      />
    </span>
  )
}
