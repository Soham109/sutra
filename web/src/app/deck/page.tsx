'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import './deck.css'

const TOTAL = 14

function Mark() {
  return <span className="deck-mark" aria-label="sutra"><i /><i /><i /></span>
}

function Arrow() {
  return <svg viewBox="0 0 64 24" aria-hidden><path d="M2 12h54M46 3l10 9-10 9" /></svg>
}

function Slide({ number, children, dark = false, notes }: { number: number; children: ReactNode; dark?: boolean; notes: string }) {
  return <article className={`deck-slide${dark ? ' is-dark' : ''}`} data-slide={number} data-notes={notes}>
    <header className="deck-slide-head"><span className="deck-brand"><Mark /> sutra</span><span>{String(number).padStart(2, '0')} / {TOTAL}</span></header>
    <div className="deck-slide-body">{children}</div>
    <footer className="deck-slide-foot"><span>GMP/1 · group checkout for agents</span><span>__init__ to win it</span></footer>
  </article>
}

function Person({ name, amount, tone = 'coral' }: { name: string; amount: string; tone?: string }) {
  return <div className={`deck-person tone-${tone}`}><span>{name[0]}</span><div><b>{name}</b><small>{amount}</small></div></div>
}

function Screenshot({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return <figure className={`deck-shot ${className}`}><img src={src} alt={alt} /></figure>
}

function Deck() {
  const [active, setActive] = useState(1)
  const [notesOpen, setNotesOpen] = useState(false)
  const [overview, setOverview] = useState(false)

  const go = (next: number) => {
    const value = Math.max(1, Math.min(TOTAL, next))
    setActive(value)
    history.replaceState(null, '', `#${value}`)
  }

  useEffect(() => {
    const syncFromHash = () => {
      const requested = Number(location.hash.slice(1))
      if (Number.isFinite(requested) && requested >= 1 && requested <= TOTAL) setActive(requested)
    }
    syncFromHash()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); go(active + 1) }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); go(active - 1) }
      if (event.key.toLowerCase() === 'n') setNotesOpen((v) => !v)
      if (event.key.toLowerCase() === 'o') setOverview((v) => !v)
      if (event.key.toLowerCase() === 'f') void document.documentElement.requestFullscreen?.()
      if (event.key === 'Escape') setOverview(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', syncFromHash)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', syncFromHash)
    }
  }, [active])

  const notes = useMemo(() => {
    if (typeof document === 'undefined') return ''
    return document.querySelector<HTMLElement>(`[data-slide="${active}"]`)?.dataset.notes ?? ''
  }, [active])

  return <main className={`deck-shell${overview ? ' is-overview' : ''}`}>
    <div className="deck-stage">
      <div className="deck-track" data-active={active}>
        <Slide number={1} dark notes="Open with the sentence, then pause: Splitting a bill is easy. Splitting a purchase is not.">
          <div className="cover-grid">
            <div>
              <h1>Split it before<br />you <em>pay it.</em></h1>
              <p className="cover-copy">One cart. N people. N cards.<br />Nobody becomes the group bank.</p>
            </div>
            <div className="cover-orbit" aria-label="Four people authorizing one purchase">
              <div className="cover-core"><span>ONE</span><b>GROUP<br />DECISION</b><small>₹9,600</small></div>
              <Person name="Ada" amount="₹2,400" />
              <Person name="Arsh" amount="₹2,400" tone="gold" />
              <Person name="Maya" amount="₹2,400" tone="blue" />
              <Person name="Dev" amount="₹2,400" tone="green" />
            </div>
          </div>
        </Slide>

        <Slide number={2} notes="Tell Ada's story. She wants four tickets, but the checkout accepts one card, so she fronts everything and inherits the social debt.">
          <div className="split-55">
            <div>
              <h2>The checkout sees<br /><em>one payer.</em></h2>
              <p className="lede">The group has four people. The merchant has one card field. So Ada becomes the lender.</p>
              <div className="story-numbers"><div><b>₹9,600</b><span>exposed on Ada's card</span></div><div><b>3</b><span>friends to chase later</span></div></div>
            </div>
            <div className="fronting-visual">
              <div className="checkout-card"><small>SHARED ORDER</small><b>₹9,600</b><label>Card number</label><span>•••• •••• •••• 1842</span><button>Ada pays all</button></div>
              <div className="exposure-chart"><div className="chart-label">Organizer exposure · illustrative</div><div className="chart-area"><i /><i /><i /><i /><strong>₹9,600</strong></div><div className="chart-axis"><span>checkout</span><span>day 3</span><span>day 7</span><span>day 11</span></div></div>
            </div>
          </div>
        </Slide>

        <Slide number={3} dark notes="This is the protocol gap. Payment agents are good at one principal. A group requires several independent principals to authorize one coordinated action.">
          <div className="gap-slide">
            <h2>Payment agents learned<br />to pay for <em>one.</em></h2>
            <div className="gap-comparison">
              <div className="gap-old"><span>USER</span><Arrow /><span>AGENT</span><Arrow /><span>CARD</span><Arrow /><span>ORDER</span></div>
              <div className="gap-rule" />
              <div className="gap-new"><div className="mini-people"><i>A</i><i>R</i><i>M</i><i>D</i></div><Arrow /><span className="gap-missing">?</span><Arrow /><span>ONE<br />ORDER</span></div>
            </div>
            <p className="big-claim">The missing primitive is <b>multi-principal consent.</b></p>
          </div>
        </Slide>

        <Slide number={4} notes="Explain the clean separation: Prava secures each person's individual mandate. Sutra binds those mandates together under a group rule.">
          <div className="split-45">
            <div>
              <h2>Prava secures<br /><em>the individual.</em></h2>
              <ul className="feature-list">
                <li><b>Hosted passkey approval</b><span>The agent cannot approve for the human.</span></li>
                <li><b>Merchant-scoped mandate</b><span>Permission works only for the intended merchant.</span></li>
                <li><b>Amount-capped authority</b><span>A card cannot be charged above the approved ceiling.</span></li>
                <li><b>One-time execution</b><span>Short-lived, revocable and auditable.</span></li>
              </ul>
            </div>
            <div className="prava-device">
              <div className="device-top"><Mark /><span>PRAVA APPROVAL</span></div>
              <div className="device-person"><i>A</i><span>Ada's card<br /><small>•••• 1842</small></span></div>
              <div className="device-amount"><small>MAXIMUM</small><b>₹2,400</b></div>
              <div className="device-scope"><span>Merchant</span><b>Konkan Coach</b><span>Use limit</span><b>1 charge</b></div>
              <button>Approve with passkey</button>
              <small className="device-foot">Sutra never sees the card number.</small>
            </div>
          </div>
        </Slide>

        <Slide number={5} dark notes="Now name our contribution: Prava gives four secure independent mandates. GMP/1 turns them into one policy-bound purchase without pooling funds.">
          <div className="mandate-slide">
            <h2>Sutra binds <em>N mandates</em><br />into one decision.</h2>
            <div className="mandate-network">
              <div className="mandate-people"><Person name="Ada" amount="cap ₹2,400" /><Person name="Arsh" amount="cap ₹2,400" tone="gold" /><Person name="Maya" amount="cap ₹2,400" tone="blue" /><Person name="Dev" amount="cap ₹2,400" tone="green" /></div>
              <div className="mandate-lines"><i /><i /><i /><i /></div>
              <div className="policy-core"><small>GMP/1 POLICY</small><b>all_of(A, R, M, D)</b><span>cart hash · caps · deadline</span></div>
              <Arrow />
              <div className="merchant-core"><small>MERCHANT</small><b>₹9,600</b><span>four person-scoped charges</span></div>
            </div>
            <div className="invariant-row"><span>Nothing pooled</span><span>Nothing fronted</span><span>Nothing invented</span></div>
          </div>
        </Slide>

        <Slide number={6} notes="Walk left to right. Planning answers are not payment consent. Consent is bound to a frozen cart, exact share, cap and rule.">
          <h2 className="wide-title">From messy intent to <em>inspectable consent.</em></h2>
          <div className="process-rail">
            <div><strong>01</strong><b>Bring context</b><span>sentence · link · bill</span></div><Arrow />
            <div><strong>02</strong><b>Ask the group</b><span>time · place · budget</span></div><Arrow />
            <div><strong>03</strong><b>Freeze facts</b><span>cart hash · shares · rule</span></div><Arrow />
            <div><strong>04</strong><b>Approve alone</b><span>own passkey · own cap</span></div><Arrow />
            <div><strong>05</strong><b>Commit safely</b><span>charge · reconcile · receipt</span></div>
          </div>
          <div className="process-note"><b>Critical boundary</b><span>An RSVP, budget or chat message can never authorize payment.</span></div>
        </Slide>

        <Slide number={7} notes="Policies are the group's contract. Give two examples: all_of for shared tickets; quorum plus an armed backstop when the purchase can survive a dropout.">
          <div className="policy-layout">
            <div><h2>The group chooses<br /><em>the rule.</em></h2><p className="lede">Approval is evaluated as a policy—not as whoever happens to tap first.</p></div>
            <div className="policy-stack">
              <div className="policy-row is-active"><code>all_of</code><span>Everyone approves, or nobody starts charging.</span><b>4 / 4</b></div>
              <div className="policy-row"><code>quorum(3)</code><span>Any three approvals can lock the purchase.</span><b>3 / 4</b></div>
              <div className="policy-row"><code>required(Ada)</code><span>Ada must be in the locked set.</span><b>A + 2</b></div>
              <div className="policy-row"><code>veto(Dev)</code><span>Dev can make the policy unsatisfiable.</span><b>1 veto</b></div>
              <div className="policy-row"><code>deadline</code><span>Primary rule can fall back at a known time.</span><b>T → rule</b></div>
            </div>
          </div>
        </Slide>

        <Slide number={8} dark notes="This is where we stop being a demo wrapper. Card calls do not roll back. Unknown is not failure; Sutra reconciles the provider before it ever retries.">
          <div className="safety-layout">
            <div><h2>Payments do not<br /><em>roll back.</em></h2><p className="lede">So GMP/1 is a crash-resumable saga built around evidence.</p></div>
            <div className="safety-flow">
              <div><span>1</span><b>Record attempt</b><small>durable idempotency reference</small></div>
              <Arrow /><div><span>2</span><b>Call Prava</b><small>terminal refusal ≠ network loss</small></div>
              <Arrow /><div className="safety-choice"><span>3</span><b>Response lost?</b><small>inspect mandate charges first</small></div>
              <div className="choice-branches"><p><i>FOUND</i> adopt transaction · never reissue</p><p><i>ABSENT</i> remain unknown · reconcile later</p></div>
            </div>
            <div className="safety-tags"><span>No silent double charge</span><span>Explicit partial outcomes</span><span>Crash recovery from event log</span></div>
          </div>
        </Slide>

        <Slide number={9} notes="Show that this is a product, not just a protocol: private signals produce explainable rankings; the group then sees live consent state and a signed outcome.">
          <h2 className="wide-title">A protocol people can <em>actually use.</em></h2>
          <div className="product-triptych">
            <div><Screenshot src="/deck/plan-board.png" alt="Explainable venue ranking" /><b>Plan together</b><span>Private signals → explainable real options</span></div>
            <div><Screenshot src="/deck/group-midflight.png" alt="Live group decision" /><b>Decide together</b><span>Live state, exact shares, explicit rule</span></div>
            <div><Screenshot src="/deck/receipt.png" alt="Signed group receipt" /><b>Prove the outcome</b><span>Rail-aware, hash-chained, signed receipt</span></div>
          </div>
        </Slide>

        <Slide number={10} notes="Define NANDA Town as the flight simulator for agent protocols. Our contribution is a real payments-layer plugin, not a screenshot or an API wrapper.">
          <div className="split-50 nanda-layout">
            <div>
              <h2>Portable into the<br /><em>Internet of Agents.</em></h2>
              <p className="lede">NANDA Town lets protocols swap into twelve agent infrastructure layers.</p>
              <div className="plugin-swap"><div><small>DEFAULT</small><b>prepaid_credits</b><span>play-money balances between agents</span></div><Arrow /><div className="is-selected"><small>OUR PLUGIN</small><b>prava_mandates</b><span>human-authorized cards → merchant</span></div></div>
              <code className="entry-code">nest.plugins.payments → prava_mandates</code>
            </div>
            <Screenshot src="/deck/nanda.png" alt="NANDA discovery proof" className="shot-nanda" />
          </div>
        </Slide>

        <Slide number={11} notes="Use this as the proof slide. The engine and extraction counts are local; the 118 plugin count is the packaged upstream NANDA Town run. The local package reports 117 passed and one intentional skip.">
          <div className="proof-layout">
            <div><h2>Depth you can<br /><em>rerun.</em></h2><p className="lede">Tests, traces and receipts—not adjectives.</p></div>
            <div className="proof-bars">
              <div style={{ '--value': 100 } as React.CSSProperties}><span>GMP/1 engine</span><i /><b>690</b><small>passing tests</small></div>
              <div style={{ '--value': 42 } as React.CSSProperties}><span>NANDA plugin upstream</span><i /><b>118</b><small>passing in NANDA Town</small></div>
              <div style={{ '--value': 24 } as React.CSSProperties}><span>merchant extraction</span><i /><b>33</b><small>passing tests</small></div>
            </div>
            <div className="proof-stamp"><span>ALL GREEN</span><b>real marketplace → 4 shares → 1 decline → backstop → committed receipt</b></div>
          </div>
        </Slide>

        <Slide number={12} notes="Radical honesty is a feature. Explain that the rail is fixed before consent and the receipt can never claim a charge on a non-charging flow.">
          <div className="boundary-layout">
            <h2>Every rail says<br /><em>what actually happened.</em></h2>
            <div className="boundary-table">
              <div className="boundary-head"><span>RAIL</span><span>SUTRA COMPLETES</span><span>THE RECEIPT MAY SAY</span></div>
              <div><b>Prava mandates</b><span>person-scoped card charges</span><strong className="good">charged</strong></div>
              <div><b>Shopify test order</b><span>N test outcomes → one Admin order</span><strong className="good">TEST · ₹0 real</strong></div>
              <div><b>Shopify POS</b><span>cashier split-tender handoff</span><strong>ready for POS</strong></div>
              <div><b>Online checkout</b><span>verified split + merchant handoff</span><strong>approved for checkout</strong></div>
              <div><b>At venue</b><span>exact debt + signed agreement</span><strong>₹0 charged</strong></div>
            </div>
            <p className="boundary-foot">A merchant URL is not payment capability. A signed agreement is not a card charge.</p>
          </div>
        </Slide>

        <Slide number={13} dark notes="Stop speaking. Let this transition sit for one second, then switch to the live product tab.">
          <div className="demo-transition"><span>NOW FOR</span><h2>the demo.</h2><p>One sentence → one group → independent consent → honest receipt</p><div className="demo-arrow"><Arrow /></div></div>
        </Slide>

        <Slide number={14} notes="Use the configured development-store product. Two people approve independently through Prava sandbox; after commit, create the Shopify TEST order and verify its participant transactions in Admin. Say clearly that no real money moved.">
          <div className="demo-plan">
            <div>
              <h2>Two minutes.<br /><em>Five proofs.</em></h2>
              <p className="demo-prompt">“Split the Listening Room headphones between Soham and Arsh.”</p>
              <div className="demo-close">End on: <b>Two consents. One TEST order. Nothing pooled.</b></div>
            </div>
            <ol className="demo-steps">
              <li><strong>00–20</strong><div><b>Real Shopify product</b><span>Show product, variant, price and source.</span></div></li>
              <li><strong>20–45</strong><div><b>Exact split</b><span>Show two shares, caps and the all-of rule.</span></div></li>
              <li><strong>45–80</strong><div><b>Independent consent</b><span>Soham and Arsh approve on separate devices.</span></div></li>
              <li><strong>80–100</strong><div><b>Committed receipt</b><span>Show participant outcomes and signed evidence.</span></div></li>
              <li><strong>100–120</strong><div><b>Merchant-side proof</b><span>Create the TEST order; verify transactions in Shopify Admin.</span></div></li>
            </ol>
          </div>
        </Slide>
      </div>
    </div>

    <nav className="deck-controls" aria-label="Presentation controls">
      <button onClick={() => go(active - 1)} disabled={active === 1} aria-label="Previous slide">←</button>
      <span><i style={{ width: `${(active / TOTAL) * 100}%` }} /></span>
      <button onClick={() => go(active + 1)} disabled={active === TOTAL} aria-label="Next slide">→</button>
      <button onClick={() => setNotesOpen((v) => !v)}>N</button>
      <button onClick={() => setOverview((v) => !v)}>O</button>
      <button onClick={() => window.print()}>PDF</button>
    </nav>
    {notesOpen && <aside className="deck-notes"><b>Speaker notes · slide {active}</b><p>{notes}</p></aside>}
    {overview && <button className="overview-exit" onClick={() => setOverview(false)}>Exit overview</button>}
  </main>
}

export default function PitchDeckPage() {
  return <Deck />
}
