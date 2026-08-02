import Link from 'next/link'
import { Mark } from '@/components/shell'
import { ConsentThreadDemo } from '@/components/landing/consent-thread'
import { HowItWorks } from '@/components/landing/how'
import { LandingNav } from '@/components/landing/nav'
import { LiveBadge } from '@/components/landing/live-badge'
import { MandateOrbit } from '@/components/landing/mandate-orbit'
import { ProductLab } from '@/components/landing/product-lab'
import './landing.css'

const REPO = 'https://github.com/Soham109/sutra'
const SPEC = `${REPO}/blob/main/spec/PROTOCOL.md`

function Arrow() { return <svg className="l-arrow" viewBox="0 0 20 20" aria-hidden><path d="M4 10h11M11 6l4 4-4 4" /></svg> }

export default function Landing() {
  return <div className="landing">
    <LandingNav specUrl={SPEC} />

    <main>
      <section className="l-wrap l-hero"><div className="l-hero-copy">
        <h1>Split it before<br />you <span>pay it.</span></h1>
        <p>Every checkout has one card field. A group is never one person — so someone fronts the bill, then spends two weeks chasing everyone back. Sutra gives each person their own share on their own card, and always says plainly whether the money moved.</p>
        <div className="l-hero-actions"><Link className="l-button" href="/app/plan/new">Plan with Sutra bot <Arrow /></Link><Link className="l-button l-button-quiet" href="/app/bill">Split a bill</Link></div>
        <LiveBadge />
      </div>
      <MandateOrbit />
      </section>

      <HowItWorks />

      <div className="l-signal-rail"><div className="l-signal-track"><span><b>Say it</b> sentence → structured plan</span><i /><span><b>Paste it</b> link → imported item</span><i /><span><b>Scan it</b> receipt → exact lines</span><i /><span><b>Share it</b> invite → individual consent</span><i /><span aria-hidden><b>Say it</b> sentence → structured plan</span></div></div>

      <section id="product" className="l-wrap l-section l-product-section"><header className="l-section-head l-section-head-wide"><span className="l-section-no">PRODUCT</span><h2>Start where the group already is.</h2><p>A sentence, a merchant page, a paper receipt, or a saved group of friends — they all turn into the same shared plan. Try each one below; the people and the rule stay the same.</p></header><ProductLab /></section>

      <section id="consent" className="l-consent-band"><div className="l-wrap l-section l-consent-section"><header className="l-section-head l-section-head-inline"><div><span className="l-section-no">THE DECISION</span><h2>Money waits for the rule.</h2></div><p>No twelve-step slideshow. Change the group’s rule and watch the exact same dropout either still go through cleanly, or cancel for everybody.</p></header><ConsentThreadDemo /></div></section>

      {/* Parked: "One product. Honest boundaries." — four dense cards of
          system jargon that nobody scrolling a landing page asked for.
          The architecture argument lives in spec/PROTOCOL.md, where the
          person who wants it will actually go looking.
      <section id="proof" className="l-proof-band"><div className="l-wrap l-section"><header className="l-section-head l-section-head-light l-section-head-inline"><div><span className="l-section-no">THE WHOLE SYSTEM</span><h2>One product.<br />Honest boundaries.</h2></div><p>The extension, app, agent and payment rail share one account and one protocol. What changes is what each surface is actually allowed to do.</p></header>
      <div className="proof-grid">
      <article className="proof-card proof-card-surface"><span>01 · SURFACES</span><h3>Bring the context. Keep the account.</h3><div className="proof-surfaces"><b>Web + PWA<small>plan · search · manage</small></b><i>↔</i><b>Extension<small>read the active page</small></b><i>↔</i><b>Mobile next<small>camera · share · push</small></b></div><p>Friends, circles and receipts live in the hosted product database—not inside a browser extension.</p></article>
      <article className="proof-card proof-card-rails"><span>02 · MONEY</span><h3>“Imported” is not “purchased.”</h3><div className="proof-rail"><i className="proof-dot proof-dot-good"/><b>Supported merchant</b><em>individual mandates → one merchant commit</em></div><div className="proof-rail"><i className="proof-dot"/><b>Unsupported merchant</b><em>coordinate → return to authenticated checkout</em></div><div className="proof-rail"><i className="proof-dot proof-dot-warn"/><b>Physical bill</b><em>record what is owed; never claim charged</em></div></article>
      <article className="proof-card proof-card-agent"><span>03 · OPENAI + AGENTS</span><h3>Models interpret.<br />They never invent the bill.</h3><div className="proof-code"><p><i>intent</i> “movie Friday with the crew”</p><p><i>facts</i> merchant URL · OpenStreetMap</p><p><i>math</i> deterministic allocation</p><p><i>consent</i> GMP/1 state machine</p></div><footer><b>OpenAI optional</b><small>Offline rules remain the fallback.</small></footer></article>
      <article className="proof-card proof-card-safety"><span>04 · INVARIANTS</span><h3>Delightful with plans.<br />Boring with money.</h3><ul><li><b>No pooled balance</b><small>Sutra never holds the group’s money.</small></li><li><b>No silent share changes</b><small>A moved cap requires fresh consent.</small></li><li><b>No unknown double charge</b><small>Ambiguous outcomes reconcile before retry.</small></li><li><b>Signed receipts</b><small>The consent chain remains verifiable.</small></li></ul></article>
      </div>
      <div className="proof-actions"><a href={SPEC}>Read GMP/1 <Arrow /></a><a href={REPO}>Inspect the source <Arrow /></a></div>
      </div></section>
      */}

      <section className="l-final"><div className="l-wrap l-final-inner"><div><h2>Make the plan.<br /><span>Keep the finish honest.</span></h2><p>Every person approves and pays only their own share. And the receipt always says plainly whether your card was actually charged, or you still need to finish paying — at the register, at checkout, or at the table.</p></div><Link className="l-final-button" href="/app/plan/new">Plan with Sutra bot <Arrow /></Link></div></section>
    </main>
    <footer className="l-footer"><div className="l-wrap"><div className="l-brand"><Mark /><span>sutra</span></div><p>Group coordination, individual consent, and a receipt that always names what actually got paid.</p><div><a href={SPEC}>Protocol</a><a href={REPO}>GitHub</a><span>GMP/1 · 2026</span></div></div></footer>
  </div>
}
