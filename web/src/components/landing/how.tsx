'use client'

import { useEffect, useRef, useState } from 'react'

// How it works, as a scroll-driven sequence rather than a list.
//
// The product's mark is a thread through separate nodes, and that is literally
// what this section is: a line that draws itself down the page while the panel
// beside it shows the actual moment being described. Each step is a real screen
// from the product, drawn in markup — a prompt, three friends answering, venues
// ranked with their real factor bars, a thread of consent going green.
//
// The visual is sticky and the text scrolls past it, so the panel is doing the
// explaining and the words are captions. That is the right way round for
// something people find abstract.

interface Step {
  n: string
  title: string
  body: string
  aside: string
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Tell Sutra bot what you want',
    body: 'Say it the way you would say it to a friend. It works out who you mean, roughly when, and what you can spend.',
    aside: 'Or paste a link. Or photograph a receipt.',
  },
  {
    n: '02',
    title: 'Your friends answer on their phones',
    body: 'Each gets their own link — no account, no download. They tap when they are free, where they are coming from, and their own limit.',
    aside: 'Their budget is never shown to the group.',
  },
  {
    n: '03',
    title: 'Real places, ranked on real answers',
    body: 'Venues from OpenStreetMap, scored on who can make the time, how far each person travels, and whose budget fits. Every number is shown.',
    aside: 'Nothing invented. You can check the arithmetic.',
  },
  {
    n: '04',
    title: 'Everyone pays their own share',
    body: 'Each person approves their own amount on their own card, capped at their own number. Everybody is charged at once — or nobody is, and every approval is released.',
    aside: 'Nobody fronts the money. Nobody chases anybody.',
  },
]

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        // The step whose middle is closest to the middle of the screen wins,
        // rather than "the last one to cross a line" — that stays correct when
        // somebody flings the page or scrolls back up.
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
        void entries
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-15% 0px -15% 0px' },
    )
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
            <span className="how-track-fill" style={{ height: `${((active + 1) / STEPS.length) * 100}%` }} />
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
                <div key={i} className={`how-scene${i === active ? ' is-on' : ''}`}>
                  <Scene index={i} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="how-foot">
          <b>The honest bit:</b> when the merchant takes card payments through our rail, everyone is
          charged directly and no money is ever pooled. When it is a paper restaurant bill, Sutra
          does the exact split and records who agreed to what — and says plainly that nothing was
          charged, because nothing was.
        </p>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */

const FRIENDS = [
  { name: 'Soham', from: 'Koramangala', when: '7–11pm' },
  { name: 'Arsh', from: 'Indiranagar', when: '8–11.30pm' },
  { name: 'Maya', from: 'Jayanagar', when: '7.30–10.30pm' },
]

const VENUES = [
  { name: 'Sukh Sagar', km: '2.7 km', score: 93 },
  { name: 'Nandhana', km: '3.7 km', score: 92 },
  { name: 'Simply Native', km: '3.9 km', score: 91 },
]

function Scene({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="sc sc-say">
        <span className="sc-chip">Sutra bot</span>
        <p className="sc-typed">
          Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each
          <i className="sc-caret" />
        </p>
        <div className="sc-slots">
          <span><b>restaurant</b>what</span>
          <span><b>Sat evening</b>when</span>
          <span><b>Koramangala</b>where</span>
          <span><b>₹800</b>each</span>
        </div>
      </div>
    )
  }

  if (index === 1) {
    return (
      <div className="sc sc-answers">
        {FRIENDS.map((f, i) => (
          <div className="sc-card" key={f.name} style={{ animationDelay: `${i * 160}ms` }}>
            <i className="sc-av">{f.name[0]}</i>
            <div>
              <b>{f.name}</b>
              <small>
                free {f.when} · from {f.from}
              </small>
            </div>
            <span className="sc-tick">✓</span>
          </div>
        ))}
        <p className="sc-note">Budgets stay private. Only the ranking sees them.</p>
      </div>
    )
  }

  if (index === 2) {
    return (
      <div className="sc sc-rank">
        <div className="sc-window">
          Best common window <b>8:00–10:30pm</b> · 3 of 3 can make it
        </div>
        {VENUES.map((v, i) => (
          <div className="sc-venue" key={v.name} style={{ animationDelay: `${i * 140}ms` }}>
            <div className="sc-venue-top">
              <b>{v.name}</b>
              <span>{v.score}%</span>
            </div>
            <div className="sc-bars">
              <i style={{ width: '100%' }} title="time" />
              <i style={{ width: `${v.score - 8}%` }} title="travel" />
              <i style={{ width: '50%' }} title="budget" />
            </div>
            <small>longest trip {v.km}</small>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="sc sc-pay">
      <div className="sc-thread">
        {FRIENDS.map((f, i) => (
          <span key={f.name} className="sc-node" style={{ animationDelay: `${i * 200}ms` }}>
            <i>{f.name[0]}</i>
            <b>₹780</b>
          </span>
        ))}
        <span className="sc-line" />
      </div>
      <div className="sc-receipt">
        <span className="sc-tick sc-tick-lg">✓</span>
        <div>
          <b>Charged · ₹2,340</b>
          <small>3 consent records · signed receipt</small>
        </div>
      </div>
      <p className="sc-note">Three cards, one merchant, one moment. No one was owed anything.</p>
    </div>
  )
}
