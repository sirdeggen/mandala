import { WalletProtocol } from '@bsv/sdk'

export const TOPIC = 'tm_mandala'
export const LOOKUP = 'ls_mandala'
export const FT_PROTOCOL: WalletProtocol = [2, 'mandala token']
export const ADMIN_PROTOCOL: WalletProtocol = [2, 'mandala admin']
export const BASKET = 'mandala-tokens'
export const MESSAGEBOX = 'mandala-payments'

// Endpoint defaults come from Vite env when present (the app), otherwise
// they start empty and MUST be set via configureMandala (any other consumer).
// Guarded access — import.meta.env only exists under Vite/vitest.
const env: Record<string, string | undefined> =
  (import.meta as unknown as { env?: Record<string, string> }).env ?? {}

export let OVERLAY_URL = env.VITE_OVERLAY_URL ?? ''
export let OVERLAY_IDENTITY_KEY = env.VITE_OVERLAY_IDENTITY_KEY ?? ''
export let MESSAGEBOX_URL = env.VITE_MESSAGEBOX_URL ?? ''

export interface MandalaEndpoints {
  overlayUrl?: string
  overlayIdentityKey?: string
  messageBoxUrl?: string
}

/** Override endpoint configuration at runtime (ESM live bindings propagate). */
export function configureMandala (endpoints: MandalaEndpoints): void {
  if (endpoints.overlayUrl != null) OVERLAY_URL = endpoints.overlayUrl
  if (endpoints.overlayIdentityKey != null) OVERLAY_IDENTITY_KEY = endpoints.overlayIdentityKey
  if (endpoints.messageBoxUrl != null) MESSAGEBOX_URL = endpoints.messageBoxUrl
}
