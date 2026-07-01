import { Wrench } from 'lucide-react'
import { useDevMode, toggleDevMode } from '../lib/devMode'
import { cn } from '@/lib/utils'

/**
 * A small always-present toggle for developer mode. When on, the send flow lets
 * you attempt a transfer of a paused asset so the overlay's server-side
 * rejection can be observed (see lib/devMode.ts). Bottom-right so it clears the
 * top-right Toaster and the holder brand row.
 */
export default function DevModeToggle() {
  const dev = useDevMode()
  return (
    <button
      type="button"
      onClick={() => toggleDevMode()}
      aria-pressed={dev}
      title="Developer mode — bypass the frontend pause guard to test overlay enforcement"
      className={cn(
        'fixed bottom-3 right-3 z-[60] flex items-center gap-1.5 rounded-full border px-2.5 py-1.5',
        'text-[10px] font-semibold uppercase tracking-[1px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dev
          ? 'border-warning/40 bg-warning/15 text-warning shadow-[var(--shadow-pop)]'
          : 'border-border bg-card/80 text-subtle-foreground backdrop-blur hover:text-foreground'
      )}
    >
      <Wrench className="h-[11px] w-[11px]" strokeWidth={2.2} />
      Dev{dev ? ' · on' : ''}
    </button>
  )
}
