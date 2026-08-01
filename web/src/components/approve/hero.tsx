'use client'

import type { Policy } from '@/lib/api'
import { Countdown, Guardrail, Money, PolicyChip } from '@/components/ui'
import { money } from '@/lib/format'
import { CurrencyPicker, FxLine } from './fx'
import type { MemberView } from './model'
import { ItemLines, RequoteNote } from './states'

/**
 * The drunk-friend test: one glance answers what you are paying, to whom,
 * capped at what. Everything else on this page is subordinate to the number.
 */
export function ShareHero({
  v,
  policy,
  display,
  onDisplay,
  previous,
  requoteReason,
}: {
  v: MemberView
  policy: Policy | null
  display: string
  onDisplay: (next: string) => void
  previous: number | null
  requoteReason: string | null
}) {
  const cur = v.group.currency
  const requoted = v.requote_round > 0

  return (
    <section className="card ap-flip" aria-label="Your share">
      <div style={{ padding: '14px 16px 0' }}>
        {requoted && (
          <RequoteNote
            round={v.requote_round}
            from={previous}
            to={v.share_amount}
            currency={cur}
            reason={requoteReason}
          />
        )}
      </div>

      <div className="ap-hero">
        <div className="eyebrow">{requoted ? 'Your new share' : 'Your share'}</div>
        <div style={{ margin: '10px 0 2px' }}>
          {requoted && previous != null && (
            <div className="amount muted ap-strike" style={{ fontSize: 16, marginBottom: 2 }}>
              {money(previous, cur)}
            </div>
          )}
          <Money minor={v.share_amount} currency={cur} size="xl" />
        </div>
        <div className="small muted">
          of <span className="amount">{money(v.group.total, cur)}</span> at <b>{v.group.merchant.name}</b>
        </div>
        <FxLine minor={v.share_amount} fx={v.fx} currency={cur} display={display} />
        <CurrencyPicker fx={v.fx} currency={cur} value={display} onChange={onDisplay} />
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <ItemLines items={v.my_items} currency={cur} />

        <div style={{ marginTop: 16 }}>
          <Guardrail merchant={v.group.merchant.name} cap={v.cap_amount} currency={cur} />
        </div>

        <div className="row-between" style={{ marginTop: 14, alignItems: 'flex-start', gap: 10 }}>
          {policy ? (
            <PolicyChip policy={policy} />
          ) : (
            <span className="small muted">{v.group.policy_text}</span>
          )}
          <Countdown to={v.group.deadline_at} />
        </div>
      </div>
    </section>
  )
}
