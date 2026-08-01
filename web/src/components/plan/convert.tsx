'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { money, toMinor } from '@/lib/format'
import { ErrorNote } from '@/components/ui'
import type { PlanOption } from './model'

// The handover, and the one seam in this product that has to be said out loud.
//
// OpenStreetMap knows where a restaurant is. It does not know what dinner
// costs, and no amount of confidence would make a number we invented true. So
// when the chosen option carries no price, the group types one — and the page
// says exactly why it is asking rather than quietly defaulting to something.
//
// A storefront product resolved from a real merchant page already has a real
// price, and this panel simply confirms it.

const POLICIES = [
  {
    id: 'all_of',
    label: 'Everyone, or nobody',
    detail: 'One decline cancels the whole thing and nobody is charged.',
    value: { type: 'all_of' as const },
  },
  {
    id: 'quorum',
    label: 'Enough of us',
    detail: 'Goes ahead once most people are in; the rest simply drop out.',
    value: null, // filled from headcount below
  },
] as const

export function ConvertPanel({
  planId,
  option,
  currency,
  headcount,
  onDone,
}: {
  planId: string
  option: PlanOption
  currency: string
  headcount: number
  onDone: (groupId: string) => void
}) {
  const known = option.price?.amount_minor ?? 0
  const [amount, setAmount] = useState(known ? String(known / 100) : '')
  const [policyId, setPolicyId] = useState<'all_of' | 'quorum'>('all_of')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const perHead = toMinor(amount, currency)
  const quorumM = Math.max(2, Math.ceil(headcount * 0.6))
  const isVenue = option.source === 'overpass'

  const submit = async () => {
    if (perHead <= 0) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ group_id: string }>(`/v1/plans/${planId}/convert`, {
        unit_amount: perHead,
        qty: headcount,
        currency,
        policy: policyId === 'quorum' ? { type: 'quorum', m: quorumM } : { type: 'all_of' },
      })
      onDone(res.group_id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="convert">
      <div className="convert-head">
        <span className="eyebrow">Turn it into a split</span>
        <h2>{option.title}</h2>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="convert-grid">
        <div className="field">
          <span className="field-label">
            {known ? 'Price per person' : 'What will it cost each?'}
          </span>
          <input
            className="input input-lg"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount in ${currency}`}
            autoFocus={!known}
          />
          <span className="tiny faint">
            {isVenue
              ? 'The map knows where this place is, not what a meal there costs — so this number comes from you, not from us.'
              : 'Read from the merchant’s own page. Change it if the page is out of date.'}
          </span>
        </div>

        <div className="field">
          <span className="field-label">What lets it go ahead</span>
          <div className="convert-policies">
            {POLICIES.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`convert-policy${policyId === p.id ? ' is-on' : ''}`}
                onClick={() => setPolicyId(p.id)}
                aria-pressed={policyId === p.id}
              >
                <span className="convert-policy-label">
                  {p.id === 'quorum' ? `Any ${quorumM} of ${headcount}` : p.label}
                </span>
                <span className="tiny faint">{p.detail}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {perHead > 0 && (
        <p className="convert-sum">
          {headcount} {headcount === 1 ? 'person' : 'people'} × {money(perHead, currency)} ={' '}
          <b>{money(perHead * headcount, currency)}</b>
          {isVenue ? (
            <>
              . Nothing is charged through sutra — everyone agrees their share here, then pays the
              venue on their own card.
            </>
          ) : (
            <>
              . Each person approves their own share on their own card, capped at that amount by the
              card network.
            </>
          )}
        </p>
      )}

      <button className="btn btn-primary btn-lg" disabled={busy || perHead <= 0} onClick={() => void submit()}>
        {busy ? 'Creating…' : 'Send everyone their share'}
      </button>
    </section>
  )
}
