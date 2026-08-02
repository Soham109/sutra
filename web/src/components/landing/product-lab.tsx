'use client'

import Link from 'next/link'
import { useState } from 'react'

type Mode = 'plan' | 'link' | 'bill' | 'circle'

const MODES: Record<Mode, {
  nav: string
  number: string
  title: string
  copy: string
  action: string
  href: string
  facts: string[]
}> = {
  plan: {
    nav: 'Say the plan', number: '01',
    title: 'Start with the messy sentence.',
    copy: 'Sutra asks who, when, where and budget only when it needs to. Real venues come from OpenStreetMap; the ranking shows its arithmetic.',
    action: 'Coordinate a plan', href: '/app/plan/new',
    facts: ['Sees who’s actually free', 'Real places, never invented', 'Every score explained'],
  },
  link: {
    nav: 'Paste the link', number: '02',
    title: 'Bring any checkout into the room.',
    copy: 'Paste a product, ticket, stay or cart URL. Sutra reads the price and details straight from the merchant’s own page, then lets the group claim items and split any shared fees.',
    action: 'Split a link', href: '/app/discover',
    facts: ['Live merchant data', 'Items belong to people', 'Drafts autosave'],
  },
  bill: {
    nav: 'Scan the bill', number: '03',
    title: 'Photograph the receipt at the table.',
    copy: 'Your phone reads the receipt on-device first. A small vision model can double-check it, but the math still has to match the printed total exactly before anyone can claim an item.',
    action: 'Scan a bill', href: '/app/bill',
    facts: ['Scanned on your phone first', 'Nothing invented to balance', 'Explicit at-venue acceptance'],
  },
  circle: {
    nav: 'Bring the circle', number: '04',
    title: 'The people you keep planning with.',
    copy: 'Save your group once, reuse it every time, and see a private reliability score based on what actually happened in your own past splits — never a public rating.',
    action: 'Open circles', href: '/app/circles',
    facts: ['Reusable people', 'Private reliability', 'See what you owe, live'],
  },
}

const ORDER = Object.keys(MODES) as Mode[]

function PlanVisual() {
  return <div className="lab-map" aria-hidden>
    <div className="lab-map-grid" />
    <svg viewBox="0 0 620 390"><path d="M42 310C130 290 164 190 250 210s100 88 180 31 98-150 153-157" /><circle cx="42" cy="310" r="8" /><circle cx="250" cy="210" r="8" /><circle cx="430" cy="241" r="8" /><circle cx="583" cy="84" r="8" /></svg>
    <div className="lab-map-place"><span>Best fit</span><b>Burma Burma</b><small>8:00 PM · ₹780 each</small></div>
    <div className="lab-map-person lab-map-person-a">S</div><div className="lab-map-person lab-map-person-b">M</div><div className="lab-map-person lab-map-person-c">A</div>
  </div>
}

function LinkVisual() {
  return <div className="lab-cart" aria-hidden>
    <div className="lab-browser"><i /><i /><i /><span>merchant.com/concert/tickets</span></div>
    <div className="lab-ticket"><small>FRIDAY · 8:30 PM</small><strong>Sablewood Live</strong><span>Balcony · Row C</span><b>₹5,400</b></div>
    <div className="lab-claims"><span><i>SO</i>2 tickets</span><span><i>MA</i>1 ticket</span><span><i>AR</i>1 ticket</span></div>
  </div>
}

function BillVisual() {
  return <div className="lab-bill" aria-hidden>
    <div className="lab-paper"><strong>THE TABLE</strong><small>01 AUG 2026 · 22:14</small><hr /><p><span>2 × Burmese Khow Suey</span><b>1,520.00</b></p><p><span>Tea Leaf Salad</span><b>620.00</b></p><p><span>Service charge</span><b>214.00</b></p><hr /><p className="lab-paper-total"><span>TOTAL</span><b>2,354.00</b></p></div>
    <div className="lab-scanline" /><div className="lab-reconcile"><span>✓</span><b>Reconciles exactly</b><small>₹2,354.00 printed · ₹2,354.00 parsed</small></div>
  </div>
}

function CircleVisual() {
  return <div className="lab-circle" aria-hidden>
    <div className="lab-circle-ring"><span>Movie crew</span></div>
    {['SO','MA','AR','DE','ZO'].map((name, index) => <i key={name} className={`lab-circle-person lab-circle-person-${index + 1}`}>{name}</i>)}
    <div className="lab-circle-note"><span>Next plan</span><b>Friday movie</b><small>5 people added instantly</small></div>
  </div>
}

export function ProductLab() {
  const [mode, setMode] = useState<Mode>('plan')
  const active = MODES[mode]

  return (
    <div className="product-lab">
      <div className="lab-tabs" role="tablist" aria-label="Ways to start with Sutra">
        {ORDER.map((key) => <button key={key} role="tab" aria-selected={mode === key} onClick={() => setMode(key)}><span>{MODES[key].number}</span>{MODES[key].nav}</button>)}
      </div>
      <div className="lab-body">
        <article className="lab-copy" key={`${mode}-copy`}>
          <span className="lab-number">{active.number}</span>
          <h3>{active.title}</h3>
          <p>{active.copy}</p>
          <ul>{active.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          <Link href={active.href}>{active.action}<svg viewBox="0 0 20 20" aria-hidden><path d="M4 10h11M11 6l4 4-4 4" /></svg></Link>
        </article>
        <div className="lab-visual" role="tabpanel" key={`${mode}-visual`}>
          {mode === 'plan' ? <PlanVisual /> : mode === 'link' ? <LinkVisual /> : mode === 'bill' ? <BillVisual /> : <CircleVisual />}
        </div>
      </div>
    </div>
  )
}
