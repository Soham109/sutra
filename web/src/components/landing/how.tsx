'use client'

import { useEffect, useRef, useState } from 'react'

// How it works, as a scroll-driven sequence of real devices.
//
// The panel shows what is actually on somebody's screen at each moment: a
// phone with the prompt, the browser extension reading a checkout page, the QR
// that puts a link in four hands, four phones answering, and four phones
// flipping to paid at once. Text is the caption; the device is the argument.
//
// Everything drawn here is markup, not screenshots — so it stays correct when
// the product changes, and it weighs nothing.

interface Step {
  n: string
  title: string
  body: string
  aside: string
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Say it in your own words',
    body: 'Tell Sutra bot what you want. It works out who you mean, roughly when, and what it should cost — then goes and finds real places that fit.',
    aside: 'Nothing invented. Every venue is a real place with real coordinates.',
  },
  {
    n: '02',
    title: 'Or split the page you’re already on',
    body: 'The browser extension reads the checkout you have open — the real price, currency and quantity, straight off the merchant’s own page — and turns it into a split without you retyping anything.',
    aside: 'Works on stores nobody integrated with. Bookmarklet too, zero install.',
  },
  {
    n: '03',
    title: 'Everyone gets their own link',
    body: 'Show the QR at the table or drop the links in the chat. No account, no download — each person opens their own share on their own phone.',
    aside: 'A leaked link still can’t do anything without that person’s passkey.',
  },
  {
    n: '04',
    title: 'They answer in a few taps',
    body: 'When they are free, where they are coming from, what they can spend. Sutra ranks real venues against those answers and shows the arithmetic.',
    aside: 'Budgets stay private. Only the ranking ever sees them.',
  },
  {
    n: '05',
    title: 'Everyone pays their own share',
    body: 'Each person approves their own amount on their own card, capped at their own number by the card network. Every phone flips in the same second — or nobody is charged at all.',
    aside: 'Nobody fronts the money. Nobody chases anybody.',
  },
]

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const pick = () => {
      const mid = window.innerHeight / 2
      let best = -1
      let bestDist = Infinity
      for (const el of stepRefs.current) {
        if (!el) continue
        const box = el.getBoundingClientRect()
        const dist = Math.abs(box.top + box.height / 2 - mid)
        if (dist < bestDist) {
          bestDist = dist
          best = Number(el.dataset.i)
        }
      }
      if (best >= 0) setActive(best)
    }
    // Nearest-to-centre rather than "last one to cross a line", so it stays
    // correct when the page is flung or scrolled back up.
    const io = new IntersectionObserver(pick, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
      rootMargin: '-15% 0px -15% 0px',
    })
    for (const el of stepRefs.current) if (el) io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section id="how" className="l-how">
      <div className="l-wrap">
        <header className="l-section-head l-section-head-wide">
          <span className="l-section-no">HOW IT WORKS</span>
          <h2>
            One person plans it.
            <br />
            Nobody becomes the bank.
          </h2>
          <p>
            The awkward part of doing anything as a group was never the booking. It is one friend
            paying for everyone, then spending a fortnight asking for it back.
          </p>
        </header>

        <div className="how-scroll">
          <div className="how-track" aria-hidden>
            <span
              className="how-track-fill"
              style={{ height: `${((active + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <ol className="how-list">
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                ref={(el) => {
                  stepRefs.current[i] = el
                }}
                data-i={i}
                className={i === active ? 'is-active' : ''}
              >
                <span className="how-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="how-aside">{s.aside}</span>
              </li>
            ))}
          </ol>

          <div className="how-stage">
            <div className="how-panel">
              {STEPS.map((_, i) => (
                <div key={i} className={`how-scene${i === active ? ' is-on' : ''}`} aria-hidden={i !== active}>
                  <Scene index={i} on={i === active} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

const CREW = [
  { name: 'Soham', from: 'Koramangala', when: '7–11pm' },
  { name: 'Arsh', from: 'Indiranagar', when: '8–11.30pm' },
  { name: 'Maya', from: 'Jayanagar', when: '7.30–10.30pm' },
]

/** A phone. Real proportions, a bezel, a notch, and a home indicator. */
function Phone({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  return (
    <div className={`ph ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <span className="ph-notch" aria-hidden />
      <div className="ph-screen">{children}</div>
      <span className="ph-home" aria-hidden />
    </div>
  )
}

/* Icons. Inline so they inherit colour and cost nothing to load. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function Icon({ name, className = '' }: { name: string; className?: string }) {
  const p = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, className: `ico ${className}` }
  switch (name) {
    case 'clock':
      return <svg {...p}><circle cx="8" cy="8" r="6" {...S} /><path d="M8 4.6V8l2.2 1.6" {...S} /></svg>
    case 'pin':
      return <svg {...p}><path d="M8 14s4.5-4 4.5-7a4.5 4.5 0 1 0-9 0c0 3 4.5 7 4.5 7Z" {...S} /><circle cx="8" cy="6.9" r="1.6" {...S} /></svg>
    case 'wallet':
      return <svg {...p}><rect x="2" y="4" width="12" height="9" rx="2" {...S} /><path d="M11 8.5h1.6" {...S} /></svg>
    case 'check':
      return <svg {...p}><path d="M3.4 8.4 6.6 11.4l6-6.6" {...S} /></svg>
    case 'sparkle':
      return <svg {...p}><path d="M8 2.2 9.3 6l3.8 1.3-3.8 1.3L8 12.4 6.7 8.6 2.9 7.3 6.7 6 8 2.2Z" {...S} /></svg>
    case 'scan':
      return <svg {...p}><path d="M3 6V4.4A1.4 1.4 0 0 1 4.4 3H6M10 3h1.6A1.4 1.4 0 0 1 13 4.4V6M13 10v1.6a1.4 1.4 0 0 1-1.4 1.4H10M6 13H4.4A1.4 1.4 0 0 1 3 11.6V10" {...S} /></svg>
    case 'card':
      return <svg {...p}><rect x="2" y="4" width="12" height="8" rx="1.6" {...S} /><path d="M2 7h12" {...S} /></svg>
    default:
      return null
  }
}

/** A QR-ish block. Deterministic from a seed so it never flickers on re-render. */
function Qr() {
  const cells = Array.from({ length: 121 }, (_, i) => {
    const x = i % 11
    const y = Math.floor(i / 11)
    const finder = (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7)
    return finder || (((x * 7 + y * 13 + x * y) % 5) < 2)
  })
  return (
    <div className="qr" aria-hidden>
      {cells.map((on, i) => (
        <i key={i} className={on ? 'on' : ''} />
      ))}
    </div>
  )
}

function Scene({ index, on }: { index: number; on: boolean }) {
  // 01 — the prompt
  if (index === 0) {
    return (
      <div className="sc sc-one">
        <Phone className="ph-lead">
          <span className="ph-bar"><Icon name="sparkle" /> Sutra bot</span>
          <p className="ph-typed">
            Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each
            {on && <i className="ph-caret" />}
          </p>
          <div className="ph-slots">
            <span><b>restaurant</b>what</span>
            <span><b>Sat evening</b>when</span>
            <span><b>Koramangala</b>where</span>
            <span><b>₹800</b>each</span>
          </div>
        </Phone>
      </div>
    )
  }

  // 02 — the extension reading a real checkout
  if (index === 1) {
    return (
      <div className="sc sc-ext">
        <div className="brow">
          <span className="brow-bar">
            <i /><i /><i />
            <b>allbirds.com/products/…</b>
            <em className="brow-ext">S</em>
          </span>
          <div className="brow-body">
            <div className="brow-page">
              <span className="brow-img" />
              <span className="brow-l" />
              <span className="brow-l brow-l-sm" />
              <b className="brow-price">$40.00</b>
            </div>
            <div className="brow-sheet">
              <span className="brow-chip"><Icon name="scan" /> read from this page</span>
              <b>Men’s Soft Merino Tee</b>
              <small>$40.00 · USD · via json-ld</small>
              <span className="brow-cta">Split this</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 03 — one QR, four hands
  if (index === 2) {
    return (
      <div className="sc sc-qr">
        <div className="qr-card">
          <Qr />
          <b><Icon name="scan" /> Scan to join</b>
          <small>4 links · no account needed</small>
        </div>
        <div className="qr-fan">
          {CREW.map((c, i) => (
            <Phone key={c.name} className="ph-mini" delay={i * 150}>
              <span className="ph-av ph-av-sm">{c.name[0]}</span>
              <span className="ph-mini-top">your share</span>
              <b className="ph-mini-amt">₹780</b>
              <span className="ph-mini-btn">
                <Icon name="card" /> Review
              </span>
            </Phone>
          ))}
        </div>
      </div>
    )
  }

  // 04 — answering
  if (index === 3) {
    return (
      <div className="sc sc-ans">
        {CREW.map((f, i) => (
          <Phone key={f.name} className="ph-mini ph-ans" delay={i * 170}>
            <span className="ph-av">{f.name[0]}</span>
            <b className="ph-ans-name">{f.name}</b>
            <span className="ph-ans-row"><Icon name="clock" /> {f.when}</span>
            <span className="ph-ans-row"><Icon name="pin" /> {f.from}</span>
            <span className="ph-ans-row"><Icon name="wallet" /> set</span>
            <span className="ph-ans-tick"><Icon name="check" /></span>
          </Phone>
        ))}
        <div className="ans-out">
          <span className="ans-win">8:00–10:30pm · 3 of 3 can make it</span>
          <div className="ans-venue"><b>Sukh Sagar</b><span>93%</span></div>
          <div className="ans-venue"><b>Nandhana</b><span>92%</span></div>
        </div>
      </div>
    )
  }

  // 05 — every phone flips at once
  return (
    <div className="sc sc-pay">
      <div className="pay-row">
        {CREW.map((f, i) => (
          <Phone key={f.name} className="ph-mini ph-paid" delay={i * 120}>
            <span className="ph-paid-tick"><Icon name="check" /></span>
            <b className="ph-mini-amt">₹780</b>
            <span className="ph-mini-top">charged</span>
          </Phone>
        ))}
      </div>
      <div className="pay-receipt">
        <b>₹2,340 charged · 3 cards</b>
        <small>one merchant · signed receipt · nobody was owed anything</small>
      </div>
    </div>
  )
}
