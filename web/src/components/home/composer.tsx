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
      <div className="composer-copy">
        <span className="eyebrow">Start anything</span>
        <h1 id="composer-title">
          Say it, paste it,<br />or drop the bill.
        </h1>
        <p>
          An idea gets planned with your group. A link gets read from the merchant. A receipt gets
          itemised. All three end the same way — everyone pays their own share from their own card.
        </p>
      </div>

      <div className="composer-action">
        <div className={`composer-box${read ? ` composer-box-${read.route}` : ''}`}>
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={8}
              placeholder={'Paste the receipt, line by line…\n\n2x Margherita       24.00\nPaneer Tikka        380\nService charge       45'}
              aria-label="Describe a plan, paste a link, or paste a bill"
              autoFocus
            />
          ) : (
            <input
              value={value}
              onChange={(e) => {
                const next = e.target.value
                setValue(next)
                if (next.includes('\n')) setMultiline(true)
              }}
              onPaste={(e) => {
                // A pasted receipt needs room to breathe immediately.
                if (e.clipboardData.getData('text').includes('\n')) setMultiline(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  go()
                }
              }}
              placeholder="Dinner saturday with Arsh and Maya near Koramangala, under ₹800 each"
              aria-label="Describe a plan, paste a link, or paste a bill"
            />
          )}

          <div className="composer-foot">
            <button
              type="button"
              className="composer-mode"
              onClick={() => setMultiline((v) => !v)}
              aria-pressed={multiline}
            >
              {multiline ? 'One line' : 'Paste a receipt'}
            </button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={!read}>
              {read ? read.label : 'Continue'}
            </button>
          </div>
        </div>

        <p className="composer-read" role="status" aria-live="polite">
          {read ? read.detail : 'Type anything. We’ll tell you what happens next before it happens.'}
        </p>
      </div>
    </section>
  )
}
