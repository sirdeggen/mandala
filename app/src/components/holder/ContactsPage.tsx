/**
 * ContactsPage - Wallet-native contacts management.
 *
 * Reads/writes contacts via contactsStore (PushDrop wallet outputs).
 * Supports two add-contact paths:
 *   (a) SEARCH: IdentityClient.resolveByAttributes → pick a DisplayableIdentity
 *   (b) MANUAL: paste identity key + type a name
 *
 * Meridian-styled: white cards, hairline borders, ink/navy/brass palette.
 */

import { useCallback, useState } from 'react'
import { Building2, UserPlus, Pencil, Trash2, X, Check, Search, ChevronRight, BadgeCheck, Send } from 'lucide-react'
import { noAutofill } from '../../lib/noAutofill'
import { IdentityClient } from '@bsv/sdk'
import { useWallet } from '../../context/WalletContext'
import { useContactsData, useInvalidateContacts } from '../../hooks/useContactsData'
import { Spinner } from '../ui/spinner'
import { IdentitySigil } from '@/components/ui/identity-sigil'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  saveContact,
  removeContact,
  type StoredContact,
} from '@bsv/mandala/contactsStore'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function abbrevKey(key: string): string {
  if (!key || key.length <= 12) return key
  return `${key.slice(0, 5)}…${key.slice(-5)}`
}

/** Deterministic pastel hue (0–359) from a key, for the card's header wash. */
function hueForKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-[100px] left-1/2 z-50 flex max-w-[370px] -translate-x-1/2 flex-col gap-[7px]">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-center gap-[10px] rounded-md px-[14px] py-[11px]',
            'text-[13px] font-medium shadow-[var(--shadow-pop)]',
            t.type === 'success'
              ? 'bg-primary text-primary-foreground'
              : 'bg-destructive text-destructive-foreground'
          )}
        >
          {t.type === 'success' ? (
            <Check className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} />
          ) : (
            <X className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} />
          )}
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="opacity-70 hover:opacity-100 focus-visible:outline-none"
          >
            <X className="h-[13px] w-[13px]" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContactRow
// ---------------------------------------------------------------------------

interface ContactRowProps {
  contact: StoredContact
  onEdit: (c: StoredContact) => void
  onRemove: (identityKey: string) => void
  /** When provided, the card shows a primary "Send" CTA. */
  onSend?: (c: StoredContact) => void
  removing: boolean
}

/** A contact rendered as a profile card - gradient header, overlaid avatar,
 *  verified badge, truncated Badge ID, and a primary Send action. */
function ContactRow({ contact, onEdit, onRemove, onSend, removing }: ContactRowProps) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const hue = hueForKey(contact.identityKey)

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
      {/* Gradient header */}
      <div
        className="relative h-16"
        style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 82%), hsl(${(hue + 42) % 360} 52% 88%))` }}
      >
        {contact.badgeLabel && (
          <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-neutral-900">
            {contact.badgeLabel}
          </span>
        )}
        {/* Avatar, overlaid on the header edge */}
        <div className="absolute -bottom-6 left-4 rounded-full bg-card p-[3px]">
          <UserAvatar seed={contact.identityKey} src={contact.avatarURL} size={48} />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-4 pt-8">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold leading-tight">{contact.name}</span>
          <BadgeCheck className="size-4 shrink-0 text-success" strokeWidth={2.2} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-subtle-foreground">
          {contact.handle && <span>@{contact.handle}</span>}
          <code className="font-mono" title={contact.identityKey}>{abbrevKey(contact.identityKey)}</code>
        </div>
        {contact.note && (
          <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{contact.note}</p>
        )}

        {/* Actions */}
        {confirmRemove ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={removing}
              onClick={() => onRemove(contact.identityKey)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-[12.5px] font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {removing && <Spinner size="sm" tone="current" className="h-3 w-3" />}
              {removing ? 'Removing…' : 'Remove contact'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            {onSend && (
              <button
                type="button"
                onClick={() => onSend(contact)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Send className="size-4" /> Send
              </button>
            )}
            {onSend ? (
              <button
                type="button"
                onClick={() => onEdit(contact)}
                aria-label={`Edit ${contact.name}`}
                className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onEdit(contact)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="size-4" /> Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              aria-label={`Remove ${contact.name}`}
              className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Identity search result shape
// ---------------------------------------------------------------------------

interface DisplayableIdentity {
  identityKey?: string
  name?: string
  avatarURL?: string
  badgeLabel?: string
  abbreviatedKey?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// AddContactDialog
// ---------------------------------------------------------------------------

type AddMode = 'search' | 'manual'

interface AddContactDialogProps {
  wallet: unknown
  onSaved: (contact: StoredContact) => void
  onCancel: () => void
}

function AddContactDialog({ wallet, onSaved, onCancel }: AddContactDialogProps) {
  const [mode, setMode] = useState<AddMode>('search')

  // Search path
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DisplayableIdentity[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DisplayableIdentity | null>(null)

  // Form fields (shared by both paths, pre-filled by search pick)
  const [name, setName] = useState('')
  const [identityKey, setIdentityKey] = useState('')
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [note, setNote] = useState('')
  const [avatarURL, setAvatarURL] = useState('')
  const [badgeLabel, setBadgeLabel] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const doSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const client = new IdentityClient(wallet as any, undefined, 'mandala')
      const raw = await client.resolveByAttributes(
        { attributes: { any: searchQuery.trim() } },
        true
      )
      const results: DisplayableIdentity[] = Array.isArray(raw)
        ? (raw as unknown[]).map(r => r as DisplayableIdentity)
        : []
      setSearchResults(Array.isArray(results) ? results : [])
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [wallet, searchQuery])

  const pickIdentity = (identity: DisplayableIdentity) => {
    setSelected(identity)
    setIdentityKey(identity.identityKey ?? '')
    setName(identity.name ?? '')
    setAvatarURL(identity.avatarURL ?? '')
    setBadgeLabel(identity.badgeLabel ?? '')
  }

  const handleSave = async () => {
    if (!identityKey.trim() || !name.trim()) {
      setSaveError('Badge ID and name are required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const contact: StoredContact = {
        identityKey: identityKey.trim(),
        name: name.trim(),
        email: email.trim() || undefined,
        handle: handle.trim() || undefined,
        note: note.trim() || undefined,
        avatarURL: avatarURL.trim() || undefined,
        badgeLabel: badgeLabel.trim() || undefined,
      }
      await saveContact(wallet as any, contact)
      onSaved(contact)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const hasIdentity = identityKey.trim() !== '' && name.trim() !== ''

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 backdrop-blur-[3px]">
      <div
        className={cn(
          'mx-auto w-full max-w-[430px] rounded-b-[22px] bg-background',
          'shadow-[var(--shadow-pop)]',
          'max-h-[90vh] overflow-y-auto animate-in'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[22px] pt-[18px] pb-[14px]">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Add Contact</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[16px] w-[16px]" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-[6px] px-[22px] pb-[14px]">
          {(['search', 'manual'] as AddMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setSelected(null); setSearchResults([]) }}
              className={cn(
                'rounded-full px-[14px] py-[7px] text-[12px] font-semibold leading-none transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-foreground hover:bg-muted'
              )}
            >
              {m === 'search' ? 'Search Identity' : 'Manual Entry'}
            </button>
          ))}
        </div>

        <div className="px-[22px] pb-[30px]">
          {/* SEARCH mode */}
          {mode === 'search' && !selected && (
            <div>
              <div className="flex gap-[8px]">
                <input
                  {...noAutofill}
                  name="mandala-contact-search"
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void doSearch() }}
                  placeholder="Name, @handle, or email…"
                  className={cn(
                    'flex-1 rounded border border-border bg-input px-[12px] py-[9px]',
                    'text-[13px] placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
                <button
                  type="button"
                  onClick={() => void doSearch()}
                  disabled={searching || !searchQuery.trim()}
                  className={cn(
                    'flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded',
                    'bg-primary text-primary-foreground transition-opacity disabled:opacity-50',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                >
                  <Search className="h-[16px] w-[16px]" />
                </button>
              </div>

              {searching && (
                <div className="mt-[14px] text-center text-[13px] text-muted-foreground">
                  Searching…
                </div>
              )}

              {searchError && (
                <div className="mt-[10px] rounded bg-destructive/10 px-[12px] py-[9px] text-[12px] text-destructive">
                  {searchError}
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="mt-[12px] rounded-md border border-border bg-card overflow-hidden">
                  {searchResults.map((identity, i) => (
                    <button
                      key={identity.identityKey ?? i}
                      type="button"
                      onClick={() => pickIdentity(identity)}
                      className={cn(
                        'flex w-full items-center gap-[10px] px-[14px] py-[11px]',
                        'text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        i > 0 && 'border-t border-separator'
                      )}
                    >
                      <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary">
                        {identity.avatarURL ? (
                          <img src={identity.avatarURL} alt={identity.name ?? ''} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[12px] font-semibold text-primary-foreground">
                            {initials(identity.name ?? '?')}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-[6px]">
                          <span className="truncate text-[13px] font-semibold">{identity.name ?? 'Unknown'}</span>
                          {identity.badgeLabel && (
                            <span className="shrink-0 rounded-full bg-accent px-[6px] py-[2px] text-[10px] font-semibold text-accent-foreground">
                              {identity.badgeLabel}
                            </span>
                          )}
                        </div>
                        {identity.identityKey && (
                          <div className="mt-[2px] font-mono text-[10px] text-subtle-foreground">
                            {abbrevKey(identity.identityKey)}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-[14px] w-[14px] shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery && !searchError && (
                <div className="mt-[14px] text-center text-[13px] text-muted-foreground">
                  No results - try manual entry.
                </div>
              )}
            </div>
          )}

          {/* After search pick - show form pre-filled */}
          {mode === 'search' && selected && (
            <div className="mb-[14px] flex items-center gap-[10px] rounded-md border border-border bg-card px-[14px] py-[10px]">
              <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary">
                {selected.avatarURL ? (
                  <img src={selected.avatarURL} alt={selected.name ?? ''} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[12px] font-semibold text-primary-foreground">
                    {initials(selected.name ?? '?')}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{selected.name}</div>
                <div className="font-mono text-[10px] text-subtle-foreground">{abbrevKey(selected.identityKey ?? '')}</div>
              </div>
              <button
                type="button"
                onClick={() => { setSelected(null); setSearchResults([]) }}
                className="text-muted-foreground hover:text-foreground focus-visible:outline-none"
              >
                <X className="h-[14px] w-[14px]" />
              </button>
            </div>
          )}

          {/* Form fields - shown in manual mode or after search pick */}
          {(mode === 'manual' || selected) && (
            <div className="flex flex-col gap-[10px]">
              {mode === 'manual' && (
                <div>
                  <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                    Badge ID *
                  </label>
                  <input
                    type="text"
                    value={identityKey}
                    onChange={e => setIdentityKey(e.target.value)}
                    placeholder="02abcdef…"
                    className={cn(
                      'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                      'font-mono text-[12px] placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  />
                </div>
              )}

              <div>
                <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Alice Smith"
                  className={cn(
                    'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                    'text-[13px] placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-[8px]">
                <div>
                  <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="alice@example.com"
                    className={cn(
                      'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                      'text-[13px] placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  />
                </div>
                <div>
                  <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                    Handle
                  </label>
                  <input
                    type="text"
                    value={handle}
                    onChange={e => setHandle(e.target.value)}
                    placeholder="@alice"
                    className={cn(
                      'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                      'text-[13px] placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring'
                    )}
                  />
                </div>
              </div>

              <div>
                <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                  Note
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Optional note…"
                  className={cn(
                    'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                    'text-[13px] placeholder:text-muted-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring'
                  )}
                />
              </div>

              {saveError && (
                <div className="rounded bg-destructive/10 px-[12px] py-[9px] text-[12px] text-destructive">
                  {saveError}
                </div>
              )}

              <button
                type="button"
                disabled={saving || !hasIdentity}
                onClick={() => void handleSave()}
                className={cn(
                  'mt-[4px] flex w-full items-center justify-center gap-2 rounded-md py-[13px]',
                  'text-[14px] font-semibold leading-none',
                  'bg-primary text-primary-foreground transition-opacity disabled:opacity-50',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                {saving && <Spinner size="sm" tone="current" />}
                {saving ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditContactDialog
// ---------------------------------------------------------------------------

interface EditContactDialogProps {
  contact: StoredContact
  wallet: unknown
  onSaved: (contact: StoredContact) => void
  onCancel: () => void
}

function EditContactDialog({ contact, wallet, onSaved, onCancel }: EditContactDialogProps) {
  const [name, setName] = useState(contact.name)
  const [email, setEmail] = useState(contact.email ?? '')
  const [handle, setHandle] = useState(contact.handle ?? '')
  const [note, setNote] = useState(contact.note ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) {
      setSaveError('Name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated: StoredContact = {
        ...contact,
        name: name.trim(),
        email: email.trim() || undefined,
        handle: handle.trim() || undefined,
        note: note.trim() || undefined,
      }
      await saveContact(wallet as any, updated)
      onSaved(updated)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-[3px]">
      <div className="mx-auto w-full max-w-[430px] rounded-t-xl bg-background shadow-[var(--shadow-pop)] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-[22px] pt-[18px] pb-[14px]">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Edit Contact</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[16px] w-[16px]" />
          </button>
        </div>

        <div className="flex flex-col gap-[10px] px-[22px] pb-[30px]">
          {/* Identity key (read-only) */}
          <div>
            <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
              Badge ID
            </label>
            <div className="flex w-full items-center gap-2.5 rounded border border-border bg-muted/40 px-[12px] py-[9px]">
              <IdentitySigil value={contact.identityKey} size={24} className="rounded" />
              <code
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-subtle-foreground"
                title={contact.identityKey}
              >
                {contact.identityKey.length > 12
                  ? `${contact.identityKey.slice(0, 5)}…${contact.identityKey.slice(-5)}`
                  : contact.identityKey}
              </code>
            </div>
          </div>

          <div>
            <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className={cn(
                'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                'text-[13px] focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-[8px]">
            <div>
              <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="alice@example.com"
                className={cn(
                  'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                  'text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                )}
              />
            </div>
            <div>
              <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
                Handle
              </label>
              <input
                type="text"
                value={handle}
                onChange={e => setHandle(e.target.value)}
                placeholder="@alice"
                className={cn(
                  'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                  'text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
                )}
              />
            </div>
          </div>

          <div>
            <label className="mb-[4px] block text-[11px] font-medium uppercase tracking-[0.8px] text-faint-foreground">
              Note
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional note…"
              className={cn(
                'w-full rounded border border-border bg-input px-[12px] py-[9px]',
                'text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
              )}
            />
          </div>

          {saveError && (
            <div className="rounded bg-destructive/10 px-[12px] py-[9px] text-[12px] text-destructive">
              {saveError}
            </div>
          )}

          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => void handleSave()}
            className={cn(
              'mt-[4px] flex w-full items-center justify-center gap-2 rounded-md py-[13px]',
              'text-[14px] font-semibold leading-none',
              'bg-primary text-primary-foreground transition-opacity disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {saving && <Spinner size="sm" tone="current" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContactsPage - main export
// ---------------------------------------------------------------------------

export default function ContactsPage({ onBack, onSend }: {
  onBack?: () => void
  /** When provided, each contact card shows a primary "Send" action. */
  onSend?: (c: StoredContact) => void
}) {
  const { wallet } = useWallet()
  // Shared cached query - renders instantly on navigation, refetches behind.
  const { data } = useContactsData()
  const invalidateContacts = useInvalidateContacts()
  const contacts = data?.saved ?? []
  const loading = data == null
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<StoredContact | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  let nextToastId = 0

  const addToast = (message: string, type: Toast['type']) => {
    const id = ++nextToastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  const handleContactSaved = (contact: StoredContact) => {
    setShowAdd(false)
    setEditTarget(null)
    addToast(`${contact.name} saved`, 'success')
    void invalidateContacts()
  }

  const handleRemove = async (identityKey: string) => {
    if (wallet == null) return
    setRemovingKey(identityKey)
    try {
      await removeContact(wallet as any, identityKey)
      addToast('Contact removed', 'success')
      void invalidateContacts()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Remove failed', 'error')
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <div className="flex flex-col pb-[24px]">
      {/* Header */}
      <div className="flex items-center justify-between px-[22px] pt-[20px] pb-[18px]">
        <div className="flex items-center gap-[9px]">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to home"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <Building2 className="h-[20px] w-[20px] text-primary" strokeWidth={1.9} />
          <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Relationships</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          aria-label="Add contact"
          className={cn(
            'flex items-center gap-[6px] rounded-full px-[13px] py-[8px]',
            'bg-primary text-primary-foreground text-[12px] font-semibold',
            'transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          <UserPlus className="h-[14px] w-[14px]" />
          Add
        </button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="px-[22px]">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-[12px] border-b border-separator py-[13px]">
              <div className="h-[40px] w-[40px] animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-[6px]">
                <div className="h-[13px] w-[120px] animate-pulse rounded-full bg-muted" />
                <div className="h-[10px] w-[80px] animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && contacts.length === 0 && (
        <div className="flex flex-col items-center gap-[12px] px-[26px] py-[48px]">
          <div className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-muted">
            <Building2 className="h-[26px] w-[26px] text-muted-foreground" />
          </div>
          <p className="text-center text-[14px] font-medium text-muted-foreground">
            No contacts yet - add someone.
          </p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className={cn(
              'mt-[4px] rounded-full px-[20px] py-[10px]',
              'text-[13px] font-semibold',
              'bg-primary text-primary-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            Add Contact
          </button>
        </div>
      )}

      {/* Contacts grid */}
      {!loading && contacts.length > 0 && (
        <div className="mx-[16px] grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {contacts.map(c => (
            <ContactRow
              key={c.identityKey}
              contact={c}
              onEdit={setEditTarget}
              onRemove={identityKey => void handleRemove(identityKey)}
              onSend={onSend}
              removing={removingKey === c.identityKey}
            />
          ))}
        </div>
      )}

      {/* Add dialog */}
      {showAdd && wallet != null && (
        <AddContactDialog
          wallet={wallet}
          onSaved={handleContactSaved}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Edit dialog */}
      {editTarget != null && wallet != null && (
        <EditContactDialog
          contact={editTarget}
          wallet={wallet}
          onSaved={handleContactSaved}
          onCancel={() => setEditTarget(null)}
        />
      )}

      {/* Toasts */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
