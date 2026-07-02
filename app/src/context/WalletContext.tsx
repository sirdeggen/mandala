import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { WalletClient } from '@bsv/sdk'
import { MessageBoxClient } from '@bsv/message-box-client'
import { toast } from 'sonner'
import { OVERLAY_IDENTITY_KEY, MESSAGEBOX_URL } from '../lib/mandala/constants'
import { reconcileWallet } from '../lib/mandala/reconcile'

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
    const init = async () => {
      try {
        const wallet = new WalletClient()
        const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true })
        const messageBoxClient = new MessageBoxClient({
          host: MESSAGEBOX_URL, walletClient: wallet as any,
          enableLogging: false, networkPreset: 'mainnet'
        })
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
      } catch (e) {
        setState(s => ({ ...s, isInitialized: true, error: 'Failed to initialize wallet. Ensure a BRC-100 wallet (Metanet) is running.' }))
      }
    }
    void init()
  }, [])

  return <WalletContext.Provider value={state}>{children}</WalletContext.Provider>
}
