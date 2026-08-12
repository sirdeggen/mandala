import type { Article } from './types'

/**
 * Help-centre articles. Edit freely - this file is the single source of truth
 * for article content. Each article is keyed by a URL-safe `slug`. Collections
 * (see collections.ts) reference these slugs to build their reading lists.
 */
export const ARTICLES: Article[] = [
  // ── Getting started ─────────────────────────────────────────────────────────
  {
    slug: 'what-is-underwrite',
    title: 'What is Underwrite?',
    summary: 'A plain-language overview of the platform and the problem it solves.',
    audience: [],
    updated: '2026-07-01',
    body: [
      { type: 'paragraph', text: 'Underwrite is a platform for issuing regulated, reserve-backed digital instruments - such as stablecoins and deposit tokens - and proving, at any moment, that every unit in circulation is fully backed.' },
      { type: 'paragraph', text: 'Traditional digital money asks holders to trust a monthly PDF attestation. Underwrite replaces that with continuous, on-chain reconciliation: the units you issue and the reserves that back them are tracked together, so backing can be verified in real time rather than after the fact.' },
      { type: 'heading', text: 'Who uses Underwrite' },
      { type: 'list', items: [
        'Issuers - licensed companies that create instruments, hold reserves against them, and manage who can transact.',
        'Auditors - the professionals who independently confirm that reserves match the amount issued.',
        'Holders - the people and businesses who receive and transfer instruments, and can see they are backed.',
      ] },
      { type: 'callout', tone: 'info', text: 'You do not need to understand blockchains to use Underwrite. The platform handles settlement; you work with instruments, reserves, and reports.' },
      { type: 'heading', text: 'What you get' },
      { type: 'list', items: [
        'Provable backing - reserves reconciled against issued units, not asserted in a report.',
        'Compliance built in - issuers control who can hold and transact, and can act on individual units when required.',
        'Near-zero settlement cost - transfers settle on-chain in seconds for a fraction of a cent.',
      ] },
    ],
  },
  {
    slug: 'underwrite-for-issuers',
    title: 'Underwrite for issuers',
    summary: 'What issuing on Underwrite looks like, end to end.',
    audience: ['issuer'],
    updated: '2026-07-01',
    body: [
      { type: 'paragraph', text: 'As an issuer you create instruments, connect the reserves that back them, and manage the rules for who can hold and move them - all from the issuer console.' },
      { type: 'heading', text: 'The lifecycle of an instrument' },
      { type: 'steps', items: [
        'Register the instrument. This mints a genesis record on-chain whose identifier becomes the instrument’s permanent asset ID.',
        'Connect a reserve. Link the bank or asset account that holds the value backing the instrument.',
        'Issue units into circulation. Each unit is reconciled against your reserves from the moment it exists.',
        'Operate. Manage holders, freeze or recover units when compliance requires it, and keep reserves in step with circulation.',
      ] },
      { type: 'callout', tone: 'info', text: 'The role you pick during onboarding personalises the console. It does not grant authority - issuing power is tied to your wallet identity.' },
      { type: 'paragraph', text: 'Every action leaves an auditable trail, so the auditors who verify your reserves are working from the same record you are.' },
    ],
  },
  {
    slug: 'underwrite-for-auditors',
    title: 'Underwrite for auditors',
    summary: 'How auditors independently verify that instruments are fully backed.',
    audience: ['auditor'],
    updated: '2026-07-01',
    body: [
      { type: 'paragraph', text: 'As an auditor you confirm that the reserves an issuer holds match the units they have put into circulation - and you can do this continuously, not just at period end.' },
      { type: 'heading', text: 'What you can verify' },
      { type: 'list', items: [
        'Total units in circulation for each instrument, read directly from the chain.',
        'The reserves declared against those units.',
        'Every issuance, transfer, and recovery event, in chronological order.',
      ] },
      { type: 'paragraph', text: 'Because circulation is recorded on-chain, you are not reliant on the issuer’s internal spreadsheet. You reconcile against an independent source and produce reports your firm can stand behind.' },
      { type: 'callout', tone: 'success', text: 'Continuous verification means a discrepancy surfaces when it happens - not weeks later in a quarterly review.' },
    ],
  },
  {
    slug: 'key-concepts',
    title: 'Key terms, defined',
    summary: 'A short glossary of the words you will see across Underwrite.',
    audience: [],
    updated: '2026-07-01',
    body: [
      { type: 'paragraph', text: 'A quick reference for the terms used throughout the product and this help centre.' },
      { type: 'list', items: [
        'Instrument - a class of digital money you issue, such as a euro deposit token. It has a name, a ticker, and a permanent asset ID.',
        'Unit - a single indivisible amount of an instrument in circulation.',
        'Reserve - the real-world value (a bank balance or asset account) held to back issued units.',
        'Backing - the state of every issued unit being matched by reserves. Full backing means reserves ≥ circulation.',
        'Reconciliation - comparing units in circulation against reserves to confirm backing.',
        'Asset ID - the permanent on-chain identifier created when an instrument is registered.',
        'Holder - anyone who holds units of an instrument.',
      ] },
    ],
  },

  // ── For issuers ─────────────────────────────────────────────────────────────
  {
    slug: 'issuing-your-first-instrument',
    title: 'Issuing your first instrument',
    summary: 'Register an instrument and put its first units into circulation.',
    audience: ['issuer'],
    updated: '2026-07-02',
    body: [
      { type: 'paragraph', text: 'Registering an instrument is the first step to issuing. It is quick, but it is permanent - the identifier it creates cannot be changed later.' },
      { type: 'steps', items: [
        'From the Instruments page, select Issue instrument.',
        'Give the instrument a name (e.g. “Euro Deposit Token”), a ticker (e.g. EUR), and the number of decimal places it uses.',
        'Confirm. Registering mints a genesis transaction on-chain; its outpoint becomes the instrument’s permanent asset ID.',
        'Once registered, issue units into circulation from the instrument’s page.',
      ] },
      { type: 'callout', tone: 'warning', text: 'Choose the ticker and decimals carefully. They are part of the instrument’s permanent identity and cannot be edited after registration.' },
      { type: 'paragraph', text: 'You can give each instrument a distinct icon so it is easy to tell apart at a glance. This is cosmetic and can be changed at any time.' },
    ],
  },
  {
    slug: 'backing-instruments-with-reserves',
    title: 'Backing instruments with reserves',
    summary: 'Connect reserves and keep them in step with circulation.',
    audience: ['issuer'],
    updated: '2026-07-02',
    body: [
      { type: 'paragraph', text: 'An instrument is only as trustworthy as the reserves behind it. Underwrite tracks the value you issue against the reserves you declare, so backing is always visible.' },
      { type: 'heading', text: 'Connecting a reserve' },
      { type: 'paragraph', text: 'From the Banking area, link the bank or asset account that holds the value backing an instrument. This becomes the reserve reconciled against that instrument’s circulation.' },
      { type: 'heading', text: 'Staying fully backed' },
      { type: 'list', items: [
        'Before issuing new units, make sure reserves cover the increase.',
        'When units are redeemed and removed from circulation, reserves can be released accordingly.',
        'Reconciliation runs continuously, so any gap between reserves and circulation is visible immediately.',
      ] },
      { type: 'callout', tone: 'success', text: 'Full backing - reserves at or above circulation - is the state auditors confirm and holders rely on.' },
    ],
  },
  {
    slug: 'compliance-controls',
    title: 'Compliance controls',
    summary: 'Manage who can hold and transact, and act on units when required.',
    audience: ['issuer'],
    updated: '2026-07-03',
    body: [
      { type: 'paragraph', text: 'Regulated issuance means controlling who participates. Underwrite gives issuers the tools to enforce their compliance obligations directly on the instrument.' },
      { type: 'heading', text: 'What you can control' },
      { type: 'list', items: [
        'Who may hold or receive units of an instrument.',
        'Freezing units associated with an address when required by law or investigation.',
        'Recovering or reissuing units in defined circumstances, such as a court order.',
      ] },
      { type: 'callout', tone: 'warning', text: 'These are powerful actions. Every one is recorded on-chain and appears in the ledger, so use is fully auditable.' },
      { type: 'paragraph', text: 'Controls are exercised per instrument, so different instruments can carry different rules.' },
    ],
  },
  {
    slug: 'the-issuer-console',
    title: 'Finding your way around the console',
    summary: 'A tour of the issuer console and where each task lives.',
    audience: ['issuer'],
    updated: '2026-07-03',
    body: [
      { type: 'paragraph', text: 'The console is organised around your instruments. Pick an instrument in the sidebar and the sections beneath it apply to that instrument.' },
      { type: 'list', items: [
        'Home / Instruments - see every instrument you issue and create new ones.',
        'Reserves - the treasury balance and reserves backing the selected instrument.',
        'Operations - issuance and the compliance controls for the selected instrument.',
        'Ledger - the full, ordered history of activity for the selected instrument.',
        'Banking - connect and manage the accounts that hold your reserves.',
      ] },
      { type: 'paragraph', text: 'Your account and settings live at the bottom of the sidebar. The section you are in and the instrument you have selected are both kept in the address, so a reload brings you back exactly where you were.' },
    ],
  },

  // ── For auditors ────────────────────────────────────────────────────────────
  {
    slug: 'verifying-reserves',
    title: 'Verifying reserves',
    summary: 'Reconcile issued units against declared reserves.',
    audience: ['auditor'],
    updated: '2026-07-04',
    body: [
      { type: 'paragraph', text: 'Verification comes down to one question: do the reserves cover everything in circulation? Underwrite gives you both figures from independent sources so you can answer it with confidence.' },
      { type: 'steps', items: [
        'Select the instrument you are reviewing.',
        'Read total circulation directly from the chain - the sum of all units issued and not redeemed.',
        'Compare it against the reserves declared for that instrument.',
        'Confirm reserves are at or above circulation, and note any exceptions.',
      ] },
      { type: 'callout', tone: 'info', text: 'Because circulation is read from the chain rather than the issuer’s records, your reconciliation rests on an independent source of truth.' },
    ],
  },
  {
    slug: 'reading-reconciliation-reports',
    title: 'Reading reconciliation reports',
    summary: 'What the ledger and reconciliation views show, and how to read them.',
    audience: ['auditor'],
    updated: '2026-07-04',
    body: [
      { type: 'paragraph', text: 'The ledger is the ordered history of everything that has happened to an instrument. It is the backbone of any report you produce.' },
      { type: 'heading', text: 'What each entry tells you' },
      { type: 'list', items: [
        'The event type - issuance, transfer, redemption, freeze, or recovery.',
        'The amount and the instrument affected.',
        'When it happened, in sequence, so nothing is hidden between reporting periods.',
      ] },
      { type: 'paragraph', text: 'Reconciliation pairs this history with reserve balances so you can show, for any point in time, that backing held. Discrepancies are surfaced rather than buried, so your report reflects the real state of the instrument.' },
    ],
  },

  // ── Core concepts ───────────────────────────────────────────────────────────
  {
    slug: 'reserves-and-backing',
    title: 'Reserves and backing, explained',
    summary: 'The relationship between issued units and the value behind them.',
    audience: [],
    updated: '2026-07-05',
    body: [
      { type: 'paragraph', text: 'Backing is the promise that every unit in circulation can be redeemed for the value it represents. Reserves are how that promise is kept.' },
      { type: 'paragraph', text: 'When an issuer puts units into circulation, they should hold reserves of at least equal value. As units are redeemed and retired, reserves can be released. Keeping the two in balance is what “fully backed” means.' },
      { type: 'callout', tone: 'success', text: 'Reserves ≥ circulation is the healthy state. Underwrite makes that comparison continuously so it is never a surprise.' },
    ],
  },
  {
    slug: 'on-chain-settlement',
    title: 'What “on-chain settlement” means for you',
    summary: 'Why settling on-chain makes backing provable and transfers cheap.',
    audience: [],
    updated: '2026-07-05',
    body: [
      { type: 'paragraph', text: 'Settling on-chain means transfers of an instrument are recorded on a public ledger as they happen. Two things follow from this.' },
      { type: 'list', items: [
        'Circulation is provable. Anyone reconciling the instrument can count what exists without asking the issuer.',
        'Transfers are fast and cheap. Settlement takes seconds and costs a fraction of a cent, regardless of amount.',
      ] },
      { type: 'paragraph', text: 'You interact with instruments, reserves, and reports - the settlement layer works underneath. You do not need to manage keys by hand or understand the mechanics to benefit from them.' },
    ],
  },
  {
    slug: 'instruments-explained',
    title: 'Instruments, units, and tickers',
    summary: 'How an instrument is structured and what its parts mean.',
    audience: [],
    updated: '2026-07-05',
    body: [
      { type: 'paragraph', text: 'An instrument is a class of digital money you issue - for example, a euro deposit token. Everything issued under it shares the same identity and backing.' },
      { type: 'list', items: [
        'Name - the human-readable label, e.g. “Euro Deposit Token”.',
        'Ticker - a short symbol, e.g. EUR, used in listings and reports.',
        'Decimals - how finely a unit can be divided.',
        'Asset ID - the permanent on-chain identifier assigned at registration.',
      ] },
      { type: 'paragraph', text: 'A unit is a single amount of an instrument. Holders send and receive units; issuers create and, where permitted, retire them; auditors count them.' },
      { type: 'callout', tone: 'warning', text: 'Name, ticker, and decimals are set at registration and become part of the instrument’s permanent identity.' },
    ],
  },
]

/** Fast slug → article lookup. */
export const ARTICLE_BY_SLUG: Record<string, Article> = Object.fromEntries(
  ARTICLES.map(a => [a.slug, a] as const)
)
