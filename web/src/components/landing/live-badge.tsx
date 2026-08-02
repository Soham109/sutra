'use client'

import { useEffect, useState } from 'react'

// Proof that cannot be written into a slide.
//
// The engine reports which payment adapter it is actually running — the real
// Prava sandbox, or the in-memory mock used by the test suite. Anyone reading
// this page can hit the same endpoint themselves and get the same answer, which
// is the point: a claim about an integration is worth what it costs to check,
// and this one costs one curl.
//
// It says "sandbox" when it is a sandbox. Dressing that up as "live" is the
// exact lie the rest of this codebase is built to refuse.

interface Health {
  status?: string
  prava_adapter?: string
  version?: string
}

const LABEL: Record<string, string> = {
  sandbox: 'Prava sandbox — hosted mandate sessions, test cards',
  live: 'Prava live',
  mock: 'Mock adapter — no real payment rail',
}

export function LiveBadge() {
  const [health, setHealth] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h: Health) => alive && setHealth(h))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  // Nothing at all rather than a hopeful placeholder: a badge that claims a
  // connection while the connection is down is worse than no badge.
  //
  // The slot below still reserves the badge's footprint even while empty —
  // otherwise the health fetch resolving pops this in late and reflows
  // everything centered against this column, including the orbit beside it.
  const adapter = health?.prava_adapter
  const real = adapter === 'sandbox' || adapter === 'live'

  return (
    <div className="l-live-badge-slot">
      {!failed && adapter ? (
        <a
          className={`l-live-badge${real ? '' : ' is-mock'}`}
          href="https://engine-production-e6fa.up.railway.app/health"
          target="_blank"
          rel="noreferrer noopener"
          title="Check it yourself — this is the engine’s own /health"
        >
          <span className="l-live-dot" aria-hidden />
          {LABEL[adapter] ?? adapter}
          <span className="l-live-check">verify ↗</span>
        </a>
      ) : null}
    </div>
  )
}
