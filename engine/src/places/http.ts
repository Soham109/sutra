import { FetchRefused, assertHttps } from '../catalog/fetcher.js'

// catalog/fetcher.ts owns the SSRF-hardened `safeFetch`, and this module does
// not use it: safeFetch is GET-only and pins its own User-Agent, while Overpass
// needs a form POST and Nominatim's usage policy requires a UA that identifies
// *this* application. So this is a local fetch, and it is stricter rather than
// weaker. safeFetch has to re-resolve every redirect hop because it takes URLs
// from users; every host reachable from here is a module constant in this
// directory, so we pin an allowlist and refuse redirects outright — a redirect
// off an OSM endpoint is a signal something is wrong, not a hop to follow.

export { FetchRefused }

/**
 * Identifies sutra to the OSM operators. Both Nominatim's and Overpass's usage
 * policies make an application-identifying UA mandatory; anonymous traffic gets
 * blocked, and rightly so — these are volunteer-funded shared resources.
 */
export const OSM_UA = 'sutra-gmp/0.1 (+https://github.com/Soham109/sutra; group-checkout coordinator)'

const ALLOWED_HOSTS = new Set([
  'nominatim.openstreetmap.org',
  'overpass-api.de',
  'overpass.kumi.systems',
])

const MAX_BYTES = 4_000_000
const DEFAULT_TIMEOUT_MS = 15_000

export interface OsmResponse {
  status: number
  body: string
}

export async function osmFetch(
  raw: string,
  init: { method?: 'GET' | 'POST'; body?: string; timeout_ms?: number; signal?: AbortSignal } = {},
): Promise<OsmResponse> {
  const target = assertHttps(raw)
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    throw new FetchRefused(`refusing to fetch ${target.hostname}; not an OSM endpoint`)
  }

  const timer = AbortSignal.timeout(init.timeout_ms ?? DEFAULT_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([timer, init.signal]) : timer

  const res = await fetch(target, {
    method: init.method ?? 'GET',
    redirect: 'manual',
    signal,
    body: init.body,
    headers: {
      'user-agent': OSM_UA,
      accept: 'application/json',
      'accept-language': 'en',
      ...(init.body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
    },
  })

  if (res.status >= 300 && res.status < 400) {
    throw new FetchRefused(`${target.hostname} redirected (${res.status}); refusing to follow`)
  }
  if (Number(res.headers.get('content-length') ?? '0') > MAX_BYTES) {
    throw new FetchRefused('response is too large to parse')
  }

  return { status: res.status, body: await readCapped(res) }
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      break
    }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Serialises callers and holds a floor on the gap between them.
 *
 * OSM rate limits are absolute, not averaged, so a token bucket that lets a
 * burst through would violate them. The queue is process-wide by construction:
 * one gate instance per endpoint, held at module scope.
 */
export class RateGate {
  private tail: Promise<void> = Promise.resolve()
  private last = 0

  constructor(private readonly min_gap_ms: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(async () => {
      const wait = this.min_gap_ms - (Date.now() - this.last)
      if (wait > 0) await sleep(wait)
      try {
        return await fn()
      } finally {
        this.last = Date.now()
      }
    })
    // A failed turn must not wedge everyone behind it.
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    )
    return turn
  }
}
