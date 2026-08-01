'use client'

import Link from 'next/link'
import { Avatar, Countdown } from '@/components/ui'
import { MEMBER_LABEL, money } from '@/lib/format'
import type { PlanSummary, WaitingItem } from '@/lib/api'
import { Ring } from './charts'

// Who has not answered, and how the group is doing without them.
//
// The chase is the real work of group money, so it gets a name and a face
// rather than a progress percentage. Under no-blame the faces go grey and
// nameless for everyone except the organiser — declining under social pressure
// is the failure mode this product exists to remove, so the UI has to hold
// that line even when it would be more informative not to.

export function Waiting({ groups, plans }: { groups: WaitingItem[]; plans: PlanSummary[] }) {
  if (groups.length === 0 && plans.length === 0) return null

  return (
    <section className="waiting" aria-labelledby="waiting-title">
      <div className="section-head">
        <h2 id="waiting-title">Waiting on others</h2>
        <Link href="/app/groups" className="text-button">
          All groups ↗
        </Link>
      </div>

      <div className="waiting-list">
        {groups.map((g) => {
          const anonymous = g.waiting.some((w) => w.name === null)
          // approved_count and the still-deciding count come straight from the
          // API; the rest of paying_count (declined, dropped, …) is whatever is
          // left — a real number, just not one the API names directly.
          const total = g.paying_count || 1
          const deciding = g.waiting.length
          const other = Math.max(0, g.paying_count - g.approved_count - deciding)
          const progressLabel =
            other > 0
              ? `${g.approved_count} approved, ${other} declined, ${deciding} still deciding, out of ${g.paying_count}`
              : `${g.approved_count} of ${g.paying_count} approved`
          return (
            <Link href={`/app/groups/${g.group_id}`} className="waiting-row" key={g.group_id}>
              <div className="waiting-main">
                <div className="waiting-title-row">
                  <span className="waiting-title">{g.title}</span>
                  {g.you_organized && <span className="chip chip-quiet">you organised</span>}
                </div>
                <div className="waiting-meta">
                  <span className="amount">{money(g.total, g.currency)}</span>
                  <span className="dot-sep" aria-hidden />
                  <span className="waiting-progress">
                    <Ring
                      size={18}
                      stroke={3}
                      trackColor="var(--line-2)"
                      label={progressLabel}
                      segments={[
                        { value: g.approved_count / total, color: 'var(--ok)' },
                        { value: other / total, color: 'var(--bad)' },
                      ]}
                    />
                    {g.approved_count} of {g.paying_count} approved
                  </span>
                  <span className="dot-sep" aria-hidden />
                  <Countdown to={g.deadline_at} />
                </div>
              </div>

              <div className="waiting-people" aria-label={`${g.waiting.length} still to answer`}>
                {g.waiting.slice(0, 5).map((w, i) => (
                  <span
                    className="waiting-person"
                    key={i}
                    title={
                      w.name
                        ? `${w.name} — ${w.status ? MEMBER_LABEL[w.status] : 'waiting'}`
                        : 'Hidden while no-blame is on'
                    }
                  >
                    <Avatar name={w.name ?? '·'} size="sm" color={w.name ? undefined : 'var(--ink-3)'} />
                  </span>
                ))}
                {g.waiting.length > 5 && <span className="waiting-more">+{g.waiting.length - 5}</span>}
              </div>

              <span className="waiting-count">
                {g.waiting.length} {g.waiting.length === 1 ? 'person' : 'people'}
                <span className="tiny faint">{anonymous ? 'hidden' : 'to answer'}</span>
              </span>
            </Link>
          )
        })}

        {plans.map((p) => (
          <Link href={`/app/plans/${p.plan_id}`} className="waiting-row" key={p.plan_id}>
            <div className="waiting-main">
              <div className="waiting-title-row">
                <span className="waiting-title">{p.title}</span>
                <span className="chip chip-quiet">deciding</span>
              </div>
              <div className="waiting-meta">
                <span className="waiting-progress">
                  <Ring
                    size={18}
                    stroke={3}
                    trackColor="var(--line-2)"
                    label={`${p.responded_count} of ${p.participant_count} answered`}
                    segments={[
                      { value: p.participant_count > 0 ? p.responded_count / p.participant_count : 0, color: 'var(--brand)' },
                    ]}
                  />
                  {p.responded_count} of {p.participant_count} answered
                </span>
                {p.option_count > 0 && (
                  <>
                    <span className="dot-sep" aria-hidden />
                    <span>{p.option_count} options ranked</span>
                  </>
                )}
                <span className="dot-sep" aria-hidden />
                <Countdown to={p.deadline_at} />
              </div>
            </div>
            <span className="waiting-count">
              {p.participant_count - p.responded_count}
              <span className="tiny faint">still quiet</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
