'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

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

interface Read {
  route: Route
  label: string
  detail: string
}

const URL_RE = /^https?:\/\/\S+$/i
const BARE_DOMAIN_RE = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i
/** A line ending in something money-shaped: "Paneer Tikka   380.00" */
const MONEY_LINE_RE = /[^\n]*?[\d][\d,]*(?:[.,]\d{2})?\s*$/

function readInput(raw: string): Read | null {
  const text = raw.trim()
  if (!text) return null

  if (URL_RE.test(text) || BARE_DOMAIN_RE.test(text)) {
    let host = text
    try {
      host = new URL(URL_RE.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, '')
    } catch {
      /* keep the raw string; the resolver will report a bad link properly */
    }
    return {
      route: 'link',
      label: 'Read this page',
      detail: `We’ll open ${host} and read its own price, currency and variants — then you shape the split.`,
    }
  }

  // A receipt is the one thing people paste as many lines, most of which end
  // in a number. Two such lines is enough signal and rarely a false positive.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const moneyLines = lines.filter((l) => MONEY_LINE_RE.test(l) && /\d/.test(l))
  if (lines.length >= 3 && moneyLines.length >= 2) {
    return {
      route: 'bill',
      label: 'Split this bill',
      detail: `${moneyLines.length} priced lines detected. We’ll itemise it, check the maths against the printed total, then let everyone claim their dishes.`,
    }
  }

  return {
    route: 'plan',
    label: 'Plan with Sutra bot',
    detail:
      'Sutra bot reads who, when and where from that sentence, asks everyone for their times and locations, then ranks real places against the answers.',
  }
}

export function Composer() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [multiline, setMultiline] = useState(false)

  const read = useMemo(() => readInput(value), [value])

  const go = () => {
    const text = value.trim()
    if (!read || !text) return
    if (read.route === 'link') {
      const url = URL_RE.test(text) ? text : `https://${text}`
      router.push(`/app/discover?url=${encodeURIComponent(url)}`)
      return
    }
    if (read.route === 'bill') {
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
        <span className="eyebrow">Sutra bot</span>
        <h1 id="composer-title">What are we doing?</h1>
        <p className="muted">
          Say it, paste a link, or drop in the bill. An idea gets planned with your group, a link
          gets read from the merchant, a receipt gets itemised — and all three end the same way.
        </p>
      </header>

      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault()
          go()
        }}
      >
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (e.target.value.includes('\n')) setMultiline(true)
          }}
          onPaste={(e) => {
            // A pasted receipt needs room to breathe immediately.
            if (e.clipboardData.getData('text').includes('\n')) setMultiline(true)
          }}
          onKeyDown={(e) => {
            // Enter sends; shift-enter is for the people pasting a receipt.
            if (e.key === 'Enter' && !e.shiftKey && !multiline) {
              e.preventDefault()
              go()
            }
          }}
          rows={multiline ? 9 : 3}
          placeholder="Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each"
          aria-label="Describe a plan, paste a link, or paste a bill"
        />
        <button className="btn btn-primary btn-lg" type="submit" disabled={!read}>
          {read ? read.label : 'Continue'}
        </button>
      </form>

      {/* Say where this is about to go before anything is pressed. Detection
          that acts silently is a magic trick; detection that announces itself
          is a tool. */}
      <p className="composer-read" role="status" aria-live="polite">
        {read ? read.detail : 'Type anything. We’ll tell you what happens next before it happens.'}
      </p>

      <div className="ask-examples">
        <span className="tiny faint">Try one:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setValue(ex)
              setMultiline(false)
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
const EXAMPLES = [
  'Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each',
  'Somewhere to watch the match with the boys tonight',
  'Coffee tomorrow morning with Priya around Indiranagar',
]
