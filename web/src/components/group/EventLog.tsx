'use client'

import { useEffect, useRef } from 'react'
import type { GmpEvent } from '@/lib/api'
import { Badge, Empty } from '@/components/ui'
import { clockTime } from '@/lib/format'
import { eventTone, narrate } from './narrate'

// The protocol, made legible. Newest at the bottom, because this reads like a
// transcript of a decision, not a feed.

export function EventLog({
  events,
  currency,
  noBlame,
  follow,
  cursorSeq,
}: {
  events: GmpEvent[]
  currency: string
  noBlame: boolean
  /** Keep the newest line in view — off while a human is scrubbing. */
  follow: boolean
  cursorSeq?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const last = events.length > 0 ? events[events.length - 1].seq : 0
  const firstPaint = useRef(true)

  useEffect(() => {
    const el = box.current
    if (!el) return
    if (!follow && cursorSeq === undefined) return
    el.scrollTo({ top: el.scrollHeight, behavior: firstPaint.current ? 'auto' : 'smooth' })
    firstPaint.current = false
  }, [last, follow, cursorSeq, events.length])

  if (events.length === 0) {
    return (
      <Empty title="Nothing has happened yet">
        Every invite, view, approval, charge and refusal lands here as it happens — in order, and with the numbers
        attached.
      </Empty>
    )
  }

  return (
    <div className="gr-log" ref={box} role="log" aria-live="polite" aria-label="Group event log">
      {events.map((e, i) => (
        <div
          className={`gr-log-row${i === events.length - 1 ? ' gr-log-in' : ''}`}
          key={e.seq}
          data-now={cursorSeq !== undefined && e.seq === cursorSeq ? '1' : '0'}
        >
          <span className="gr-log-time" title={new Date(e.at).toLocaleString()}>
            {clockTime(e.at)}
          </span>
          <span className="gr-tagcell">
            <Badge tone={eventTone(e.type)}>{e.type}</Badge>
          </span>
          <span className="gr-log-say">{narrate(e, { currency, noBlame })}</span>
        </div>
      ))}
    </div>
  )
}
