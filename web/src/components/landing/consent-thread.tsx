'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/ui'
import { CART, CAST, inr } from './demo-cart'

/**
 * One group booking, told the way you would tell it to a friend.
 *
 * Deliberately plain: no policy expressions, no mandates, no verdicts. The
 * protocol underneath is exactly the same one the engine runs — this just
 * says it in words a person buying cinema tickets already uses.
 *
 * The replay starts from the first step when it scrolls into view, holds each
 * step long enough to actually read, and can be stepped through by hand.
 */

type Who = 'waiting' | 'deciding' | 'yes' | 'no' | 'covering' | 'paid' | 'released'
type Outcome = 'booked' | 'off'
type StoryId = 'cover' | 'everyone'

interface Step {
  /** How long this step holds when it is playing itself. */
  ms: number
  who: Who[]
  amounts: number[]
  say: string
  /** The share sliding from Ada across to the gap Cleo left. */
  token?: boolean
  /** Index of the person whose share someone else is covering. */
  covered?: number
  result?: { kind: Outcome; head: string; detail: string }
}

interface Story {
  /** What the group agreed before anyone was asked — in plain words. */
  rule: string
  tab: string
  steps: Step[]
}

const S = CART.share
const BASE = [S, S, S, S]

const STATE_LABEL: Record<Who, string> = {
  waiting: 'Not yet',
  deciding: 'Deciding',
  yes: 'Approved',
  covering: 'Covering Cleo',
  no: 'Said no',
  paid: 'Paid',
  released: 'Released',
}

const STATE_TONE: Record<Who, string> = {
  waiting: 'cs-tag',
  deciding: 'cs-tag cs-tag-wait',
  yes: 'cs-tag cs-tag-yes',
  covering: 'cs-tag cs-tag-yes',
  no: 'cs-tag cs-tag-no',
  paid: 'cs-tag cs-tag-paid',
  released: 'cs-tag cs-tag-no',
}

const COVER: Step[] = [
  {
    ms: 4200, who: ['waiting', 'waiting', 'waiting', 'waiting'], amounts: BASE,
    say: `Ada picked four seats for Friday. Everyone gets sent their own ${inr(S)} to approve. Nothing has been charged yet.`,
  },
  {
    ms: 2800, who: ['deciding', 'waiting', 'waiting', 'waiting'], amounts: BASE,
    say: 'Ada opens hers first. Her phone, her card, her Face ID.',
  },
  {
    ms: 4200, who: ['yes', 'waiting', 'waiting', 'waiting'], amounts: BASE,
    say: `Ada approves ${inr(S)}. It is held on her own card, locked to ${CART.merchant}, and cannot be charged for a rupee more than her share.`,
  },
  {
    ms: 3600, who: ['yes', 'yes', 'waiting', 'waiting'], amounts: BASE,
    say: `Ben approves his ${inr(S)} on his own card. Ada is not paying for him and will not be chasing him later.`,
  },
  {
    ms: 2400, who: ['yes', 'yes', 'deciding', 'waiting'], amounts: BASE,
    say: 'Cleo opens hers.',
  },
  {
    ms: 4400, who: ['yes', 'yes', 'no', 'waiting'], amounts: BASE,
    say: 'Cleo cannot make it, so she says no. She is not charged, and she does not owe anybody anything.',
  },
  {
    ms: 2800, who: ['yes', 'yes', 'no', 'yes'], amounts: BASE,
    say: `Dev approves his ${inr(S)}.`,
  },
  {
    ms: 4800, who: ['yes', 'yes', 'no', 'yes'], amounts: BASE, covered: 2,
    say: `Three of the four are in, which is all this group asked for. But the seats still cost ${inr(CART.total)}, and ${inr(S)} of that is missing.`,
  },
  {
    ms: 5200, who: ['covering', 'yes', 'no', 'yes'], amounts: BASE, token: true, covered: 2,
    say: `Ada had offered to cover up to ${inr(CART.coverCap)} if somebody dropped — agreed before anyone was asked. ${inr(S)} of that is used now.`,
  },
  {
    ms: 4200, who: ['covering', 'yes', 'no', 'yes'], amounts: [CART.covered, S, S, S], covered: 2,
    say: `Ada's share reads ${inr(CART.covered)}, still inside the limit she set herself. Nobody was asked for more money, and nobody had to negotiate.`,
  },
  {
    ms: 4000, who: ['paid', 'paid', 'released', 'paid'], amounts: [CART.covered, S, S, S], covered: 2,
    result: { kind: 'booked', head: 'Booked', detail: `3 cards · ${inr(CART.total)} · one go` },
    say: 'All three cards are charged in the same moment. The cinema is paid once, in full.',
  },
  {
    ms: 6500, who: ['paid', 'paid', 'released', 'paid'], amounts: [CART.covered, S, S, S], covered: 2,
    result: { kind: 'booked', head: 'Booked', detail: `3 cards · ${inr(CART.total)} · one go` },
    say: 'Everyone paid the cinema straight from their own card. Nobody fronted the money, so nobody has to be paid back.',
  },
]

const EVERYONE: Step[] = [
  {
    ms: 4600, who: ['waiting', 'waiting', 'waiting', 'waiting'], amounts: BASE,
    say: 'Same four seats, same four people. This time the group asked for something stricter: everyone is in, or the booking does not happen.',
  },
  {
    ms: 2800, who: ['yes', 'waiting', 'waiting', 'waiting'], amounts: BASE,
    say: `Ada approves ${inr(S)}.`,
  },
  {
    ms: 2800, who: ['yes', 'yes', 'waiting', 'waiting'], amounts: BASE,
    say: `Ben approves ${inr(S)}.`,
  },
  {
    ms: 3200, who: ['yes', 'yes', 'yes', 'waiting'], amounts: BASE,
    say: `Cleo approves ${inr(S)}. One to go.`,
  },
  {
    ms: 2400, who: ['yes', 'yes', 'yes', 'deciding'], amounts: BASE,
    say: 'Dev opens his.',
  },
  {
    ms: 3000, who: ['yes', 'yes', 'yes', 'no'], amounts: BASE,
    say: 'Dev says no.',
  },
  {
    ms: 5200, who: ['yes', 'yes', 'yes', 'no'], amounts: BASE,
    say: 'That is the whole booking gone. This group needed all four, so sutra stops right here — it will not charge the three who said yes.',
  },
  {
    ms: 4000, who: ['released', 'released', 'released', 'released'], amounts: BASE,
    result: { kind: 'off', head: 'Called off', detail: '4 holds released · ₹0 moved' },
    say: 'Every hold is released at once.',
  },
  {
    ms: 7000, who: ['released', 'released', 'released', 'released'], amounts: BASE,
    result: { kind: 'off', head: 'Called off', detail: '4 holds released · ₹0 moved' },
    say: `No half-booking, no charge sitting there that clears on Thursday, nothing to refund. Booked the old way, Ada would already have paid ${inr(CART.total)} and be spending the week asking for ${inr(CART.total - S)} of it back.`,
  },
]

const STORIES: Record<StoryId, Story> = {
  cover: {
    tab: 'If someone drops out',
    rule: 'Three of us is enough — and Ada will cover one share if someone drops',
    steps: COVER,
  },
  everyone: {
    tab: 'Everyone, or nobody',
    rule: 'All four of us, or we do not book it',
    steps: EVERYONE,
  },
}

export function ConsentThreadDemo() {
  const [id, setId] = useState<StoryId>('cover')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [reduced, setReduced] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const seenRef = useRef(false)

  const story = STORIES[id]
  const steps = story.steps
  const i = Math.min(step, steps.length - 1)
  const f = steps[i]
  const last = i === steps.length - 1

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Someone who asked for less motion gets the settled outcome, not a slideshow.
  useEffect(() => {
    if (reduced) setStep(steps.length - 1)
  }, [reduced, steps])

  // Start from the beginning the first time it is actually on screen, so the
  // story is never joined halfway through.
  useEffect(() => {
    const node = rootRef.current
    if (!node || reduced) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !seenRef.current) {
          seenRef.current = true
          setStep(0)
          setPlaying(true)
        }
      },
      { threshold: 0.35 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [reduced])

  useEffect(() => {
    if (reduced || !playing || last) return
    const t = window.setTimeout(() => setStep((v) => v + 1), f.ms)
    return () => window.clearTimeout(t)
  }, [i, f.ms, playing, reduced, last])

  const go = useCallback(
    (next: number) => {
      setPlaying(false)
      setStep(Math.max(0, Math.min(steps.length - 1, next)))
    },
    [steps.length],
  )

  const pickStory = (next: StoryId) => {
    setId(next)
    setStep(0)
    setPlaying(!reduced)
  }

  // Derived from the shares themselves rather than a headcount, so the bar and
  // the number beside it can never disagree — Ada covering two shares counts
  // as two shares' worth of money.
  const PAYING: Who[] = ['yes', 'covering', 'paid']
  const covered = f.who.reduce((sum, w, idx) => (PAYING.includes(w) ? sum + f.amounts[idx] : sum), 0)
  const pct = Math.round((covered / CART.total) * 100)

  return (
    <figure className="cs" ref={rootRef} aria-label="How one group booking plays out">
      <p className="l-sr">
        Four friends split a {inr(CART.total)} cinema booking into {inr(S)} shares.{' '}
        {id === 'cover'
          ? `Cleo says no, Ada covers Cleo's share from a limit she agreed in advance, and three cards are charged ${inr(CART.total)} together.`
          : 'Dev says no, the group had asked for all four, so every hold is released and no card is charged.'}
      </p>

      <header className="cs-top">
        <span className="cs-poster" aria-hidden>
          ◒
        </span>
        <div className="cs-what">
          <strong>{CART.title}</strong>
          <span>{CART.detail}</span>
        </div>
        <div className="cs-total">
          <span>{CART.when}</span>
          <b>{inr(CART.total)}</b>
        </div>
      </header>

      <div className="cs-rule">
        <span className="cs-rule-k">What the group agreed</span>
        <strong>{story.rule}</strong>
      </div>

      <ol className="cs-people">
        {CAST.map((m, mi) => {
          const state = f.who[mi]
          return (
            <li className="cs-person" data-s={state} key={m.name}>
              <span className="cs-face">
                <Avatar name={m.name} color={m.color} />
              </span>
              <span className="cs-name">{m.first}</span>
              <span key={f.amounts[mi]} className="cs-amt">
                {inr(f.amounts[mi])}
              </span>
              <span className={STATE_TONE[state]}>{STATE_LABEL[state]}</span>
              {f.covered === mi && state === 'no' && <span className="cs-note">Ada is covering this</span>}
            </li>
          )
        })}
        {f.token && <span key={`token-${i}`} className="cs-token">{inr(S)}</span>}
      </ol>

      <div className="cs-money">
        <div className="cs-bar">
          <span style={{ width: `${pct}%` }} data-k={f.result?.kind ?? 'live'} />
        </div>
        <span className="cs-money-t">
          {f.result?.kind === 'off' ? `${inr(0)} charged` : `${inr(covered)} of ${inr(CART.total)} covered`}
        </span>
      </div>

      <div className="cs-say">
        {f.result && (
          <div className="cs-result" data-k={f.result.kind} key={f.result.head}>
            <b>{f.result.head}</b>
            <span>{f.result.detail}</span>
          </div>
        )}
        <p key={i}>{f.say}</p>
      </div>

      {!reduced && (
        <nav className="cs-nav" aria-label="Step through the story">
          <button type="button" className="cs-btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous step">
            ←
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-play"
            onClick={() => (last ? (setStep(0), setPlaying(true)) : setPlaying((v) => !v))}
          >
            {last ? '↻ Watch again' : playing ? '❙❙ Pause' : '▶ Play'}
          </button>
          <button type="button" className="cs-btn" onClick={() => go(i + 1)} disabled={last} aria-label="Next step">
            →
          </button>
          <ol className="cs-dots" aria-hidden>
            {steps.map((_, si) => (
              <li key={si} data-on={si <= i} />
            ))}
          </ol>
          <span className="cs-count">
            {i + 1} / {steps.length}
          </span>
        </nav>
      )}

      <div className="cs-tabs" role="group" aria-label="Choose which version to watch">
        {(Object.keys(STORIES) as StoryId[]).map((key) => (
          <button key={key} type="button" aria-pressed={id === key} onClick={() => pickStory(key)}>
            {STORIES[key].tab}
          </button>
        ))}
      </div>
    </figure>
  )
}
