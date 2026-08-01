'use client'

import Link from 'next/link'
import type { Group, GroupMember } from '@/lib/api'
import { Avatar, Countdown } from '@/components/ui'
import { memberTone, money, progressOf, relativeTime } from '@/lib/format'
import { GroupBadge } from './badges'

/** The consent thread, compressed to a row. Same colours, same meaning. */
export function ThreadStack({ members, max = 6 }: { members: GroupMember[]; max?: number }) {
  const payers = members.filter((m) => m.role !== 'observer')
  const shown = payers.slice(0, max)
  const rest = payers.length - shown.length
  return (
    <div className="gr-stack" aria-hidden>
      {shown.map((m) => (
        <div className="gr-node" key={m.member_id} data-tone={memberTone(m.status)}>
          <Avatar name={m.name} size="sm" />
        </div>
      ))}
      {rest > 0 && <div className="gr-more">+{rest}</div>}
    </div>
  )
}

export function GroupRow({ group }: { group: Group }) {
  const { done, total } = progressOf(group.members)
  const live = !group.terminal

  return (
    <Link href={`/app/groups/${group.group_id}`} className="list-row gr-row">
      <ThreadStack members={group.members} />

      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.title}
        </div>
        <div className="tiny faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.merchant.name}
        </div>
      </div>

      <div className="gr-row-meta">
        <span className="tiny mono muted" title={`${done} of ${total} members have their own mandate live`}>
          {done}/{total} approved
        </span>
        <span className="amount" style={{ fontSize: 14 }}>
          {money(group.total, group.currency)}
        </span>
        <GroupBadge status={group.status} live={live} />
        <span className="tiny faint" style={{ minWidth: 74, textAlign: 'right' }}>
          {live && group.status === 'collecting' ? (
            <Countdown to={group.deadline_at} />
          ) : (
            <span title={new Date(group.deadline_at).toLocaleString()}>{relativeTime(group.deadline_at)}</span>
          )}
        </span>
      </div>
    </Link>
  )
}
