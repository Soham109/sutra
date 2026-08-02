import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeFetch } from '../src/catalog/fetcher.js'

// Caught live against the real, configured Shopify development store
// (sutra-agzdw2mf.myshopify.com): its /password gate answers a request
// carrying `Accept: application/json` (exactly what catalog/sources.ts's
// suggest.json search sends) by redirecting to ITSELF, forever — it has no
// JSON representation of the password page to offer. Before this fix,
// safeFetch burned its whole MAX_REDIRECTS budget re-fetching the same URL
// and then threw an opaque "too many redirects", with no URL attached for a
// caller to reason about — which meant catalog/sources.ts's password-wall
// detection (checking the final `res.url`) never got a response to check at
// all. safeFetch now recognises a redirect back to an already-visited URL in
// the SAME chain and returns immediately with that URL, rather than
// retrying a chain that can only ever repeat.

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeFetch — a redirect loop resolves fast, with a real URL attached', () => {
  it('stops on the second hop instead of exhausting the full redirect budget', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'https://example.com/password' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await safeFetch('https://example.com/search/suggest.json?q=x', {
      accept: 'application/json',
    })

    expect(res.url).toBe('https://example.com/password')
    expect(res.status).toBe(302)
    // Two hops: the original URL, then the redirect target it then repeats.
    // The old behaviour re-fetched the same URL up to MAX_REDIRECTS+1 times.
    expect(calls).toBe(2)
  })

  it('still resolves a normal, non-looping multi-hop redirect chain the same as before', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/a')) return new Response(null, { status: 301, headers: { location: '/b' } })
      if (url.includes('/b')) return new Response(null, { status: 302, headers: { location: '/c' } })
      return new Response('final page', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await safeFetch('https://example.com/a')
    expect(res.url).toBe('https://example.com/c')
    expect(res.status).toBe(200)
    expect(res.body).toBe('final page')
  })

  it('a longer ping-pong loop (A -> B -> A -> B …) is also caught, not just an immediate self-redirect', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const next = url.includes('/a') ? '/b' : '/a'
      return new Response(null, { status: 302, headers: { location: next } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await safeFetch('https://example.com/a')
    // Caught the moment a previously-visited URL would be revisited again —
    // strictly fewer hops than the full MAX_REDIRECTS budget.
    expect(res.status).toBe(302)
    expect(['https://example.com/a', 'https://example.com/b']).toContain(res.url)
    expect(fetchMock.mock.calls.length).toBeLessThan(6)
  })
})
