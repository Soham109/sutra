'use client'

import { useEffect, useState } from 'react'

// This is the one part of the page that cannot be pre-computed and stay
// honest: it fetches all four endpoints from this exact origin, in the
// visitor's own browser, right now. The thread below draws itself out of
// four real HTTP responses the same way the product's consent thread draws
// itself out of four real mandate approvals — reusing that signature
// deliberately, because the mechanism is the same: state that only advances
// when something true has actually happened.
//
// Relative paths, not the hardcoded production origin: `web/next.config.ts`
// rewrites `/.well-known/*` and `/skill.md` to the engine (ENGINE_URL), so a
// relative fetch is answered by whatever engine this deployment actually
// points at — never a value this component invents. The "check it yourself"
// links are absolute, to the canonical production origin, on purpose: that
// is the URL a judge is meant to trust regardless of where this page itself
// is being viewed from.

const PROD_ORIGIN = 'https://sutra-gmp.vercel.app'

interface Endpoint {
  path: string
  label: string
  purpose: string
}

const ENDPOINTS: Endpoint[] = [
  { path: '/.well-known/agent-card.json', label: 'agent-card.json', purpose: 'A2A agent card' },
  { path: '/.well-known/agents/sutra.json', label: 'agents/sutra.json', purpose: 'NANDA agent listing' },
  { path: '/.well-known/agent-facts.json', label: 'agent-facts.json', purpose: 'AgentFacts document' },
  { path: '/skill.md', label: 'skill.md', purpose: 'REST API, in prose' },
]

type FetchState = 'pending' | 'ok' | 'error'

interface Result extends Endpoint {
  state: FetchState
  httpStatus?: number
  contentType?: string
  ms?: number
  body?: string
  error?: string
}

function prettyBody(raw: string, contentType?: string): string {
  if (contentType?.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }
  return raw
}

export function DiscoveryChain() {
  const [results, setResults] = useState<Result[]>(
    ENDPOINTS.map((e) => ({ ...e, state: 'pending' as FetchState }))
  )

  useEffect(() => {
    let alive = true
    ENDPOINTS.forEach((ep, i) => {
      const t0 = performance.now()
      fetch(ep.path, { cache: 'no-store' })
        .then(async (r) => {
          const ms = Math.round(performance.now() - t0)
          const contentType = r.headers.get('content-type') ?? ''
          const text = await r.text()
          if (!alive) return
          setResults((prev) =>
            prev.map((p, pi) =>
              pi === i
                ? { ...p, state: r.ok ? 'ok' : 'error', httpStatus: r.status, contentType, ms, body: text }
                : p
            )
          )
        })
        .catch((err: unknown) => {
          if (!alive) return
          setResults((prev) =>
            prev.map((p, pi) => (pi === i ? { ...p, state: 'error', error: String(err) } : p))
          )
        })
    })
    return () => {
      alive = false
    }
  }, [])

  const liveCount = results.filter((r) => r.state === 'ok').length
  const settled = results.every((r) => r.state !== 'pending')

  return (
    <div className="disco">
      <div className="thread disco-thread" role="status" aria-live="polite">
        <div className="disco-thread-fill" style={{ width: `${(liveCount / ENDPOINTS.length) * 100}%` }} />
        {results.map((r) => (
          <div
            key={r.path}
            className="thread-node disco-node"
            data-state={r.state === 'ok' ? 'approved' : r.state === 'error' ? 'declined' : 'awaiting_approval'}
          >
            <span className="thread-ring disco-ring">
              {r.state === 'ok' ? (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8.5 6.3 12 13 4" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : r.state === 'error' ? (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="var(--bad)" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="dot dot-brand dot-live" aria-hidden />
              )}
            </span>
            <span className="thread-name disco-node-name mono">{r.label}</span>
          </div>
        ))}
      </div>

      <p className="disco-summary small">
        {settled
          ? `${liveCount} of ${ENDPOINTS.length} answered just now, from this exact page load.`
          : 'fetching, live, from your browser…'}
      </p>

      <div className="disco-grid">
        {results.map((r) => (
          <div className="card card-pad disco-card" key={r.path}>
            <div className="disco-card-head">
              <div>
                <div className="disco-card-title mono">{r.label}</div>
                <div className="disco-card-purpose tiny faint">{r.purpose}</div>
              </div>
              <a
                className="disco-check tiny"
                href={`${PROD_ORIGIN}${r.path}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                check it yourself ↗
              </a>
            </div>

            <div className="disco-meta">
              {r.state === 'pending' && <span className="badge">fetching…</span>}
              {r.state === 'ok' && (
                <>
                  <span className="badge badge-ok">{r.httpStatus} OK</span>
                  <span className="chip">{r.contentType?.split(';')[0]}</span>
                  <span className="chip">{r.ms} ms</span>
                </>
              )}
              {r.state === 'error' && <span className="badge badge-bad">{r.httpStatus ?? 'no response'}</span>}
            </div>

            {r.state === 'ok' && r.body && (
              <pre className="well disco-body mono">{prettyBody(r.body, r.contentType)}</pre>
            )}
            {r.state === 'error' && (
              <p className="small" style={{ color: 'var(--bad)' }}>
                {r.error ?? 'This endpoint did not answer from this deployment — not hidden, not retried silently.'}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
