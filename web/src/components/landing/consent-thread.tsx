'use client'

import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui'
import { money } from '@/lib/format'

/**
 * A self-running replay of one GMP/1 group, in two variants. Both runs use the
 * same cart and the same four people as the rest of the page, so the numbers a
 * visitor sees here are the numbers they see in every other section.
 */

type NodeState = 'idle' | 'deciding' | 'approved' | 'declined' | 'absorbing' | 'charged' | 'void'
type SegState = 'empty' | 'filled' | 'broken' | 'healed'
type Verdict = 'pending' | 'commit' | 'abort'
type ScenarioId = 'quorum' | 'all_of'

interface Member {
  name: string
  first: string
  color: string
}

interface Frame {
  ms: number
  nodes: NodeState[]
  segs: SegState[]
  amounts: number[]
  tally: number
  verdict: Verdict
  caption: string
  /** The absorbed share, animated along the thread from backstop to dropped node. */
  token?: boolean
  /** Index of the member whose share a backstop is covering. */
  covered?: number
  flash?: 'commit' | 'abort'
  result?: { kind: 'commit' | 'abort'; head: string; detail: string }
}

interface Scenario {
  label: string
  expr: string
  need: string
  frames: Frame[]
}

const SHARE = 6700
const DOUBLE = 13400
const BASE = [SHARE, SHARE, SHARE, SHARE]

// Deliberately off the ok/bad hues: green and red carry state on this page.
const MEMBERS: Member[] = [
  { name: 'Ada Okonkwo', first: 'Ada', color: '#2E2AD8' },
  { name: 'Ben Farrow', first: 'Ben', color: '#0F6C8C' },
  { name: 'Cleo Marsh', first: 'Cleo', color: '#7A2E8E' },
  { name: 'Dev Raman', first: 'Dev', color: '#8A6D0B' },
]

const LABEL: Record<NodeState, string> = {
  idle: 'invited',
  deciding: 'deciding',
  approved: 'approved',
  absorbing: 'backstop',
  declined: 'declined',
  charged: 'paid',
  void: 'cancelled',
}

const TONE: Record<NodeState, string> = {
  idle: 'badge',
  deciding: 'badge badge-warn',
  approved: 'badge badge-brand',
  absorbing: 'badge badge-brand',
  declined: 'badge badge-bad',
  charged: 'badge badge-ok',
  void: 'badge badge-bad',
}

const VERDICT: Record<Verdict, string> = {
  pending: 'waiting',
  commit: 'commit',
  abort: 'abort',
}

const QUORUM: Frame[] = [
  {
    ms: 1100, nodes: ['idle', 'idle', 'idle', 'idle'], segs: ['empty', 'empty', 'empty'],
    amounts: BASE, tally: 0, verdict: 'pending',
    caption: 'Four mandates issued, one per person. Nothing has been charged, and no money is sitting in a pool anywhere.',
  },
  {
    ms: 800, nodes: ['deciding', 'idle', 'idle', 'idle'], segs: ['empty', 'empty', 'empty'],
    amounts: BASE, tally: 0, verdict: 'pending',
    caption: 'Ada opens hers. Her passkey, her phone, her card.',
  },
  {
    ms: 950, nodes: ['approved', 'idle', 'idle', 'idle'], segs: ['filled', 'empty', 'empty'],
    amounts: BASE, tally: 1, verdict: 'pending',
    caption: 'Ada approved $67.00 — capped at her share, locked to sablewood.co, single use.',
  },
  {
    ms: 950, nodes: ['approved', 'approved', 'idle', 'idle'], segs: ['filled', 'filled', 'empty'],
    amounts: BASE, tally: 2, verdict: 'pending',
    caption: 'Ben approved $67.00 on his own card. Ada is not fronting it for him.',
  },
  {
    ms: 700, nodes: ['approved', 'approved', 'deciding', 'idle'], segs: ['filled', 'filled', 'empty'],
    amounts: BASE, tally: 2, verdict: 'pending',
    caption: 'Cleo is deciding.',
  },
  {
    ms: 1250, nodes: ['approved', 'approved', 'declined', 'idle'], segs: ['filled', 'broken', 'empty'],
    amounts: BASE, tally: 2, verdict: 'pending',
    caption: 'Cleo declined. Her mandate is cancelled where it stands and she owes the group nothing.',
  },
  {
    ms: 1000, nodes: ['approved', 'approved', 'declined', 'approved'], segs: ['filled', 'broken', 'filled'],
    amounts: BASE, tally: 3, verdict: 'pending',
    caption: 'Dev approved $67.00.',
  },
  {
    ms: 1150, nodes: ['approved', 'approved', 'declined', 'approved'], segs: ['filled', 'broken', 'filled'],
    amounts: BASE, tally: 3, verdict: 'commit',
    caption: 'quorum(3) is satisfied — but the cart is still $67.00 short of $268.00.',
  },
  {
    ms: 1500, nodes: ['absorbing', 'approved', 'declined', 'approved'], segs: ['filled', 'healed', 'filled'],
    amounts: BASE, tally: 3, verdict: 'commit', token: true, covered: 2,
    caption: 'Ada armed a backstop up to $75.00 before approvals opened. The engine raises her own mandate to close the gap.',
  },
  {
    ms: 1200, nodes: ['absorbing', 'approved', 'declined', 'approved'], segs: ['filled', 'healed', 'filled'],
    amounts: [DOUBLE, SHARE, SHARE, SHARE], tally: 3, verdict: 'commit', covered: 2,
    caption: 'Ada’s mandate now reads $134.00, inside a cap she already consented to. Nobody was asked for anything new.',
  },
  {
    ms: 900, nodes: ['charged', 'charged', 'declined', 'charged'], segs: ['healed', 'healed', 'healed'],
    amounts: [DOUBLE, SHARE, SHARE, SHARE], tally: 3, verdict: 'commit', covered: 2, flash: 'commit',
    result: { kind: 'commit', head: 'Committed', detail: '3 cards · $268.00 · one window' },
    caption: 'Three single-use credentials, exercised inside one window.',
  },
  {
    ms: 2600, nodes: ['charged', 'charged', 'declined', 'charged'], segs: ['healed', 'healed', 'healed'],
    amounts: [DOUBLE, SHARE, SHARE, SHARE], tally: 3, verdict: 'commit', covered: 2,
    result: { kind: 'commit', head: 'Committed', detail: '3 cards · $268.00 · one window' },
    caption: 'The merchant was paid once, in full, by three different cards. No one is owed anything afterwards.',
  },
]

const ALL_OF: Frame[] = [
  {
    ms: 1100, nodes: ['idle', 'idle', 'idle', 'idle'], segs: ['empty', 'empty', 'empty'],
    amounts: BASE, tally: 0, verdict: 'pending',
    caption: 'Same cart, same four people. This group chose all_of and nobody armed a backstop.',
  },
  {
    ms: 950, nodes: ['approved', 'idle', 'idle', 'idle'], segs: ['filled', 'empty', 'empty'],
    amounts: BASE, tally: 1, verdict: 'pending',
    caption: 'Ada approved $67.00.',
  },
  {
    ms: 900, nodes: ['approved', 'approved', 'idle', 'idle'], segs: ['filled', 'filled', 'empty'],
    amounts: BASE, tally: 2, verdict: 'pending',
    caption: 'Ben approved $67.00.',
  },
  {
    ms: 900, nodes: ['approved', 'approved', 'approved', 'idle'], segs: ['filled', 'filled', 'filled'],
    amounts: BASE, tally: 3, verdict: 'pending',
    caption: 'Cleo approved $67.00. One to go.',
  },
  {
    ms: 750, nodes: ['approved', 'approved', 'approved', 'deciding'], segs: ['filled', 'filled', 'filled'],
    amounts: BASE, tally: 3, verdict: 'pending',
    caption: 'Dev is deciding.',
  },
  {
    ms: 1200, nodes: ['approved', 'approved', 'approved', 'declined'], segs: ['filled', 'filled', 'broken'],
    amounts: BASE, tally: 3, verdict: 'pending',
    caption: 'Dev declined.',
  },
  {
    ms: 1150, nodes: ['approved', 'approved', 'approved', 'declined'], segs: ['filled', 'filled', 'broken'],
    amounts: BASE, tally: 3, verdict: 'abort',
    caption: 'all_of can no longer be satisfied. The engine stops here — it will not charge the three who said yes.',
  },
  {
    ms: 1000, nodes: ['void', 'void', 'void', 'void'], segs: ['empty', 'empty', 'empty'],
    amounts: BASE, tally: 3, verdict: 'abort', flash: 'abort',
    result: { kind: 'abort', head: 'Nothing charged', detail: '4 mandates cancelled · $0.00 moved' },
    caption: 'Every mandate cancelled, at once.',
  },
  {
    ms: 2800, nodes: ['void', 'void', 'void', 'void'], segs: ['empty', 'empty', 'empty'],
    amounts: BASE, tally: 3, verdict: 'abort',
    result: { kind: 'abort', head: 'Nothing charged', detail: '4 mandates cancelled · $0.00 moved' },
    caption: 'No partial charge, no pending hold that clears on Thursday, nothing to refund. In the old version of this evening, Ada would already have paid $268.00 and be chasing $201.00 of it.',
  },
]

const SCENARIOS: Record<ScenarioId, Scenario> = {
  quorum: { label: 'quorum(3) + backstop', expr: 'quorum(3)', need: 'needs 3', frames: QUORUM },
  all_of: { label: 'all_of → abort', expr: 'all_of', need: 'needs 4', frames: ALL_OF },
}

export function ConsentThreadDemo() {
  const [id, setId] = useState<ScenarioId>('quorum')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [reduced, setReduced] = useState(false)

  const scenario = SCENARIOS[id]
  const frames = scenario.frames
  const i = Math.min(step, frames.length - 1)
  const f = frames[i]

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Someone who asked for less motion gets the settled outcome, not a slideshow of it.
  useEffect(() => {
    setStep(reduced ? frames.length - 1 : 0)
  }, [reduced, frames])

  useEffect(() => {
    if (reduced || !playing) return
    const t = window.setTimeout(() => setStep((v) => (v + 1) % frames.length), f.ms)
    return () => window.clearTimeout(t)
  }, [i, f.ms, playing, reduced, frames])

  return (
    <section className="l-demo" aria-label="Worked example of a sutra group checkout">
      <p className="l-sr">
        A replay of one group buy: four people split a $268.00 cart into $67.00 shares. Under{' '}
        {scenario.expr}, {id === 'quorum'
          ? 'Cleo declines, Ada’s backstop absorbs her $67.00 share, and three cards are charged $268.00 in one window.'
          : 'Dev declines, the policy fails, all four mandates are cancelled and no card is charged.'}
      </p>

      <div className="l-demo-head">
        <span className="badge badge-brand">GMP/1</span>
        <span className="mono tiny faint">grp_8f3c21 · sablewood.co</span>
        <span className="l-demo-total">
          <span className="tiny faint">cart</span>
          <span className="amount">{money(26800)}</span>
        </span>
      </div>

      <div className="l-demo-body">
        <div className="l-thread" aria-hidden>
          <div className="l-track" />
          {f.segs.map((s, si) => (
            <div key={si} className="l-seg" data-s={s} style={{ left: `${12.5 + si * 25}%` }} />
          ))}
          {f.token && <span key={`token-${i}`} className="l-token">+{money(SHARE)}</span>}
          {f.flash && <span key={`flash-${i}`} className="l-flash" data-k={f.flash} />}

          {MEMBERS.map((m, mi) => {
            const state = f.nodes[mi]
            return (
              <div className="l-node" data-s={state} key={m.name}>
                <div className="l-ring">
                  <Avatar name={m.name} color={m.color} />
                </div>
                <span className="l-node-name">{m.first}</span>
                <span key={f.amounts[mi]} className="l-node-amt amount l-bump">
                  {money(f.amounts[mi])}
                </span>
                <span className={TONE[state]}>{LABEL[state]}</span>
                {f.covered === mi && <span className="l-node-note">covered by Ada</span>}
              </div>
            )
          })}
        </div>

        <div className="l-caption">
          {f.result && (
            <div className="l-verdict" data-k={f.result.kind} key={f.result.head}>
              <b>{f.result.head}</b>
              <span className="mono tiny">{f.result.detail}</span>
            </div>
          )}
          <p>{f.caption}</p>
        </div>
      </div>

      <div className="l-policybar">
        <span className="faint">policy</span>
        <code className="l-expr">{scenario.expr}</code>
        <span className="l-arrow">·</span>
        <span>{f.tally} of 4 approved, {scenario.need}</span>
        <span className="l-arrow">→</span>
        <span className="l-vd" data-k={f.verdict}>{VERDICT[f.verdict]}</span>
      </div>

      <div className="l-controls">
        <div className="l-switch" role="group" aria-label="Choose which run to watch">
          {(Object.keys(SCENARIOS) as ScenarioId[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={id === key}
              onClick={() => {
                setId(key)
                setStep(0)
              }}
            >
              {SCENARIOS[key].label}
            </button>
          ))}
        </div>
        <div className="l-controls-end">
          {!reduced && (
            <button type="button" className="btn btn-secondary" onClick={() => setPlaying((v) => !v)}>
              {playing ? '❙❙ Pause' : '▶ Play'}
            </button>
          )}
          <span className="tiny faint">{reduced ? 'Final state' : 'Replaying'}</span>
        </div>
      </div>
    </section>
  )
}
