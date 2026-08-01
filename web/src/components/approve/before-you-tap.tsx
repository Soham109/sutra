'use client'

import { money } from '@/lib/format'
import type { MemberView } from './model'

// The four seconds before somebody taps a payment button on a phone.
//
// This page is, by its own file comment, "the only page most people will ever
// see of sutra — often in a bar, sometimes slightly drunk". Until now the last
// thing it said before that tap was eleven grey words: "Opens Prava's own page.
// Your passkey never touches sutra."
//
// That introduces an unfamiliar company name, an unfamiliar auth word, and an
// off-domain redirect, all in one breath, at the exact moment somebody is
// deciding whether this is a scam. It is the shape people are trained to
// distrust — and it was set in the smallest, faintest type on the screen.
//
// So the reassurance is the thing itself now, not a footnote under it, and it
// answers the three questions actually being asked: who am I about to be sent
// to, what is the most that can happen to me, and what if somebody backs out.
// Every number in it is this member's real number.

export function BeforeYouTap({ v }: { v: MemberView }) {
  const cur = v.group.currency
  const cap = v.cap_amount > 0 ? v.cap_amount : v.share_amount

  return (
    <section className="btap" aria-label="What happens when you approve">
      <h2 className="btap-title">Before you tap</h2>
      <ol className="btap-list">
        <li>
          <span className="btap-i" aria-hidden>
            1
          </span>
          <div>
            <b>You’ll finish on Prava’s own page, not here.</b>
            <p>
              Prava is the payments company that holds your card. Sutra never sees your card
              number and never sees your passkey — that is why the last step happens on their
              site instead of ours.
            </p>
          </div>
        </li>
        <li>
          <span className="btap-i" aria-hidden>
            2
          </span>
          <div>
            <b>Nothing is charged when you approve.</b>
            <p>
              Approving creates a permission, capped at <strong>{money(cap, cur)}</strong> and
              locked to <strong>{v.group.merchant.name}</strong>. Nobody — not this app, not the
              merchant — can take more than that or spend it anywhere else. The limit is held by
              the card network, not by our code.
            </p>
          </div>
        </li>
        <li>
          <span className="btap-i" aria-hidden>
            3
          </span>
          <div>
            <b>If the group falls apart, you pay nothing.</b>
            <p>
              Everyone is charged in the same moment or nobody is. If someone backs out, every
              permission is cancelled instead — so there is no charge to refund and nothing to
              wait on.
            </p>
          </div>
        </li>
      </ol>
    </section>
  )
}
