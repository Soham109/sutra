'use client'

import Link from 'next/link'
import { money } from '@/lib/format'
import type { GroupStatus } from '@/lib/api'

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
}: {
  status: GroupStatus
  members: Member[]
  currency: string
  groupId: string
  /** true on the rail that actually charges cards */
  charges: boolean
  terminal: boolean
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
            ? 'Each person is charged their own amount, on their own card, in the same moment. If any single one fails, the ones that already went through are not left stranded — the group lands on a partial result and says exactly who paid what.'
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
          The rule is being checked now. Nothing has been charged yet — that only happens once the
          rule passes, and then it happens to everyone at once.
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
          ? 'Approving costs nothing — it only creates a permission. Every card is charged in the same moment once the rule passes, or none of them is.'
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
