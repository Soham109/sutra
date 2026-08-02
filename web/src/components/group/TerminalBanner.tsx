'use client'

import Link from 'next/link'
import type { GroupMember, GroupStatus, Rail } from '@/lib/api'
import { money } from '@/lib/format'

// The end of the story, said plainly. "Nothing was charged" is the single most
// reassuring sentence this product can print, so it gets the loudest treatment.

const COPY_CARD: Record<string, { cls: string; title: string; line: string }> = {
  committed: {
    cls: 'banner banner-ok',
    title: 'Committed',
    line: 'Every planned share cleared on its own capped credential. The receipt records each provider transaction.',
  },
  partial: {
    cls: 'banner',
    title: 'Partially committed',
    line: 'Some shares cleared and some did not. Only what cleared was charged — nothing was collected on behalf of anyone who fell through.',
  },
  aborted: {
    cls: 'banner banner-bad',
    title: 'Aborted — nothing charged',
    line: 'The policy did not resolve, so no card was touched. There is nothing to refund and nobody to chase.',
  },
  expired: {
    cls: 'banner banner-bad',
    title: 'Expired — nothing charged',
    line: 'The deadline passed before the policy resolved. Every unused mandate lapsed on its own.',
  },
}

const COPY_VENUE: Record<string, { cls: string; title: string; line: string }> = {
  committed: {
    cls: 'banner banner-ok',
    title: 'Agreed',
    line: 'Everyone confirmed their share. No card was charged through sutra — settle at the table with the amounts below.',
  },
  partial: {
    cls: 'banner',
    title: 'Partially agreed',
    line: 'Some people confirmed and some did not. Only the confirmed amounts are on the record — nobody was charged through sutra.',
  },
  aborted: {
    cls: 'banner banner-bad',
    title: 'Called off — nothing owed through sutra',
    line: 'The group did not finish agreeing. There is no charge and no receipt to settle against.',
  },
  expired: {
    cls: 'banner banner-bad',
    title: 'Expired — nothing owed through sutra',
    line: 'The deadline passed before everyone agreed. No card was touched.',
  },
}

function nonChargingCopy(rail: Rail, status: string) {
  const base = COPY_VENUE[status]
  if (!base || status !== 'committed') return base
  if (rail === 'shopify_pos') {
    return {
      ...base,
      title: 'Ready for Shopify POS',
      line: 'Everyone confirmed an exact share. No card was charged through sutra — the cashier can now run split payment at the counter.',
    }
  }
  if (rail === 'checkout_handoff') {
    return {
      ...base,
      title: 'Split agreed',
      line: 'Everyone confirmed the proposed split. No card was charged and no merchant order was placed through sutra.',
    }
  }
  return base
}

/**
 * The question this product kept failing to answer: money moved — so now what?
 *
 * "Every share cleared on its own card" was the last thing the page said, and
 * the obvious next thought is "…and who actually buys the thing?". Leaving
 * that unanswered is what made the whole flow feel like it did not add up.
 *
 * The truthful answer differs by rail and it is not flattering in both cases,
 * so it is stated rather than implied.
 */
function WhatHappensToTheOrder({
  charges,
  merchant,
  paid,
  rail,
  checkoutUrl,
}: {
  charges: boolean
  merchant: string
  paid: number
  rail: Rail
  checkoutUrl?: string
}) {
  if (!charges) {
    const pos = rail === 'shopify_pos'
    const handoff = rail === 'checkout_handoff'
    return (
      <div className="afterword">
        <b>{pos ? 'Now ask the cashier to split the payment.' : handoff ? 'Now return to the merchant checkout.' : 'Now settle up at the table.'}</b>
        <p>
          No card was charged through sutra — what you have is everyone’s agreement and a signed record of the
          exact shares. {pos
            ? `At ${merchant}, ask the cashier to choose Split payment in Shopify POS, enter each amount, and let all ${paid} people present their own cards.`
            : handoff
              ? `Open ${merchant}'s checkout next. If it only accepts one card, the merchant still needs a Sutra adapter before this can finish without somebody fronting the order.`
              : `Hand ${merchant} the ${paid} ${paid === 1 ? 'card' : 'cards'} for the amounts above, or pay however you normally would.`}{' '}
          The receipt is proof of the arithmetic and consent, not proof of merchant payment.
        </p>
        {handoff && checkoutUrl ? (
          <a className="btn btn-primary" style={{ marginTop: 10 }} href={checkoutUrl} target="_blank" rel="noreferrer">
            Continue to merchant checkout ↗
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <div className="afterword">
      <b>Each share is now on its own single-use card.</b>
      <p>
        Prava minted {paid} separate card {paid === 1 ? 'number' : 'numbers'} — one per person, each
        locked to {merchant} and capped at that person’s own amount, each usable once. The money
        left {paid === 1 ? 'that card' : 'those cards'}, not a pot we hold: sutra never has custody
        of anyone’s money at any point.
      </p>
      <p>
        <b>Sutra does not place the order for you.</b> One cart paid by {paid} different cards only
        works where {merchant} accepts more than one card for a single order. Where each person is
        buying their own thing — a ticket each, a seat each — every card covers exactly its owner’s
        item and nobody fronted anything.
      </p>
    </div>
  )
}

export function TerminalBanner({
  status,
  decisionNote,
  narrative,
  members,
  currency,
  groupId,
  charges,
  merchant,
  rail,
  checkoutUrl,
}: {
  status: GroupStatus
  decisionNote: string | null
  narrative: string | null
  members: GroupMember[]
  currency: string
  groupId: string
  /** whether this rail actually charges cards, so the copy cannot claim one it did not */
  charges: boolean
  merchant: string
  rail: Rail
  checkoutUrl?: string
}) {
  const copy = charges ? COPY_CARD[status] : nonChargingCopy(rail, status)
  if (!copy) return null

  const charged = members.reduce((s, m) => s + m.charged_amount + m.backstop_absorbed, 0)
  const paid = members.filter((m) =>
    charges ? m.status === 'charged' : m.status === 'settled' || m.status === 'charged',
  ).length
  const reason = decisionNote ?? narrative
  const amountLabel = charges
    ? `charged across ${paid} ${paid === 1 ? 'card' : 'cards'}`
    : `agreed · ${paid} ${paid === 1 ? 'person' : 'people'}`

  return (
    <div className={copy.cls} role="status">
      <div className="row-between wrap" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="banner-title" style={status === 'partial' ? { color: 'var(--warn)' } : undefined}>
            {copy.title}
          </div>
          <p className="small" style={{ marginTop: 6, maxWidth: '62ch' }}>
            {copy.line}
          </p>
          {reason && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Reason: {reason}
            </p>
          )}
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="amount amount-lg">{money(charged || members.reduce((s, m) => s + m.share_amount, 0), currency)}</span>
          <span className="tiny faint mono">{amountLabel}</span>
        </div>
      </div>

      {(status === 'committed' || status === 'partial') && (
        <WhatHappensToTheOrder charges={charges} merchant={merchant} paid={paid} rail={rail} checkoutUrl={checkoutUrl} />
      )}

      <div className="row wrap" style={{ gap: 10, marginTop: 14 }}>
        <Link className="btn btn-secondary" href={`/app/receipts/${groupId}`}>
          Open the signed receipt
        </Link>
        <a className="btn btn-ghost small" href={`/api/v1/groups/${groupId}/receipt`} target="_blank" rel="noreferrer">
          Raw signed JSON ↗
        </a>
      </div>
    </div>
  )
}
