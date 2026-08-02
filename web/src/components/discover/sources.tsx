'use client'

import type { SearchResponse } from '@/lib/api'

// Where the results came from.
//
// This used to print one chip per catalogue — "Shopify storefronts · 2 results
// · 3685ms" — plus a disclosure reading "Searching 1 of 2 catalogues" and,
// underneath it, "Prava discovery runs on the wallet host behind agent
// request-signing, not the merchant API key."
//
// Every word of that is true and none of it is any of the shopper's business.
// A person looking for a merino tee does not know what Shopify is, has never
// heard of a catalogue, and reads "1 of 2" as "half of this is broken". The
// operational detail still exists, in full, at GET /v1/discover/sources and on
// the settings page — where somebody goes when they want it.
//
// What stays here is the one honest thing a shopper needs: whether the search
// covered everything it meant to, and what to do when it did not.

export interface SourceHealth {
  kind: string
  label: string
  available: boolean
  reason?: string
}

export function SourceStrip({
  sources,
  tookMs,
}: {
  sources: SearchResponse['sources']
  tookMs: number
}) {
  if (sources.length === 0) return null
  const answered = sources.filter((s) => !s.error)
  const stores = answered.length
  if (stores === 0) return null

  return (
    <p className="tiny faint">
      Searched {stores === 1 ? 'the stores we can reach' : `${stores} sets of stores`} just now,
      live — {(tookMs / 1000).toFixed(1)}s. Prices and stock are the merchant’s own, read at this
      moment rather than from a cache.
    </p>
  )
}

/**
 * A store that failed is worth one sentence, because it means results are
 * missing — but it is said in terms of the consequence, not the cause.
 *
 * A password-protected store is a different consequence from a transient
 * failure: it will not answer next time either, and pasting its exact
 * product link will not help (the resolver hits the same wall) — so it gets
 * its own sentence rather than being folded into "try again in a moment".
 */
export function SourceErrors({ sources }: { sources: SearchResponse['sources'] }) {
  const blockedStores = sources.flatMap((s) => s.blocked ?? [])
  const failed = sources.filter((s) => s.error)
  if (blockedStores.length === 0 && failed.length === 0) return null
  return (
    <p className="tiny" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
      {blockedStores.length > 0 && (
        <span style={{ display: 'block' }}>
          {blockedStores.length === 1
            ? `${blockedStores[0]!.domain} asks visitors for a password before it will show anything, so it could not be searched.`
            : `${blockedStores.length} stores ask visitors for a password before they'll show anything, so they could not be searched.`}
        </span>
      )}
      {failed.length > 0 && (
        <span style={{ display: 'block' }}>
          Some stores did not answer just now, so this list may be missing things. Try again in a
          moment, or paste a link straight to the item you want — that works whether or not a store
          answers search.
        </span>
      )}
    </p>
  )
}

/**
 * Deliberately renders nothing on the shopping flow.
 *
 * Kept as a component so the settings page — which is where somebody goes to
 * ask "is anything down?" — keeps its detailed answer, while the search
 * results stop announcing internal plumbing to people who are shopping.
 */
export function UnavailableSources({ health }: { health: SourceHealth[] }) {
  void health
  return null
}
