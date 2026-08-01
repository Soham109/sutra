'use client'

import { useEffect, useState } from 'react'
import { money } from '@/lib/format'
import type { GroupMember } from '@/lib/api'

// Getting four links into four hands.
//
// A single group link that asks people to pick their own name off a list is
// fine in a chat and wrong at a table — it adds a step, and it lets somebody
// claim the wrong share. So there are two honest modes, and neither is the
// "copy this URL" box that was there before:
//
//   Pass the phone — one person at a time, full screen, their name and their
//   exact amount above a QR of THEIR link. Hand it round the table; each person
//   scans the one with their name on it and lands directly on their own share.
//
//   Send them — one pre-written message per person, or one block for the group
//   chat, straight into the native share sheet.

export function PassThePhone({
  members,
  currency,
  title,
  onClose,
}: {
  members: GroupMember[]
  currency: string
  title: string
  onClose: () => void
}) {
  const payers = members.filter((m) => m.role !== 'observer')
  const [i, setI] = useState(0)
  const [origin, setOrigin] = useState('')

  useEffect(() => setOrigin(window.location.origin), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === ' ') setI((v) => Math.min(v + 1, payers.length - 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, payers.length])

  const m = payers[i]
  if (!m) return null
  const last = i === payers.length - 1

  return (
    <div className="pass" role="dialog" aria-modal="true" aria-label="Pass the phone">
      <button className="pass-close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <div className="pass-count" aria-hidden>
        {i + 1} / {payers.length}
      </div>

      <div className="pass-card">
        <span className="pass-for">this one is for</span>
        <h2>{m.name}</h2>
        <div className="pass-amount">{money(m.share_amount, currency)}</div>

        {origin && (
          // Their own link, not the group's — they land on their share with
          // nothing to choose and nothing to get wrong.
          <img
            className="pass-qr"
            alt={`QR code for ${m.name}'s share`}
            src={`/api/v1/members/${m.member_id}/qr.png`}
          />
        )}

        <p className="pass-hint">
          Point a camera at it. No account, no app — it opens their own share of {title}.
        </p>
      </div>

      <div className="pass-nav">
        <button className="btn btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          ← Back
        </button>
        {last ? (
          <button className="btn btn-primary btn-lg" onClick={onClose}>
            Everyone has it
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => setI(i + 1)}>
            Next person →
          </button>
        )}
      </div>

      <div className="pass-dots" aria-hidden>
        {payers.map((p, n) => (
          <span key={p.member_id} className={n === i ? 'is-on' : n < i ? 'is-done' : ''} />
        ))}
      </div>
    </div>
  )
}

/** One message per person, ready to paste into a group chat. */
export function buildInviteText(
  members: GroupMember[],
  currency: string,
  title: string,
  origin: string,
): string {
  const lines = members
    .filter((m) => m.role !== 'observer')
    .map((m) => `${m.name} — ${money(m.share_amount, currency)}\n${origin}/a/${m.member_id}`)
  return `${title}\n\nEveryone pays their own share, from their own card. Your link is yours:\n\n${lines.join('\n\n')}`
}
