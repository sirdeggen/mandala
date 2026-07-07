import { useEffect, useState } from 'react'
import { IdentityClient } from '@bsv/sdk'

interface ResolvedIdentity {
  name?: string
  badgeLabel?: string
  avatarURL?: string
}

interface Props {
  identityKey: string
  wallet: import('@bsv/sdk').WalletInterface | null
}

// Abbreviate a key (or any long string) to first 12 + "…" — enough hex to
// visually distinguish counterparties when no resolved name is available.
export function abbreviate (key: string): string {
  if (key.length <= 14) return key
  return `${key.slice(0, 12)}…`
}

/**
 * Renders an identityKey as a resolved identity (name / avatar / badge) when
 * the wallet can resolve it, falling back to the abbreviated key. Shared by
 * the holder's transaction history and the issuer's overlay activity feed.
 */
export function CounterpartyDisplay ({ identityKey, wallet }: Props) {
  const [resolved, setResolved] = useState<ResolvedIdentity | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!identityKey || wallet == null) return
    let cancelled = false
    setLoading(true)
    const client = new IdentityClient(wallet as any)
    client.resolveByIdentityKey({ identityKey })
      .then(results => {
        if (!cancelled && results.length > 0) {
          const r = results[0]
          setResolved({
            name: r.name,
            badgeLabel: r.badgeLabel,
            avatarURL: r.avatarURL
          })
        }
      })
      .catch(() => { /* fall back to abbreviated key */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [identityKey, wallet])

  if (!identityKey) return <span className="text-subtle-foreground">—</span>
  if (loading) return <span className="animate-pulse text-subtle-foreground">{abbreviate(identityKey)}</span>

  if (resolved?.name) {
    return (
      <span className="flex items-center gap-1.5">
        {resolved.avatarURL && (
          <img src={resolved.avatarURL} alt={resolved.name} className="h-5 w-5 rounded-full" />
        )}
        <span className="font-medium">{resolved.name}</span>
        {resolved.badgeLabel && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
            {resolved.badgeLabel}
          </span>
        )}
      </span>
    )
  }

  return <span className="tabular text-subtle-foreground">{abbreviate(identityKey)}</span>
}
