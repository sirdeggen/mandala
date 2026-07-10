import { Wrench, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDevMode, toggleDevMode } from '../lib/devMode'
import { useOnboarding, updateProfile, resetOnboarding, type OnboardingRole } from '../lib/onboarding'
import { cn } from '@/lib/utils'

/**
 * Developer utilities - an always-present affordance in the bottom-right. The
 * pill toggles developer mode (bypass the frontend pause guard so the overlay's
 * server-side rejection can be observed, see lib/devMode.ts). Hovering reveals a
 * panel to reset the first-run tour and to preview the Issuer vs Auditor
 * experience without re-onboarding.
 */
export default function DevModeToggle() {
  const dev = useDevMode()
  const { role } = useOnboarding()
  const navigate = useNavigate()

  // Treat anything that isn't explicitly 'auditor' as issuer for the switch.
  const isAuditor = role === 'auditor'

  const setRole = (next: OnboardingRole) => updateProfile({ role: next })

  const resetTour = () => {
    resetOnboarding()
    navigate('/')
  }

  return (
    <div className="group fixed bottom-3 right-3 z-[60]">
      {/* Hover panel */}
      <div
        className={cn(
          'absolute bottom-full right-0 mb-2 w-56 origin-bottom-right rounded-xl border border-border bg-popover p-1.5 shadow-[var(--shadow-pop)]',
          'pointer-events-none scale-95 opacity-0 transition-[opacity,transform] duration-150',
          'group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100 group-focus-within:opacity-100'
        )}
      >
        <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[1px] text-faint-foreground">
          Developer
        </div>

        {/* Role switch */}
        <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
          <span className="text-[13px] font-medium text-foreground">
            {isAuditor ? 'Auditor' : 'Issuer'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isAuditor}
            aria-label="Toggle Issuer / Auditor"
            onClick={() => setRole(isAuditor ? 'issuer' : 'auditor')}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              isAuditor ? 'bg-primary' : 'bg-muted-foreground/40'
            )}
          >
            <span
              className={cn(
                'inline-block size-4 transform rounded-full bg-white shadow transition-transform',
                isAuditor ? 'translate-x-[18px]' : 'translate-x-[2px]'
              )}
            />
          </button>
        </div>

        {/* Reset tour */}
        <button
          type="button"
          onClick={resetTour}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
        >
          <RotateCcw className="size-4 text-muted-foreground" strokeWidth={2} />
          Reset tour
        </button>
      </div>

      {/* Dev-mode pill */}
      <button
        type="button"
        onClick={() => toggleDevMode()}
        aria-pressed={dev}
        title="Developer mode - bypass the frontend pause guard to test overlay enforcement. Hover for more."
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5',
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
    </div>
  )
}
