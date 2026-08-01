'use client'

import { useMemo, useState } from 'react'
import type { SignalPayload, TimeWindow } from './model'

// "When are you free" is where group planning usually dies, because every tool
// asks for it as a calendar. A calendar is the wrong instrument on a phone at a
// bus stop.
//
// So: a few named blocks over the next several days, tapped, multi-select. The
// blocks are real intervals — the sweep-line that finds the group's common
// window needs genuine start/end instants, not a mood — but the person only
// ever touches "Sat evening".

const BLOCKS: { key: string; label: string; from: number; to: number }[] = [
  { key: 'morning', label: 'Morning', from: 8, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 21 },
  { key: 'late', label: 'Late', from: 21, to: 24 },
]

const DAY_COUNT = 5

function dayLabel(d: Date, today: Date): string {
  const same = d.toDateString() === today.toDateString()
  if (same) return 'Today'
  const t = new Date(today)
  t.setDate(t.getDate() + 1)
  if (d.toDateString() === t.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

/** Local wall-clock hour on a given day → a real UTC instant. */
function at(day: Date, hour: number): string {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0)
  return d.toISOString()
}

export function AvailabilityPicker({
  busy,
  hint,
  onSend,
}: {
  busy: boolean
  hint?: string
  onSend: (p: SignalPayload) => void | Promise<void>
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const today = useMemo(() => new Date(), [])
  const days = useMemo(
    () =>
      Array.from({ length: DAY_COUNT }, (_, i) => {
        const d = new Date(today)
        d.setDate(d.getDate() + i)
        return d
      }),
    [today],
  )

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const windows: TimeWindow[] = useMemo(() => {
    const out: TimeWindow[] = []
    for (const key of picked) {
      const [dayIdx, blockKey] = key.split('|')
      const day = days[Number(dayIdx)]
      const block = BLOCKS.find((b) => b.key === blockKey)
      if (!day || !block) continue
      out.push({ start: at(day, block.from), end: at(day, block.to) })
    }
    return out.sort((a, b) => a.start.localeCompare(b.start))
  }, [picked, days])

  // A block that has already ended today is not an option, and offering it is
  // how you get "free 9am" from someone answering at 11pm.
  const past = (day: Date, to: number) =>
    day.toDateString() === today.toDateString() && today.getHours() >= to

  return (
    <>
      <h2>When could you make it?</h2>
      <p className="answer-help">
        Tap everything that works{hint ? <> — they suggested {hint}</> : null}. More taps means an
        easier time finding a slot that suits everybody.
      </p>

      <div className="avail-grid" role="group" aria-label="Pick the times you are free">
        <div className="avail-corner" aria-hidden />
        {BLOCKS.map((b) => (
          <div className="avail-col-head" key={b.key}>
            {b.label}
          </div>
        ))}

        {days.map((day, di) => (
          <div className="avail-day-row" key={di} style={{ display: 'contents' }}>
            <div className="avail-row-head">
              <span>{dayLabel(day, today)}</span>
              <span className="tiny faint">{day.getDate()}</span>
            </div>
            {BLOCKS.map((b) => {
              const key = `${di}|${b.key}`
              const disabled = past(day, b.to)
              return (
                <button
                  type="button"
                  key={key}
                  className={`avail-cell${picked.has(key) ? ' is-on' : ''}`}
                  aria-pressed={picked.has(key)}
                  aria-label={`${dayLabel(day, today)} ${b.label}`}
                  disabled={disabled}
                  onClick={() => toggle(key)}
                />
              )
            })}
          </div>
        ))}
      </div>

      <div className="answer-choices">
        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={busy || picked.size === 0}
          onClick={() => void onSend({ kind: 'availability', windows, anytime: false })}
        >
          {picked.size === 0
            ? 'Pick at least one'
            : `Send ${picked.size} ${picked.size === 1 ? 'slot' : 'slots'}`}
        </button>
        <button
          className="btn btn-ghost btn-block"
          disabled={busy}
          onClick={() => void onSend({ kind: 'availability', windows: [], anytime: true })}
        >
          Any time works for me
        </button>
      </div>
    </>
  )
}
