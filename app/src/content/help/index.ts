/**
 * Help-centre content API. The UI imports only from here, so the underlying data
 * (currently static `.ts` files) can later be swapped for a CMS or database
 * without touching a single component.
 */
import type { Article, Collection } from './types'
import { COLLECTIONS, COLLECTION_BY_SLUG } from './collections'
import { ARTICLES, ARTICLE_BY_SLUG } from './articles'

export type { Article, Collection, ArticleBlock, Audience } from './types'
export { COLLECTIONS } from './collections'
export { ARTICLES } from './articles'

/** Every collection, in display order. */
export function getCollections(): Collection[] {
  return COLLECTIONS
}

export function getCollection(slug: string): Collection | undefined {
  return COLLECTION_BY_SLUG[slug]
}

export function getArticle(slug: string): Article | undefined {
  return ARTICLE_BY_SLUG[slug]
}

/** Resolve a collection's article slugs to full articles, preserving order and
 *  silently dropping any slug with no matching article. */
export function getArticlesFor(collection: Collection): Article[] {
  return collection.articleSlugs
    .map(slug => ARTICLE_BY_SLUG[slug])
    .filter((a): a is Article => a != null)
}

/** The collection an article belongs to (the first that references it). */
export function getCollectionForArticle(slug: string): Collection | undefined {
  return COLLECTIONS.find(c => c.articleSlugs.includes(slug))
}

/** Case-insensitive search across titles and summaries. */
export function searchArticles(query: string): Article[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  return ARTICLES.filter(a =>
    a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q)
  )
}
