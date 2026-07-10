import Avatar from 'boring-avatars'
import { cn } from '@/lib/utils'

/** Fallback palette: light blue, dark blue, yellow, black, teal. */
const FALLBACK_COLORS = ['#8ecae6', '#023e8a', '#ffb703', '#0a0a0a', '#2a9d8f']

/**
 * User avatar — the real avatar image when available, otherwise a deterministic
 * boring-avatars "bauhaus" fallback seeded by the user's key/name. Round, to
 * distinguish a *user* from an *instrument* (which uses a square identity sigil).
 */
export function UserAvatar({
  seed, src, size = 32, className,
}: {
  seed: string
  src?: string | null
  size?: number
  className?: string
}) {
  return (
    <div
      className={cn('shrink-0 overflow-hidden rounded-full', className)}
      style={{ width: size, height: size }}
    >
      {src != null && src !== '' ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <Avatar name={seed || 'issuer'} variant="bauhaus" colors={FALLBACK_COLORS} size={size} />
      )}
    </div>
  )
}
