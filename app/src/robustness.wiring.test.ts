/**
 * Structural checks that the shipped UI/pipeline modules wire the pure
 * single-flight / admin-auth / submit guards — not parallel reimplementations.
 * Reads source as the verifier's static CTA bar.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives at app/src/; app modules resolve against it, the extracted
// @bsv/mandala package sources live at <repo>/lib/src.
const appSrc = dirname(fileURLToPath(import.meta.url))
const libSrc = resolve(appSrc, '../../lib/src')

function src(rel: string): string {
  return readFileSync(resolve(appSrc, rel), 'utf8')
}

function lib(rel: string): string {
  return readFileSync(resolve(libSrc, rel), 'utf8')
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

  it('issuerOps + submitAdminAction share withAdminAuthGate; redeem asserts prior before FT load', () => {
    const issue = lib('issuerOps.ts')
    const assets = lib('assets.ts')
    const ftc = lib('ftCandidates.ts')
    expect(issue).toContain('withAdminAuthGate')
    expect(issue).toContain('assertSpendablePrior')
    expect(assets).toContain('withAdminAuthGate')
    expect(assets).toContain('assertSpendablePrior')
    // redeemTokens fails fast on a stale prior via loadFtCandidates'
    // requireSpendable, which asserts against the first basket listing —
    // before the heavier BEEF/listActions work (skeptic gap).
    const redeemFn = issue.slice(issue.indexOf('export async function redeemTokens'))
    expect(redeemFn).toContain('requireSpendable')
    expect(redeemFn).toContain('guardRedeemSubmit')
    expect(ftc).toContain('assertSpendablePrior')
    const assertIdx = ftc.indexOf('assertSpendablePrior(')
    const beefIdx = ftc.indexOf("include: 'entire transactions'")
    expect(assertIdx).toBeGreaterThan(-1)
    expect(beefIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeLessThan(beefIdx)
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

  it('useIssuerMutations redeem passes holder-cache balance into guard + redeemTokens', () => {
    const s = src('hooks/useIssuerMutations.ts')
    // Mutation boundary must not omit balance (skeptic gap)
    expect(s).toMatch(/guardRedeemSubmit\(\{[\s\S]*balance/)
    expect(s).toMatch(/redeemTokens\(\{[\s\S]*balance/)
    expect(s).toContain('qc.getQueryData<HolderData>(holderKey)')
  })

  it('redeem gates on the PRE-decrement balance (react-query awaits onMutate before mutationFn)', () => {
    const s = src('hooks/useIssuerMutations.ts')
    const redeemBlock = s.slice(s.indexOf('const redeem = useMutation'))
    // The optimistic decrement must not live in onMutate — that runs before
    // mutationFn, so the balance gate would compare against balance-minus-amount
    // and refuse any redeem above half (redeem-all impossible).
    expect(redeemBlock).not.toMatch(/onMutate\s*:/)
    const guardIdx = redeemBlock.indexOf('guardRedeemSubmit(')
    const adjustIdx = redeemBlock.indexOf('adjustBalance(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(adjustIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(adjustIdx)
  })

  it('reconcile prioritizes accepted rebroadcast; sweep blocked by accepted + fresh intents', () => {
    const s = lib('reconcile.ts')
    expect(s).toContain("entry.stage === 'accepted'")
    expect(s).toContain('broadcastAcceptedTx')
    // Sweep must stay away while an overlay-accepted tx awaits broadcast OR a
    // live pipeline's intent marker is fresh.
    expect(s).toMatch(/e\.stage === 'accepted' \|\|[\s\S]*e\.stage === 'intent'/)
    expect(s).toContain('INTENT_TTL_MS')
    // Cross-tab: the whole pass runs under a web lock.
    expect(s).toContain("tryWithLock('mandala.reconcile'")
    // Failed aborts are retained (attempts++), not dropped on first failure.
    expect(s).toContain('ABORT_RETRY_CAP')
  })

  it('txJournal stages are intent | accepted | abort with per-entry atomic keys', () => {
    const s = lib('txJournal.ts')
    expect(s).toContain("stage: 'intent' | 'accepted' | 'abort'")
    expect(s).toContain("'mandala.txJournal.'") // per-entry key prefix
    expect(s).not.toMatch(/stage:.*pending/)
  })

  it('pipelines run under intent markers and cross-tab locks', () => {
    const transfer = lib('transfer.ts')
    const issuer = lib('issuerOps.ts')
    const assets = lib('assets.ts')
    expect(transfer).toContain('journalIntentBegin')
    expect(transfer).toContain("tryWithLock('mandala.send'")
    expect(issuer.match(/withIntent\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(assets).toContain('withIntent(')
    expect(lib('adminAuthGate.ts')).toContain('tryWithLock(`mandala.admin.')
  })

  it('receive verifies the transaction against the message body before internalizing', () => {
    const s = lib('receive.ts')
    expect(s).toContain('verifyIncoming(msg)')
    expect(s).toContain('InvalidTransferError')
    expect(s).toContain('isAlreadyInternalized')
  })

  it('transfer journals the recipient notification before sending it', () => {
    const transfer = lib('transfer.ts')
    expect(transfer).toContain('notifyPut(')
    expect(transfer).toContain('notifyRemove(')
    const putIdx = transfer.indexOf('notifyPut(')
    const sendIdx = transfer.indexOf('messageBoxClient.sendMessage', putIdx)
    expect(putIdx).toBeGreaterThan(-1)
    expect(sendIdx).toBeGreaterThan(putIdx)
  })
})
