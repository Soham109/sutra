'use client'

import { useState } from 'react'
import { money } from '@/lib/format'
import { FACTOR_LABEL, type OptionScore, type PlanOption } from './model'

// An option, with the arithmetic that put it there.
//
// The score is not a verdict handed down by a model — it is a weighted mean of
// five factors, each computed from what people actually sent, each carrying a
// sentence you can check against the data. So the card shows the number AND
// lets you open the working. A ranking you cannot audit is just an opinion
// with a percentage sign on it.

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function OptionCard({
  option,
  score,
  rank,
  chosen,
  busy,
  onChoose,
  onVote,
}: {
  option: PlanOption
  score: OptionScore
  rank: number
  chosen: boolean
  busy?: boolean
  onChoose?: () => void
  onVote?: (v: -1 | 1) => void
}) {
  const [open, setOpen] = useState(false)
  const excluded = score.excluded !== null

  return (
    <article className={`opt${excluded ? ' opt-excluded' : ''}${chosen ? ' opt-chosen' : ''}`}>
      <div className="opt-rank" aria-hidden>
        {excluded ? '—' : rank}
      </div>

      <div className="opt-body">
        <div className="opt-head">
          <h3>{option.title}</h3>
          {score.score !== null && !excluded && (
            <span className="opt-score" title="Weighted mean of the factors below">
              {pct(score.score)}
            </span>
          )}
        </div>

        {option.subtitle && <p className="opt-sub">{option.subtitle}</p>}

        <div className="opt-meta">
          {option.price && (
            <span className="amount">
              {money(option.price.amount_minor, option.price.currency)}
              <span className="tiny faint">
                {option.price.basis === 'per_person' ? ' each' : option.price.basis === 'total' ? ' total' : ''}
              </span>
            </span>
          )}
          {option.when && (
            <span className="tiny">
              {new Date(option.when.start).toLocaleString([], {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          )}
          {option.url && (
            <a
              className="tiny"
              href={option.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
            >
              {option.source === 'overpass' ? 'on the map ↗' : 'open ↗'}
            </a>
          )}
        </div>

        {excluded && <p className="opt-excluded-why">Ruled out — {score.excluded}</p>}

        {/* The bars are the score, not a decoration of it: width is the factor
            value, opacity is its weight, so a zero-weight factor visibly does
            not count rather than quietly counting for nothing. */}
        <div className="opt-factors">
          {score.factors.map((f) => (
            <div className="opt-factor" key={f.key} title={f.why}>
              <span className="opt-factor-label">{FACTOR_LABEL[f.key]}</span>
              <span className="opt-factor-track">
                <span
                  className="opt-factor-fill"
                  style={{ width: pct(f.value), opacity: f.weight === 0 ? 0.18 : 0.45 + f.weight }}
                />
              </span>
              <span className="opt-factor-value">{f.weight === 0 ? '–' : pct(f.value)}</span>
            </div>
          ))}
        </div>

        <button className="opt-open" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide the working' : 'Show the working'}
        </button>

        {open && (
          <div className="opt-working">
            <ul>
              {score.factors.map((f) => (
                <li key={f.key}>
                  <b>
                    {FACTOR_LABEL[f.key]} · {f.weight === 0 ? 'not counted' : `${pct(f.value)} × weight ${f.weight}`}
                  </b>
                  <span>{f.why}</span>
                </li>
              ))}
            </ul>
            {score.per_participant.length > 0 && (
              <table className="opt-people">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Free</th>
                    <th>Travel</th>
                    <th>Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {score.per_participant.map((p, i) => (
                    // id is redacted to everyone but the organiser/self — see model.ts
                    <tr key={p.participant_id ?? `${p.name}-${i}`}>
                      <td>{p.name}</td>
                      <td>{p.time_ok === null ? '—' : p.time_ok ? 'yes' : 'no'}</td>
                      <td>{p.travel_km === null ? '—' : `${p.travel_km.toFixed(1)} km`}</td>
                      <td>{p.budget_ok === null ? '—' : p.budget_ok ? 'ok' : 'over'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="tiny faint">
              Based on {pct(score.confidence)} of the group having answered. A dash means they
              haven’t said — never that they agreed.
            </p>
          </div>
        )}

        <div className="opt-actions">
          {onVote && !excluded && (
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => onVote(1)}>
                Want this
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => onVote(-1)}>
                Rather not
              </button>
            </>
          )}
          {onChoose && !excluded && (
            <button className="btn btn-primary" disabled={busy} onClick={onChoose}>
              {chosen ? 'Chosen' : 'Pick this'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
