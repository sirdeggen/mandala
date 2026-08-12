/**
 * In-app hero walkthrough. A dismissible panel that tracks the demo narrative
 * (authorise, issue against reserves, enforce controls, attest, redeem, prove
 * on-chain) with deep links, so a presenter or a self-serve evaluator can follow
 * the story in order. Toggled from the Developer panel.
 */
import { useNavigate } from 'react-router-dom'
import { Check, X, ArrowRight } from 'lucide-react'
import { useDemoGuide, setGuideOpen, toggleGuideStep } from '../../lib/demoGuide'
import { cn } from '@/lib/utils'

interface Step { id: string; title: string; hint: string; go: () => void; goLabel: string }

export default function DemoChecklist() {
  const { open, done } = useDemoGuide()
  const navigate = useNavigate()
  if (!open) return null

  const steps: Step[] = [
    { id: 'authorise', title: 'Get authorised', hint: 'Connect FINMA under Integrations so the Badge may issue stablecoins.', go: () => navigate('/issuer/integrations'), goLabel: 'Integrations' },
    { id: 'register', title: 'Register the CHF instrument', hint: 'Issue a CHF-pegged token from a template on the Instruments page.', go: () => navigate('/issuer/overview'), goLabel: 'Instruments' },
    { id: 'mint', title: 'Fund reserves, approve the mint', hint: 'Open the instrument, add a reserve deposit on Reserves, then approve the mint request.', go: () => navigate('/issuer/overview'), goLabel: 'Instruments' },
    { id: 'enforce', title: 'Enforce a control', hint: 'Review a monitoring alert on Compliance, then freeze or ban the flagged party.', go: () => navigate('/issuer/compliance'), goLabel: 'Compliance' },
    { id: 'attest', title: 'Sign the reserve attestation', hint: 'On the instrument’s Attestations tab, sign the period attestation and anchor it on-chain.', go: () => navigate('/issuer/overview'), goLabel: 'Instruments' },
    { id: 'redeem', title: 'Redeem at par', hint: 'Settle a redemption at par on Issuance & redemption; units burn on-chain.', go: () => navigate('/issuer/overview'), goLabel: 'Instruments' },
    { id: 'prove', title: 'Show proof of reserves', hint: 'Open the public transparency page and verify a signed attestation on-chain.', go: () => window.open('/transparency', '_blank'), goLabel: 'Open page' },
  ]

  const completed = steps.filter(s => done.includes(s.id)).length

  return (
    <div className="fixed bottom-3 left-3 z-50 flex max-h-[80vh] w-[min(92vw,340px)] flex-col rounded-2xl border border-border bg-popover shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-[13.5px] font-semibold text-foreground">Demo walkthrough</div>
          <div className="text-[11.5px] text-muted-foreground">{completed} of {steps.length} steps</div>
        </div>
        <button type="button" onClick={() => setGuideOpen(false)} aria-label="Hide walkthrough" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {steps.map((s, i) => {
          const isDone = done.includes(s.id)
          return (
            <div key={s.id} className="flex items-start gap-2.5 rounded-lg p-2">
              <button
                type="button"
                onClick={() => toggleGuideStep(s.id)}
                aria-pressed={isDone}
                aria-label={isDone ? 'Mark step not done' : 'Mark step done'}
                className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors', isDone ? 'border-success bg-success text-white' : 'border-input-border text-transparent hover:border-muted-foreground')}
              >
                {isDone ? <Check className="size-3" strokeWidth={3} /> : <span className="text-[10px] font-semibold text-muted-foreground">{i + 1}</span>}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn('text-[12.5px] font-medium', isDone ? 'text-muted-foreground line-through' : 'text-foreground')}>{s.title}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{s.hint}</div>
                <button type="button" onClick={s.go} className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline">
                  {s.goLabel} <ArrowRight className="size-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
