'use client'

import { useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { money, toMinor } from '@/lib/format'
import { ErrorNote } from '@/components/ui'
import type { PlanOption } from './model'
import { CheckoutModePicker, type CheckoutMode } from '@/components/discover/how-it-completes'

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
    detail: 'One decline cancels the handoff; no payment is claimed.',
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
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('')
  const [posConfirmed, setPosConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const groupTotal = toMinor(amount, currency)
  const quorumM = Math.max(2, Math.ceil(headcount * 0.6))
  const isVenue = option.source === 'overpass'

  const submit = async () => {
    if (groupTotal <= 0) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ group_id: string }>(`/v1/plans/${planId}/convert`, {
        unit_amount: groupTotal,
        qty: 1,
        currency,
        policy: policyId === 'quorum' ? { type: 'quorum', m: quorumM } : { type: 'all_of' },
        rail: checkoutMode,
      })
      onDone(res.group_id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (isVenue) {
    return (
      <section className="convert plan-stays-plan">
        <div className="convert-head">
          <span className="eyebrow">Plan chosen</span>
          <h2>{option.title}</h2>
        </div>
        <div className="plan-boundary-grid">
          <div>
            <span className="field-label">What is locked in</span>
            <b>The place, the people and the common time.</b>
            <p>Your budget answers stay estimates. They help rank the plan; they are not a bill and never become a charge.</p>
          </div>
          <div>
            <span className="field-label">After the outing</span>
            <b>Split the real receipt.</b>
            <p>Scan or enter the final lines, including tax and tip. Each person confirms the amount they actually owe.</p>
          </div>
          <div>
            <span className="field-label">When merchants integrate</span>
            <b>The plan can continue into payment.</b>
            <p>A Shopify POS or Sutra merchant adapter can attach a live quote and collect each share without replacing the plan.</p>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 16 }}>
          <Link className="btn btn-primary" href="/app/bill">Split the real bill when it arrives</Link>
          {option.url && <a className="btn btn-secondary" href={option.url} target="_blank" rel="noreferrer">Open venue ↗</a>}
        </div>
      </section>
    )
  }

  return (
    <section className="convert">
      <div className="convert-head">
        <span className="eyebrow">Turn it into a split</span>
        <h2>{option.title}</h2>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <CheckoutModePicker
        value={checkoutMode}
        onChange={setCheckoutMode}
        isShopify={option.source === 'shopify'}
        posConfirmed={posConfirmed}
        onPosConfirmed={setPosConfirmed}
      />

      <div className="convert-grid">
        <div className="field">
          <span className="field-label">
            {known ? 'Item total' : 'What will the group purchase cost?'}
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
            Read from the merchant’s own page. Change it if the page is out of date; shipping and tax are confirmed later.
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

      {groupTotal > 0 && (
        <p className="convert-sum">
          <b>{money(groupTotal, currency)}</b> shared across {headcount}{' '}
          {headcount === 1 ? 'person' : 'people'}
          . Nothing is charged through sutra. {checkoutMode === 'shopify_pos'
            ? 'Each person presents their own card at Shopify POS.'
            : 'Delivery address, shipping, tax and final payment remain at merchant checkout.'}
        </p>
      )}

      <button
        className="btn btn-primary btn-lg"
        disabled={busy || groupTotal <= 0 || !checkoutMode || (checkoutMode === 'shopify_pos' && !posConfirmed)}
        onClick={() => void submit()}
      >
        {busy ? 'Creating…' : checkoutMode === 'shopify_pos' ? 'Prepare the POS split' : checkoutMode === 'checkout_handoff' ? 'Prepare checkout handoff' : 'Choose how this finishes'}
      </button>
    </section>
  )
}
