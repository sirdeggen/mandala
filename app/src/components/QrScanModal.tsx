import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import jsQR from 'jsqr'

interface Props {
  open: boolean
  onClose: () => void
  /** Called once with the decoded QR text; the caller closes the modal. */
  onResult: (text: string) => void
}

/**
 * Camera QR scanner - captures an identity key from another wallet's Receive
 * screen. getUserMedia preview + jsQR over canvas frames (works everywhere,
 * no BarcodeDetector dependency). The stream is torn down on close/unmount.
 */
export default function QrScanModal ({ open, onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    let cancelled = false
    let stream: MediaStream | null = null
    let raf = 0
    const video = videoRef.current
    if (video == null) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        video.srcObject = s
        void video.play()
        const tick = () => {
          if (cancelled) return
          if (ctx != null && video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height)
            if (code != null && code.data !== '') {
              onResult(code.data)
              return
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => {
        if (!cancelled) setError('Camera unavailable - check permissions, or paste the key into the search field instead.')
      })

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[380px] rounded-lg bg-card shadow-[var(--shadow-pop)] overflow-hidden animate-pop"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Scan an Entity ID QR code"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-separator">
          <span className="text-[14px] font-semibold">Scan Entity ID</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="grid h-8 w-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={16} />
          </button>
        </div>

        {error !== '' ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{error}</p>
        ) : (
          <div className="relative aspect-square bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {/* Framing corners */}
            <div className="pointer-events-none absolute inset-[14%] rounded-md border-2 border-white/70" />
          </div>
        )}

        <p className="px-4 py-3 text-center text-[12px] text-subtle-foreground">
          Point the camera at a Receive-screen QR code.
        </p>
      </div>
    </div>
  )
}
