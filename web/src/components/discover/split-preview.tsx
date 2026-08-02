'use client'

import { Avatar, Money } from '@/components/ui'
import { money } from '@/lib/format'
import type { SplitResult } from './model'

// The whole point of the builder: you can see what each person will be asked
// for, to the cent, before anyone is asked. Computed the same way the engine
// computes it, so the numbers on the approval page will match these.

export function SplitPreview({
  split,
  currency,
  toleranceBps,
  charges,
}: {
  split: SplitResult
  currency: string
  toleranceBps: number
  charges: boolean
}) {
  const paying = split.shares.filter((s) => s.role !== 'observer')
  const exact = split.unassigned === 0 && paying.length > 0

  return (
    <div className="card card-pad col" style={{ gap: 14 }}>
      <div className="row-between" style={{ alignItems: 'baseline' }}>
        <h3>The split</h3>
        <span className="tiny faint mono">live</span>
      </div>

      <div className="col" style={{ gap: 4 }}>
        <div className="row-between">
          <span className="small muted">Items</span>
          <Money minor={split.itemsTotal} currency={currency} />
        </div>
        <div className="row-between">
          <span className="small muted">Fees</span>
          <Money minor={split.feesTotal} currency={currency} />
        </div>
        <hr className="divider" style={{ margin: '6px 0' }} />
        <div className="row-between" style={{ alignItems: 'baseline' }}>
          <span style={{ fontWeight: 550 }}>Total</span>
          <Money minor={split.total} currency={currency} size="lg" />
        </div>
      </div>

      {split.shares.length === 0 ? (
        <p className="small faint">Add people below and their shares appear here.</p>
      ) : (
        <div className="col" style={{ gap: 2 }}>
          {split.shares.map((s) => (
            <div key={s.key} className="row" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <Avatar name={s.name || '?'} size="sm" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div
                  className="small"
                  style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {s.name || 'Unnamed'}
                </div>
                <div className="tiny faint">
                  {s.role === 'observer' && 'No payment obligation'}
                  {s.role === 'sponsor' &&
                    (s.covering.length > 0
                      ? `Covering ${s.covering.map((c) => c.name).join(', ')}`
                      : 'Not covering anyone yet')}
                  {(s.role === 'payer' || s.role === 'backstop') &&
                    (s.coveredBy
                      ? `Covered by ${s.coveredBy}`
                      : `${money(s.itemsMinor, currency)} of items + ${money(s.feesMinor, currency)} of fees`)}
                </div>
              </div>
              <div className="col" style={{ alignItems: 'flex-end', gap: 1 }}>
                {s.role === 'observer' ? (
                  <span className="small faint mono">—</span>
                ) : (
                  <>
                    <Money minor={s.payable} currency={currency} />
                    <span className="tiny faint mono" title="The largest amount this proposal permits once tolerance is applied">
                      cap {money(s.cap, currency)}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {split.unassigned !== 0 && split.total !== 0 && (
        <p className="tiny" style={{ color: 'var(--warn)' }}>
          {money(split.unassigned, currency)} isn’t claimed by anybody yet — add a payer, or give every line at
          least one claimant.
        </p>
      )}

      {exact && (
        <p className="tiny faint" style={{ lineHeight: 1.55 }}>
          Shares sum to exactly <span className="mono">{money(split.total, currency)}</span> — odd cents go to the
          earliest member, never to rounding. Each cap is{' '}
          <span className="mono">{(toleranceBps / 100).toFixed(2)}%</span> above the share, so a small price
          change at checkout doesn’t silently exceed the proposal. {charges
            ? 'On this test charging rail, that cap is also applied to the credential.'
            : 'This finish line records the cap but does not charge it.'}
        </p>
      )}

      {split.contested.length > 0 && (
        <p className="tiny" style={{ color: 'var(--warn)', lineHeight: 1.55 }}>
          {split.contested.length} line{split.contested.length === 1 ? ' is' : 's are'} contested. Until the
          sealed-bid window closes these amounts assume an even split; bids decide who gets a slot, never what it
          costs.
        </p>
      )}
    </div>
  )
}
