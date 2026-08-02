'use client'

import type { Dashboard } from '@/lib/api'
import { formatLatency } from './charts'

// The four facts a person wants before they read anything else on the page.
// Every one of them is a straight read of `reliability`, computed by the
// engine from the event log — nothing here is estimated or invented.

export function StatRow({ data }: { data: Dashboard }) {
  const r = data.reliability
  const brandNew = r.groups === 0 && data.recent.length === 0 && data.exposure.length === 0

  if (brandNew) {
    return (
      <section className="stat-row stat-row-empty" aria-label="Your activity, once you have some">
        <span className="eyebrow">Your activity</span>
        <p>
          Nothing yet — this is where your record builds. Once you split something, you’ll see what
          you’ve paid, how many groups, how often you approve, and how fast you usually decide.
        </p>
      </section>
    )
  }

  const tiles: { key: string; label: string; value: string }[] = []
  tiles.push({ key: 'groups', label: 'Groups', value: String(r.groups) })
  tiles.push({
    key: 'rate',
    label: 'Approval rate',
    value: r.approval_rate === null ? 'Not yet' : `${Math.round(r.approval_rate * 100)}%`,
  })
  tiles.push({
    key: 'latency',
    label: 'Time to decide',
    value: r.median_latency_s === null ? 'Not yet' : formatLatency(r.median_latency_s),
  })

  return (
    <section className="stat-row" aria-label="Your activity at a glance">
      <span className="eyebrow">Your activity</span>
      <div className="stat-tiles">
        {tiles.map((t) => (
          <div className="stat-tile" key={t.key}>
            <span className="stat-label">{t.label}</span>
            <span className="stat-value">{t.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
