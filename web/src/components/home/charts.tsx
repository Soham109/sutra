'use client'

// Small chart primitives shared across the dashboard. No chart library — the
// rest of the product is hand-rolled SVG/CSS (see exposure.tsx, the consent
// thread in ui.tsx), so these follow the same rule: plain markup, themed off
// the existing custom properties, nothing that needs a dependency.

/** A donut/progress ring built from stacked stroke-dasharray arcs. Segments
 * are fractions of the whole (0–1) and are drawn in order starting at 12
 * o'clock; whatever is left unfilled shows the track colour, so "the rest"
 * never needs its own explicit (and possibly wrong) segment. */
export function Ring({
  size = 40,
  stroke = 5,
  segments,
  trackColor = 'var(--line-2)',
  label,
}: {
  size?: number
  stroke?: number
  segments: { value: number; color: string }[]
  trackColor?: string
  label?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const gap = segments.filter((s) => s.value > 0).length > 1 ? Math.min(3, c * 0.02) : 0
  let offset = 0

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      {segments.map((s, i) => {
        if (s.value <= 0) return null
        const len = Math.max(0, s.value * c - gap)
        const dashOffset = -offset
        offset += s.value * c
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${len} ${Math.max(0, c - len)}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )
      })}
    </svg>
  )
}

/** Seconds → a short, human string. Extends past the "s / m" the rest of the
 * app uses (see lib/format.ts relativeTime) into hours and days, since a
 * decision latency can legitimately run that long. */
export function formatLatency(s: number): string {
  if (s < 90) return `${Math.round(s)}s`
  const m = s / 60
  if (m < 90) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 36) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

// A log scale so a 30-second decision and a 5-hour one are both legible on
// the same bar. The tick set is a fixed, labelled scale — not data — exactly
// like an axis would be on any other chart.
const LATENCY_SCALE_MIN = 10
const LATENCY_SCALE_MAX = 86400
export const LATENCY_TICKS = [
  { s: 60, label: '1m' },
  { s: 600, label: '10m' },
  { s: 3600, label: '1h' },
  { s: 21600, label: '6h' },
  { s: 86400, label: '1d' },
]

export function latencyScalePct(seconds: number): number {
  const clamped = Math.min(Math.max(seconds, LATENCY_SCALE_MIN), LATENCY_SCALE_MAX)
  return (Math.log(clamped / LATENCY_SCALE_MIN) / Math.log(LATENCY_SCALE_MAX / LATENCY_SCALE_MIN)) * 100
}

/** How fast you usually decide, placed on a fixed time scale instead of just
 * stated as a sentence — the scale is the "meaningful comparison": is this
 * a minute or most of a day? */
export function LatencyMeter({ seconds }: { seconds: number }) {
  const pct = latencyScalePct(seconds)
  return (
    <div
      className="latency-meter"
      role="img"
      aria-label={`Usually decides within ${formatLatency(seconds)}, on a scale from a minute to a day`}
    >
      <div className="latency-track">
        <div className="latency-fill" style={{ width: `${pct}%` }} />
        <div className="latency-marker" style={{ left: `${pct}%` }} />
      </div>
      <div className="latency-ticks" aria-hidden>
        {LATENCY_TICKS.map((t) => (
          <span key={t.s} className="latency-tick" style={{ left: `${latencyScalePct(t.s)}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A single currency if every amount agrees on one, otherwise null — the
 * signal that summing them would be the "confident nonsense" this product
 * is built to avoid (see exposure.tsx). */
export function commonCurrency(currencies: string[]): string | null {
  const set = new Set(currencies)
  return set.size === 1 ? [...set][0]! : null
}
