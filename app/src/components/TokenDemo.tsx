import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Wallet, Send, Download, ShieldCheck, Copy, Check, AlertTriangle } from 'lucide-react'
import { useWallet } from '../context/WalletContext'
import IssuerDashboard from './issuer/IssuerDashboard'
import TokenWallet from './TokenWallet'
import SendTokens from './SendTokens'
import ReceiveTokens from './ReceiveTokens'
import { cn } from '@/lib/utils'
import { BrandMark } from './ui/BrandMark'

const segTrigger = cn(
  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 py-1.5',
  'text-[13px] font-medium text-muted-foreground select-none cursor-pointer',
  'transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98]',
  'data-[state=active]:bg-[var(--segment-thumb)] data-[state=active]:text-foreground',
  'data-[state=active]:shadow-[var(--shadow-thumb)] data-[state=active]:font-semibold',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
)

function IdentityChip({ identityKey }: { identityKey: string }) {
  const [copied, setCopied] = useState(false)
  const initials = identityKey.slice(2, 4).toUpperCase()
  const copy = () => {
    void navigator.clipboard.writeText(identityKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <button
      onClick={copy}
      title="Copy identity key"
      className="group inline-flex items-center gap-2.5 rounded-full bg-card pl-1.5 pr-3 py-1.5 shadow-[var(--shadow-card)] transition-transform duration-150 ease-out active:scale-[0.98]"
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground tabular">
        {initials}
      </span>
      <span className="tabular text-[13px] font-medium text-foreground">
        {identityKey.slice(0, 6)}…{identityKey.slice(-4)}
      </span>
      {copied
        ? <Check className="h-3.5 w-3.5 text-success" />
        : <Copy className="h-3.5 w-3.5 text-subtle-foreground group-hover:text-muted-foreground" />}
    </button>
  )
}

export default function TokenDemo() {
  const { isInitialized, error, isIssuer, identityKey } = useWallet()

  if (!isInitialized) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4 animate-in">
          {/* Meridian spinner: navy ring matching the brand knot */}
          <div className="relative h-9 w-9">
            <div className="absolute inset-0 rounded-full border-[2.5px] border-primary/15" />
            <div
              className="absolute inset-0 animate-spin rounded-full border-[2.5px] border-solid"
              style={{ borderColor: 'var(--brass)', borderRightColor: 'transparent' }}
            />
          </div>
          <p className="text-[14px] font-medium text-muted-foreground">Connecting your wallet…</p>
        </div>
      </div>
    )
  }

  if (error != null) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center animate-in">
          <div className="grid h-12 w-12 place-items-center rounded-[13px] bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Couldn't connect</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-20 pt-8 sm:pt-12">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <BrandMark wordmark size="sm" sublabel="TOKEN WALLET" />
        {identityKey && <IdentityChip identityKey={identityKey} />}
      </header>

      {isIssuer && (
        <div className="mb-5 flex items-center gap-2.5 rounded-[--radius-md] bg-accent px-4 py-3 animate-in">
          <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-accent-foreground" />
          <p className="text-[13px] font-medium text-accent-foreground">
            Issuer mode — this wallet controls the overlay instance.
          </p>
        </div>
      )}

      <Tabs.Root defaultValue={isIssuer ? 'issuer' : 'wallet'}>
        <Tabs.List
          className="mb-6 flex w-full gap-1 rounded-[10px] bg-[var(--segment-track)] p-1"
          aria-label="Sections"
        >
          {isIssuer && (
            <Tabs.Trigger value="issuer" className={segTrigger}>
              <ShieldCheck className="h-4 w-4" /> Issuer
            </Tabs.Trigger>
          )}
          <Tabs.Trigger value="wallet" className={segTrigger}>
            <Wallet className="h-4 w-4" /> Wallet
          </Tabs.Trigger>
          <Tabs.Trigger value="send" className={segTrigger}>
            <Send className="h-4 w-4" /> Send
          </Tabs.Trigger>
          <Tabs.Trigger value="receive" className={segTrigger}>
            <Download className="h-4 w-4" /> Receive
          </Tabs.Trigger>
        </Tabs.List>

        {isIssuer && (
          <Tabs.Content value="issuer" className="animate-in focus-visible:outline-none">
            <IssuerDashboard />
          </Tabs.Content>
        )}
        <Tabs.Content value="wallet" className="animate-in focus-visible:outline-none">
          <TokenWallet />
        </Tabs.Content>
        <Tabs.Content value="send" className="animate-in focus-visible:outline-none">
          <SendTokens />
        </Tabs.Content>
        <Tabs.Content value="receive" className="animate-in focus-visible:outline-none">
          <ReceiveTokens />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
