/**
 * Content for the first-run product tour, split out so it can be edited without
 * touching the tour machinery. One path per onboarding role (issuer, auditor,
 * individual); each step can navigate to a route and ring-highlight an element
 * marked with a matching `data-tour-id`.
 *
 * Keep copy short (a step card is ~340px wide) and free of em dashes.
 * `{asset}` in a route is replaced at runtime with the instrument currently in
 * the URL, or the first available instrument; steps flagged `needsAsset` fall
 * back to the instruments list when the user has no instrument yet.
 */
import type { OnboardingRole } from './onboarding'

export interface TourStep {
  id: string
  title: string
  description: string
  /** Button label. Tapping it marks the step done (and finishes on the last). */
  action: string
  /** Route to navigate to when the step is opened. May contain `{asset}`. */
  route?: string
  /** `data-tour-id` of the element to highlight on the target page. */
  highlight?: string
  /** Route needs an instrument id; softened to the instruments list if none. */
  needsAsset?: boolean
}

export interface TourPath {
  /** Title shown in the collapsed pill and the pane header. */
  title: string
  /** One-line framing shown under the header. */
  intro: string
  steps: TourStep[]
}

const ISSUER: TourPath = {
  title: 'Getting started',
  intro: 'Issue and administer a reserve-backed stablecoin, live on chain.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Underwrite',
      description: 'Your console for issuing and administering a fully reserve-backed stablecoin. Everything here settles live on chain.',
      action: 'Start',
    },
    {
      id: 'templates',
      title: 'Pick an instrument template',
      description: 'Start from a template (fiat stablecoin, deposit token, e-money and more) or from scratch. Each is reserve-backed and auditor-ready from day one.',
      action: 'Got it',
      route: '/issuer/home',
      highlight: 'instrument-templates',
    },
    {
      id: 'reserves',
      title: 'Fund reserves and mint',
      description: 'Record incoming reserve deposits, then mint against them with maker-checker sign-off. Every unit issued is backed 1:1 on chain.',
      action: 'Got it',
      route: '/issuer/instrument?asset={asset}&tab=banking',
      highlight: 'instrument-tabs',
      needsAsset: true,
    },
    {
      id: 'controls',
      title: 'Enforce compliance controls',
      description: 'Screen holders, sanction entities, freeze holdings and set access rules. Controls are enforced on chain by the overlay, not just in the UI.',
      action: 'Got it',
      route: '/issuer/instrument?asset={asset}&tab=sanctions',
      highlight: 'instrument-tabs',
      needsAsset: true,
    },
    {
      id: 'attestations',
      title: 'Get audited',
      description: 'Publish reserve attestations for your auditor to review and sign. A signed attestation is anchored on chain as proof of backing.',
      action: 'Got it',
      route: '/issuer/instrument?asset={asset}&tab=attestations',
      highlight: 'instrument-tabs',
      needsAsset: true,
    },
    {
      id: 'reports',
      title: 'Export regulator-ready reports',
      description: 'Generate reserve, redemption, control-action and holder reports for regulators and auditors, each anchored to on-chain evidence.',
      action: 'Got it',
      route: '/issuer/reports',
      highlight: 'nav-reports',
    },
    {
      id: 'transparency',
      title: 'Prove your reserves publicly',
      description: 'Share a public proof-of-reserves page so anyone can verify your backing in real time, without having to trust you.',
      action: 'Got it',
      route: '/transparency',
      highlight: 'transparency-hero',
    },
    {
      id: 'done',
      title: 'You are set up',
      description: 'That is the core loop: issue, back, control, attest and prove. You can reopen this tour any time from Account settings.',
      action: 'Finish',
    },
  ],
}

const AUDITOR: TourPath = {
  title: 'Getting started',
  intro: 'Find instruments, verify reserves and sign attestations.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome, auditor',
      description: 'You sign in with your own identity key. Discover the instruments you audit, watch them, and verify their backing on chain.',
      action: 'Start',
    },
    {
      id: 'discover',
      title: 'Find instruments',
      description: 'Every instrument live on the overlay, grouped by issuing entity. Read straight from public on-chain data, whatever wallet you use.',
      action: 'Got it',
      route: '/reviewer/discover',
      highlight: 'nav-discover',
    },
    {
      id: 'watch',
      title: 'Watch what you audit',
      description: 'Add the instruments you review to your watchlist and they stay one click away in the sidebar.',
      action: 'Got it',
      route: '/reviewer/discover',
      highlight: 'watchlist',
    },
    {
      id: 'attestations',
      title: 'Review and sign attestations',
      description: 'Open a watched instrument and use its Attestations tab to check reserves against circulation, then sign with your wallet. Your signature is anchored on chain.',
      action: 'Got it',
      route: '/reviewer/discover',
    },
    {
      id: 'transparency',
      title: 'Public proof of reserves',
      description: 'The same figures are published publicly, so the market can verify backing alongside your attestation.',
      action: 'Got it',
      route: '/transparency',
      highlight: 'transparency-hero',
    },
    {
      id: 'done',
      title: 'You are set up',
      description: 'Discover, watch, verify and sign, all against on-chain truth. You can reopen this tour any time from Account settings.',
      action: 'Finish',
    },
  ],
}

const INDIVIDUAL: TourPath = {
  title: 'Getting started',
  intro: 'Check any instrument’s backing, in real time and on chain.',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Underwrite',
      description: 'See how an instrument is backed and administered, in real time and verifiable on chain, with your own identity key.',
      action: 'Start',
    },
    {
      id: 'discover',
      title: 'Find instruments',
      description: 'Browse every instrument live on the overlay, grouped by issuing entity, with live supply figures.',
      action: 'Got it',
      route: '/reviewer/discover',
      highlight: 'nav-discover',
    },
    {
      id: 'watch',
      title: 'Watch the ones you hold',
      description: 'Add instruments to your watchlist and they stay one click away in the sidebar. Open one to inspect reserves and 1:1 backing.',
      action: 'Got it',
      route: '/reviewer/discover',
      highlight: 'watchlist',
    },
    {
      id: 'transparency',
      title: 'Verify reserves yourself',
      description: 'The public proof-of-reserves page lets anyone confirm backing without trusting the issuer.',
      action: 'Got it',
      route: '/transparency',
      highlight: 'transparency-hero',
    },
    {
      id: 'help',
      title: 'Learn more',
      description: 'The guides explain how issuance, reserves and attestations work on Underwrite.',
      action: 'Got it',
      route: '/help',
    },
    {
      id: 'done',
      title: 'You are set up',
      description: 'Browse, inspect and verify, any time. You can reopen this tour from Account settings.',
      action: 'Finish',
    },
  ],
}

export const TOUR_PATHS: Record<OnboardingRole, TourPath> = {
  issuer: ISSUER,
  auditor: AUDITOR,
  individual: INDIVIDUAL,
}

/** Fill a step's `{asset}` token; falls back to the instruments list when the
 *  step needs an instrument but none is available yet. */
export function resolveRoute(step: TourStep, assetId: string | null): string | undefined {
  if (step.route == null) return undefined
  if (step.route.includes('{asset}')) {
    if (assetId == null || assetId === '') return '/issuer/overview'
    return step.route.replace('{asset}', encodeURIComponent(assetId))
  }
  return step.route
}
