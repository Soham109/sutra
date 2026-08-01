'use client'

import type { GmpEvent } from '@/lib/api'
import { clockTime } from '@/lib/format'

// Because the log is append-only, the whole group can be re-derived at any seq.
// So replay costs nothing and the demo tells itself.

const SPEEDS = [1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

export function ReplayBar({
  active,
  index,
  events,
  playing,
  speed,
  onEnter,
  onLive,
  onScrub,
  onPlay,
  onStep,
  onSpeed,
}: {
  active: boolean
  /** Number of events applied; 0 = the moment before anything happened. */
  index: number
  events: GmpEvent[]
  playing: boolean
  speed: Speed
  onEnter: () => void
  onLive: () => void
  onScrub: (i: number) => void
  onPlay: () => void
  onStep: (delta: number) => void
  onSpeed: (s: Speed) => void
}) {
  if (events.length < 2) return null

  if (!active) {
    return (
      <div className="gr-replay">
        <button className="btn btn-secondary tiny" onClick={onEnter}>
          ▶ Replay from the start
        </button>
        <span className="tiny faint grow">
          Step through the group beat by beat — every state below is re-derived from the log.
        </span>
      </div>
    )
  }

  const current = index > 0 ? events[index - 1] : null

  return (
    <div className="gr-replay">
      <button className="btn btn-secondary gr-step" onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Step back">
        ◀
      </button>
      <button className="btn btn-primary gr-step" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        className="btn btn-secondary gr-step"
        onClick={() => onStep(1)}
        disabled={index >= events.length}
        aria-label="Step forward"
      >
        ▶
      </button>

      <input
        className="gr-scrub"
        type="range"
        min={0}
        max={events.length}
        value={index}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Replay position"
      />

      <span className="tiny mono faint" style={{ minWidth: 96 }}>
        {index}/{events.length}
        {current ? ` · ${clockTime(current.at)}` : ' · start'}
      </span>

      <div className="row" style={{ gap: 4 }}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={s === speed ? 'btn btn-secondary gr-step' : 'btn btn-ghost gr-step'}
            onClick={() => onSpeed(s)}
            aria-pressed={s === speed}
          >
            {s}×
          </button>
        ))}
      </div>

      <button className="btn btn-ghost tiny" onClick={onLive}>
        Back to live
      </button>
    </div>
  )
}
