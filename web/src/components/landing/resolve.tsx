'use client'

import Link from 'next/link'
import { useState } from 'react'
import { money } from '@/lib/format'

const EXAMPLE = 'https://sablewood.co/products/two-day-pass'

/**
 * The preview only claims to know a product while the example URL is untouched.
 * Type your own link and it stops pretending — the app does the real resolve.
 */
export function ResolveDemo() {
  const [url, setUrl] = useState(EXAMPLE)
  const known = url.trim() === EXAMPLE

  return (
    <div className="l-resolve">
      <div className="l-resolve-bar">
        <label className="l-sr" htmlFor="l-url">
          Product link
        </label>
        <input
          id="l-url"
          className="input input-lg"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="https://…"
        />
        <Link className="btn btn-primary btn-lg" href={`/app/discover?url=${encodeURIComponent(url)}`}>
          Resolve it
        </Link>
      </div>

      {known ? (
        <div className="card l-resolved">
          <span className="l-thumb" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="2.5" y="4.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M2.5 14l4.2-3.6 3.6 3 3.4-2.6 5.8 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="l-resolved-main">
            <div style={{ fontWeight: 600, letterSpacing: '-0.012em' }}>Sablewood Fest — 2-Day Pass</div>
            <div className="small muted">
              sablewood.co · <span className="amount">{money(6700)}</span> USD · in stock
            </div>
          </div>
          <span className="chip chip-brand">schema.org/Product</span>
        </div>
      ) : (
        <div className="note note-plain" style={{ marginTop: 14 }}>
          <span aria-hidden>→</span>
          <span>
            Resolve it and the app reads that page’s own markup, then tells you exactly what it found — title, price,
            currency, merchant — before anybody is asked to approve a cent.
          </span>
        </div>
      )}

      <div className="l-sources">
        <span className="chip">JSON-LD</span>
        <span className="chip">OpenGraph</span>
        <span className="chip">Shopify /products.json</span>
        <span className="chip">microdata</span>
      </div>
    </div>
  )
}
