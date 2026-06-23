import * as Tabs from '@radix-ui/react-tabs'
import { useWallet } from '../context/WalletContext'
import IssuerPanel from './IssuerPanel'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import { ReceiveTokens } from './ReceiveTokens'

export default function TokenDemo() {
  const { isInitialized, error, isIssuer, identityKey } = useWallet()

  if (!isInitialized) return <div className="p-8 text-center">Connecting wallet…</div>
  if (error != null) return <div className="p-8 text-center text-red-600">{error}</div>

  return (
    <div className="max-w-3xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Mandala Tokens</h1>
        <p className="text-sm text-muted-foreground break-all">Identity: {identityKey}</p>
        {isIssuer && <p className="text-sm font-medium text-emerald-600">Issuer mode — this wallet controls the overlay instance.</p>}
      </header>
      <Tabs.Root defaultValue={isIssuer ? 'issuer' : 'wallet'}>
        <Tabs.List className="flex gap-2 border-b mb-4">
          {isIssuer && <Tabs.Trigger value="issuer" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Issuer</Tabs.Trigger>}
          <Tabs.Trigger value="wallet" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Wallet</Tabs.Trigger>
          <Tabs.Trigger value="send" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Send</Tabs.Trigger>
          <Tabs.Trigger value="receive" className="px-3 py-2 data-[state=active]:border-b-2 data-[state=active]:border-primary">Receive</Tabs.Trigger>
        </Tabs.List>
        {isIssuer && <Tabs.Content value="issuer"><IssuerPanel /></Tabs.Content>}
        <Tabs.Content value="wallet"><TokenWallet /></Tabs.Content>
        <Tabs.Content value="send"><SendTokens /></Tabs.Content>
        <Tabs.Content value="receive"><ReceiveTokens /></Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
