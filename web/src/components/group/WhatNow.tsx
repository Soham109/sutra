'use client'

import Link from 'next/link'
import { money } from '@/lib/format'
import type { GroupStatus, Rail } from '@/lib/api'

// What is actually going on, in the words a person would use.
//
// This page opened on "Collecting", a "Consent thread", an "Event log" replaying
// 3 of 3, an "fx.snapshot pinned against INR across 2 currencies", a tolerance
// of "100 bps", a "Stragglers" row, a "Blame" row and a truncated cart hash.
// Every one of those is a real thing this system does and most of them are on
// screen before the reader has been told the only two facts they came for:
//
//   who are we waiting on, and has anybody's money moved yet.
//
// So those two go first, in a sentence, above everything else. The protocol
// detail keeps its place further down the page for whoever wants it — it is
// not deleted, it is just no longer the headline.

interface Member {
  member_id: string
  name: string
  status: string
  share_amount: number
  role: string
}

const WAITING = new Set(['invited', 'viewed', 'awaiting_approval'])

export function WhatNow({
  status,
  members,
  currency,
  groupId,
  charges,
  terminal,
  rail,
}: {
  status: GroupStatus
  members: Member[]
  currency: string
  groupId: string
  /** true on the rail that actually charges cards */
  charges: boolean
  terminal: boolean
  rail: Rail
}) {
  const payers = members.filter((m) => m.role !== 'observer')
  const waiting = payers.filter((m) => WAITING.has(m.status))
  const done = payers.filter((m) => !WAITING.has(m.status) && m.status !== 'dropped')

  if (terminal) return null

  if (status === 'committing') {
    return (
      <section className="whatnow is-live">
        <h2>
          {charges
            ? `Everyone’s in. Charging all ${payers.length} cards now.`
            : `Everyone’s in. Sealing the split now.`}
        </h2>
        <p>
          {charges
            ? 'Sutra is processing each capped credential with an idempotent reference. Unknown results are reconciled before retry; if an irreversible mixed result occurs, the group reports exactly who paid what as partial.'
            : 'Recording everyone’s agreement and sealing the receipt. No card is charged through sutra on this kind of split.'}
        </p>
      </section>
    )
  }

  if (waiting.length === 0) {
    return (
      <section className="whatnow">
        <h2>Everybody has answered.</h2>
        <p>
          The rule is being checked now. Nothing has been charged yet. On a charging rail, a guarded
          and recoverable transaction sequence begins only after the rule passes.
        </p>
      </section>
    )
  }

  const names = waiting.map((m) => m.name)
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  return (
    <section className="whatnow">
      <h2>
        Waiting on {list}
        {waiting.length > 1 ? '' : ''}.
      </h2>
      <p>
        {done.length > 0
          ? `${done.length} of ${payers.length} ${done.length === 1 ? 'person has' : 'people have'} answered. `
          : ''}
        <b>Nothing has been charged.</b>{' '}
        {charges
          ? 'Approving costs nothing — it creates a capped permission. Charging begins only after the rule passes; retries reconcile provider state and any partial outcome stays explicit.'
          : rail === 'shopify_pos'
            ? 'This records each exact share. Once everyone agrees, take the amounts to the cashier for Shopify POS split payment.'
            : rail === 'checkout_handoff'
              ? 'This records the proposed split only. No card is charged and merchant checkout remains a separate next step.'
              : 'This split records who owes what and produces a signed receipt. You pay the venue directly.'}
      </p>

      {/* The single most useful thing on the page when people are missing:
          the link for each person who has not answered. It used to be buried
          in a panel below the fold, under the event log. */}
      <ul className="whatnow-links">
        {waiting.map((m) => (
          <li key={m.member_id}>
            <span className="whatnow-who">
              {m.name}
              <em>{money(m.share_amount, currency)}</em>
            </span>
            <CopyLink memberId={m.member_id} name={m.name} />
          </li>
        ))}
      </ul>

      <Link className="tiny" href={`/j/${groupId}`}>
        Or show one QR code and let people pick their own name →
      </Link>
    </section>
  )
}

function CopyLink({ memberId, name }: { memberId: string; name: string }) {
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/a/${memberId}`

  const send = async () => {
    // The share sheet is the right thing on a phone, which is where somebody
    // sending a friend a link actually is. Clipboard is the desktop fallback.
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (nav.share) {
      try {
        await nav.share({ title: `${name}'s share`, url })
        return
      } catch {
        /* dismissed the sheet — fall through to the clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard blocked; the link is still visible on the page */
    }
  }

  return (
    <button type="button" className="btn btn-secondary tiny" onClick={() => void send()}>
      Send {name} their link
    </button>
  )
}
