'use client'

import type { Reliability } from '@/lib/api'
import { money } from '@/lib/format'
import { Skeleton } from '@/components/ui'

/** Seconds, spoken the way a person would say them: 42s, 3m 10s, 1h 04m. */
export function latencyText(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '—'
  const total = Math.max(0, Math.round(s))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const rs = total % 60
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${String(rm).padStart(2, '0')}m` : `${h}h`
}

export function rateText(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '—'
  return `${Math.round(r * 100)}%`
}

/** The one-line version, for list rows. */
export function RecordLine({ r, loading }: { r?: Reliability; loading?: boolean }) {
  if (loading || !r) {
    return (
      <div className="row" style={{ gap: 8, width: 152, justifyContent: 'flex-end' }}>
        <Skeleton h={12} w={64} />
        <Skeleton h={12} w={48} />
      </div>
    )
  }
  if (r.groups === 0) {
    return <span className="tiny faint">No seats held yet</span>
  }
  return (
    <span className="tiny muted mono" style={{ whiteSpace: 'nowrap' }}>
      {rateText(r.approval_rate)} approved · {latencyText(r.median_latency_s)} median
    </span>
  )
}

interface Cell {
  label: string
  value: string
  note?: string
}

export function cellsFor(r: Reliability, currency = 'USD'): Cell[] {
  return [
    { label: 'Groups', value: String(r.groups), note: 'seats held' },
    { label: 'Approved', value: String(r.approvals), note: 'own mandate signed' },
    { label: 'Declined', value: String(r.declines), note: 'walked away' },
    { label: 'Approval rate', value: rateText(r.approval_rate), note: 'of decisions made' },
    { label: 'Median reply', value: latencyText(r.median_latency_s), note: 'invite → decision' },
    { label: 'Charged', value: money(r.charged_total_minor, currency), note: 'own card, own share' },
    { label: 'Absorbed', value: money(r.backstopped_total_minor, currency), note: 'covered for others' },
  ]
}

/** The record as a hairline grid of facts. Never coloured — these are not scores. */
export function RecordGrid({ r, currency = 'USD' }: { r: Reliability | null; currency?: string }) {
  const cells = r ? cellsFor(r, currency) : null

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
        gap: 1,
        background: 'var(--line)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r)',
        overflow: 'hidden',
      }}
    >
      {(cells ?? Array.from({ length: 7 }, () => null)).map((c, i) => (
        <div key={c ? c.label : i} style={{ background: 'var(--surface)', padding: '11px 13px' }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {c ? c.label : ' '}
          </div>
          {c ? (
            <div className="amount" style={{ fontSize: 19 }}>
              {c.value}
            </div>
          ) : (
            <Skeleton h={19} w="60%" />
          )}
          <div className="tiny faint" style={{ marginTop: 2 }}>
            {c?.note ?? ' '}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Where these numbers come from — said plainly, every time they are shown. */
export function ProvenanceNote({ who = 'These' }: { who?: string }) {
  return (
    <p className="tiny faint" style={{ marginTop: 10 }}>
      {who} numbers are recomputed from the append-only event log every time this page loads. There is no editable
      profile behind them — a record can only be earned, one held seat at a time.
    </p>
  )
}
