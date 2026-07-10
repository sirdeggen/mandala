/**
 * Help-centre content model. Everything the help centre renders comes from the
 * sibling `collections.ts` / `articles.ts` data files - no content lives in the
 * components. Keep this a plain, serialisable shape so it can later be moved to
 * a CMS or database with no change to the UI.
 */

export type Audience = 'issuer' | 'auditor'

/** A block of article body. A tiny, deliberately-small set that renders without
 *  a Markdown parser and keeps authored content structured and typed. */
export type ArticleBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone?: 'info' | 'success' | 'warning'; text: string }

export interface Article {
  slug: string
  title: string
  /** One-line summary shown in listings and search. */
  summary: string
  /** Who the article is primarily written for (empty = everyone). */
  audience: Audience[]
  /** ISO date (YYYY-MM-DD) of the last meaningful edit. */
  updated: string
  body: ArticleBlock[]
}

export interface Collection {
  slug: string
  title: string
  description: string
  /** Lucide icon name (resolved in the UI). */
  icon: string
  /** Article slugs, in the order they should appear. */
  articleSlugs: string[]
}
