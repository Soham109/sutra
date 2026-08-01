'use client'

import { useState } from 'react'
import type { Circle, User } from '@/lib/api'
import { Avatar, Badge } from '@/components/ui'
import { MoneyInput, Row, Section, ToggleChip } from './fields'
import { type DraftMember, ROLES, ROLE_LABEL, ROLE_LINE, type Role, uid } from './model'

export function PeopleEditor({
  members,
  onMembers,
  friends,
  circles,
  currency,
  meId,
  circleId,
  onCircle,
}: {
  members: DraftMember[]
  onMembers: (next: DraftMember[]) => void
  friends: User[]
  circles: Circle[]
  currency: string
  meId?: string
  circleId: string
  onCircle: (id: string) => void
}) {
  const [typed, setTyped] = useState('')

  const taken = (name: string) =>
    members.some((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase())

  const addByName = (name: string, userId?: string) => {
    const clean = name.trim()
    if (!clean || taken(clean)) return
    onMembers([
      ...members,
      { key: uid('m'), name: clean, role: 'payer', weight: 1, backstopCap: 0, sponsorFor: '', userId },
    ])
  }

  const addCircle = (c: Circle) => {
    const next = [...members]
    for (const u of c.members) {
      if (next.some((m) => m.userId === u.id || m.name.trim().toLowerCase() === u.name.trim().toLowerCase())) continue
      next.push({
        key: uid('m'),
        name: u.name,
        role: 'payer',
        weight: 1,
        backstopCap: 0,
        sponsorFor: '',
        userId: u.id,
      })
    }
    onMembers(next)
    onCircle(circleId === c.id ? '' : c.id)
  }

  const patch = (key: string, change: Partial<DraftMember>) =>
    onMembers(members.map((m) => (m.key === key ? { ...m, ...change } : m)))

  const remove = (key: string) =>
    onMembers(
      members
        .filter((m) => m.key !== key)
        .map((m) => (m.sponsorFor === key ? { ...m, sponsorFor: '' } : m)),
    )

  const duplicates = new Set(
    members
      .map((m) => m.name.trim().toLowerCase())
      .filter((n, i, all) => n.length > 0 && all.indexOf(n) !== i),
  )

  const unaddedFriends = friends.filter(
    (f) => !members.some((m) => m.userId === f.id || m.name.trim().toLowerCase() === f.name.trim().toLowerCase()),
  )

  // One payer, and that payer is you.
  const solo = members.length === 1

  return (
    <Section
      step={2}
      title="The people"
      lede={
        solo
          ? 'Just you. One mandate on your own card, capped at the price — the same protocol, with a group of one.'
          : 'Everyone who will be asked. Each of them approves on their own device and pays with their own card — nobody here is collecting money from anybody.'
      }
      aside={<Badge tone={solo ? 'brand' : 'plain'}>{solo ? 'just you' : `${members.length} in the group`}</Badge>}
    >
      {/* Buying something for yourself is a group of one, and the product was
          quietly refusing to admit that — you had to notice that leaving the
          list alone happened to work. Now it says so. */}
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={`btn ${solo ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => {
            if (solo) return
            const me = members.find((m) => m.userId === meId) ?? members[0]
            if (me) onMembers([me])
          }}
        >
          Just me
        </button>
        <button
          type="button"
          className={`btn ${solo ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => {
            if (!solo) return
            onMembers([...members, { key: uid('m'), name: '', role: 'payer', weight: 1, backstopCap: 0, sponsorFor: '' }])
          }}
        >
          Split with others
        </button>
      </div>

      <div className="col" style={{ gap: 10 }}>
        {members.map((m) => (
          <div key={m.key} className="well col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <Avatar name={m.name || '?'} />
              <input
                className="input grow"
                style={{ minWidth: 150 }}
                aria-label="Member name"
                value={m.name}
                placeholder="Their name"
                onChange={(e) => patch(m.key, { name: e.target.value })}
              />
              {m.userId === meId && <Badge tone="brand">you</Badge>}
              {m.userId && m.userId !== meId && <Badge>linked</Badge>}
              {members.length > 1 && (
                <button type="button" className="btn btn-ghost" onClick={() => remove(m.key)}>
                  Remove
                </button>
              )}
            </div>

            <div className="col" style={{ gap: 6 }}>
              <Row gap={6}>
                {ROLES.map((r) => (
                  <ToggleChip key={r} on={m.role === r} onClick={() => patch(m.key, { role: r })}>
                    {ROLE_LABEL[r]}
                  </ToggleChip>
                ))}
              </Row>
              <p className="tiny faint">{ROLE_LINE[m.role]}</p>
            </div>

            {m.role === 'backstop' && (
              <label className="row wrap" style={{ gap: 8 }}>
                <span className="small muted">Absorbs up to</span>
                <MoneyInput
                  value={m.backstopCap}
                  currency={currency}
                  width={110}
                  ariaLabel="Backstop cap"
                  onChange={(backstopCap) => patch(m.key, { backstopCap })}
                />
                <span className="tiny faint">
                  beyond their own share. Never charged above this, even if two people drop out.
                </span>
              </label>
            )}

            {m.role === 'sponsor' && (
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="small muted">Covering</span>
                <select
                  className="select"
                  style={{ width: 'auto', minWidth: 160 }}
                  aria-label="Who this sponsor covers"
                  value={m.sponsorFor}
                  onChange={(e) => patch(m.key, { sponsorFor: e.target.value })}
                >
                  <option value="">Choose someone…</option>
                  {members
                    .filter((x) => x.key !== m.key && x.role !== 'observer' && x.role !== 'sponsor')
                    .map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.name || 'Unnamed'}
                      </option>
                    ))}
                </select>
                {!m.sponsorFor && <span className="tiny" style={{ color: 'var(--warn)' }}>A sponsor needs someone to cover.</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {duplicates.size > 0 && (
        <p className="tiny" style={{ color: 'var(--warn)', marginTop: 10 }}>
          Two people share a name. Claims are recorded by name, so give one of them a surname or an initial.
        </p>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <input
          className="input grow"
          style={{ minWidth: 180 }}
          value={typed}
          placeholder="Add somebody by name…"
          aria-label="Add a member by name"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addByName(typed)
              setTyped('')
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!typed.trim() || taken(typed)}
          onClick={() => {
            addByName(typed)
            setTyped('')
          }}
        >
          Add
        </button>
      </div>
      {typed.trim() !== '' && taken(typed) && (
        <p className="tiny" style={{ color: 'var(--warn)', marginTop: 6 }}>
          {typed.trim()} is already in the group.
        </p>
      )}

      {unaddedFriends.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="field-label">Friends</span>
          <Row gap={6}>
            {unaddedFriends.map((f) => (
              <ToggleChip key={f.id} on={false} onClick={() => addByName(f.name, f.id)} title={`@${f.handle}`}>
                <Avatar name={f.name} color={f.accent} size="sm" />
                {f.name}
              </ToggleChip>
            ))}
          </Row>
        </div>
      )}

      {circles.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="field-label">Circles</span>
          <Row gap={6}>
            {circles.map((c) => (
              <ToggleChip
                key={c.id}
                on={circleId === c.id}
                onClick={() => addCircle(c)}
                title={c.members.map((m) => m.name).join(', ')}
              >
                <span aria-hidden>{c.emoji}</span>
                {c.name}
                <span className="mono faint">{c.members.length}</span>
              </ToggleChip>
            ))}
          </Row>
          <p className="tiny faint" style={{ marginTop: 6 }}>
            Adding a circle files the group under it, so the same people are one click away next time.
          </p>
        </div>
      )}

      {friends.length === 0 && circles.length === 0 && (
        <p className="tiny faint" style={{ marginTop: 10 }}>
          You have no saved friends yet — names typed here work perfectly well. Anyone you add by name gets their
          own approval link.
        </p>
      )}
    </Section>
  )
}
