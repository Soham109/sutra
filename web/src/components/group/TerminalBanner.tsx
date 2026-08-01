'use client'

import Link from 'next/link'
import type { GroupMember, GroupStatus } from '@/lib/api'
import { money } from '@/lib/format'

// The end of the story, said plainly. "Nothing was charged" is the single most
// reassuring sentence this product can print, so it gets the loudest treatment.

const COPY: Record<string, { cls: string; title: string; line: string }> = {
  committed: {
    cls: 'banner banner-ok',
    title: 'Committed',
    line: 'Every share cleared on its own card, at the same moment. No one fronted anyone else.',
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
    line: 'The deadline passed before the policy resolved. Every mandate lapsed on its own.',
  },
}

export function TerminalBanner({
  status,
  decisionNote,
  narrative,
  members,
  currency,
  groupId,
}: {
  status: GroupStatus
  decisionNote: string | null
  narrative: string | null
  members: GroupMember[]
  currency: string
  groupId: string
}) {
  const copy = COPY[status]
  if (!copy) return null

  const charged = members.reduce((s, m) => s + m.charged_amount + m.backstop_absorbed, 0)
  const paid = members.filter((m) => m.status === 'charged').length
  const reason = decisionNote ?? narrative

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
          <span className="amount amount-lg">{money(charged, currency)}</span>
          <span className="tiny faint mono">
            charged across {paid} {paid === 1 ? 'card' : 'cards'}
          </span>
        </div>
      </div>

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
