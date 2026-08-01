'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Mark } from '@/components/shell'

// The nav detaches from the page and floats over it.
//
// It stays glassy the whole way down — the blur is the point, you should be
// able to see the page moving underneath it — but it only takes a shadow and a
// tighter height once you have actually scrolled. At rest it should feel like
// part of the page; in motion it should feel like it is above it.

// "Architecture" used to point at #proof, a section that is commented out in
// page.tsx — so the link scrolled nowhere.
const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#product', label: 'Product' },
  { href: '#consent', label: 'The decision' },
]

export function LandingNav({ specUrl }: { specUrl: string }) {
  const [lifted, setLifted] = useState(false)

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`l-nav${lifted ? ' is-lifted' : ''}`}>
      <div className="l-nav-shell">
        <Link href="/" className="l-brand" aria-label="Sutra home">
          <Mark />
          <span>sutra</span>
        </Link>

        <nav className="l-nav-links" aria-label="Main navigation">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          <a href={specUrl}>Developers</a>
        </nav>

        <div className="l-nav-end">
          <Link className="l-login" href="/app">
            Log in
          </Link>
          <Link className="l-button l-button-small" href="/app/plan/new">
            <span className="l-start-long">Plan with Sutra bot</span>
            <span className="l-start-short">Start</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
