import Avatar from 'boring-avatars'
import { cn } from '@/lib/utils'

/** Deterministic Bauhaus-style generative tile (boring-avatars) used as the
 *  fallback for a company logo when none is uploaded. Square to distinguish an
 *  organisation from a person's round avatar. */
const PALETTE = ['#0f172a', '#1e3a8a', '#0e7490', '#0d9488', '#e8622c']

export function CompanyAvatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex overflow-hidden', className)} style={{ width: size, height: size }}>
      <Avatar name={name || 'company'} variant="bauhaus" size={size} square colors={PALETTE} />
    </span>
  )
}
