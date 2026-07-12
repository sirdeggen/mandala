/**
 * First-run product tour. A self-contained floating pane (bottom-right on
 * desktop, bottom sheet on mobile) that walks a new user through the surfaces
 * relevant to their onboarding role. Each step can navigate to a route and
 * ring-highlight an element tagged with `data-tour-id`.
 *
 * State lives in lib/onboardingTour (localStorage); content in
 * lib/onboardingTourContent. Mounted once at the app root; it gates its own
 * render so it only appears once first-run onboarding is complete.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, ChevronRight, Check, X, CircleDot, PlayCircle } from 'lucide-react'
import { useWallet } from '../../context/WalletContext'
import { useOnboarding } from '../../lib/onboarding'
import { useAdminAssets } from '../../hooks/useAdminAssets'
import { useIsMobile } from '../../hooks/use-mobile'
import { useTour, markTourStep, markTourAutoOpened, dismissTour } from '../../lib/onboardingTour'
import { TOUR_PATHS, resolveRoute, type TourStep } from '../../lib/onboardingTourContent'
import { TourHighlight } from './TourHighlight'
import { cn } from '@/lib/utils'

export default function OnboardingTour() {
  const onboarding = useOnboarding()
  const { isInitialized } = useWallet()
  const tour = useTour()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const assets = useAdminAssets().data

  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  const role = onboarding.role
  const path = role != null ? TOUR_PATHS[role] : null

  // Resolve the instrument a step should deep-link to: the one in the URL,
  // else the first the issuer holds.
  const assetId = searchParams.get('asset') || (assets != null && assets.length > 0 ? assets[0].assetId : '')

  // Auto-open expanded on the very first visit after onboarding completes.
  const canShow = isInitialized && onboarding.completed && role != null && path != null && !tour.dismissed
  useEffect(() => {
    if (!canShow) return
    if (tour.autoOpened) return
    const first = path!.steps[0]
    setOpen(true)
    setExpandedId(first?.id ?? null)
    if (first) activateStep(first)
    markTourAutoOpened()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow, tour.autoOpened, path])

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (isMobile && open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isMobile, open])

  const steps = path?.steps ?? []
  const doneCount = useMemo(() => steps.filter(s => tour.completed.includes(s.id)).length, [steps, tour.completed])
  const percent = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0

  const navRef = useRef<string>('')
  function activateStep(step: TourStep) {
    setHighlight(step.highlight ?? null)
    const route = resolveRoute(step, assetId)
    if (route != null) {
      const currentPath = location.pathname + location.search
      if (route !== currentPath && route !== navRef.current) {
        navRef.current = route
        navigate(route)
      }
    }
  }

  if (!canShow || path == null) return null

  function toggleStep(step: TourStep) {
    const willOpen = expandedId !== step.id
    setExpandedId(willOpen ? step.id : null)
    if (willOpen) activateStep(step)
  }

  function completeStep(step: TourStep, isLast: boolean) {
    markTourStep(step.id)
    if (isLast) {
      dismissTour()
      setHighlight(null)
      setOpen(false)
      return
    }
    if (isMobile) setOpen(false)
  }

  function handleDismiss() {
    dismissTour()
    setHighlight(null)
    setOpen(false)
  }

  return (
    <>
      <TourHighlight targetId={highlight} />

      {/* Mobile backdrop */}
      {isMobile && open && (
        <div className="fixed inset-0 z-[59] bg-foreground/40 backdrop-blur-sm animate-in" onClick={() => setOpen(false)} aria-hidden />
      )}

      <div
        className={cn(
          'fixed z-[61] flex flex-col',
          isMobile && open && 'inset-x-0 bottom-0 top-16',
          isMobile && !open && 'bottom-[92px] right-4 max-w-[calc(100vw-2rem)]',
          !isMobile && open && 'right-4 top-4 bottom-4 w-[360px]',
          !isMobile && !open && 'bottom-16 right-4',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-col overflow-hidden border border-border bg-card text-foreground shadow-[var(--shadow-pop)]',
            open ? 'h-full flex-1' : '',
            isMobile && open ? 'rounded-t-2xl' : 'rounded-2xl',
          )}
        >
          {/* Header / pill */}
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <ProgressRing percent={percent} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{path.title}</span>
                {!open && (
                  <span className="block truncate text-[11.5px] text-muted-foreground">{doneCount}/{steps.length} complete</span>
                )}
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </span>
          </button>

          {/* Body */}
          {open && (
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
              {/* Placeholder walkthrough video (ambient), like the issue-instrument panel */}
              <div className="shrink-0 p-2 pb-0">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted">
                  <video className="absolute inset-0 h-full w-full object-cover" src="/video/intro.mov" autoPlay loop muted playsInline aria-hidden />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/90 text-neutral-900"><PlayCircle className="size-3.5" strokeWidth={2} /></span>
                    <span className="text-[12px] font-semibold text-white drop-shadow">{path.title}</span>
                  </div>
                </div>
              </div>
              <p className="shrink-0 px-4 pt-3 text-[13.5px] leading-snug text-muted-foreground text-balance">{path.intro}</p>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {steps.map((step, i) => {
                  const isExpanded = expandedId === step.id
                  const isDone = tour.completed.includes(step.id)
                  const isLast = i === steps.length - 1
                  return (
                    <div key={step.id} className={cn('rounded-lg', isExpanded ? 'bg-muted/60' : 'hover:bg-muted/30')}>
                      <button
                        type="button"
                        onClick={() => toggleStep(step)}
                        aria-expanded={isExpanded}
                        className="flex w-full items-start gap-2.5 p-2.5 text-left"
                      >
                        <span className="mt-0.5 shrink-0">
                          {isDone
                            ? <Check className="size-4 text-success" strokeWidth={3} />
                            : <CircleDot className={cn('size-4', isExpanded ? 'text-brass' : 'text-faint-foreground')} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className={cn('text-[13px] font-medium', isDone && 'text-muted-foreground line-through')}>{step.title}</span>
                            {!isExpanded && <ChevronRight className="size-4 shrink-0 text-faint-foreground" />}
                          </span>
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="space-y-3 pb-3 pl-9 pr-3">
                          <p className="text-[12px] leading-relaxed text-muted-foreground text-balance">{step.description}</p>
                          <button
                            type="button"
                            onClick={() => completeStep(step, isLast)}
                            className={cn(
                              'inline-flex h-8 items-center gap-1.5 rounded-full border px-4 text-[12px] font-medium transition-colors',
                              isDone
                                ? 'border-border bg-card text-foreground hover:bg-muted'
                                : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                            )}
                          >
                            {isDone && <Check className="size-3.5" strokeWidth={3} />}
                            {step.action}
                          </button>
                        </div>
                      )}

                      {i < steps.length - 1 && <div className="mx-2.5 h-px bg-separator" />}
                    </div>
                  )
                })}
              </div>

              <div className="shrink-0 border-t border-border p-2">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" /> Dismiss tour
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function ProgressRing({ percent }: { percent: number }) {
  return (
    <span className="relative grid size-6 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          className="text-muted" fill="none" stroke="currentColor" strokeWidth={4}
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          className="text-brass transition-all duration-500 ease-out" fill="none" stroke="currentColor" strokeWidth={4}
          strokeDasharray={`${percent}, 100`} strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
