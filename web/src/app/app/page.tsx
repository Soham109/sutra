'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Launchpad } from '@/components/home/launchpad'
import { GroupRow } from '@/components/home/group-row'
import { ProvenanceNote, RecordGrid } from '@/components/home/record'
import { Section } from '@/components/home/section'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { ErrorNote, Skeleton } from '@/components/ui'
import { api, type Group } from '@/lib/api'

export default function HomePage() {
  const { reliability, loading } = useSession()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const response = await api.get<{ groups: Group[] }>('/v1/my/groups')
      setGroups(response.groups ?? [])
    } catch (cause) {
      setError((cause as Error).message)
      setGroups([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const { live, finished } = useMemo(() => {
    const all = groups ?? []
    return { live: all.filter((group) => !group.terminal), finished: all.filter((group) => group.terminal) }
  }, [groups])

  const busy = loading || groups === null
  const currency = groups?.[0]?.currency ?? 'USD'

  return (
    <Shell crumbs={<span className="here">Today</span>}>
      <div className="page home-page">
        <Launchpad />

        {error && <ErrorNote>We couldn’t refresh your groups — {error}. <button className="text-button" onClick={() => void load()}>Try again</button></ErrorNote>}

        {busy && <div className="home-loading"><Skeleton h={90} /><Skeleton h={90} /><Skeleton h={90} /></div>}

        {!busy && live.length > 0 && (
          <Section title={live.length === 1 ? 'Happening now' : 'Happening now'} live action={<Link href="/app/groups">See all ↗</Link>}>
            <div className="home-ledger">{live.map((group) => <GroupRow key={group.group_id} group={group} />)}</div>
          </Section>
        )}

        {!busy && live.length === 0 && (
          <section className="quiet-state">
            <div><span className="eyebrow">Nothing waiting</span><h2>Your next plan starts above.</h2></div>
            <p>No reminders to send and nobody to chase. When you start a split, its approvals and deadline will live here.</p>
          </section>
        )}

        <div className="home-two-col">
          <Section title="Your rhythm" hint="private, evidence-based">
            <div className="record-surface"><RecordGrid r={loading ? null : reliability} currency={currency} /><ProvenanceNote /></div>
          </Section>
          <section className="model-note">
            <span className="eyebrow">The model</span>
            <h2>Items belong to people.<br />Fees belong to the cart.</h2>
            <p>Assign exact seats, rooms or dishes; split shared fees proportionally; sponsor someone; add a backstop; then choose the rule that lets the group commit.</p>
            <Link href="/app/discover">Build a precise split <span>↗</span></Link>
          </section>
        </div>

        {!busy && finished.length > 0 && (
          <Section title="Recently settled" action={<Link href="/app/receipts">All receipts ↗</Link>}>
            <div className="home-ledger">{finished.slice(0, 5).map((group) => <GroupRow key={group.group_id} group={group} finished />)}</div>
          </Section>
        )}
      </div>
    </Shell>
  )
}
