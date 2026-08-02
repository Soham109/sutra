'use client'

import Link from 'next/link'
import { money } from '@/lib/format'
import { Countdown } from '@/components/ui'
import type { NeedsYouItem, PlanSummary } from '@/lib/api'

// The top of the dashboard, always. Everything else on this page is context;
// this is the only part that is a to-do list.
//
// Each card answers the four questions a person actually has before they tap:
// what is it, how much is mine, what is the most it can become, and how long
// have I got. The cap is shown next to the share because the gap between them
// is the only thing that can surprise you later.

const ASK_LABEL: Record<string, string> = {
  rsvp: 'are you in',
  availability: 'when you’re free',
  location: 'where you’re coming from',
  budget: 'your limit',
  constraint: 'anything to work around',
  vote: 'your pick',
}

export function NeedsYou({
  approvals,
  plans,
}: {
  approvals: NeedsYouItem[]
  plans: PlanSummary[]
}) {
  const count = approvals.length + plans.length
  if (count === 0) return null

  return (
    <section className="needs" aria-labelledby="needs-title">
      <div className="needs-head">
        <h2 id="needs-title">
          <span className="needs-count">{count}</span>
          {count === 1 ? 'thing needs you' : 'things need you'}
        </h2>
      </div>

      <div className="needs-grid">
        {approvals.map((a) => {
          const headroom = a.cap_amount - a.share_amount
          return (
            <article className="need-card" key={a.member_id}>
              <div className="need-top">
                <span className="need-merchant">{a.merchant?.name ?? 'A group'}</span>
                <Countdown to={a.deadline_at} />
              </div>

              <h3 className="need-title">{a.title}</h3>

              <div className="need-figure">
                <span className="need-share">{money(a.share_amount, a.currency)}</span>
                <span className="need-share-label">your share</span>
              </div>

              {a.action === 'approve' ? (
                <p className="need-cap">
                  Capped at <b>{money(a.cap_amount, a.currency)}</b>
                  {headroom > 0 && <> — {money(headroom, a.currency)} of headroom for tax or drift</>}.
                  Enforced by the card network, not by us.
                </p>
              ) : (
                <p className="need-cap">
                  {a.rail === 'shopify_pos'
                    ? 'Confirm this share, then present your own card at Shopify POS. Nothing is charged here.'
                    : a.rail === 'checkout_handoff'
                      ? 'Confirm the proposed share. Merchant checkout and payment are still pending.'
                      : 'You’ll pay the venue directly. Nothing is charged through sutra.'}
                </p>
              )}

              <Link className="btn btn-primary btn-block btn-lg" href={`/a/${a.member_id}`}>
                {a.action === 'approve' ? 'Review and approve' : 'Review and accept'}
              </Link>
            </article>
          )
        })}

        {plans.map((p) => (
          <article className="need-card need-card-plan" key={p.plan_id}>
            <div className="need-top">
              <span className="need-merchant">Still deciding</span>
              <Countdown to={p.deadline_at} />
            </div>

            <h3 className="need-title">{p.title}</h3>

            <p className="need-ask">
              They need {p.asked.map((k) => ASK_LABEL[k] ?? k).join(', ')}.
            </p>

            <p className="need-cap">
              {p.responded_count} of {p.participant_count} have answered
              {p.option_count > 0 && <> · {p.option_count} options on the board</>}
            </p>

            <Link
              className="btn btn-secondary btn-block btn-lg"
              href={p.participant_id ? `/p/${p.participant_id}` : `/app/plans/${p.plan_id}`}
            >
              Answer now
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}
