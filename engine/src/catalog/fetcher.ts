import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Guarded outbound fetch. The resolver takes URLs from users, so it is an
// SSRF surface: https only, public addresses only, capped size, capped time,
// capped redirects, and every redirect hop re-validated.

const MAX_BYTES = 3_000_000
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 4

const UA =
  'Mozilla/5.0 (compatible; sutra-gmp/0.1; +https://github.com/Soham109/sutra) group-checkout-resolver'

export class FetchRefused extends Error {}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  const [a = 0, b = 0] = p
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase()
  if (s === '::1' || s === '::') return true
  if (s.startsWith('fc') || s.startsWith('fd')) return true // unique local
  if (s.startsWith('fe80')) return true // link-local
  if (s.startsWith('::ffff:')) return isPrivateV4(s.slice(7))
  return false
}

async function assertPublicHost(hostname: string): Promise<void> {
  const literal = isIP(hostname)
  if (literal) {
    const bad = literal === 4 ? isPrivateV4(hostname) : isPrivateV6(hostname)
    if (bad) throw new FetchRefused(`refusing to fetch a private address (${hostname})`)
    return
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal')) {
    throw new FetchRefused(`refusing to fetch ${hostname}`)
  }
  let addrs: { address: string; family: number }[]
  try {
    addrs = await lookup(hostname, { all: true })
  } catch {
    throw new FetchRefused(`cannot resolve ${hostname}`)
  }
  for (const a of addrs) {
    const bad = a.family === 4 ? isPrivateV4(a.address) : isPrivateV6(a.address)
    if (bad) throw new FetchRefused(`${hostname} resolves to a private address`)
  }
}

export function assertHttps(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new FetchRefused('that does not look like a URL')
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') throw new FetchRefused('only https URLs are supported')
  return url
}

export interface FetchedPage {
  url: string
  status: number
  contentType: string
  body: string
}

/** Fetch a public https document, following redirects with re-validation. */
export async function safeFetch(
  raw: string,
  init: { accept?: string; signal?: AbortSignal; acceptLanguage?: string } = {},
): Promise<FetchedPage> {
  let url = assertHttps(raw)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname)

    const timer = AbortSignal.timeout(TIMEOUT_MS)
    const signal = init.signal ? AbortSignal.any([timer, init.signal]) : timer

    // Accept-Language defaults on, because it is what makes a merchant serve
    // an English page instead of a guessed one. But it is also, on some
    // storefronts, the signal a currency-conversion app uses to pick a
    // market — pass acceptLanguage: '' to send none at all when the caller
    // needs the store's own base price, not a locale-converted one. See the
    // callers in resolver.ts for why that matters.
    //
    // The empty string has to be sent as a real header, not just omitted:
    // when no Accept-Language key is present at all, Node's own fetch
    // (undici) silently substitutes its own default of `Accept-Language: *`
    // — which turned out to be enough by itself to trigger the same
    // currency conversion this is trying to avoid. `if (lang)` here would
    // treat '' as "don't bother setting it" and let that default sneak back
    // in, so the key is always set, explicitly, to whatever was asked for.
    const headers: Record<string, string> = {
      'user-agent': UA,
      accept: init.accept ?? 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': init.acceptLanguage ?? 'en-US,en;q=0.9',
    }

    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers,
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new FetchRefused(`redirect without a location (${res.status})`)
      url = assertHttps(new URL(loc, url).toString())
      continue
    }

    const contentType = res.headers.get('content-type') ?? ''
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_BYTES) throw new FetchRefused('page is too large to parse')

    const body = await readCapped(res)
    return { url: url.toString(), status: res.status, contentType, body }
  }
  throw new FetchRefused('too many redirects')
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
