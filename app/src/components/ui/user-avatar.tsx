import { IdentitySigil } from '@/components/ui/identity-sigil'
import { cn } from '@/lib/utils'

/**
 * User avatar - the real avatar image when available, otherwise a deterministic
 * identity sigil seeded by the user's key/name. Round, to distinguish a *user*
 * from an *instrument* (which uses a square, Lucide-icon tile via InstrumentIcon).
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
        <IdentitySigil value={seed || 'user'} size={size} />
      )}
    </div>
  )
}
