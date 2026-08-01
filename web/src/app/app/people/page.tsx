'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProvenanceNote, RecordGrid, RecordLine } from '@/components/home/record'
import { Section } from '@/components/home/section'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { Avatar, Badge, Empty, ErrorNote, Modal, Skeleton } from '@/components/ui'
import { api, type Reliability, type User } from '@/lib/api'

interface Person extends User {
  is_friend: boolean
  is_me: boolean
}

/**
 * People are not profiles here. The only thing this page can tell you about
 * someone is what the event log already proved: how often they approved, how
 * fast, and what they carried for other people.
 */
export default function PeoplePage() {
  const { user, refresh } = useSession()
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [records, setRecords] = useState<Record<string, Reliability>>({})
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const asked = useRef<Set<string>>(new Set())

  const search = useCallback(async (query: string) => {
    setError('')
    try {
      const res = await api.get<{ people: Person[] }>(`/v1/people?q=${encodeURIComponent(query)}`)
      setPeople(res.people ?? [])
    } catch (e) {
      setError((e as Error).message)
      setPeople([])
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const id = setTimeout(() => void search(q), q ? 200 : 0)
    return () => clearTimeout(id)
  }, [q, user, search])

  // Records load per person, in parallel, and only once each — the list paints
  // immediately and each row fills itself in.
  useEffect(() => {
    if (!people) return
    const todo = people.filter((p) => !asked.current.has(p.id))
    if (todo.length === 0) return
    todo.forEach((p) => asked.current.add(p.id))
    void Promise.all(
      todo.map(async (p) => {
        try {
          const res = await api.get<{ user: User; reliability: Reliability }>(`/v1/people/${p.id}/reliability`)
          setRecords((prev) => ({ ...prev, [p.id]: res.reliability }))
        } catch {
          asked.current.delete(p.id) // let a later render retry rather than lie
        }
      }),
    )
  }, [people])

  const toggleFriend = async (p: Person) => {
    setBusyId(p.id)
    setError('')
    try {
      await api.post(`/v1/people/${p.id}/${p.is_friend ? 'unfriend' : 'friend'}`)
      setPeople((prev) => prev?.map((x) => (x.id === p.id ? { ...x, is_friend: !p.is_friend } : x)) ?? prev)
      await refresh()
    } catch (e) {
      setError(
        `We couldn’t ${p.is_friend ? 'remove' : 'add'} ${p.name} — ${(e as Error).message}. Nothing changed; try again.`,
      )
    } finally {
      setBusyId(null)
    }
  }

  const { friends, others } = useMemo(() => {
    const all = [...(people ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    return {
      friends: all.filter((p) => p.is_friend),
      others: all.filter((p) => !p.is_friend).sort((a, b) => Number(b.is_me) - Number(a.is_me)),
    }
  }, [people])

  const open = people?.find((p) => p.id === openId) ?? null
  const loading = people === null

  return (
    <Shell
      crumbs={
        <>
          <Link href="/app">Home</Link>
          <span className="sep">/</span>
          <span className="here">People</span>
        </>
      }
    >
      <div className="page">
        <header className="page-head">
          <h1>People</h1>
          <p className="muted" style={{ maxWidth: '58ch' }}>
            Everyone who has ever held a seat on this engine, with the record they earned holding it.
          </p>
        </header>

        <div className="stack" style={{ ['--gap' as string]: '24px' }}>
          <input
            className="input input-lg"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or @handle…"
            aria-label="Search people"
            style={{ maxWidth: 460 }}
          />

          {error && <ErrorNote>{error}</ErrorNote>}

          {loading && (
            <div className="card">
              {[0, 1, 2, 3].map((i) => (
                <div className="list-row" key={i}>
                  <Skeleton h={32} w={32} />
                  <div className="grow col" style={{ gap: 6 }}>
                    <Skeleton h={13} w={140} />
                    <Skeleton h={11} w={90} />
                  </div>
                  <Skeleton h={12} w={120} />
                </div>
              ))}
            </div>
          )}

          {people !== null && people.length === 0 && !error && (
            <div className="card">
              {q ? (
                <Empty
                  title={`Nobody matches “${q}”`}
                  action={
                    <button className="btn btn-secondary" onClick={() => setQ('')}>
                      Clear the search
                    </button>
                  }
                >
                  Handles are exact and names are matched loosely. If they have never used this engine, they will not be
                  here yet.
                </Empty>
              ) : (
                <Empty
                  title="No one here yet"
                  action={
                    <Link href="/app/discover" className="btn btn-primary">
                      Start a group buy
                    </Link>
                  }
                >
                  People appear on this page once they have held a seat in a group — invited, approved or declined. Run
                  one buy and everyone you invite shows up here with a record of their own.
                </Empty>
              )}
            </div>
          )}

          {people !== null && people.length > 0 && (
            <>
              <Section title="Your friends" hint={friends.length ? `${friends.length}` : undefined}>
                {friends.length > 0 ? (
                  <div className="card">
                    {friends.map((p) => (
                      <PersonRow
                        key={p.id}
                        person={p}
                        record={records[p.id]}
                        busy={busyId === p.id}
                        onOpen={() => setOpenId(p.id)}
                        onToggle={() => void toggleFriend(p)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="well small muted">
                    No friends yet. Add someone below and they are one tap away when you are picking seats for a cart —
                    friendship here is just a shortcut, it grants nobody any spending power over you.
                  </div>
                )}
              </Section>

              <Section title="Everyone on this engine" hint={`${others.length}`}>
                {others.length > 0 ? (
                  <div className="card">
                    {others.map((p) => (
                      <PersonRow
                        key={p.id}
                        person={p}
                        record={records[p.id]}
                        busy={busyId === p.id}
                        onOpen={() => setOpenId(p.id)}
                        onToggle={() => void toggleFriend(p)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="well small muted">
                    That is everyone — you have already added every person on this engine.
                  </div>
                )}
              </Section>
            </>
          )}

          <p className="tiny faint">
            Approval rate and median reply are computed from the append-only event log, not entered by anyone. Somebody
            with no record is not untrustworthy — they are just new.
          </p>
        </div>
      </div>

      {open && (
        <Modal title={open.name} onClose={() => setOpenId(null)}>
          <div className="row wrap" style={{ gap: 14, marginBottom: 18 }}>
            <Avatar name={open.name} color={open.accent} size="lg" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 7 }}>
                <span style={{ fontWeight: 600 }}>{open.name}</span>
                {open.is_me && <Badge>you</Badge>}
                {open.is_friend && <Badge tone="brand">friend</Badge>}
              </div>
              <div className="small faint mono">@{open.handle}</div>
            </div>
            {!open.is_me && (
              <button
                className={open.is_friend ? 'btn btn-secondary' : 'btn btn-primary'}
                disabled={busyId === open.id}
                onClick={() => void toggleFriend(open)}
              >
                {busyId === open.id ? 'Saving…' : open.is_friend ? 'Remove friend' : 'Add friend'}
              </button>
            )}
          </div>

          <RecordGrid r={records[open.id] ?? null} />
          <ProvenanceNote who={`${open.is_me ? 'Your' : open.name.split(' ')[0] + '’s'}`} />

          <div className="well" style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Member id
            </div>
            <code className="mono small">{open.id}</code>
          </div>
        </Modal>
      )}
    </Shell>
  )
}

function PersonRow({
  person,
  record,
  busy,
  onOpen,
  onToggle,
}: {
  person: Person
  record?: Reliability
  busy: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  return (
    <div className="list-row wrap">
      <button
        onClick={onOpen}
        className="row grow"
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 170 }}
        aria-label={`Open ${person.name}’s record`}
      >
        <Avatar name={person.name} color={person.accent} />
        <span className="col" style={{ minWidth: 0 }}>
          <span className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {person.name}
            </span>
            {person.is_me && <Badge>you</Badge>}
          </span>
          <span className="tiny faint mono">@{person.handle}</span>
        </span>
      </button>

      <RecordLine r={record} loading={!record} />

      {!person.is_me && (
        <button
          className={person.is_friend ? 'btn btn-secondary' : 'btn btn-primary'}
          onClick={onToggle}
          disabled={busy}
          title={person.is_friend ? 'Remove friend' : 'Add friend'}
        >
          {busy ? 'Saving…' : person.is_friend ? 'Friends' : 'Add friend'}
        </button>
      )}
    </div>
  )
}
