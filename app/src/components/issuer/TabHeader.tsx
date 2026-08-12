import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'

/**
 * Shared header for an instrument tab: a short headline, a one-line description,
 * and an optional right-aligned "Learn more" pill that links into the help
 * centre. Keeps every tab's top matter consistent.
 */
export default function TabHeader({ title, description, guide }: {
  title: string
  description: string
  /** Help-centre path, e.g. "/help/for-issuers/compliance-controls". */
  guide?: string
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        <p className="mt-0.5 text-balance text-[13.5px] text-muted-foreground">{description}</p>
      </div>
      {guide != null && (
        <Link
          to={guide}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Learn more
          <ArrowUpRight className="size-3.5" />
        </Link>
      )}
    </div>
  )
}
