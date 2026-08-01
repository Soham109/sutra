'use client'

import Link from 'next/link'
import { Badge, Countdown, Money } from '@/components/ui'
import type { Group, GroupMember, GroupStatus } from '@/lib/api'
import { MEMBER_LABEL, accentFor, initials, progressOf, relativeTime } from '@/lib/format'

export const GROUP_LABEL: Record<GroupStatus, string> = {
  draft: 'Draft',
  collecting: 'Collecting',
  deciding: 'Deciding',
  committing: 'Committing',
  committed: 'Committed',
  partial: 'Partial',
  aborted: 'Aborted',
  expired: 'Timed out',
}

export function groupTone(s: GroupStatus): 'ok' | 'bad' | 'warn' | 'brand' | 'plain' {
  if (s === 'committed') return 'ok'
  if (s === 'partial') return 'warn'
  if (s === 'aborted' || s === 'expired') return 'bad'
  if (s === 'collecting' || s === 'deciding' || s === 'committing') return 'brand'
  return 'plain'
}

export function groupHref(id: string): string {
  return `/app/groups/${id}`
}

const SETTLED = ['approved', 'charging', 'charged']
const OUT = ['declined', 'failed', 'dropped', 'expired']

/**
 * The consent thread, compressed to a row: one node per payer, ringed brand
 * once that member's own mandate is live. Same grammar as the war room, small
 * enough to sit in a list.
 */
export function ThreadStack({ members, max = 6 }: { members: GroupMember[]; max?: number }) {
  const payers = members.filter((m) => m.role !== 'observer')
  const shown = payers.slice(0, max)
  const rest = payers.length - shown.length

  return (
    <div className="row" style={{ gap: 0, flex: 'none' }} aria-label="Consent thread">
      {shown.map((m, i) => {
        const settled = SETTLED.includes(m.status)
        const out = OUT.includes(m.status)
        return (
          <span
            key={m.member_id}
            title={`${m.name} — ${MEMBER_LABEL[m.status]}`}
            style={{
              marginLeft: i === 0 ? 0 : -7,
              zIndex: shown.length - i,
              padding: 1.5,
              borderRadius: 999,
              background: 'var(--surface)',
              border: `1.5px solid ${settled ? 'var(--brand)' : out ? 'var(--bad-line)' : 'var(--line-2)'}`,
            }}
          >
            <span
              className="avatar avatar-sm"
              style={{
                background: accentFor(m.name),
                filter: out ? 'grayscale(1)' : undefined,
                opacity: out ? 0.5 : 1,
              }}
              aria-hidden
            >
              {initials(m.name)}
            </span>
          </span>
        )
      })}
      {rest > 0 && (
        <span className="tiny faint mono" style={{ marginLeft: 7 }}>
          +{rest}
        </span>
      )}
    </div>
  )
}

/** One group as a list row. Live groups lead with time; finished ones with outcome. */
export function GroupRow({ group, finished = false }: { group: Group; finished?: boolean }) {
  const { done, total } = progressOf(group.members)

  return (
    <Link className="list-row wrap" href={groupHref(group.group_id)}>
      <ThreadStack members={group.members} />

      <div className="grow" style={{ minWidth: 150 }}>
        <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.title}
        </div>
        <div className="row wrap tiny faint" style={{ gap: 7 }}>
          <span className="mono">
            {done}/{total} approved
          </span>
          <span aria-hidden>·</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
            {group.merchant.name}
          </span>
          {finished && (
            <>
              <span aria-hidden>·</span>
              <span>{relativeTime(group.deadline_at)}</span>
            </>
          )}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 12, justifyContent: 'flex-end' }}>
        {!finished && <Countdown to={group.deadline_at} />}
        <Money minor={group.total} currency={group.currency} />
        <Badge tone={groupTone(group.status)}>{GROUP_LABEL[group.status]}</Badge>
      </div>
    </Link>
  )
}
