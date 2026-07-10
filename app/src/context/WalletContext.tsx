import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { WalletClient } from '@bsv/sdk'
import { MessageBoxClient } from '@bsv/message-box-client'
import { toast } from 'sonner'
import { OVERLAY_IDENTITY_KEY, MESSAGEBOX_URL } from '@bsv/mandala/constants'
import { reconcileWallet } from '@bsv/mandala/reconcile'
import { reconcileNotifications } from '@bsv/mandala/notifyJournal'

interface WalletState {
  wallet: WalletClient | null
  messageBoxClient: MessageBoxClient | null
  identityKey: string | null
  isIssuer: boolean
  isInitialized: boolean
  error: string | null
}

const WalletContext = createContext<WalletState>({
  wallet: null, messageBoxClient: null, identityKey: null,
  isIssuer: false, isInitialized: false, error: null
})

export const useWallet = (): WalletState => useContext(WalletContext)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    wallet: null, messageBoxClient: null, identityKey: null,
    isIssuer: false, isInitialized: false, error: null
  })

  useEffect(() => {
    // StrictMode double-invokes this effect: the cancelled flag stops the
    // stale run from clobbering state, and the reconcile passes below are
    // web-lock guarded so an overlapping second run skips instead of
    // double-broadcasting/aborting.
    let cancelled = false
    const init = async () => {
      try {
        const wallet = new WalletClient()
        const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
        const messageBoxClient = new MessageBoxClient({
          host: MESSAGEBOX_URL, walletClient: wallet as any,
          enableLogging: false, networkPreset: 'mainnet'
        })
        if (cancelled) return
        setState({
          wallet, messageBoxClient, identityKey,
          isIssuer: identityKey === OVERLAY_IDENTITY_KEY,
          isInitialized: true, error: null
        })
        // Recover half-failed flows from previous sessions: re-broadcast
        // overlay-accepted txs, retry pending aborts, and sweep stuck nosend
        // actions so held admin-auth/FT inputs are released (see reconcile.ts).
        void reconcileWallet(wallet as any).then(r => {
          const recovered = r.rebroadcast.length + r.aborted.length + r.swept
          if (recovered > 0) {
            console.info('[mandala] reconciled pending transactions:', r)
            toast.info(`Recovered ${recovered} pending transaction${recovered === 1 ? '' : 's'}`)
          }
        }).catch(e => console.warn('[mandala] reconcile failed:', e))
        // Deliver recipient notifications a crashed/failed send left pending —
        // without this the recipient never learns about their on-chain funds.
        void reconcileNotifications(messageBoxClient).then(d => {
          if (d.length > 0) console.info('[mandala] delivered pending transfer notifications:', d)
        }).catch(e => console.warn('[mandala] notification retry failed:', e))
      } catch (e) {
        if (!cancelled) {
          setState(s => ({ ...s, isInitialized: true, error: 'Failed to initialize wallet. Ensure a BRC-100 wallet (Metanet) is running.' }))
        }
      }
    }
    void init()
    return () => { cancelled = true }
  }, [])

  return <WalletContext.Provider value={state}>{children}</WalletContext.Provider>
}
