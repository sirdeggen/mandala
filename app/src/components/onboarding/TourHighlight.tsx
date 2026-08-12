import { useEffect, useState } from 'react'

interface Rect { top: number; left: number; width: number; height: number }

/**
 * Rounded-rectangle ring drawn over the element marked with
 * `data-tour-id={targetId}`. A requestAnimationFrame retry loop means the
 * element doesn't have to exist the instant we set the id (handles route
 * transitions without hardcoded timeouts), and it re-measures on scroll/resize.
 * Pass `null` to hide.
 */
export function TourHighlight({ targetId }: { targetId: string | null }) {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!targetId) { setRect(null); return }

    let cancelled = false
    let rafId = 0
    let attempts = 0
    const MAX_ATTEMPTS = 120 // ~2s at 60fps

    let cleanup: (() => void) | null = null

    function tryLocate() {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`)
      if (el) {
        const measure = () => {
          const r = el.getBoundingClientRect()
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        }
        measure()
        const init = el.getBoundingClientRect()
        const inViewport = init.top >= 0 && init.bottom <= window.innerHeight
        if (!inViewport) el.scrollIntoView({ behavior: 'smooth', block: 'center' })

        const observer = new ResizeObserver(measure)
        observer.observe(el)
        window.addEventListener('scroll', measure, { passive: true })
        window.addEventListener('resize', measure)
        cleanup = () => {
          observer.disconnect()
          window.removeEventListener('scroll', measure)
          window.removeEventListener('resize', measure)
        }
        return
      }
      if (++attempts >= MAX_ATTEMPTS) { setRect(null); return }
      rafId = requestAnimationFrame(tryLocate)
    }

    rafId = requestAnimationFrame(tryLocate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      cleanup?.()
    }
  }, [targetId])

  if (!rect) return null

  return (
    <div
      className="pointer-events-none fixed z-[55] rounded-xl ring-2 ring-brass ring-offset-2 ring-offset-background shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-brass)_22%,transparent)] transition-[top,left,width,height] duration-300"
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
      }}
      aria-hidden
    />
  )
}
