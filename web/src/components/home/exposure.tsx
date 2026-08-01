'use client'

import { money } from '@/lib/format'
import type { Exposure } from '@/lib/api'

// The one number no other money app can show you.
//
// Because approval and charging are separated by a real mandate, there is a
// window — sometimes hours long — where your card is genuinely on the hook for
// an amount that has not been taken. Splitwise cannot show this because it has
// no authorizations. Your bank cannot show it because the charge has not
// happened. We can, exactly, because we hold the mandates.
//
// The bar is the product's thesis in one control: consent already given, money
// not yet moved, and the difference made visible instead of hidden.

const BANDS = [
  {
    key: 'authorized' as const,
    label: 'Could still be charged',
    className: 'exp-authorized',
    explain: 'You approved this. The merchant can take it, up to your cap, without asking again.',
  },
  {
    key: 'charging' as const,
    label: 'Being charged now',
    className: 'exp-charging',
    explain: 'In flight at the card network this second.',
  },
  {
    key: 'backstop_armed' as const,
    label: 'Promised to cover',
    className: 'exp-backstop',
    explain: 'A standing offer to absorb a friend’s share if they drop. Only charged if it fires.',
  },
  {
    key: 'owed_at_venue' as const,
    label: 'Owed at a venue',
    className: 'exp-venue',
    explain: 'Agreed on a bill split. You pay the venue directly — no card was charged here.',
  },
  {
    key: 'settled' as const,
    label: 'Already paid',
    className: 'exp-settled',
    explain: 'Charged and settled through the card network.',
  },
]

export function ExposureMeter({ exposure }: { exposure: Exposure[] }) {
  const live = exposure.filter(
    (e) => e.authorized + e.charging + e.settled + e.backstop_armed + e.owed_at_venue > 0,
  )

  if (live.length === 0) {
    return (
      <section className="exposure exposure-empty">
        <div className="exposure-head">
          <span className="eyebrow">Your card right now</span>
          <h2>Nothing is authorised against your card.</h2>
        </div>
        <p className="exposure-note">
          When you approve a share, it will appear here — the exact amount, held open, until the
          group commits or releases it.
        </p>
      </section>
    )
  }

  return (
    <section className="exposure" aria-labelledby="exposure-title">
      <div className="exposure-head">
        <span className="eyebrow">Your card right now</span>
        <h2 id="exposure-title">What you’re on the hook for</h2>
      </div>

      {live.map((e) => {
        const pending = e.authorized + e.charging
        const total = pending + e.settled + e.backstop_armed + e.owed_at_venue
        return (
          <div className="exposure-row" key={e.currency}>
            <div className="exposure-lead">
              <span className="exposure-amount">{money(pending, e.currency)}</span>
              <span className="exposure-lead-label">
                {pending > 0
                  ? 'could leave your card without you doing anything else'
                  : 'is authorised against your card'}
              </span>
            </div>

            <div
              className="exposure-bar"
              role="img"
              aria-label={BANDS.filter((b) => e[b.key] > 0)
                .map((b) => `${b.label}: ${money(e[b.key], e.currency)}`)
                .join('. ')}
            >
              {BANDS.map((b) =>
                e[b.key] > 0 ? (
                  <span
                    key={b.key}
                    className={`exposure-seg ${b.className}`}
                    style={{ flexGrow: e[b.key] }}
                    title={`${b.label} — ${money(e[b.key], e.currency)}`}
                  />
                ) : null,
              )}
            </div>

            <dl className="exposure-legend">
              {BANDS.map((b) =>
                e[b.key] > 0 ? (
                  <div key={b.key} className="exposure-legend-item">
                    <dt>
                      <span className={`exposure-swatch ${b.className}`} aria-hidden />
                      {b.label}
                    </dt>
                    <dd>
                      <span className="amount">{money(e[b.key], e.currency)}</span>
                      <span className="tiny faint">{b.explain}</span>
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>

            {total > 0 && e.currency !== live[0]?.currency && (
              <p className="tiny faint">Amounts in {e.currency} are shown separately — never converted.</p>
            )}
          </div>
        )
      })}

      {live.length > 1 && (
        <p className="exposure-note">
          Each currency is counted on its own. Adding them together would be a made-up number.
        </p>
      )}
    </section>
  )
}
