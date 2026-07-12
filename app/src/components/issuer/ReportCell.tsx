import type { ReactNode } from 'react'
import { IdentityKeyPopover } from './IdentityKeyPopover'

const looksLikeKey = (v: string) => /^[0-9a-f]{16,}$/i.test(v)
const trunc = (k: string) => (k.length > 12 ? `${k.slice(0, 5)}…${k.slice(-5)}` : k)

/** Columns that hold an identity key (get a sigil + relationship popover). */
export function isIdColumn(column: string): boolean {
  return column === 'From' || column === 'To' || /badge id$/i.test(column)
}
const isAnchorColumn = (column: string) => column === 'Anchor'

/** Columns that read better without wrapping (dates, keys, hashes). */
export function isNowrapColumn(column: string): boolean {
  if (isIdColumn(column) || isAnchorColumn(column)) return true
  const c = column.toLowerCase()
  return c.includes('hash') || /\b(when|requested|reviewed|processed|updated|created|generated|date)\b/.test(c)
}

/** Highlight case-insensitive matches of `query` within `text`. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.toLowerCase()
  if (q === '' || !text.toLowerCase().includes(q)) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let n = 0
  for (;;) {
    const at = lower.indexOf(q, from)
    if (at === -1) { parts.push(text.slice(from)); break }
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={n++} className="rounded-sm bg-warning/40 px-0.5 text-foreground">{text.slice(at, at + q.length)}</mark>)
    from = at + q.length
  }
  return <>{parts}</>
}

/**
 * One report-table cell. Identity keys (From / To / Badge ID / Holder) render as
 * a sigil + first-5-last-5 truncation with the full key on hover; transaction
 * hashes truncate the same way; everything else is plain text. Underlying data
 * stays full for export.
 */
export function ReportCell({ column, value, query = '' }: { column: string; value: string; query?: string }) {
  if (isIdColumn(column) && looksLikeKey(value)) {
    return <IdentityKeyPopover value={value} />
  }
  if ((column.toLowerCase().includes('hash') || isAnchorColumn(column)) && value !== '') {
    return <span className="font-mono text-[11px] text-subtle-foreground" title={value}><Highlight text={trunc(value)} query={query} /></span>
  }
  return <Highlight text={value} query={query} />
}
