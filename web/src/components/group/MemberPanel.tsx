'use client'

import { useState } from 'react'
import type { GroupMember } from '@/lib/api'
import { Avatar, Badge, StatusBadge } from '@/components/ui'
import { money } from '@/lib/format'
import { RoleBadge } from './badges'

// Per member: what they owe, what they capped themselves at, and what the
// protocol currently thinks of them. Nothing here can spend anyone's money —
// the approval link just opens their own device's page.

const NOT_YET = new Set(['invited', 'viewed', 'awaiting_approval'])

export function MemberPanel({
  members,
  currency,
  merchant,
  allocations,
  anonymise,
  replaying,
  charges = true,
}: {
  members: GroupMember[]
  currency: string
  merchant: string
  allocations: Record<string, { amount: number; shortfall: number }>
  anonymise: boolean
  replaying: boolean
  /** false on at_venue — no mandates, no card-network language */
  charges?: boolean
}) {
  return (
    <div className="card">
      <div className="gr-sec">
        <h3>Members</h3>
        <span className="tiny faint mono">{members.length} invited</span>
      </div>

      {members.map((m) => (
        <MemberCard
          key={m.member_id}
          member={m}
          currency={currency}
          allocation={allocations[m.member_id]}
          anonymise={anonymise}
          replaying={replaying}
        />
      ))}

      <div style={{ padding: '13px 16px', borderTop: '1px solid var(--line)' }}>
        <p className="guardrail">
          {charges ? (
            <>
              Every mandate is locked to <b>{merchant}</b>, capped at that member&rsquo;s own number, single use, and
              expires with the group. Those limits are enforced at the card network — not by this app.
            </>
          ) : (
            <>
              This split records who agreed to pay <b>{merchant}</b> what. Nothing is charged through sutra — each
              person settles at the table with their own card.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function MemberCard({
  member: m,
  currency,
  allocation,
  anonymise,
  replaying,
}: {
  member: GroupMember
  currency: string
  allocation?: { amount: number; shortfall: number }
  anonymise: boolean
  replaying: boolean
}) {
  const [qr, setQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const hidden = anonymise && (m.status === 'declined' || m.status === 'dropped')
  const name = hidden ? 'A member' : m.name
  const pending = NOT_YET.has(m.status) && !replaying

  const copy = async () => {
    const url = `${window.location.origin}/a/${m.member_id}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="gr-mem">
      <div className="gr-mem-head">
        <Avatar name={name} color={hidden ? 'var(--ink-3)' : undefined} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 550 }}>{name}</span>
            <RoleBadge role={m.role} />
            {m.on_hold && <Badge tone="warn">On hold</Badge>}
            {m.requote_round > 0 && <Badge tone="warn">Requote {m.requote_round}</Badge>}
          </div>
        </div>
        <StatusBadge status={m.status} />
      </div>

      <div className="gr-mem-facts">
        <span className="gr-fact">
          Share <b>{money(m.status === 'charged' && m.charged_amount ? m.charged_amount : m.share_amount, currency)}</b>
        </span>
        {m.cap_amount > 0 && (
          <span className="gr-fact">
            Cap <b>{money(m.cap_amount, currency)}</b>
          </span>
        )}
        {m.backstop_cap > 0 && (
          <span className="gr-fact">
            Backstop{' '}
            <b>
              {money(m.backstop_cap, currency)} {m.backstop_armed ? 'armed' : 'offered'}
            </b>
          </span>
        )}
        {allocation && m.backstop_absorbed === 0 && (
          <span className="gr-fact" style={{ color: 'var(--warn)' }}>
            Allocated <b style={{ color: 'var(--warn)' }}>{money(allocation.amount, currency)}</b> to cover a shortfall
          </span>
        )}
        {m.backstop_absorbed > 0 && (
          <span className="gr-fact" style={{ color: 'var(--ok)' }}>
            Absorbed <b style={{ color: 'var(--ok)' }}>{money(m.backstop_absorbed, currency)}</b>
          </span>
        )}
      </div>

      {pending && (
        <div className="row wrap" style={{ gap: 8, marginTop: 10, paddingLeft: 43 }}>
          <button className="btn btn-secondary tiny" onClick={() => void copy()}>
            {copied ? 'Link copied' : 'Copy approval link'}
          </button>
          <button className="btn btn-ghost tiny" onClick={() => setQr((v) => !v)} aria-expanded={qr}>
            {qr ? 'Hide QR' : 'Show QR'}
          </button>
          <code className="tiny faint mono gr-break">/a/{m.member_id}</code>
        </div>
      )}

      {pending && qr && (
        <div className="col" style={{ gap: 6, marginTop: 10, paddingLeft: 43 }}>
          {/* Served by the engine; scanning it opens this member's own approval page. */}
          <img
            className="gr-qr"
            src={`/api/v1/members/${m.member_id}/qr.png`}
            alt={`QR code opening the approval page for ${name}`}
            loading="lazy"
          />
          <span className="tiny faint">They approve on their own device. Nothing is charged from here.</span>
        </div>
      )}
    </div>
  )
}
