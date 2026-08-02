'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui'
import { useSession } from '@/components/session'
import { api, type User } from '@/lib/api'

// The one place the app asks "who".
//
// Every flow that used to hand you a blank box labelled "Person 2" now offers
// your friends first — ranked by who you actually split something with most
// recently, not A→Z — then your circles, then the rest of the directory if
// you search for someone who isn't a friend yet. Finding a stranger offers a
// friend request right there, inline, with its pending state visible; it
// never silently re-sends one that is already outstanding, because
// `requestFriend` on the engine resolves a crossing request to friendship
// instead of deadlocking (see engine/test/social-privacy.test.ts).
//
// A typed name with no account stays possible — splitting a restaurant bill
// with a stranger at the table is a real case the protocol is built for
// (Social.assertSeatable allows any bare name; it only refuses attaching
// someone else's ACCOUNT without their agreement) — but it is visibly the
// lesser option here: dashed, uncoloured, below the friends, and it says
// plainly what it costs them.

export interface PickedPerson {
  /** Stable identity: used for de-dup and as the chip's react key. */
  key: string
  name: string
  /** Set once this pick is a real sutra account. This is what makes the
   *  member notifiable and gives the seat a real dashboard entry — see
   *  CreateGroupSchema's `member.user_id` in engine/src/types.ts. */
  userId?: string
  handle?: string
  accent?: string
}

/** Same person in, same key out — a friend is identified by account, a typed
 *  name by its lowercased text, so re-adding either one is a no-op. */
export function personKey(p: { userId?: string; name: string }): string {
  return p.userId ? `u:${p.userId}` : `n:${p.name.trim().toLowerCase()}`
}

interface DirectoryPerson extends User {
  is_friend: boolean
  is_me: boolean
  request_sent: boolean
  request_received: boolean
}

interface PickerCircle {
  id: string
  name: string
  emoji?: string
  members: { id: string; name: string; accent?: string }[]
}

type RequestState = 'sending' | 'sent' | 'error'

export function PeoplePicker({
  value,
  onChange,
  label = 'Who’s in this',
}: {
  value: PickedPerson[]
  onChange: (next: PickedPerson[]) => void
  label?: string
}) {
  const { friends, circles, recentWith, refresh } = useSession()
  const [query, setQuery] = useState('')
  const [directory, setDirectory] = useState<DirectoryPerson[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [pending, setPending] = useState<Record<string, RequestState>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedKeys = useMemo(() => new Set(value.map((p) => p.key)), [value])

  const add = (p: Omit<PickedPerson, 'key'>) => {
    const key = personKey(p)
    if (selectedKeys.has(key)) return
    onChange([...value, { ...p, key }])
    setQuery('')
  }
  const remove = (key: string) => onChange(value.filter((p) => p.key !== key))

  const friendMatching = (name: string) =>
    friends.find((f) => f.name.trim().toLowerCase() === name.trim().toLowerCase())

  // Enter always adds — but if the exact text you typed is a friend's name,
  // link their real account rather than creating a second, unlinked "person"
  // who happens to share a name with someone the app already knows. This is
  // the fast path for the common case (you know exactly who you're adding);
  // anything that doesn't match a friend becomes a bare-name, link-only seat
  // — engine/src/social.ts Social.assertSeatable allows that unconditionally.
  const addTyped = (raw: string) => {
    const name = raw.trim()
    if (!name) return
    const match = friendMatching(name)
    if (match) {
      add({ userId: match.id, name: match.name, handle: match.handle, accent: match.accent })
      return
    }
    add({ name })
  }

  // Friends ranked "who did I just split something with", not alphabetical —
  // recentWith is real evidence off shared groups (Social.recentCollaborators).
  const rankedFriends = useMemo(() => {
    const rank = new Map(recentWith.map((id, i) => [id, i]))
    const q = query.trim().toLowerCase()
    return [...friends]
      .filter((f) => !selectedKeys.has(personKey({ userId: f.id, name: f.name })))
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.handle.toLowerCase().includes(q))
      .sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id)! : Infinity
        const rb = rank.has(b.id) ? rank.get(b.id)! : Infinity
        return ra - rb || a.name.localeCompare(b.name)
      })
      .slice(0, 8)
  }, [friends, recentWith, query, selectedKeys])

  // The rest of the directory, searched live — only once you type. Listing
  // every account on the engine unprompted is not a "suggestion".
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setDirectory(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const id = setTimeout(() => {
      api
        .get<{ people: DirectoryPerson[] }>(`/v1/people?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (alive) setDirectory(res.people ?? [])
        })
        .catch(() => {
          if (alive) setDirectory([])
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, 220)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query])

  const strangers = useMemo(
    () =>
      (directory ?? [])
        .filter((p) => !p.is_me && !p.is_friend)
        .filter((p) => !selectedKeys.has(personKey({ userId: p.id, name: p.name })))
        .slice(0, 6),
    [directory, selectedKeys],
  )

  /** Ask to be friends — or, if they already asked you, this accepts instead. */
  const sendRequest = async (p: DirectoryPerson) => {
    setPending((prev) => ({ ...prev, [p.id]: 'sending' }))
    try {
      const res = await api.post<{ state: 'friends' | 'requested' | 'already' }>(`/v1/people/${p.id}/friend`)
      if (res.state === 'requested') {
        setPending((prev) => ({ ...prev, [p.id]: 'sent' }))
      } else {
        setPending((prev) => {
          const next = { ...prev }
          delete next[p.id]
          return next
        })
        add({ userId: p.id, name: p.name, handle: p.handle, accent: p.accent })
      }
      void refresh()
    } catch {
      setPending((prev) => ({ ...prev, [p.id]: 'error' }))
    }
  }

  const addCircle = (c: PickerCircle) => {
    let next = value
    for (const m of c.members) {
      const key = personKey({ userId: m.id, name: m.name })
      if (next.some((v) => v.key === key)) continue
      next = [...next, { key, name: m.name, userId: m.id, accent: m.accent }]
    }
    if (next !== value) onChange(next)
  }

  // The lesser option, on purpose: only offered once there's no friend whose
  // name matches exactly (that case has a better answer — link the account),
  // and only while you're still typing something that isn't already a chip.
  const showTypedFallback =
    query.trim() !== '' && !friendMatching(query) && !selectedKeys.has(personKey({ name: query }))

  return (
    <div className="field picker">
      <span className="field-label">{label}</span>

      {value.length > 0 && (
        <ul className="picker-chips">
          {value.map((p) => (
            <li key={p.key} className={p.userId ? undefined : 'is-unlinked'}>
              <Avatar name={p.name} color={p.accent} size="sm" />
              <span>{p.name}</span>
              {!p.userId && (
                <span
                  className="picker-chip-flag"
                  title="No account — they’ll get a link, but no notifications and no history."
                >
                  no account
                </span>
              )}
              <button type="button" onClick={() => remove(p.key)} aria-label={`Remove ${p.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="picker-entry">
        <input
          ref={inputRef}
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTyped(query)
            }
            if (e.key === 'Backspace' && !query && value.length) remove(value[value.length - 1]!.key)
          }}
          placeholder={value.length ? 'Search friends, or add someone else…' : 'Search your friends, or type a name'}
          aria-label="Find or add a person"
        />
      </div>

      {rankedFriends.length > 0 && (
        <div className="picker-suggest">
          {rankedFriends.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => add({ userId: f.id, name: f.name, handle: f.handle, accent: f.accent })}
            >
              <Avatar name={f.name} color={f.accent} size="sm" /> {f.name}
            </button>
          ))}
        </div>
      )}

      {query.trim().length >= 2 && (strangers.length > 0 || searching) && (
        <div className="picker-directory">
          <span className="tiny faint">{searching && !directory ? 'Searching…' : 'Not friends yet:'}</span>
          {strangers.map((p) => {
            const state = pending[p.id] ?? (p.request_sent ? 'sent' : undefined)
            return (
              <div key={p.id} className="picker-directory-row">
                <Avatar name={p.name} color={p.accent} size="sm" />
                <span className="grow small">
                  {p.name} <span className="tiny faint mono">@{p.handle}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary small"
                  disabled={state === 'sending' || state === 'sent'}
                  onClick={() => void sendRequest(p)}
                >
                  {state === 'sending'
                    ? 'Sending…'
                    : state === 'sent'
                      ? 'Requested'
                      : state === 'error'
                        ? 'Try again'
                        : p.request_received
                          ? 'Accept & add'
                          : 'Send friend request'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {circles.length > 0 && (
        <div className="picker-circles">
          <span className="tiny faint">Or a whole circle:</span>
          {circles.map((c) => {
            const already = c.members.every((m) => selectedKeys.has(personKey({ userId: m.id, name: m.name })))
            return (
              <button key={c.id} type="button" disabled={already} onClick={() => addCircle(c)}>
                {c.emoji ? `${c.emoji} ` : ''}
                {c.name}
                <em>{already ? 'all added' : `${c.members.length}`}</em>
              </button>
            )
          })}
        </div>
      )}

      {showTypedFallback && (
        <button type="button" className="picker-fallback" onClick={() => addTyped(query)}>
          <span>
            Add <b>“{query.trim()}”</b> without an account
          </span>
          <span>They’ll get a link — no notifications, no history, and you’ll retype them next time.</span>
        </button>
      )}

      {friends.length === 0 && circles.length === 0 && query.trim() === '' && (
        <p className="tiny faint">
          No friends added yet — search above to find them and send a request, right here. A typed name still works
          for anyone with no account.
        </p>
      )}
    </div>
  )
}
