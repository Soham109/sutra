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
  request_sent: boolean
  request_received: boolean
}

/**
 * People are not profiles here. Friendship is a request you send and they
 * accept — never an instant add. The only facts shown about someone are what
 * the event log already proved.
 */
export default function PeoplePage() {
  const { user, refresh } = useSession()
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [incoming, setIncoming] = useState<User[]>([])
  const [outgoing, setOutgoing] = useState<User[]>([])
  const [records, setRecords] = useState<Record<string, Reliability>>({})
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const asked = useRef<Set<string>>(new Set())

  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get<{ incoming: User[]; outgoing: User[] }>('/v1/people/requests')
      setIncoming(res.incoming ?? [])
      setOutgoing(res.outgoing ?? [])
    } catch {
      // Directory still works without the inbox; don't blank the page.
    }
  }, [])

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
    void loadRequests()
    const id = setTimeout(() => void search(q), q ? 200 : 0)
    return () => clearTimeout(id)
  }, [q, user, search, loadRequests])

  useEffect(() => {
    if (!people) return
    // /v1/people/:id/reliability only answers for yourself or a friend
    // (engine/src/routes-v2.ts) — everyone else is a guaranteed 403. The
    // directory used to include every account on the engine, so this fired
    // one doomed request per stranger on the page. Only ask for people the
    // route will actually answer for.
    const todo = people.filter((p) => (p.is_friend || p.is_me) && !asked.current.has(p.id))
    if (todo.length === 0) return
    todo.forEach((p) => asked.current.add(p.id))
    void Promise.all(
      todo.map(async (p) => {
        try {
          const res = await api.get<{ user: User; reliability: Reliability }>(`/v1/people/${p.id}/reliability`)
          setRecords((prev) => ({ ...prev, [p.id]: res.reliability }))
        } catch {
          asked.current.delete(p.id)
        }
      }),
    )
  }, [people])

  const patchPerson = (id: string, patch: Partial<Person>) => {
    setPeople((prev) => prev?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? prev)
  }

  const sendRequest = async (p: Person) => {
    setBusyId(p.id)
    setError('')
    try {
      const res = await api.post<{ state: 'friends' | 'requested' | 'already' }>(`/v1/people/${p.id}/friend`)
      if (res.state === 'friends' || res.state === 'already') {
        patchPerson(p.id, { is_friend: true, request_sent: false, request_received: false })
      } else {
        patchPerson(p.id, { is_friend: false, request_sent: true, request_received: false })
      }
      await loadRequests()
      await refresh()
    } catch (e) {
      setError(`We couldn’t ask ${p.name} — ${(e as Error).message}. Nothing changed; try again.`)
    } finally {
      setBusyId(null)
    }
  }

  const accept = async (p: { id: string; name: string }) => {
    setBusyId(p.id)
    setError('')
    try {
      await api.post(`/v1/people/${p.id}/accept`)
      patchPerson(p.id, { is_friend: true, request_sent: false, request_received: false })
      await loadRequests()
      await refresh()
    } catch (e) {
      setError(`We couldn’t accept ${p.name} — ${(e as Error).message}.`)
    } finally {
      setBusyId(null)
    }
  }

  const decline = async (p: { id: string; name: string }) => {
    setBusyId(p.id)
    setError('')
    try {
      await api.post(`/v1/people/${p.id}/decline`)
      patchPerson(p.id, { request_received: false })
      await loadRequests()
    } catch (e) {
      setError(`We couldn’t decline ${p.name} — ${(e as Error).message}.`)
    } finally {
      setBusyId(null)
    }
  }

  const unfriend = async (p: Person) => {
    setBusyId(p.id)
    setError('')
    try {
      await api.post(`/v1/people/${p.id}/unfriend`)
      patchPerson(p.id, { is_friend: false, request_sent: false, request_received: false })
      await loadRequests()
      await refresh()
    } catch (e) {
      setError(`We couldn’t remove ${p.name} — ${(e as Error).message}.`)
    } finally {
      setBusyId(null)
    }
  }

  const { friends, others } = useMemo(() => {
    const all = [...(people ?? [])].sort((a, b) => a.name.localeCompare(b.name))
    return {
      friends: all.filter((p) => p.is_friend),
      others: all
        .filter((p) => !p.is_friend)
        .sort((a, b) => Number(b.is_me) - Number(a.is_me) || Number(b.request_received) - Number(a.request_received)),
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
            Search anyone on Sutra by name or handle to send a request. Below that are the people
            you already know — friends, and anyone you have shared a group or plan with.
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

          {incoming.length > 0 && (
            <Section title="Wants to be friends" hint={`${incoming.length}`}>
              <div className="card">
                {incoming.map((p) => (
                  <div key={p.id} className="list-row wrap">
                    <Avatar name={p.name} color={p.accent} />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 550 }}>{p.name}</span>
                      <span className="tiny faint mono">@{p.handle}</span>
                    </span>
                    <button
                      className="btn btn-primary"
                      disabled={busyId === p.id}
                      onClick={() => void accept(p)}
                    >
                      {busyId === p.id ? 'Saving…' : 'Accept'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busyId === p.id}
                      onClick={() => void decline(p)}
                    >
                      Decline
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {outgoing.length > 0 && (
            <Section title="Requests you sent" hint={`${outgoing.length}`}>
              <div className="card">
                {outgoing.map((p) => (
                  <div key={p.id} className="list-row wrap">
                    <Avatar name={p.name} color={p.accent} />
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 550 }}>{p.name}</span>
                      <span className="tiny faint mono">@{p.handle}</span>
                    </span>
                    <Badge>pending</Badge>
                  </div>
                ))}
              </div>
            </Section>
          )}

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
                  Try their exact @handle. Only people with a Sutra account appear here.
                </Empty>
              ) : (
                <Empty
                  title="No one here yet"
                  action={
                    <Link href="/app" className="btn btn-primary">
                      Start a group
                    </Link>
                  }
                >
                  Search for someone with a Sutra account, then send a friend request.
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
                        onPrimary={() => void unfriend(p)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="well small muted">
                    No friends yet. Send a request below — they have to accept before you can put them on a split.
                  </div>
                )}
              </Section>

              <Section title={q ? 'Search results' : 'You’ve shared a group or plan with them'} hint={`${others.length}`}>
                {others.length > 0 ? (
                  <div className="card">
                    {others.map((p) => (
                      <PersonRow
                        key={p.id}
                        person={p}
                        record={records[p.id]}
                        busy={busyId === p.id}
                        onOpen={() => setOpenId(p.id)}
                        onPrimary={() =>
                          void (p.request_received ? accept(p) : p.request_sent ? undefined : sendRequest(p))
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="well small muted">
                    {q
                      ? 'Nobody matches that search.'
                      : 'Nobody yet. Search above by name or @handle to find anyone on Sutra and send them a request.'}
                  </div>
                )}
              </Section>
            </>
          )}

          <p className="tiny faint">Approval history only reflects completed Sutra groups. No history simply means they are new.</p>
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
                {open.request_sent && <Badge>requested</Badge>}
                {open.request_received && <Badge tone="brand">wants to be friends</Badge>}
              </div>
              <div className="small faint mono">@{open.handle}</div>
            </div>
            {!open.is_me && (
              <FriendAction
                person={open}
                busy={busyId === open.id}
                onSend={() => void sendRequest(open)}
                onAccept={() => void accept(open)}
                onUnfriend={() => void unfriend(open)}
              />
            )}
          </div>

          {open.is_friend || open.is_me ? (
            <RecordGrid r={records[open.id] ?? null} />
          ) : (
            // /v1/people/:id/reliability refuses this for a stranger (engine/src/routes-v2.ts)
            // — so this page never asks. Say why instead of spinning forever.
            <div className="well small muted">Reliability is visible only to you and your friends.</div>
          )}
          <ProvenanceNote who={`${open.is_me ? 'Your' : open.name.split(' ')[0] + '’s'}`} />
        </Modal>
      )}
    </Shell>
  )
}

function FriendAction({
  person,
  busy,
  onSend,
  onAccept,
  onUnfriend,
}: {
  person: Person
  busy: boolean
  onSend: () => void
  onAccept: () => void
  onUnfriend: () => void
}) {
  if (person.is_friend) {
    return (
      <button className="btn btn-secondary" disabled={busy} onClick={onUnfriend}>
        {busy ? 'Saving…' : 'Remove friend'}
      </button>
    )
  }
  if (person.request_received) {
    return (
      <button className="btn btn-primary" disabled={busy} onClick={onAccept}>
        {busy ? 'Saving…' : 'Accept request'}
      </button>
    )
  }
  if (person.request_sent) {
    return (
      <button className="btn btn-secondary" disabled>
        Requested
      </button>
    )
  }
  return (
    <button className="btn btn-primary" disabled={busy} onClick={onSend}>
      {busy ? 'Sending…' : 'Add friend'}
    </button>
  )
}

function PersonRow({
  person,
  record,
  busy,
  onOpen,
  onPrimary,
}: {
  person: Person
  record?: Reliability
  busy: boolean
  onOpen: () => void
  onPrimary: () => void
}) {
  const label = person.is_friend
    ? 'Friends'
    : person.request_received
      ? 'Accept'
      : person.request_sent
        ? 'Requested'
        : 'Add friend'

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
            {person.request_sent && <Badge>pending</Badge>}
          </span>
          <span className="tiny faint mono">@{person.handle}</span>
        </span>
      </button>

      <RecordLine r={record} loading={(person.is_friend || person.is_me) && !record} />

      {!person.is_me && (
        <button
          className={person.is_friend || person.request_sent ? 'btn btn-secondary' : 'btn btn-primary'}
          onClick={onPrimary}
          disabled={busy || person.request_sent}
          title={label}
        >
          {busy ? 'Saving…' : label}
        </button>
      )}
    </div>
  )
}
