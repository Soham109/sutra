import Link from 'next/link'
import { Mark } from '@/components/shell'
import { ConsentThreadDemo } from '@/components/landing/consent-thread'
import { FrontingFlows } from '@/components/landing/flow'
import { ResolveDemo } from '@/components/landing/resolve'
import './landing.css'

const REPO = 'https://github.com/Soham109/sutra'
const SPEC = `${REPO}/blob/main/spec/PROTOCOL.md`

const USE_CASES = [
  { icon: '◒', title: 'Movie night', copy: 'Seats, snacks and booking fees — assigned to the people who chose them.' },
  { icon: '✦', title: 'Flights & stays', copy: 'Different fares, rooms and baggage. One deadline, no human travel agent.' },
  { icon: '♫', title: 'Concerts', copy: 'Hold the group together without one card carrying the whole ticket drop.' },
  { icon: '⌁', title: 'Dinner', copy: 'Split dishes, shared plates, tax and tip before the card machine arrives.' },
  { icon: '◇', title: 'Group gifts', copy: 'Set a target, let people choose a share, and only buy when the group clears it.' },
  { icon: '↗', title: 'Anything with a link', copy: 'Paste a merchant URL. Sutra reads the cart and turns it into a group checkout.' },
]

const GUARANTEES = [
  ['No fronting', 'Every person pays the merchant from their own card. Nobody becomes the group bank.'],
  ['No pooled money', 'Sutra coordinates mandates. It never stores a balance, holds funds, or touches card numbers.'],
  ['No surprise total', 'Every approval is merchant-locked, single-use, and capped at that person’s exact exposure.'],
  ['No awkward failure', 'If the chosen rule cannot pass, all mandates are cancelled and nobody is charged.'],
]

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-wrap l-nav-in">
          <Link href="/" className="l-brand" aria-label="Sutra home">
            <Mark />
            <span>sutra</span>
          </Link>
          <nav className="l-nav-links" aria-label="Main navigation">
            <a href="#possibilities">Use cases</a>
            <a href="#how">How it works</a>
            <a href="#safety">Safety</a>
            <a href={SPEC} target="_blank" rel="noreferrer">Developers</a>
          </nav>
          <div className="l-nav-end">
            <Link className="btn btn-ghost l-nav-spec" href="/app">Sign in</Link>
            <Link className="btn btn-primary" href="/app/discover">Start a split <span aria-hidden>↗</span></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="l-wrap l-hero">
          <div className="l-hero-copy">
            <h1 className="l-h1">Buy it<br />together.<br /><span className="l-h1-accent">Without the group bank.</span></h1>
            <p className="l-sub">
              Movie seats, flights, dinner, a villa, a gift — split any checkout before it is paid. Everyone approves
              their own share. The purchase happens together, or not at all.
            </p>
            <div className="l-cta-row">
              <Link className="btn btn-primary btn-xl" href="/app/discover">Split something</Link>
              <a className="l-text-link" href="#how">See the 30-second version <span aria-hidden>↓</span></a>
            </div>
            <div className="l-promise-row" aria-label="Product guarantees">
              <span>No pooled funds</span><span>No card data</span><span>No chasing friends</span>
            </div>
          </div>
          <div className="l-hero-orbit" aria-hidden>
            <div className="l-orbit-card l-orbit-main">
              <div className="l-orbit-top"><span>Friday at 8:40</span><b>₹3,240</b></div>
              <strong>Dune: Messiah</strong>
              <span>4 seats · IMAX · PVR Phoenix</span>
              <div className="l-mini-people">
                <i style={{ '--c': '#ff6b4a' } as React.CSSProperties}>S</i>
                <i style={{ '--c': '#3228d8' } as React.CSSProperties}>A</i>
                <i style={{ '--c': '#0d8271' } as React.CSSProperties}>M</i>
                <i style={{ '--c': '#a06b16' } as React.CSSProperties}>R</i>
              </div>
              <div className="l-orbit-progress"><span /></div>
              <small>3 of 4 ready</small>
            </div>
            <div className="l-orbit-card l-orbit-float l-orbit-a"><b>₹810</b><span>Your share</span></div>
            <div className="l-orbit-card l-orbit-float l-orbit-b"><span className="l-live-dot" /> <b>Live</b><span>12:48 left</span></div>
            <div className="l-orbit-path" />
          </div>
        </section>

        <section className="l-wrap l-live-section">
          <div className="l-section-intro l-section-intro-wide">
            <p className="l-index">01 / THE MOMENT THAT MATTERS</p>
            <h2 className="l-h2">Four people can say yes.<br />Nobody has to say “pay me back.”</h2>
            <p className="l-lede">Watch the same cart commit with a backstop, then switch the rule and watch it abort cleanly.</p>
          </div>
          <ConsentThreadDemo />
        </section>

        <section id="possibilities" className="l-use-band">
          <div className="l-wrap l-section">
            <div className="l-section-intro l-split-head">
              <div>
                <p className="l-index">02 / SPLIT THE REAL WORLD</p>
                <h2 className="l-h2">If it has a price,<br />it can have a group.</h2>
              </div>
              <p className="l-lede">The model is not “divide by four.” It understands who claimed what, shared fees, sponsors, backstops, deadlines and the rule for when a purchase is allowed to happen.</p>
            </div>
            <div className="l-use-grid">
              {USE_CASES.map((item, index) => (
                <article className="l-use" key={item.title}>
                  <span className="l-use-icon">{item.icon}</span>
                  <span className="l-use-n">0{index + 1}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="l-wrap l-section">
          <div className="l-section-intro">
            <p className="l-index">03 / FROM LINK TO CHECKOUT</p>
            <h2 className="l-h2">One place to plan it.<br />One moment to commit it.</h2>
          </div>
          <div className="l-how-layout">
            <ol className="l-steps-new">
              <li><span>1</span><div><h3>Bring the thing</h3><p>Search products or paste any merchant link. Review live price, variants, stock and fees.</p></div></li>
              <li><span>2</span><div><h3>Make the split fit the group</h3><p>Assign seats or items, split shared costs, add a sponsor, and choose what happens if someone drops.</p></div></li>
              <li><span>3</span><div><h3>Send one clean invite</h3><p>Each person sees exactly what they are getting and the maximum their own card can be charged.</p></div></li>
              <li><span>4</span><div><h3>Commit together</h3><p>When the group rule passes, the merchant receives every share in one tight window. Otherwise, zero moves.</p></div></li>
            </ol>
            <ResolveDemo />
          </div>
        </section>

        <section className="l-dark-band">
          <div className="l-wrap l-section">
            <div className="l-section-intro l-split-head">
              <div><p className="l-index">04 / THE DIFFERENCE</p><h2 className="l-h2">A split after payment is debt.<br />A split before payment is coordination.</h2></div>
              <p className="l-lede">Sutra changes the topology of the purchase, not just the arithmetic on a receipt.</p>
            </div>
            <FrontingFlows />
          </div>
        </section>

        <section id="safety" className="l-wrap l-section">
          <div className="l-safety-head">
            <p className="l-index">05 / BORING IN ALL THE RIGHT PLACES</p>
            <h2 className="l-h2">Delightful for the group.<br />Uncompromising with the money.</h2>
          </div>
          <div className="l-guarantees">
            {GUARANTEES.map(([title, copy], index) => (
              <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
          <div className="l-protocol-strip">
            <div><Mark /><span><b>GMP/1</b> is an open protocol for multi-person checkout.</span></div>
            <div className="l-protocol-links"><a href={SPEC} target="_blank" rel="noreferrer">Read the spec ↗</a><a href={REPO} target="_blank" rel="noreferrer">View source ↗</a></div>
          </div>
        </section>

        <section className="l-final">
          <div className="l-wrap l-final-inner">
            <h2>Make the plan.<br /><span>Lose the group treasurer.</span></h2>
            <Link className="btn l-final-btn" href="/app/discover">Start a split <span aria-hidden>↗</span></Link>
          </div>
        </section>
      </main>

      <footer className="l-footer"><div className="l-wrap"><div className="l-brand"><Mark /><span>sutra</span></div><p>Group checkout, without the group bank.</p><span>GMP/1 · 2026</span></div></footer>
    </div>
  )
}
