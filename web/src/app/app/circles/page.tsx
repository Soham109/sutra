'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Section } from '@/components/home/section'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { Avatar, Empty, ErrorNote, Modal, Skeleton } from '@/components/ui'
import { api, type Circle, type User } from '@/lib/api'

interface Person extends User {
  is_friend: boolean
  is_me: boolean
}

const EMOJI = ['🧵', '🍜', '🎟️', '🏔️', '🏠', '🎧', '🛒', '☕', '🎂', '🚗', '📦', '🎮']

/**
 * A circle is memory, not authority: it remembers who you keep buying with so
 * you are not retyping the same five people. It cannot spend anything, and it
 * does not carry a standing mandate — that is deliberately not shipped.
 */
export default function CirclesPage() {
  const { user, refresh } = useSession()
  const [circles, setCircles] = useState<Circle[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await api.get<{ circles: Circle[] }>('/v1/circles')
      setCircles(res.circles ?? [])
    } catch (e) {
      setError((e as Error).message)
      setCircles([])
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const remove = async (id: string) => {
    setBusyId(id)
    setError('')
    try {
      const res = await api.post<{ circles: Circle[] }>(`/v1/circles/${id}/delete`)
      setCircles(res.circles ?? [])
      setConfirmId(null)
      await refresh()
    } catch (e) {
      setError(`That circle is still there — ${(e as Error).message}. Nothing was deleted; try again.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Shell
      crumbs={
        <>
          <Link href="/app">Home</Link>
          <span className="sep">/</span>
          <span className="here">Circles</span>
        </>
      }
    >
      <div className="page">
        <header className="page-head row-between wrap" style={{ gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1>Circles</h1>
            <p className="muted" style={{ maxWidth: '58ch' }}>
              A circle is a group you keep re-forming — the flatmates, the five people who always split the ramen run.
              It saves you picking the same seats every time.
            </p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
            New circle
          </button>
        </header>

        <div className="stack" style={{ ['--gap' as string]: '24px' }}>
          {error && <ErrorNote>{error}</ErrorNote>}

          {circles === null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {[0, 1, 2].map((i) => (
                <div className="card card-pad col" key={i} style={{ gap: 12 }}>
                  <Skeleton h={40} w={40} />
                  <Skeleton h={14} w="60%" />
                  <Skeleton h={11} w="40%" />
                  <Skeleton h={28} />
                </div>
              ))}
            </div>
          )}

          {circles !== null && circles.length === 0 && (
            <div className="card">
              <Empty
                title="No circles yet"
                action={
                  <button className="btn btn-primary" onClick={() => setCreating(true)}>
                    Create your first circle
                  </button>
                }
              >
                A circle just remembers a set of people so you can re-form the same group in one tap. It holds no money
                and grants no permission — every buy still needs each member to approve their own share.
              </Empty>
            </div>
          )}

          {circles !== null && circles.length > 0 && (
            <Section title={circles.length === 1 ? '1 circle' : `${circles.length} circles`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                {circles.map((c) => (
                  <CircleCard
                    key={c.id}
                    circle={c}
                    meId={user?.id}
                    confirming={confirmId === c.id}
                    busy={busyId === c.id}
                    onAskDelete={() => setConfirmId(c.id)}
                    onCancelDelete={() => setConfirmId(null)}
                    onDelete={() => void remove(c.id)}
                  />
                ))}
              </div>
            </Section>
          )}

          <div className="note note-plain">
            <span aria-hidden>🗺</span>
            <span>
              Today a circle remembers people, and that is all it does. Default policies, standing trust lines and
              recurring group mandates are on the roadmap — they are not shipped, so we are not going to draw them as if
              they were.
            </span>
          </div>
        </div>
      </div>

      {creating && (
        <CreateCircle
          onClose={() => setCreating(false)}
          onCreated={(circle) => {
            setCircles((prev) => [circle, ...(prev ?? [])])
            setCreating(false)
            void refresh()
          }}
        />
      )}
    </Shell>
  )
}

function CircleCard({
  circle,
  meId,
  confirming,
  busy,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  circle: Circle
  meId?: string
  confirming: boolean
  busy: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const isOwner = !!meId && circle.owner_id === meId
  const owner = circle.members.find((m) => m.id === circle.owner_id)
  const ownerLabel = isOwner ? 'owned by you' : owner ? `owned by ${owner.name}` : 'owner has left'
  const shown = circle.members.slice(0, 5)

  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 11 }}>
        <span
          style={{
            fontSize: 21,
            width: 42,
            height: 42,
            flex: 'none',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
          }}
          aria-hidden
        >
          {circle.emoji}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {circle.name}
          </div>
          <div className="tiny faint">
            <span className="mono">{circle.members.length}</span> {circle.members.length === 1 ? 'person' : 'people'} ·{' '}
            {ownerLabel}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 9 }}>
        <div className="avatar-stack">
          {shown.map((m) => (
            <Avatar key={m.id} name={m.name} color={m.accent} size="sm" />
          ))}
        </div>
        <span className="tiny faint" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {circle.members.map((m) => (m.id === meId ? 'you' : m.name.split(' ')[0])).join(', ')}
        </span>
      </div>

      {confirming ? (
        <div className="well col" style={{ gap: 10 }}>
          <span className="small">
            Delete <b>{circle.name}</b>? The people stay — only the shortcut goes.
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete circle'}
            </button>
            <button className="btn btn-ghost" onClick={onCancelDelete} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="row-between" style={{ gap: 8 }}>
          <Link className="btn btn-secondary" href="/app/discover">
            Start a buy →
          </Link>
          {isOwner && (
            <button className="btn btn-ghost small" onClick={onAskDelete}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CreateCircle({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Circle) => void }) {
  const { user } = useSession()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(EMOJI[0]!)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [people, setPeople] = useState<Person[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ people: Person[] }>('/v1/people')
        setPeople(res.people ?? [])
      } catch (e) {
        setError(`We couldn’t load people — ${(e as Error).message}. You can still name the circle and add them later.`)
        setPeople([])
      }
    })()
  }, [])

  const candidates = useMemo(() => {
    const list = (people ?? []).filter((p) => !p.is_me)
    const needle = q.trim().toLowerCase()
    return list
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.handle.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.is_friend) - Number(a.is_friend) || a.name.localeCompare(b.name))
  }, [people, q])

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ circle: Circle }>('/v1/circles', {
        name: name.trim(),
        emoji,
        member_ids: [...picked],
      })
      onCreated(res.circle)
    } catch (e) {
      setError(`That didn’t save — ${(e as Error).message}. Nothing was created; adjust and try again.`)
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New circle"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : `Create circle${picked.size ? ` · ${picked.size + 1}` : ''}`}
          </button>
        </>
      }
    >
      <div className="stack" style={{ ['--gap' as string]: '16px' }}>
        {error && <ErrorNote>{error}</ErrorNote>}

        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flat 3B"
            maxLength={60}
          />
        </label>

        <div className="field">
          <span className="field-label">Emoji</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {EMOJI.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                aria-label={`Emoji ${e}`}
                style={{
                  fontSize: 18,
                  width: 38,
                  height: 38,
                  cursor: 'pointer',
                  borderRadius: 'var(--r-sm)',
                  background: emoji === e ? 'var(--brand-soft)' : 'var(--surface)',
                  border: `1px solid ${emoji === e ? 'var(--brand)' : 'var(--line-2)'}`,
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">People</span>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or @handle…"
            aria-label="Filter people"
          />
          <div
            style={{
              marginTop: 8,
              maxHeight: 240,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
            }}
          >
            {people === null && (
              <div className="col" style={{ gap: 10, padding: 14 }}>
                <Skeleton h={14} />
                <Skeleton h={14} />
                <Skeleton h={14} />
              </div>
            )}
            {people !== null && candidates.length === 0 && (
              <p className="small muted" style={{ padding: 14, margin: 0 }}>
                {q
                  ? `Nobody matches “${q}”.`
                  : 'Nobody else is on this engine yet — create the circle and add people once they arrive.'}
              </p>
            )}
            {candidates.map((p) => (
              <label
                key={p.id}
                className="list-row"
                style={{ cursor: 'pointer', padding: '9px 12px', gap: 10 }}
              >
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={picked.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <Avatar name={p.name} color={p.accent} size="sm" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 550 }}>
                    {p.name}
                  </span>{' '}
                  <span className="tiny faint mono">@{p.handle}</span>
                </span>
                {p.is_friend && <span className="chip">friend</span>}
              </label>
            ))}
          </div>
        </div>

        <p className="tiny faint" style={{ margin: 0 }}>
          {user ? `You (@${user.handle}) are always a member of a circle you create. ` : ''}
          A circle is only a shortcut for picking seats — it can never approve or spend on anyone’s behalf.
        </p>
      </div>
    </Modal>
  )
}
