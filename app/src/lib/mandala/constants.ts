import { WalletProtocol } from '@bsv/sdk'

export const TOPIC = 'tm_mandala'
export const LOOKUP = 'ls_mandala'
export const FT_PROTOCOL: WalletProtocol = [2, 'mandala token']
export const ADMIN_PROTOCOL: WalletProtocol = [2, 'mandala admin']
export const BASKET = 'mandala-tokens'
export const MESSAGEBOX = 'mandala-payments'

export const OVERLAY_URL = import.meta.env.VITE_OVERLAY_URL as string
export const OVERLAY_IDENTITY_KEY = import.meta.env.VITE_OVERLAY_IDENTITY_KEY as string
export const MESSAGEBOX_URL = import.meta.env.VITE_MESSAGEBOX_URL as string
