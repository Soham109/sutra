'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GroupRow } from '@/components/home/group-row'
import { ProtocolPrimer } from '@/components/home/primer'
import { ProvenanceNote, RecordGrid } from '@/components/home/record'
import { Section } from '@/components/home/section'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { ErrorNote, Skeleton } from '@/components/ui'
import { api, type Group } from '@/lib/api'

/**
 * Home orients you in one screen: what is live right now, what your record
 * says, what just finished. Everything else in the app is reachable from here
 * in one click.
 */
export default function HomePage() {
  const { user, reliability, loading } = useSession()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState('')
  const [today, setToday] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await api.get<{ groups: Group[] }>('/v1/my/groups')
      setGroups(res.groups ?? [])
    } catch (e) {
      setError((e as Error).message)
      setGroups([])
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  // Rendered after mount so the server and the client never disagree on a date.
  useEffect(() => {
    setToday(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))
  }, [])

  const { live, finished } = useMemo(() => {
    const all = groups ?? []
    return {
      live: all.filter((g) => !g.terminal),
      finished: all.filter((g) => g.terminal),
    }
  }, [groups])

  const busy = loading || groups === null
  const fresh = !busy && !error && (groups?.length ?? 0) === 0
  const currency = groups?.[0]?.currency ?? 'USD'

  return (
    <Shell crumbs={<span className="here">Home</span>}>
      <div className="page">
        <header className="page-head row-between wrap" style={{ gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            {today && <div className="eyebrow" style={{ marginBottom: 6 }}>{today}</div>}
            <h1>{user ? `Hello, ${user.name.split(' ')[0]}` : 'Hello'}</h1>
            <p className="muted" style={{ maxWidth: '58ch' }}>
              One cart, one deadline. Everyone approves their own share on their own card — the group commits together,
              or nobody is charged.
            </p>
          </div>
          <Link href="/app/discover" className="btn btn-primary btn-lg">
            Start a group buy
          </Link>
        </header>

        <div className="stack" style={{ ['--gap' as string]: '28px' }}>
          {error && (
            <ErrorNote>
              We couldn’t load your groups just now — {error}.{' '}
              <button
                className="btn btn-ghost tiny"
                style={{ padding: '0 4px', textDecoration: 'underline' }}
                onClick={() => void load()}
              >
                Try again
              </button>
            </ErrorNote>
          )}

          {busy && (
            <div className="card card-pad col" style={{ gap: 14 }}>
              <Skeleton h={14} w={120} />
              <Skeleton h={40} />
              <Skeleton h={40} />
            </div>
          )}

          {/* Live first. If something is in flight, it owns the top of the page. */}
          {!busy && live.length > 0 && (
            <Section
              title={live.length === 1 ? 'One group in flight' : `${live.length} groups in flight`}
              live
              action={
                <Link href="/app/groups" className="small" style={{ color: 'var(--brand)' }}>
                  All groups →
                </Link>
              }
            >
              <div className="card">
                {live.map((g) => (
                  <GroupRow key={g.group_id} group={g} />
                ))}
              </div>
              <p className="tiny faint" style={{ marginTop: 8 }}>
                A group only commits when its policy is met. Until then nothing is charged, and any member can still
                decline.
              </p>
            </Section>
          )}

          {/* The teaching state: this is what a fresh account sees. */}
          {fresh && (
            <Section title="How a sutra buy works" hint="thirty seconds, then you can run one">
              <div className="card card-pad col" style={{ gap: 16 }}>
                <ProtocolPrimer />
                <div className="row wrap" style={{ gap: 10 }}>
                  <Link href="/app/discover" className="btn btn-primary btn-lg">
                    Find something to buy
                  </Link>
                  <Link href="/app/people" className="btn btn-secondary btn-lg">
                    Or find your people first
                  </Link>
                </div>
                <p className="tiny faint" style={{ margin: 0 }}>
                  Paste any product link, or search the sources this engine can actually reach. You pick the people and
                  the rule; everyone else approves their own share.
                </p>
              </div>
            </Section>
          )}

          {!busy && !fresh && live.length === 0 && (
            <Section title="Nothing in flight">
              <div className="card card-pad row-between wrap" style={{ gap: 12 }}>
                <p className="small muted" style={{ margin: 0, maxWidth: '52ch' }}>
                  No group is waiting on you. Your record below is unchanged until you hold another seat.
                </p>
                <Link href="/app/discover" className="btn btn-primary">
                  Start a group buy
                </Link>
              </div>
            </Section>
          )}

          <Section title="Your record" hint="evidence, not a score">
            <div className="card card-pad">
              <RecordGrid r={loading ? null : reliability} currency={currency} />
              <ProvenanceNote />
              {!loading && reliability && reliability.groups === 0 && (
                <p className="small muted" style={{ marginTop: 10 }}>
                  Empty is honest: you haven’t held a seat yet. Approve one share and every number here starts filling
                  in on its own.
                </p>
              )}
            </div>
          </Section>

          {!busy && finished.length > 0 && (
            <Section
              title="Recently finished"
              action={
                <Link href="/app/receipts" className="small" style={{ color: 'var(--brand)' }}>
                  Receipts →
                </Link>
              }
            >
              <div className="card">
                {finished.slice(0, 6).map((g) => (
                  <GroupRow key={g.group_id} group={g} finished />
                ))}
              </div>
              {finished.length > 6 && (
                <p className="tiny faint" style={{ marginTop: 8 }}>
                  Showing the last 6 of {finished.length}.{' '}
                  <Link href="/app/groups" style={{ color: 'var(--brand)' }}>
                    See every group →
                  </Link>
                </p>
              )}
            </Section>
          )}
        </div>
      </div>
    </Shell>
  )
}
