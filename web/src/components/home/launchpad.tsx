'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const MOMENTS = [
  { icon: '◒', label: 'Movie night', query: 'movie tickets' },
  { icon: '✦', label: 'Flights', query: 'flights' },
  { icon: '⌂', label: 'Stay', query: 'hotel or vacation stay' },
  { icon: '♫', label: 'Concert', query: 'concert tickets' },
  { icon: '⌁', label: 'Dinner', query: 'restaurant dinner' },
  { icon: '◇', label: 'Gift', query: 'group gift' },
]

function isLink(value: string) {
  return /^https?:\/\//i.test(value) || /^[\w-]+\.[a-z]{2,}(\/|$)/i.test(value)
}

export function Launchpad() {
  const router = useRouter()
  const [value, setValue] = useState('')

  const go = (raw = value) => {
    const query = raw.trim()
    if (!query) return
    if (isLink(query)) {
      const url = /^https?:\/\//i.test(query) ? query : `https://${query}`
      router.push(`/app/discover?url=${encodeURIComponent(url)}`)
    } else {
      router.push(`/app/discover?q=${encodeURIComponent(query)}`)
    }
  }

  return (
    <section className="launchpad" aria-labelledby="launch-title">
      <div className="launch-copy">
        <span className="launch-kicker">Start with the plan</span>
        <h1 id="launch-title">What are we<br /><span>splitting?</span></h1>
        <p>Search the idea, paste the exact link, or begin with a moment. Sutra turns it into a checkout your group can actually agree to.</p>
      </div>
      <div className="launch-action">
        <form onSubmit={(event) => { event.preventDefault(); go() }} className="launch-search">
          <span aria-hidden>↗</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Try ‘4 IMAX tickets’ or paste a link"
            aria-label="Search for something to split or paste a product link"
          />
          <button type="submit" disabled={!value.trim()}>Go</button>
        </form>
        <div className="moment-grid" aria-label="Popular group purchase templates">
          {MOMENTS.map((moment) => (
            <button key={moment.label} type="button" onClick={() => go(moment.query)}>
              <span>{moment.icon}</span>{moment.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
