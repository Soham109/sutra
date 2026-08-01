'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ApproveFrame, BadLink } from '@/components/approve/chrome'
import { humanError, type Joinable } from '@/components/approve/model'
import { Avatar, Badge, Empty, Skeleton, StatusBadge } from '@/components/ui'
import { api } from '@/lib/api'

/**
 * /j/:groupId — what the NFC totem and the shared QR point at.
 *
 * One tag on the table, everybody taps it, everybody lands here and picks
 * themselves. From that moment each person is on their own approval page with
 * their own passkey — which is why sharing this link is safe.
 */
export default function JoinPage() {
  const params = useParams<{ groupId: string }>()
  const groupId = String(params?.groupId ?? '')

  const [data, setData] = useState<Joinable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.get<Joinable>(`/v1/groups/${groupId}/joinable`))
      setError(null)
    } catch (e) {
      setError(humanError(e))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <ApproveFrame>
        <div className="stack" style={{ ['--gap' as string]: '12px' }}>
          <Skeleton h={13} w="40%" />
          <Skeleton h={24} w="70%" />
          <Skeleton h={56} />
          <Skeleton h={56} />
          <Skeleton h={56} />
        </div>
      </ApproveFrame>
    )
  }

  if (!data) {
    return (
      <ApproveFrame>
        <BadLink
          message={error ?? 'This group could not be opened.'}
          onRetry={() => void load()}
        />
      </ApproveFrame>
    )
  }

  const payers = data.members.filter((m) => m.role !== 'observer')
  const observers = data.members.length - payers.length

  return (
    <ApproveFrame>
      <div style={{ marginBottom: 16 }}>
        <div className="eyebrow">Tap to join</div>
        <h1 className="ap-title" style={{ marginTop: 4 }}>
          {data.title}
        </h1>
        <p className="small muted">Which one are you?</p>
      </div>

      {payers.length === 0 ? (
        <Empty title="Nobody to claim">
          This group has no payers yet. Whoever set it up needs to add people before anyone can approve a share.
        </Empty>
      ) : (
        <div className="card">
          {payers.map((m) => (
            <Link key={m.member_id} href={`/a/${m.member_id}`} className="list-row">
              <Avatar name={m.name} />
              <div className="grow">
                <div style={{ fontWeight: 550 }}>{m.name}</div>
                <div className="tiny faint">{m.role === 'payer' ? 'Paying a share' : m.role}</div>
              </div>
              {m.claimable ? <Badge tone="brand">tap to open</Badge> : <StatusBadge status={m.status} />}
            </Link>
          ))}
        </div>
      )}

      {observers > 0 && (
        <p className="tiny faint" style={{ marginTop: 10 }}>
          {observers} {observers === 1 ? 'person is' : 'people are'} watching this group without paying.
        </p>
      )}

      <div className="note note-plain" style={{ marginTop: 18 }}>
        <span aria-hidden>🔑</span>
        <span>
          This link is safe to share and useless on its own. Picking a name only opens that person&apos;s page —
          approving still needs <b>their</b> passkey, on <b>their</b> device, against <b>their</b> card. A leaked
          tag cannot spend anybody&apos;s money.
        </span>
      </div>

      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 18 }}>
        Not on the list? Ask whoever started the group to add you — shares are quoted per person before anyone
        approves.
      </p>
    </ApproveFrame>
  )
}
