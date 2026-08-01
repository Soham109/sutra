'use client'

import type { CartItem, MemberStatus } from '@/lib/api'
import { Badge, Countdown, Money, Spinner } from '@/components/ui'
import { clockTime, money } from '@/lib/format'
import type { MemberView } from './model'

const PRAVA_PORTAL = 'https://pay.prava.space'

/** Your items, as lines you can check against what you actually asked for. */
export function ItemLines({ items, currency }: { items: CartItem[]; currency: string }) {
  if (items.length === 0) return null
  return (
    <div className="ap-items">
      {items.map((i) => {
        const shared = i.claimants.includes('mi_all') || i.claimants.length > 1
        return (
          <div className="ap-item" key={i.sku}>
            <span className="grow">
              {i.name}
              {i.qty > 1 && <span className="faint"> × {i.qty}</span>}
              {shared && <span className="faint"> · shared</span>}
              {i.contested && (
                <span className="tiny" style={{ color: 'var(--warn)' }}>
                  {' '}
                  · contested
                </span>
              )}
            </span>
            <span className="amount muted">{money(i.unit_amount * i.qty, currency)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** The split moved. Say so in one sentence and show the two numbers. */
export function RequoteNote({
  round,
  from,
  to,
  currency,
  reason,
}: {
  round: number
  from: number | null
  to: number
  currency: string
  reason: string | null
}) {
  return (
    <div className="note" role="status" style={{ marginBottom: 14 }}>
      <span aria-hidden>↻</span>
      <span>
        <b>Your share changed.</b>{' '}
        {reason === 'auction settlement'
          ? 'The contested items were allocated, so the split was recalculated.'
          : 'Somebody left or the cart moved, so the split was recalculated.'}{' '}
        {from != null && (
          <>
            You were quoted <span className="amount ap-strike">{money(from, currency)}</span>, now it is{' '}
            <span className="amount">
              <b>{money(to, currency)}</b>
            </span>
            .{' '}
          </>
        )}
        Your old approval was cancelled — nothing can be charged until you approve this new amount.
        <span className="tiny faint"> (requote {round})</span>
      </span>
    </div>
  )
}

export function ApprovedCard({ v, held }: { v: MemberView; held: boolean }) {
  return (
    <section className={held ? 'banner ap-flip' : 'banner banner-brand ap-flip'} style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>
        {held ? '⏸' : '✓'}
      </div>
      <div className="banner-title" style={{ marginTop: 8 }}>
        {held ? 'Your share is on hold' : "You're in"}
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {held ? (
          <>
            Your mandate is paused. While it is paused you count as <b>not approved</b>, so the group cannot
            commit on your share. Nothing is charged, and nothing expires early.
          </>
        ) : (
          <>
            Your mandate is live and capped at <span className="amount">{money(v.cap_amount, v.group.currency)}</span>.
            Nothing moves until the group&apos;s policy passes: <b>{v.group.policy_text}</b>. If it never passes,
            the mandate is cancelled and you are not charged.
          </>
        )}
      </p>
      <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 10 }}>
        <Badge tone={held ? 'warn' : 'brand'}>{held ? 'paused' : 'mandate active'}</Badge>
        <Countdown to={v.group.deadline_at} />
      </div>
    </section>
  )
}

export function ChargingCard({ v }: { v: MemberView }) {
  return (
    <section className="banner banner-brand ap-flip" style={{ textAlign: 'center' }}>
      <div className="eyebrow">Committing</div>
      <div style={{ margin: '10px 0 4px' }}>
        <Money minor={v.share_amount} currency={v.group.currency} size="lg" />
      </div>
      <p className="small muted">
        The group passed. Your share is being charged to your own card now, once, against the mandate you
        approved. Keep this page open — it will tell you the moment it settles.
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
        <Spinner label="Charging…" />
      </div>
    </section>
  )
}

/** The celebratory moment. A ticket, because that is what it is. */
export function Ticket({ v }: { v: MemberView }) {
  const amount = v.charged_amount || v.share_amount
  return (
    <section className="ap-ticket ap-flip">
      <div className="ap-ticket-top">
        <div className="eyebrow" style={{ color: 'var(--ok)' }}>
          Paid
        </div>
        <div style={{ margin: '8px 0 2px' }}>
          <Money minor={amount} currency={v.group.currency} size="xl" />
        </div>
        <div className="small muted">
          {v.group.title} · {v.group.merchant.name}
        </div>
      </div>

      <div className="ap-perf" />

      <div className="ap-ticket-bottom">
        <div className="ap-stub">
          <span className="k">Charged to</span>
          <span>your own card</span>
        </div>
        <div className="ap-stub">
          <span className="k">Credential</span>
          <span>single use, locked to {v.group.merchant.name}</span>
        </div>
        <div className="ap-stub">
          <span className="k">Your cap</span>
          <span className="amount">{money(v.cap_amount, v.group.currency)}</span>
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Nobody pooled money and nobody fronted your share. It went on your card through a single-use,
          merchant-locked credential that cannot be used again — not by us, not by {v.group.merchant.name}.
        </p>
        <a
          className="btn btn-secondary btn-block"
          style={{ marginTop: 12 }}
          href={PRAVA_PORTAL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Verify at pay.prava.space
        </a>
      </div>
    </section>
  )
}

/** Declined, dropped, timed out or failed — while the group is still running. */
export function OutCard({ status, noBlame }: { status: MemberStatus; noBlame: boolean }) {
  const line: Record<string, string> = {
    declined: 'You declined this share.',
    dropped: 'You were dropped from this purchase.',
    expired: 'Your window closed before you decided.',
    failed: 'Your card did not accept the charge.',
  }
  return (
    <section className="banner banner-bad ap-flip">
      <div className="banner-title">You were not charged</div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {line[status] ?? 'You are out of this purchase.'} Your mandate has been cancelled, so no money can move
        on it — now or later. The rest of the group decides without you
        {noBlame ? ', and they are not told who stepped back.' : '.'}
      </p>
    </section>
  )
}

/** The group finished; this member was not part of the charge. */
export function LeftBehindCard({ v }: { v: MemberView }) {
  const failed = v.status === 'failed'
  return (
    <section className="banner banner-bad ap-flip">
      <div className="banner-title">You were not charged</div>
      <p className="small muted" style={{ marginTop: 6 }}>
        {failed
          ? 'Your card declined the charge, so your share was not collected.'
          : 'The group completed without your share.'}{' '}
        Your mandate was cancelled and nothing can be drawn on it. {v.group.merchant.name} was paid only by the
        members who approved.
      </p>
      <PortalNote />
    </section>
  )
}

/** The state that has to land on every phone at once. */
export function AbortedCard({ v, note }: { v: MemberView; note?: string | null }) {
  return (
    <section className="banner banner-bad ap-abort ap-flip">
      <div className="ap-shout" style={{ color: 'var(--bad)' }}>
        NOTHING CHARGED
      </div>
      <p className="small" style={{ marginTop: 10, color: 'var(--ink-2)' }}>
        {v.group.status === 'expired'
          ? `Nobody reached the deadline together, so “${v.group.title}” was called off.`
          : `“${v.group.title}” was called off before anything was collected.`}{' '}
        <b>Every mandate created for this group was cancelled</b> — yours and everyone else&apos;s. There is no
        pending authorization, no hold on your card, and no partial charge to chase.
      </p>
      {note && <p className="tiny faint" style={{ marginTop: 8 }}>{note}</p>}
      <PortalNote />
    </section>
  )
}

/**
 * The group passed its policy and started charging while this member was still
 * deciding. There is nothing left to approve, so we say that instead of leaving
 * a live button that can only fail.
 */
export function ClosedCard({ v }: { v: MemberView }) {
  return (
    <section className="banner ap-flip">
      <div className="banner-title">The group decided without you</div>
      <p className="small muted" style={{ marginTop: 6 }}>
        The policy — <b>{v.group.policy_text}</b> — passed with the approvals it already had, so{' '}
        {v.group.title} is being charged now. Your share is not part of it and{' '}
        <b>nothing will be charged to you</b>. If someone&apos;s backstop covered your part, you will see it on
        the group&apos;s receipt.
      </p>
    </section>
  )
}

export function ObserverCard({ v }: { v: MemberView }) {
  return (
    <section className="card card-pad ap-flip">
      <div className="eyebrow">Observer</div>
      <h2 style={{ marginTop: 6 }}>{v.group.title}</h2>
      <p className="small muted" style={{ marginTop: 6 }}>
        You are watching this group, not paying into it. There is nothing for you to approve and nothing can be
        charged to you. Deadline {clockTime(v.group.deadline_at)}.
      </p>
    </section>
  )
}

/** The standing offer to cover somebody else. Its own mandate, its own cap. */
export function BackstopCard({ v }: { v: MemberView }) {
  if (!v.backstop_cap) return null
  const cur = v.group.currency

  if (v.backstop_armed) {
    return (
      <section className="card card-pad col" style={{ gap: 6 }}>
        <div className="row-between">
          <span className="eyebrow">Backstop armed</span>
          <Badge tone="ok">standing by</Badge>
        </div>
        <p className="small muted">
          If someone drops, you cover up to <span className="amount">{money(v.backstop_cap, cur)}</span> so the
          group still completes. It is a separate mandate from your own share and it is cancelled automatically
          if it goes unused.
        </p>
      </section>
    )
  }

  if (!v.backstop_approval_url) return null

  return (
    <section className="card card-pad col" style={{ gap: 10 }}>
      <div className="eyebrow">Your standing offer</div>
      <p className="small muted">
        Separately authorize up to <span className="amount">{money(v.backstop_cap, cur)}</span> to absorb a
        dropped member&apos;s share. It is only ever charged if the group would otherwise fail, and it is a
        second mandate — approving it does not change your own cap.
      </p>
      <button
        className="btn btn-secondary btn-block"
        onClick={() => {
          window.location.href = v.backstop_approval_url as string
        }}
      >
        Arm backstop ({money(v.backstop_cap, cur)})
      </button>
    </section>
  )
}

export function PortalNote() {
  return (
    <p className="tiny muted" style={{ marginTop: 12 }}>
      Don&apos;t take our word for it —{' '}
      <a href={PRAVA_PORTAL} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--brand)' }}>
        open your own Prava portal
      </a>{' '}
      and check the mandate&apos;s state yourself.
    </p>
  )
}
