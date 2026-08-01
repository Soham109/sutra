'use client'

import { useState } from 'react'
import { money, toMinor } from '@/lib/format'
import type { SignalPayload } from './model'

// The most you are willing to pay for your own share.
//
// This is the signal people are most reluctant to give, so the page says the
// true thing plainly: it is never shown to the group, and it only filters what
// gets suggested. It is a filter, not a pledge — the number does not authorise
// anything, and nothing can be charged against it. That happens later, on your
// own card, behind your own passkey, at an amount you see first.

const STEPS = [0.5, 0.75, 1, 1.5, 2]

export function BudgetPicker({
  busy,
  currency,
  suggestion,
  onSend,
}: {
  busy: boolean
  currency: string
  /** the organiser's stated per-person ceiling, if they gave one */
  suggestion: number | null
  onSend: (p: SignalPayload) => void | Promise<void>
}) {
  const [custom, setCustom] = useState('')

  const presets = suggestion
    ? [...new Set(STEPS.map((m) => Math.round((suggestion * m) / 100) * 100))]
    : []

  const send = (minor: number) => void onSend({ kind: 'budget', ceiling_minor: minor, currency })

  return (
    <>
      <h2>What’s your limit?</h2>
      <p className="answer-help">
        The most you’d want your share to be
        {suggestion ? <> — they suggested around {money(suggestion, currency)}</> : null}.
      </p>

      {presets.length > 0 && (
        <div className="budget-presets" role="group" aria-label="Pick a limit">
          {presets.map((p) => (
            <button key={p} type="button" className="budget-chip" disabled={busy} onClick={() => send(p)}>
              {money(p, currency)}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const minor = toMinor(custom, currency)
          if (minor > 0) send(minor)
        }}
      >
        <div className="row" style={{ gap: 8, marginTop: presets.length ? 12 : 0 }}>
          <input
            className="input input-lg grow"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={`Another amount in ${currency}`}
            aria-label={`Your own limit, in ${currency}`}
          />
          <button className="btn btn-primary" disabled={busy || toMinor(custom, currency) <= 0}>
            Set
          </button>
        </div>
      </form>

      <button
        type="button"
        className="btn btn-ghost btn-block"
        style={{ marginTop: 10 }}
        disabled={busy}
        // A very large ceiling is the honest encoding of "I don't care" — it
        // never excludes anything, and it never claims a number they did not
        // give. Skipping entirely would drop them from the budget maths, and
        // that is a different, quieter statement than "anything's fine".
        onClick={() => send(Number.MAX_SAFE_INTEGER > 1e12 ? 1e11 : 1e9)}
      >
        No limit — whatever the group picks
      </button>

      <p className="answer-privacy">
        Nobody sees this number, not even the organiser. It only decides what gets suggested, and it
        cannot be charged — paying is a separate step you approve yourself.
      </p>
    </>
  )
}
