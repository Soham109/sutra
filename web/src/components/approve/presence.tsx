'use client'

import type { GroupMember } from '@/lib/api'
import { Avatar, ConsentThread } from '@/components/ui'
import { MEMBER_LABEL, progressOf } from '@/lib/format'

/**
 * Who else is on this. It updates from the same event stream as everything
 * else, so the moment a friend's thumbprint lands their ring turns — on every
 * phone at once. That shared beat is the reason people trust the group.
 */
export function Presence({
  members,
  meId,
  currency,
  anonymise,
}: {
  members: GroupMember[]
  meId: string
  currency: string
  anonymise: boolean
}) {
  const payers = members.filter((m) => m.role !== 'observer')
  if (payers.length === 0) return null
  const { done, total } = progressOf(members)
  const me = payers.find((m) => m.member_id === meId)

  return (
    <section className="card card-tight" aria-label="The rest of the group">
      <div className="row-between" style={{ padding: '2px 2px 0' }}>
        <span className="eyebrow">The group</span>
        <span className="tiny muted mono">
          {done}/{total} approved
        </span>
      </div>

      {payers.length <= 4 ? (
        <ConsentThread members={payers} currency={currency} showAmounts={false} anonymiseDeclines={anonymise} />
      ) : (
        <div className="ap-faces" style={{ marginTop: 12 }} role="list">
          {payers.map((m) => {
            const hidden = anonymise && ['declined', 'dropped'].includes(m.status)
            const label = hidden ? 'A member' : m.name
            return (
              <div className="ap-face" data-state={m.status} key={m.member_id} role="listitem">
                <div className="ap-ring">
                  <Avatar name={label} size="sm" color={hidden ? 'var(--ink-3)' : undefined} />
                </div>
                <span className={m.member_id === meId ? 'ap-nm is-you' : 'ap-nm'}>
                  {m.member_id === meId ? 'You' : label.split(' ')[0]}
                </span>
                <span className="tiny faint" style={{ fontSize: 10.5 }}>
                  {MEMBER_LABEL[m.status]}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {me && payers.length <= 4 && (
        <p className="tiny faint" style={{ textAlign: 'center', paddingBottom: 4 }}>
          You are {me.name}.
        </p>
      )}
    </section>
  )
}
