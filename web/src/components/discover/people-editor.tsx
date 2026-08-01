'use client'

import type { Circle, User } from '@/lib/api'
import { Avatar, Badge } from '@/components/ui'
import { PeoplePicker, personKey, type PickedPerson } from '@/components/people/PeoplePicker'
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

  // The picker only knows "who is in", identified by account or by typed
  // name — the per-row role/weight/backstop state below is DraftMember's own
  // business and travels along by matching that same identity.
  const pickerValue: PickedPerson[] = members.map((m) => ({
    key: personKey(m),
    name: m.name,
    userId: m.userId,
  }))

  const handlePicked = (next: PickedPerson[]) => {
    // A circle just went from "not fully in" to "fully in" — file the group
    // under it, the same shortcut the old chip-based picker gave you.
    const prevKeys = new Set(pickerValue.map((p) => p.key))
    const nextKeys = new Set(next.map((p) => p.key))
    for (const c of circles) {
      const keys = c.members.map((u) => personKey({ userId: u.id, name: u.name }))
      if (keys.length === 0) continue
      const wasFull = keys.every((k) => prevKeys.has(k))
      const isFull = keys.every((k) => nextKeys.has(k))
      if (!wasFull && isFull) {
        onCircle(circleId === c.id ? '' : c.id)
        break
      }
    }

    const existingKeys = new Set(pickerValue.map((p) => p.key))
    const kept = members.filter((m) => nextKeys.has(personKey(m)))
    const additions = next
      .filter((p) => !existingKeys.has(p.key))
      .map((p) => ({
        key: uid('m'),
        name: p.name,
        role: 'payer' as const,
        weight: 1,
        backstopCap: 0,
        sponsorFor: '',
        userId: p.userId,
      }))
    const merged = [...kept, ...additions]
    const mergedDraftKeys = new Set(merged.map((m) => m.key))
    onMembers(merged.map((m) => (m.sponsorFor && !mergedDraftKeys.has(m.sponsorFor) ? { ...m, sponsorFor: '' } : m)))
  }

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

      <div style={{ marginTop: 14 }}>
        <PeoplePicker value={pickerValue} onChange={handlePicked} label="Add someone" />
      </div>
      {circleId && (
        <p className="tiny faint" style={{ marginTop: 6 }}>
          Filed under {circles.find((c) => c.id === circleId)?.name ?? 'a circle'} — the same people are one click
          away next time.
        </p>
      )}
    </Section>
  )
}
