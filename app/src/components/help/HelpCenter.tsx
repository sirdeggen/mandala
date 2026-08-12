import { useState } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import {
  Rocket, Building2, ClipboardCheck, BookOpen, LifeBuoy,
  Search, ArrowRight, ArrowLeft, ChevronRight, Info, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/ui/BrandMark'
import { Input } from '@/components/ui/input'
import {
  getCollections, getCollection, getArticle, getArticlesFor,
  getCollectionForArticle, searchArticles,
} from '@/content/help'
import type { Article, ArticleBlock, Audience, Collection } from '@/content/help'
import { cn } from '@/lib/utils'

// ── Icon + audience helpers ───────────────────────────────────────────────────

const COLLECTION_ICONS: Record<string, LucideIcon> = {
  Rocket, Building2, ClipboardCheck, BookOpen,
}
function collectionIcon(name: string): LucideIcon {
  return COLLECTION_ICONS[name] ?? LifeBuoy
}

const AUDIENCE_LABEL: Record<Audience, string> = { issuer: 'Issuers', auditor: 'Auditors' }

function AudienceBadges({ audience }: { audience: Audience[] }) {
  if (audience.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {audience.map(a => (
        <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {AUDIENCE_LABEL[a]}
        </span>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Shared shell ──────────────────────────────────────────────────────────────

function HelpShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen w-full bg-muted text-foreground">
      {/* White top bar with rounded bottom corners, floating on the grey canvas */}
      <header className="rounded-b-2xl border-b border-border bg-card shadow-[var(--shadow-card)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 lg:px-10">
          <Link to="/help" aria-label="Help centre home">
            <BrandMark size="md" wordmark sublabel="HELP CENTRE" />
          </Link>
          <Link to="/" className="text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground">
            Back to app
          </Link>
        </div>
      </header>
      <main className={cn('mx-auto w-full px-6 pb-24 pt-10 lg:px-10', wide ? 'max-w-5xl' : 'max-w-3xl')}>
        {children}
      </main>
    </div>
  )
}

function Breadcrumb({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3.5 text-faint-foreground" />}
          {c.to != null ? (
            <Link to={c.to} className="transition-colors hover:text-foreground">{c.label}</Link>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

// ── Home ──────────────────────────────────────────────────────────────────────

export function HelpHome() {
  const [query, setQuery] = useState('')
  const collections = getCollections()
  const results = searchArticles(query)
  const searching = query.trim() !== ''

  return (
    <HelpShell wide>
      <div className="mx-auto max-w-2xl pt-6 text-center">
        <h1 className="display text-[34px] font-medium leading-tight tracking-[-0.02em]">How can we help?</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Guides and answers for issuing and auditing on Underwrite.
        </p>
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search for a topic…"
            className="h-12 pl-10 text-[15px]"
            aria-label="Search help articles"
          />
        </div>
      </div>

      {searching ? (
        <div className="mx-auto mt-10 max-w-2xl">
          <p className="mb-3 text-[13px] text-muted-foreground">
            {results.length === 0 ? 'No articles match your search.' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            {results.map((a, i) => (
              <ArticleRow key={a.slug} article={a} divider={i > 0} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {collections.map(c => (
            <CollectionCard key={c.slug} collection={c} />
          ))}
        </div>
      )}
    </HelpShell>
  )
}

function CollectionCard({ collection }: { collection: Collection }) {
  const Icon = collectionIcon(collection.icon)
  const count = collection.articleSlugs.length
  return (
    <Link
      to={`/help/${collection.slug}`}
      className="group flex gap-4 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-muted-foreground"
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
        <Icon className="size-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium text-foreground">{collection.title}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">{collection.description}</p>
        <p className="mt-3 text-[12px] font-medium text-faint-foreground">{count} article{count === 1 ? '' : 's'}</p>
      </div>
    </Link>
  )
}

// ── Collection ────────────────────────────────────────────────────────────────

export function HelpCollectionView() {
  const { collectionSlug = '' } = useParams()
  const collection = getCollection(collectionSlug)
  if (collection == null) return <Navigate to="/help" replace />
  const articles = getArticlesFor(collection)
  const Icon = collectionIcon(collection.icon)

  return (
    <HelpShell>
      <Breadcrumb trail={[{ label: 'Help centre', to: '/help' }, { label: collection.title }]} />

      <div className="flex items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          <Icon className="size-6" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="display text-[26px] font-medium leading-tight tracking-[-0.01em]">{collection.title}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{collection.description}</p>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
        {articles.map((a, i) => (
          <ArticleRow key={a.slug} article={a} divider={i > 0} />
        ))}
      </div>
    </HelpShell>
  )
}

function ArticleRow({ article, divider }: { article: Article; divider?: boolean }) {
  const collection = getCollectionForArticle(article.slug)
  const to = collection != null ? `/help/${collection.slug}/${article.slug}` : `/help`
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent',
        divider && 'border-t border-border'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-foreground">{article.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{article.summary}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-faint-foreground transition-colors group-hover:text-foreground" />
    </Link>
  )
}

// ── Article ───────────────────────────────────────────────────────────────────

export function HelpArticleView() {
  const { collectionSlug = '', articleSlug = '' } = useParams()
  const article = getArticle(articleSlug)
  const collection = getCollection(collectionSlug)
  if (article == null || collection == null) return <Navigate to="/help" replace />

  const siblings = getArticlesFor(collection).filter(a => a.slug !== article.slug)

  return (
    <HelpShell>
      <Breadcrumb trail={[
        { label: 'Help centre', to: '/help' },
        { label: collection.title, to: `/help/${collection.slug}` },
        { label: article.title },
      ]} />

      <article>
        <header className="mb-8">
          <h1 className="display text-[30px] font-medium leading-tight tracking-[-0.02em]">{article.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
            <span>Updated {formatDate(article.updated)}</span>
            <AudienceBadges audience={article.audience} />
          </div>
        </header>

        <div className="space-y-5">
          {article.body.map((block, i) => <Block key={i} block={block} />)}
        </div>
      </article>

      {siblings.length > 0 && (
        <div className="mt-14 border-t border-border pt-8">
          <p className="mb-3 text-[13px] font-semibold text-foreground">More in {collection.title}</p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            {siblings.map((a, i) => <ArticleRow key={a.slug} article={a} divider={i > 0} />)}
          </div>
        </div>
      )}

      <Link
        to={`/help/${collection.slug}`}
        className="mt-8 inline-flex items-center gap-2 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {collection.title}
      </Link>
    </HelpShell>
  )
}

// ── Block renderer ────────────────────────────────────────────────────────────

const CALLOUT_STYLES = {
  info: { wrap: 'border-border bg-muted/60', Icon: Info, icon: 'text-muted-foreground' },
  success: { wrap: 'border-success/30 bg-success/5', Icon: CheckCircle2, icon: 'text-success' },
  warning: { wrap: 'border-warning/30 bg-warning/5', Icon: AlertTriangle, icon: 'text-warning' },
} as const

function Block({ block }: { block: ArticleBlock }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="pt-2 text-[19px] font-semibold tracking-[-0.01em] text-foreground">{block.text}</h2>
    case 'paragraph':
      return <p className="text-[15.5px] leading-relaxed text-foreground/90">{block.text}</p>
    case 'list':
      return block.ordered ? (
        <ol className="list-decimal space-y-2 pl-5 text-[15.5px] leading-relaxed text-foreground/90 marker:text-muted-foreground">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      ) : (
        <ul className="list-disc space-y-2 pl-5 text-[15.5px] leading-relaxed text-foreground/90 marker:text-faint-foreground">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )
    case 'steps':
      return (
        <ol className="space-y-3">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">{i + 1}</span>
              <span className="pt-0.5 text-[15.5px] leading-relaxed text-foreground/90">{it}</span>
            </li>
          ))}
        </ol>
      )
    case 'callout': {
      const style = CALLOUT_STYLES[block.tone ?? 'info']
      const { Icon } = style
      return (
        <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3.5', style.wrap)}>
          <Icon className={cn('mt-0.5 size-[18px] shrink-0', style.icon)} strokeWidth={2} />
          <p className="text-[14px] leading-relaxed text-foreground/90">{block.text}</p>
        </div>
      )
    }
  }
}
