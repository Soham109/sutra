'use client'

import { Avatar } from '@/components/ui'
import { money } from '@/lib/format'

// The thirty seconds people remember: someone's backstop quietly covers the
// gap, and the group holds. It has to be visible from across a room, and it
// still has to be honest — the shortfall is named, not smoothed over.

export function BackstopMoment({
  name,
  amount,
  shortfall,
  total,
  currency,
  settled,
  onDismiss,
}: {
  name: string
  amount: number
  shortfall: number
  /** settled = the money actually moved (backstop.absorbed), not just planned. */
  settled: boolean
  total: number
  currency: string
  onDismiss: () => void
}) {
  return (
    <div
      className="card card-pad"
      role="status"
      style={{
        borderColor: settled ? 'var(--ok-line)' : 'var(--warn-line)',
        background: settled ? 'var(--ok-soft)' : 'var(--warn-soft)',
      }}
    >
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="eyebrow" style={{ color: settled ? 'var(--ok)' : 'var(--warn)' }}>
          {settled ? 'Backstop absorbed' : 'Backstop allocated'}
        </span>
        <button className="btn btn-ghost tiny" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>

      <div className="gr-flow">
        <div className="col" style={{ alignItems: 'center', gap: 6, minWidth: 92 }}>
          <Avatar name={name} size="lg" />
          <span className="tiny" style={{ fontWeight: 550, textAlign: 'center' }}>
            {name}
          </span>
          <span className="tiny faint">backstop</span>
        </div>

        <div className="gr-flow-track" aria-hidden>
          <span className="gr-flow-token">+{money(amount, currency)}</span>
        </div>

        <div className="gr-flow-target col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="amount amount-lg">{money(total, currency)}</span>
          <span className="tiny faint mono">group total held</span>
        </div>
      </div>

      <p className="small" style={{ marginTop: 10, color: settled ? 'var(--ok)' : 'var(--warn)' }}>
        {settled ? (
          <>
            <b>{name}</b> covered a {money(shortfall || amount, currency)} shortfall from their own pre-armed cap. The
            group committed instead of collapsing, and nobody was asked to front anything.
          </>
        ) : (
          <>
            A {money(shortfall || amount, currency)} shortfall opened up. <b>{name}</b>&rsquo;s armed backstop is being
            asked for {money(amount, currency)} of it — within the cap they set themselves.
          </>
        )}
      </p>
    </div>
  )
}
