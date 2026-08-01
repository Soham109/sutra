'use client'

import { money, relativeTime } from '@/lib/format'
import type { Dashboard } from '@/lib/api'

// What you've actually paid, one bar per group, most recent first. `recent`
// is the six most recent settlements the engine hands back — a snapshot, not
// a full ledger — so this stays a bar chart rather than a line implying a
// trend the data doesn't actually have. Currencies are never mixed into one
// scale: each gets its own row of bars, same rule as the exposure meter.

type RecentItem = Dashboard['recent'][number]

const STATUS_LABEL: Record<string, string> = {
  committed: 'went through',
  partial: 'partially went through',
  aborted: 'fell through',
  expired: 'timed out',
}

export function SettlementHistory({ recent }: { recent: RecentItem[] }) {
  if (recent.length === 0) {
    return (
      <div className="settle-chart-empty">
        <p>
          Nothing settled yet. Once a group finishes, what you actually paid shows up here as a bar
          per group — tallest is the most you’ve paid, not necessarily the most recent.
        </p>
      </div>
    )
  }

  const byCurrency = new Map<string, RecentItem[]>()
  for (const item of recent) {
    const list = byCurrency.get(item.currency) ?? []
    list.push(item)
    byCurrency.set(item.currency, list)
  }
  for (const list of byCurrency.values()) list.sort((a, b) => +new Date(b.at) - +new Date(a.at))
  const facets = [...byCurrency.entries()]

  return (
    <div className="settle-chart">
      {facets.map(([currency, items]) => {
        const max = Math.max(...items.map((i) => i.your_amount), 1)
        return (
          <div className="settle-bars" key={currency}>
            {facets.length > 1 && <span className="eyebrow settle-currency-label">{currency}</span>}
            {/* Every value here is real, visible text — title, amount, status,
                and when — so the chart needs no aria-label standing in for it;
                that would risk assistive tech reading a summary instead of the
                actual content sighted users see. Only the status dot's colour
                needs a spoken word alongside it. */}
            <div className="settle-bar-row">
              {items.map((i) => (
                <div className="settle-bar-col" key={i.group_id} title={`${i.title} — ${money(i.your_amount, currency)}`}>
                  <span className="settle-bar-value amount">{money(i.your_amount, currency)}</span>
                  <div className="settle-bar-plot">
                    <span className="settle-bar" style={{ height: `${Math.max(6, (i.your_amount / max) * 100)}%` }}>
                      <span className={`settle-bar-mark settled-${i.status}`}>
                        <span className="sr-only">{STATUS_LABEL[i.status] ?? i.status}</span>
                      </span>
                    </span>
                  </div>
                  <span className="settle-bar-label tiny faint">{i.title}</span>
                  <span className="settle-bar-time tiny faint">{relativeTime(i.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
