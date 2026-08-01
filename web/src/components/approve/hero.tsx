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
          {v.rail === 'at_venue' ? (
            // The mandate rail's guardrail sentence would be a lie here: there
            // is no merchant lock and no network-enforced cap, because there is
            // no card charge. Say what is actually true instead.
            <p className="guardrail">
              Nothing is charged through sutra on this split. You are agreeing that{' '}
              <b>{money(v.share_amount, cur)}</b> is your share, then paying{' '}
              <b>{v.group.merchant.name}</b> directly on your own card. What you get here is the
              arithmetic, the agreement, and a signed record of who owed what.
            </p>
          ) : (
            <Guardrail merchant={v.group.merchant.name} cap={v.cap_amount} currency={cur} />
          )}
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
