/**
 * Structural checks that the shipped UI/pipeline modules wire the pure
 * single-flight / admin-auth / submit guards — not parallel reimplementations.
 * Reads source as the verifier's static CTA bar.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function src(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('robustness wiring (shipped source)', () => {
  it('SendTokens blocks re-entry with sync ref, sendFlight, and pending disable', () => {
    const s = src('components/SendTokens.tsx')
    expect(s).toContain('sendStartedRef')
    expect(s).toContain('sendFlight')
    expect(s).toContain('guardSendSubmit')
    expect(s).toContain('sendMutation.isPending')
    expect(s).toContain('BusyError')
    // Confirm CTA must not rely only on setStep('sending') for double-click.
    expect(s).toMatch(/disabled=\{[\s\S]*sendMutation\.isPending/)
  })

  it('useSendMutation acquires sendFlight before optimistic write', () => {
    const s = src('hooks/useSendMutation.ts')
    expect(s).toContain('sendFlight.tryAcquire')
    expect(s).toContain('BusyError')
    expect(s).toContain('guardPositiveAmount')
    expect(s).toContain('sendFlight.release')
  })

  it('issuerOps + submitAdminAction share withAdminAuthGate', () => {
    const issue = src('lib/mandala/issuerOps.ts')
    const assets = src('lib/mandala/assets.ts')
    expect(issue).toContain('withAdminAuthGate')
    expect(issue).toContain('assertSpendablePrior')
    expect(assets).toContain('withAdminAuthGate')
    expect(assets).toContain('assertSpendablePrior')
  })

  it('IssuerPanel and RegisterAssetStrip use sync re-entry refs + guards', () => {
    const panel = src('components/IssuerPanel.tsx')
    const reg = src('components/issuer/RegisterAssetStrip.tsx')
    expect(panel).toContain('issueStartedRef')
    expect(panel).toContain('redeemStartedRef')
    expect(panel).toContain('guardIssueSubmit')
    expect(panel).toContain('guardRedeemSubmit')
    expect(panel).toContain('isAdminAuthInFlight')
    expect(reg).toContain('startedRef')
    expect(reg).toContain('registerFlight')
    expect(reg).toContain('guardRegisterSubmit')
  })

  it('RegulatoryControls uses busyRef + admin field guards', () => {
    const s = src('components/issuer/RegulatoryControls.tsx')
    expect(s).toContain('busyRef')
    expect(s).toContain('guardAdminFields')
    expect(s).toContain('isAdminAuthInFlight')
    expect(s).toContain('BusyError')
    expect(s).toMatch(/if \(busyRef\.current\) return/)
  })

  it('useIssuerMutations wraps register in registerFlight and pre-gates amounts', () => {
    const s = src('hooks/useIssuerMutations.ts')
    expect(s).toContain('registerFlight.run')
    expect(s).toContain('guardIssueSubmit')
    expect(s).toContain('guardRedeemSubmit')
    expect(s).toContain('guardRegisterSubmit')
  })

  it('reconcile still prioritizes accepted rebroadcast and skips sweep while accepted', () => {
    const s = src('lib/mandala/reconcile.ts')
    expect(s).toContain("entry.stage === 'accepted'")
    expect(s).toContain('broadcastAcceptedTx')
    expect(s).toContain("stage === 'accepted'")
    expect(s).toMatch(/if \(!journalList\(\)\.some\(e => e\.stage === 'accepted'\)\)/)
  })

  it('txJournal stages remain only accepted | abort', () => {
    const s = src('lib/mandala/txJournal.ts')
    expect(s).toContain("stage: 'accepted' | 'abort'")
    expect(s).not.toMatch(/stage:.*pending/)
  })
})
