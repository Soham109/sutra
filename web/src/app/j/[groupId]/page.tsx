'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApproveFrame, BadLink } from '@/components/approve/chrome'
import { humanError, type Joinable } from '@/components/approve/model'
import { Avatar, Badge, Countdown, Empty, Skeleton, StatusBadge } from '@/components/ui'
import { GroupBadge } from '@/components/group/badges'
import { money } from '@/lib/format'
import { api } from '@/lib/api'

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
    } catch (cause) {
      setError(humanError(cause))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { void load() }, [load])

  const payers = useMemo(() => data?.members.filter((member) => member.role !== 'observer') ?? [], [data])
  const progress = useMemo(() => ({
    done: payers.filter((member) => ['approved', 'charging', 'charged', 'settled'].includes(member.status)).length,
    total: payers.length,
  }), [payers])

  if (loading && !data) {
    return <ApproveFrame><div className="stack"><Skeleton h={210} /><Skeleton h={70} /><Skeleton h={70} /><Skeleton h={70} /></div></ApproveFrame>
  }

  if (!data) {
    return <ApproveFrame><BadLink message={error ?? 'This group could not be opened.'} onRetry={() => void load()} /></ApproveFrame>
  }

  const observers = data.members.length - payers.length

  return (
    <ApproveFrame live={data.terminal ? null : 'on'}>
      <section className="ap-join-hero">
        <div className="ap-join-meta">
          <span>{data.merchant.name}</span>
          <GroupBadge status={data.status} live={!data.terminal} />
        </div>
        <h1>{data.title}</h1>
        <div className="ap-join-total">{money(data.total, data.currency)}</div>
        <div className="ap-join-progress" aria-label={`${progress.done} of ${progress.total} people approved`}>
          <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
        </div>
        <div className="ap-join-foot">
          <span>{progress.done} of {progress.total} ready</span>
          {!data.terminal ? <Countdown to={data.deadline_at} /> : <span>Group closed</span>}
        </div>
      </section>

      <div className="ap-join-heading">
        <div>
          <h2>Choose your seat</h2>
          <p>
            {data.rail === 'at_venue' || data.rail_capability?.charges === false
              ? 'Open the share with your name. Confirm your amount — no card, no passkey.'
              : 'Open the share with your name. Approval still needs your passkey.'}
          </p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh group status">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {payers.length === 0 ? (
        <Empty title="Nobody to claim">The organizer needs to add people before anyone can approve a share.</Empty>
      ) : (
        <div className="ap-join-list">
          {payers.map((member) => (
            <Link key={member.member_id} href={`/a/${member.member_id}`} className="ap-join-row">
              <Avatar name={member.name} size="lg" />
              <div className="grow">
                <div className="ap-join-name">{member.name}</div>
                <div className="tiny faint">{member.role === 'payer' ? 'Own share' : member.role}</div>
              </div>
              <div className="ap-join-amount">
                <strong>{money(member.share_amount, data.currency)}</strong>
                {member.claimable ? <Badge tone="brand">Open</Badge> : <StatusBadge status={member.status} />}
              </div>
              <span className="ap-join-arrow" aria-hidden>→</span>
            </Link>
          ))}
        </div>
      )}

      {data.policy_text ? <div className="ap-join-rule"><span>Group rule</span><p>{data.policy_text}</p></div> : null}

      {observers > 0 ? <p className="tiny faint" style={{ marginTop: 12 }}>{observers} {observers === 1 ? 'observer is' : 'observers are'} watching without paying.</p> : null}

      <div className="ap-security-note">
        <span aria-hidden>◆</span>
        <p>
          <b>Picking a name cannot spend money.</b>{' '}
          {data.rail === 'at_venue' || data.rail_capability?.charges === false
            ? data.rail === 'shopify_pos'
              ? 'The next screen only confirms that person’s share; everyone still presents their own card at Shopify POS.'
              : data.rail === 'checkout_handoff'
                ? 'The next screen only confirms that person’s proposed share; merchant checkout and payment are still pending.'
                : 'The next screen only confirms that person’s share; everyone pays the venue directly.'
            : 'The next screen still requires that person’s passkey, on their device, against their card.'}
        </p>
      </div>
    </ApproveFrame>
  )
}
