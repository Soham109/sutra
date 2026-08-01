'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui'
import { useSession } from '@/components/session'

// Who is at the table.
//
// This used to be a grid of blank boxes labelled "Person 1", "Person 2",
// "Person 3" — so splitting a bill with people you split bills with every week
// meant typing their names again every single time, while the app sat on a
// friends list and a set of circles it never offered you.
//
// So: your circles are one tap, your friends are one tap, and anybody else is
// still just typed. Names become chips you can see and remove, because a row
// of half-filled inputs gives you no way to tell at a glance who is actually
// in the split.

interface Circle {
  id: string
  name: string
  emoji?: string
  members: { id: string; name: string }[]
}

export function PeoplePicker({
  value,
  onChange,
  label = 'Who’s at the table',
}: {
  value: string[]
  onChange: (next: string[]) => void
  label?: string
}) {
  const { user } = useSession()
  const [draft, setDraft] = useState('')
  const [circles, setCircles] = useState<Circle[]>([])
  const [friends, setFriends] = useState<{ id: string; name: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    // The session already holds these; read them off it rather than spending
    // another round trip on something the app knows.
    fetch('/api/v1/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!alive || !me) return
        setFriends(me.friends ?? [])
        setCircles(me.circles ?? [])
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const add = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    // Case-insensitive, because "Arsh" and "arsh" are one person and a bill
    // split between them twice is a bill split wrong.
    if (value.some((v) => v.toLowerCase() === clean.toLowerCase())) return
    onChange([...value, clean])
    setDraft('')
  }

  const remove = (name: string) => onChange(value.filter((v) => v !== name))

  const inSplit = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value])

  const suggestions = useMemo(() => {
    const pool = friends.map((f) => f.name)
    if (user && !pool.includes(user.name)) pool.unshift(user.name)
    const q = draft.trim().toLowerCase()
    return pool
      .filter((n) => !inSplit.has(n.toLowerCase()))
      .filter((n) => (q ? n.toLowerCase().includes(q) : true))
      .slice(0, 6)
  }, [friends, user, draft, inSplit])

  return (
    <div className="field picker">
      <span className="field-label">{label}</span>

      {value.length > 0 && (
        <ul className="picker-chips">
          {value.map((name) => (
            <li key={name}>
              <Avatar name={name} size="sm" />
              <span>{name}</span>
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name} from the split`}
              >
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
            // Backspace on an empty box removes the last chip, the way every
            // other tag input on the internet behaves.
            if (e.key === 'Backspace' && !draft && value.length) remove(value[value.length - 1]!)
          }}
          placeholder={value.length ? 'Add someone else…' : 'Type a name, or pick from below'}
          aria-label="Add a person to the split"
        />
        <button type="button" className="btn" onClick={() => add(draft)} disabled={!draft.trim()}>
          Add
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="picker-suggest">
          {suggestions.map((name) => (
            <button key={name} type="button" onClick={() => add(name)}>
              <Avatar name={name} size="sm" /> {name}
            </button>
          ))}
        </div>
      )}

      {circles.length > 0 && (
        <div className="picker-circles">
          <span className="tiny faint">Or a whole circle:</span>
          {circles.map((c) => {
            const names = c.members.map((m) => m.name)
            const already = names.every((n) => inSplit.has(n.toLowerCase()))
            return (
              <button
                key={c.id}
                type="button"
                disabled={already}
                onClick={() => {
                  const merged = [...value]
                  for (const n of names) {
                    if (!merged.some((v) => v.toLowerCase() === n.toLowerCase())) merged.push(n)
                  }
                  onChange(merged)
                }}
              >
                {c.emoji ? `${c.emoji} ` : ''}
                {c.name}
                <em>{already ? 'all added' : `${names.length}`}</em>
              </button>
            )
          })}
        </div>
      )}

      {value.length === 1 && (
        <p className="tiny faint">
          One person is not a split. Add whoever else was at the table.
        </p>
      )}
    </div>
  )
}
