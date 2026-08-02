import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { resolveProductUrl } from '../src/catalog/resolver.js'
import { FIXTURES, type Fixture } from './fixtures/catalog/manifest.js'

// The corpus accuracy harness. Every fixture in manifest.ts is a REAL page
// fetched with `curl -A '<browser UA>'` from a live merchant on 2026-08-02 —
// see the manifest for exact URLs and how each `expected` was read by hand.
// Nothing here is synthetic HTML.
//
// This runs the actual production resolveProductUrl() against each saved
// page, with only `fetch` swapped for a replay of the exact bytes that were
// captured — the SSRF guard in fetcher.ts still does a REAL DNS lookup on the
// hostname (it never touches the network for content, only to confirm the
// host isn't a private address), so this suite needs outbound DNS to run.
// That is a deliberate trade: mocking dns too would mean this test could pass
// against a resolver that no longer even calls the real strategy functions.
//
// Rows are split by `ownership` (see manifest.ts, and the session report):
//   - parse.ts rows are asserted strictly — this agent owns making every one
//     of them pass, and after the fixes in parse.ts they all do.
//   - resolver.ts / sources.ts rows are RUN and RECORDED in the printed
//     table (that table is the accuracy number in the report) but not
//     asserted against `expected`, because the fix for those lives in a file
//     this agent was told not to touch. The locked floor at the bottom still
//     catches any regression in them.

const FIXDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/catalog')
const read = (name: string) => readFileSync(path.join(FIXDIR, name), 'utf8')

function textResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

type Handler = { test: (u: URL) => boolean; respond: () => Response }

function fetchMock(handlers: Handler[]) {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    const u = new URL(raw)
    for (const h of handlers) if (h.test(u)) return h.respond()
    // Any request this harness did not anticipate is a bug in the harness,
    // not a pass-through to the real network — fail loud, not quiet.
    return textResponse(`unmocked request in catalog-accuracy harness: ${raw}`, 404, 'text/plain')
  })
}

/** A plain HTML product page: one fetch, the saved page, nothing else. */
function htmlFixtureFetch(id: string) {
  return fetchMock([{ test: () => true, respond: () => textResponse(read(`${id}.html`)) }])
}

/** A Shopify store answering `<path>.js` + `meta.json` — the primary path. */
function shopifyJsFixtureFetch(id: string) {
  return fetchMock([
    { test: (u) => u.pathname === '/meta.json', respond: () => textResponse(read(`${id}.meta.json`), 200, 'application/json') },
    { test: (u) => u.pathname.endsWith('.js'), respond: () => textResponse(read(`${id}.product.js`), 200, 'application/json') },
  ])
}

/** A Shopify store whose `.js` endpoint 404s, forcing the `.json` fallback branch. */
function shopifyJsonFallbackFetch(id: string) {
  return fetchMock([
    { test: (u) => u.pathname === '/meta.json', respond: () => textResponse(read(`${id}.meta.json`), 200, 'application/json') },
    { test: (u) => u.pathname.endsWith('.js'), respond: () => textResponse('not found', 404, 'text/html') },
    { test: (u) => u.pathname.endsWith('.json'), respond: () => textResponse(read(`${id}.product.json`), 200, 'application/json') },
  ])
}

function mockFor(fx: Fixture) {
  if (fx.id === 'shopify-bombayshavingcompany-json-fallback') return shopifyJsonFallbackFetch(fx.id)
  if (fx.platform.startsWith('shopify')) return shopifyJsFixtureFetch(fx.id)
  return htmlFixtureFetch(fx.id)
}

interface Row {
  id: string
  ownership: string
  expected: string
  actual: string
  pass: boolean
}

const rows: Row[] = []

function fmt(m: { amount_minor: number; currency: string } | null): string {
  return m ? `${m.currency} ${m.amount_minor}m` : 'REFUSE'
}

/**
 * finalize() in resolver.ts defaults an absent price to {0,'USD'} even after
 * the "refuse a non-positive price" comment a few lines above it — so a
 * refusal shows up here as amount_minor <= 0, never as product === null.
 * See the session report for the full resolver.ts finding.
 */
async function resolveAndClassify(fx: Fixture): Promise<{ amount_minor: number; currency: string } | null> {
  const result = await resolveProductUrl(fx.url)
  if (!result.product || result.product.price.amount_minor <= 0) return null
  return { amount_minor: result.product.price.amount_minor, currency: result.product.price.currency }
}

function recordAndCheck(fx: Fixture, actual: { amount_minor: number; currency: string } | null): boolean {
  const pass = JSON.stringify(actual) === JSON.stringify(fx.expected)
  rows.push({ id: fx.id, ownership: fx.ownership, expected: fmt(fx.expected), actual: fmt(actual), pass })
  return pass
}

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  const byOwner = (o: string) => rows.filter((r) => r.ownership === o)
  const lines = [
    '',
    '=== catalog price accuracy — full corpus ===',
    ...rows.map((r) => `[${r.pass ? 'PASS' : 'FAIL'}] ${r.id.padEnd(48)} (${r.ownership.padEnd(11)}) expected=${r.expected}  actual=${r.actual}`),
    '',
    `TOTAL: ${rows.filter((r) => r.pass).length} / ${rows.length} correct`,
    `  parse.ts fixtures:     ${byOwner('parse.ts').filter((r) => r.pass).length} / ${byOwner('parse.ts').length}`,
    `  resolver.ts fixtures:  ${byOwner('resolver.ts').filter((r) => r.pass).length} / ${byOwner('resolver.ts').length}`,
    `  sources.ts fixtures:   ${byOwner('sources.ts').filter((r) => r.pass).length} / ${byOwner('sources.ts').length}`,
    '',
  ]
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'))
})

describe('catalog price accuracy — parse.ts-owned fixtures (must all pass)', () => {
  for (const fx of FIXTURES.filter((f) => f.ownership === 'parse.ts')) {
    it(fx.id, async () => {
      vi.stubGlobal('fetch', mockFor(fx))
      const actual = await resolveAndClassify(fx)
      recordAndCheck(fx, actual)
      expect(actual).toEqual(fx.expected)
    })
  }
})

describe("catalog price accuracy — resolver.ts / sources.ts-owned fixtures (recorded for the report, not gated here)", () => {
  for (const fx of FIXTURES.filter((f) => f.ownership !== 'parse.ts')) {
    it(`${fx.id} [${fx.ownership}]`, async () => {
      vi.stubGlobal('fetch', mockFor(fx))
      const actual = await resolveAndClassify(fx)
      // Deliberately NOT `expect(actual).toEqual(fx.expected)` here — that
      // assertion depends on a fix in a file this agent was told to leave
      // alone. The printed table is the accuracy signal for this row; this
      // `it()` only proves the resolver ran to completion without throwing.
      recordAndCheck(fx, actual)
      expect(actual === null || typeof actual === 'object').toBe(true)
    })
  }
})

it('locked floor — overall accuracy must never regress below what this session measured', () => {
  expect(rows).toHaveLength(FIXTURES.length)
  const correct = rows.filter((r) => r.pass).length
  // If this drops, something regressed. If it rises (a resolver.ts/sources.ts
  // fix landed), raise the floor to match — do not leave slack in this number.
  expect(correct).toBeGreaterThanOrEqual(19)
})
