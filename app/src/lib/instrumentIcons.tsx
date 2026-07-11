/**
 * Instrument iconography - instruments are visually identified by a Lucide icon
 * on a deterministic colored tile (see InstrumentIcon), *not* a user-style sigil.
 * Each instrument gets a stable default icon derived from its assetId, which the
 * issuer can override from a curated picker of ~40 finance / voucher glyphs.
 *
 * The chosen icon is a *label*, persisted per-assetId in localStorage under
 * `underwrite.instrumentIcons.v1`. A module-level store + useSyncExternalStore
 * keeps every surface (cards, switcher, treasury header) in sync without a
 * context provider - the same pattern as lib/onboarding.ts.
 */
import { useSyncExternalStore } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Banknote, Coins, DollarSign, CircleDollarSign, Wallet, HandCoins, PiggyBank,
  CreditCard, Landmark, Vault,
  FileText, ScrollText, ReceiptText, Receipt, Stamp, Scale, Briefcase, BookText,
  Key, ShieldCheck,
  Ticket, TicketCheck, TicketPercent, Tag, Tags, Gift, BadgePercent,
  BadgeDollarSign, QrCode, Barcode,
  Gem, Diamond, Crown, Award, Medal, Star, TrendingUp, LineChart, Bitcoin, Euro,
} from 'lucide-react'

export interface IconGroup {
  label: string
  icons: { name: string, Icon: LucideIcon }[]
}

/** Curated, finance-flavoured icon set, grouped for the picker. */
export const ICON_GROUPS: IconGroup[] = [
  {
    label: 'Money',
    icons: [
      { name: 'Banknote', Icon: Banknote },
      { name: 'Coins', Icon: Coins },
      { name: 'DollarSign', Icon: DollarSign },
      { name: 'CircleDollarSign', Icon: CircleDollarSign },
      { name: 'Wallet', Icon: Wallet },
      { name: 'HandCoins', Icon: HandCoins },
      { name: 'PiggyBank', Icon: PiggyBank },
      { name: 'CreditCard', Icon: CreditCard },
      { name: 'Landmark', Icon: Landmark },
      { name: 'Vault', Icon: Vault },
    ],
  },
  {
    label: 'Instruments',
    icons: [
      { name: 'FileText', Icon: FileText },
      { name: 'ScrollText', Icon: ScrollText },
      { name: 'ReceiptText', Icon: ReceiptText },
      { name: 'Receipt', Icon: Receipt },
      { name: 'Stamp', Icon: Stamp },
      { name: 'Scale', Icon: Scale },
      { name: 'Briefcase', Icon: Briefcase },
      { name: 'BookText', Icon: BookText },
      { name: 'Key', Icon: Key },
      { name: 'ShieldCheck', Icon: ShieldCheck },
    ],
  },
  {
    label: 'Vouchers & tickets',
    icons: [
      { name: 'Ticket', Icon: Ticket },
      { name: 'TicketCheck', Icon: TicketCheck },
      { name: 'TicketPercent', Icon: TicketPercent },
      { name: 'Tag', Icon: Tag },
      { name: 'Tags', Icon: Tags },
      { name: 'Gift', Icon: Gift },
      { name: 'BadgePercent', Icon: BadgePercent },
      { name: 'BadgeDollarSign', Icon: BadgeDollarSign },
      { name: 'QrCode', Icon: QrCode },
      { name: 'Barcode', Icon: Barcode },
    ],
  },
  {
    label: 'Value & markets',
    icons: [
      { name: 'Gem', Icon: Gem },
      { name: 'Diamond', Icon: Diamond },
      { name: 'Crown', Icon: Crown },
      { name: 'Award', Icon: Award },
      { name: 'Medal', Icon: Medal },
      { name: 'Star', Icon: Star },
      { name: 'TrendingUp', Icon: TrendingUp },
      { name: 'LineChart', Icon: LineChart },
      { name: 'Bitcoin', Icon: Bitcoin },
      { name: 'Euro', Icon: Euro },
    ],
  },
]

/** Flat name → component lookup across every group. */
export const ICON_BY_NAME: Record<string, LucideIcon> = Object.fromEntries(
  ICON_GROUPS.flatMap(g => g.icons.map(i => [i.name, i.Icon] as const))
)

const ALL_NAMES = ICON_GROUPS.flatMap(g => g.icons.map(i => i.name))

/** 16 harmonious tile grounds (mirrors the sigil palette family). */
export const ICON_PALETTE = [
  '#4f46e5', '#7c3aed', '#9333ea', '#c026d3',
  '#db2777', '#e11d48', '#dc2626', '#ea580c',
  '#d97706', '#ca8a04', '#16a34a', '#059669',
  '#0d9488', '#0891b2', '#0ea5e9', '#2563eb',
]

/** FNV-1a 32-bit hash - deterministic, SSR-safe. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic default icon name for an instrument with no explicit choice. */
export function defaultIconName(assetId: string): string {
  return ALL_NAMES[fnv1a(assetId) % ALL_NAMES.length]!
}

/** Deterministic tile color for an instrument (stable across icon changes). */
export function defaultIconColor(assetId: string): string {
  return ICON_PALETTE[(fnv1a(`c:${assetId}`) >>> 3) % ICON_PALETTE.length]!
}

/**
 * The theme colour for an instrument: the issuer's chosen colour if set,
 * otherwise the deterministic default. Reads the override synchronously so even
 * non-reactive callers pick up a change on their next render; components that
 * must update live should use `useInstrumentColor`.
 */
export function iconColor(assetId: string): string {
  return currentColors[assetId] ?? defaultIconColor(assetId)
}

// ── Persistence stores ────────────────────────────────────────────────────────
// Two parallel per-assetId maps: the chosen icon name, and the chosen theme
// colour. Both use the module-level store + useSyncExternalStore pattern so
// every surface stays in sync without a context provider.

const ICON_KEY = 'underwrite.instrumentIcons.v1'
const COLOR_KEY = 'underwrite.instrumentColors.v1'
const listeners = new Set<() => void>()

function readMap(key: string): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(key)
    if (raw == null) return {}
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

let current = readMap(ICON_KEY)
let currentColors = readMap(COLOR_KEY)

/** Override the icon for one instrument (pass null to revert to the default). */
export function setInstrumentIcon(assetId: string, name: string | null): void {
  const next = { ...current }
  if (name == null || !(name in ICON_BY_NAME)) delete next[assetId]
  else next[assetId] = name
  current = next
  try { localStorage.setItem(ICON_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

/** Override the theme colour for one instrument (pass null to revert). Updates
 *  the icon tile and every surface that derives its colour from `iconColor`. */
export function setInstrumentColor(assetId: string, color: string | null): void {
  const next = { ...currentColors }
  if (color == null || !ICON_PALETTE.includes(color)) delete next[assetId]
  else next[assetId] = color
  currentColors = next
  try { localStorage.setItem(COLOR_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Reactive: the chosen icon name for an instrument (its default if unset). */
export function useInstrumentIconName(assetId: string): string {
  const map = useSyncExternalStore(subscribe, () => current, () => current)
  return map[assetId] ?? defaultIconName(assetId)
}

/** Reactive: the theme colour for an instrument (its default if unset). */
export function useInstrumentColor(assetId: string): string {
  const map = useSyncExternalStore(subscribe, () => currentColors, () => currentColors)
  return map[assetId] ?? defaultIconColor(assetId)
}
