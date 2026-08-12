import type { Collection } from './types'

/**
 * Help-centre collections - the top-level groupings shown on the help home, and
 * the reading lists on each collection page. `icon` is a Lucide icon name that
 * the UI resolves. Reorder freely; `articleSlugs` controls article order.
 */
export const COLLECTIONS: Collection[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    description: 'New to Underwrite? Start here - what it is, who it’s for, and the words you’ll see.',
    icon: 'Rocket',
    articleSlugs: [
      'what-is-underwrite',
      'underwrite-for-issuers',
      'underwrite-for-auditors',
      'key-concepts',
    ],
  },
  {
    slug: 'for-issuers',
    title: 'For issuers',
    description: 'Register instruments, back them with reserves, and manage compliance.',
    icon: 'Building2',
    articleSlugs: [
      'issuing-your-first-instrument',
      'backing-instruments-with-reserves',
      'compliance-controls',
      'the-issuer-console',
    ],
  },
  {
    slug: 'for-auditors',
    title: 'For auditors',
    description: 'Independently confirm that instruments are fully backed.',
    icon: 'ClipboardCheck',
    articleSlugs: [
      'verifying-reserves',
      'reading-reconciliation-reports',
    ],
  },
  {
    slug: 'concepts',
    title: 'Core concepts',
    description: 'The ideas behind reserves, backing, and on-chain settlement.',
    icon: 'BookOpen',
    articleSlugs: [
      'reserves-and-backing',
      'on-chain-settlement',
      'instruments-explained',
    ],
  },
]

/** Fast slug → collection lookup. */
export const COLLECTION_BY_SLUG: Record<string, Collection> = Object.fromEntries(
  COLLECTIONS.map(c => [c.slug, c] as const)
)
