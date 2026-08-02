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

      <section className="l-final"><div className="l-wrap l-final-inner"><div><h2>Make the plan.<br /><span>Keep the finish honest.</span></h2><p>Every person approves and pays only their own share. And the receipt always says plainly whether your card was actually charged, or you still need to finish paying — at the register, at checkout, or at the table.</p></div><Link className="l-final-button" href="/app/plan/new">Plan with Sutra bot <Arrow /></Link></div></section>
    </main>
    <footer className="l-footer"><div className="l-wrap"><div className="l-brand"><Mark /><span>sutra</span></div><p>Group coordination, individual consent, and a receipt that always names what actually got paid.</p><div><a href={SPEC}>Protocol</a><a href={REPO}>GitHub</a><span>GMP/1 · 2026</span></div></div></footer>
  </div>
}
