'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// One box, three destinations.
//
// A person arriving here has one of exactly three things in hand: an idea
// ("dinner saturday with Arsh"), a link (the checkout page they are already
// on), or a bill (the receipt that just landed on the table). Making them
// choose a mode first is a tax on knowing our own architecture.
//
// So the box reads what you typed and SAYS where it is about to send you
// before you press anything. Detection that acts silently is a magic trick;
// detection that announces itself is a tool.

type Route = 'plan' | 'link' | 'bill'

const URL_RE = /^https?:\/\/\S+$/i
const DOMAIN_RE = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i

const MODES: Record<Route, { label: string; hint: string; placeholder: string; action: string }> = {
  plan: {
    label: 'Plan an idea',
    hint: 'Tell us what, who, roughly when, where, and a budget if you have one.',
    placeholder: 'Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each',
    action: 'Review the plan',
  },
  link: {
    label: 'Split a link',
    hint: 'Paste a public merchant or product page. Sutra reads the page; you verify the item and price.',
    placeholder: 'https://merchant.com/product',
    action: 'Read the page',
  },
  bill: {
    label: 'Split a bill',
    hint: 'Paste receipt lines here, or open the bill scanner to take or upload a photo.',
    placeholder: 'Paneer tikka  380.00\nLime soda      120.00\nTotal          500.00',
    action: 'Itemise the bill',
  },
}

export function Composer() {
  const router = useRouter()
  const [mode, setMode] = useState<Route>('plan')
  const [values, setValues] = useState<Record<Route, string>>({ plan: '', link: '', bill: '' })
  const value = values[mode]
  const setValue = (next: string) => setValues((current) => ({ ...current, [mode]: next }))
  const linkValid = mode !== 'link' || URL_RE.test(value.trim()) || DOMAIN_RE.test(value.trim())

  const go = () => {
    const text = value.trim()
    if (!text || !linkValid) return
    if (mode === 'link') {
      const url = URL_RE.test(text) ? text : `https://${text}`
      router.push(`/app/discover?url=${encodeURIComponent(url)}`)
      return
    }
    if (mode === 'bill') {
      sessionStorage.setItem('sutra:bill', text)
      router.push('/app/bill')
      return
    }
    sessionStorage.setItem('sutra:intent', text)
    router.push(`/app/plan/new?q=${encodeURIComponent(text.slice(0, 300))}`)
  }

  return (
    <section className="composer" aria-labelledby="composer-title">
      <header className="page-head">
        <span className="eyebrow">Start a group</span>
        <h1 id="composer-title">What are you bringing?</h1>
        <p className="muted">
          Start with an idea, a real merchant page, or a receipt. You will check every detail before anyone is invited.
        </p>
      </header>

      <div className="composer-modes" role="group" aria-label="Choose what to start with">
        {(Object.keys(MODES) as Route[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
          >
            <span>{key === 'plan' ? '✦' : key === 'link' ? '↗' : '▤'}</span>
            {MODES[key].label}
          </button>
        ))}
      </div>

      <form
        className={`ask-box composer-box is-${mode}`}
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && mode !== 'bill') {
              e.preventDefault()
              go()
            }
          }}
          rows={mode === 'bill' ? 7 : 4}
          inputMode={mode === 'link' ? 'url' : 'text'}
          placeholder={MODES[mode].placeholder}
          aria-label={MODES[mode].label}
          aria-invalid={mode === 'link' && !!value.trim() && !linkValid}
        />
        {mode === 'link' && value.trim() && !linkValid && (
          <p className="composer-validation" role="alert">Paste a full product URL or a domain such as merchant.com/product.</p>
        )}
        <div className="composer-actions">
          {mode === 'bill' && (
            <button className="btn btn-secondary" type="button" onClick={() => router.push('/app/bill')}>
              Take or upload a photo
            </button>
          )}
          <button className="btn btn-primary btn-lg" type="submit" disabled={!value.trim() || !linkValid}>
            {MODES[mode].action} →
          </button>
        </div>
      </form>

      <div className="composer-next">
        <span className="eyebrow">After continue</span>
        <p>{MODES[mode].hint}</p>
        <ol>
          <li>{mode === 'plan' ? 'Check what Sutra understood' : mode === 'link' ? 'Verify the product and live price' : 'Check every item and the printed total'}</li>
          <li>Add the people involved</li>
          <li>Choose the rule, then share their private links</li>
        </ol>
      </div>

      <div className="ask-examples">
        <span className="tiny faint">Example</span>
        {EXAMPLES[mode].map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setValue(ex)
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </section>
  )
}

/** The same three the Sutra bot page offers, so the two never disagree. */
const EXAMPLES: Record<Route, string[]> = {
  plan: ['Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each'],
  link: ['https://www.amazon.in/dp/example'],
  bill: ['Paneer tikka  380.00\nLime soda  120.00\nTotal  500.00'],
}
