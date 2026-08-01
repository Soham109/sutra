'use client'

import { money } from '@/lib/format'
import type { Reliability } from '@/lib/api'
import { LatencyMeter, Ring, formatLatency } from './charts'

// Your record, drawn rather than stated. Approved/declined already carry
// meaning as colours everywhere else in this product (badges, the consent
// thread) — green and red here are that same state, not decoration.

export function ReliabilityPanel({
  reliability: r,
  settledCurrency,
}: {
  reliability: Reliability
  settledCurrency: string | null
}) {
  if (r.groups === 0) return null // brand new — the stat row above already teaches this

  const decisions = r.approvals + r.declines

  return (
    <section className="record" aria-labelledby="record-title">
      <div className="section-head">
        <h2 id="record-title">Your record</h2>
      </div>
      <p className="record-note">
        Recomputed from what actually happened, every time you look. Nobody can edit it — only earn
        it.
      </p>

      <div className="record-grid">
        {decisions > 0 ? (
          <div className="record-card">
            <div className="record-donut">
              <Ring
                size={104}
                stroke={13}
                trackColor="var(--surface-3)"
                label={`You approved ${r.approvals} of ${decisions} decisions`}
                segments={[
                  { value: r.approvals / decisions, color: 'var(--ok)' },
                  { value: r.declines / decisions, color: 'var(--bad)' },
                ]}
              />
              <div className="record-donut-figure" aria-hidden>
                <span className="record-donut-value">{Math.round((r.approvals / decisions) * 100)}%</span>
                <span className="record-donut-caption">approved</span>
              </div>
            </div>
            <dl className="record-legend">
              <div>
                <dt>
                  <span className="dot dot-ok" aria-hidden /> Approved
                </dt>
                <dd>{r.approvals}</dd>
              </div>
              <div>
                <dt>
                  <span className="dot dot-bad" aria-hidden /> Declined
                </dt>
                <dd>{r.declines}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="record-card record-card-empty">
            <span className="eyebrow">Approval rate</span>
            <p>Once you’ve approved or declined a split, how often you say yes shows up here.</p>
          </div>
        )}

        {r.median_latency_s !== null ? (
          <div className="record-card">
            <span className="eyebrow">Time to decide</span>
            <p className="record-latency-headline">
              Usually within <b>{formatLatency(r.median_latency_s)}</b>
            </p>
            <LatencyMeter seconds={r.median_latency_s} />
          </div>
        ) : (
          <div className="record-card record-card-empty">
            <span className="eyebrow">Time to decide</span>
            <p>Once you approve something, how fast you usually decide shows up here.</p>
          </div>
        )}
      </div>

      {r.backstopped_total_minor > 0 && (
        <p className="record-backstop">
          You’ve covered <b>{money(r.backstopped_total_minor, settledCurrency ?? 'USD')}</b> for
          friends when they didn’t pay.
        </p>
      )}
    </section>
  )
}
