import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveProductUrl } from '../src/catalog/resolver.js'
import { ShopifySource } from '../src/catalog/sources.js'

// Fixtures for the findings this agent made and fixed in resolver.ts /
// sources.ts, kept separate from fixtures/catalog/ (that directory and its
// manifest belong to the parse.ts agent working the same session). Every
// HTML/JSON file here is a REAL page or API response saved
// on 2026-08-02, not hand-typed. See the session report for exact URLs.
const FIXDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/resolver-own')
const read = (name: string) => readFileSync(path.join(FIXDIR, name), 'utf8')

function textResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hashbang (client-routed) links are refused before any fetch — Ecwid-style widgets', () => {
  it('refuses a #!/ address without inventing the store\'s own name as the product', async () => {
    // Real, live example this was caught on: badsquiddogames.com, an Ecwid
    // store using the classic hash-routed widget. The fragment never
    // reaches the server at all (RFC 3986 §3.5), so a server-side fetch of
    // this URL can only ever see the shop's home page — resolving it used
    // to hand back the STORE's own name ("Bad Squiddo Games") and $0 as if
    // that were the product.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await resolveProductUrl('https://badsquiddogames.com/shop#!/Amelia-King-Land-Army/p/820790357')
    expect(r.product).toBeNull()
    expect(r.strategy).toBe('client-routed')
    expect(fetchMock).not.toHaveBeenCalled() // refused before ever touching the network
  })

  it('does not touch an ordinary in-page anchor on an otherwise real link', async () => {
    // #reviews does not start with "!" — this must reach the normal resolve
    // path, not be swept up by the hashbang guard.
    const fetchMock = vi.fn().mockResolvedValue(textResponse('not a shop', 404))
    vi.stubGlobal('fetch', fetchMock)
    const r = await resolveProductUrl('https://example.com/products/thing#reviews')
    expect(r.strategy).not.toBe('client-routed')
  })
})

describe('a headless Shopify storefront (no Liquid .js/.json routes) must still resolve a live product', () => {
  it('falls through to page scraping instead of believing "not-found" when the page itself declares a real product', async () => {
    // fashionnova-headless-product.html: a real, live Fashion Nova product
    // page (Shopify backend, Hydrogen/Oxygen storefront — no Liquid theme
    // at all). Both <handle>.js and <handle>.json 404 for EVERY product on
    // this architecture, dead or alive, because those routes simply do not
    // exist — the old code treated any double-404 as proof the item was
    // gone and refused outright, which made every live product on this
    // real, production storefront completely unreachable.
    const html = read('fashionnova-headless-product.html')
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.endsWith('.js') || u.pathname.endsWith('.json')) return textResponse('not found', 404)
      if (u.pathname === '/meta.json') return textResponse('not found', 404)
      return textResponse(html, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveProductUrl(
      'https://www.fashionnova.com/products/a-dollar-and-a-dream-short-sleeve-tee-fncolorname-white',
    )
    expect(r.product).not.toBeNull()
    expect(r.product?.title).toContain('A Dollar And A Dream')
    expect(r.product?.price).toEqual({ amount_minor: 1399, currency: 'USD' })
  })

  it('still refuses a genuinely dead handle on the same kind of store (both signals agree)', async () => {
    // A page that ALSO 404s (or 200s with no Product markup) after the JSON
    // API said not-found is the original "Bestsellers ₹99" case this guard
    // exists for — two independent signals agreeing, not one alone.
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.endsWith('.js') || u.pathname.endsWith('.json')) return textResponse('not found', 404)
      if (u.pathname === '/meta.json') return textResponse('not found', 404)
      // The page itself also 404s — no Product markup anywhere.
      return textResponse('<html><title>Page Not Found</title></html>', 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveProductUrl('https://example.com/products/definitely-not-real')
    expect(r.product).toBeNull()
  })
})

describe('ProductGroup/hasVariant (Shopify\'s current JSON-LD shape for variant products)', () => {
  it('reads every variant\'s own offer instead of just the first, and gets stock status right', async () => {
    // gymshark-productgroup.html: a real, live Gymshark product page. 7
    // ssizes under hasVariant, each its own Product node with its own single
    // Offer; the first in document order (XXS) is out of stock. The old
    // code picked "the node with an offer" (singular) — exactly that first
    // variant — so the product read as entirely out of stock even though a
    // different size (XS) was buyable, and any product where sizes are
    // priced differently would have quietly quoted one arbitrary variant's
    // price for the whole item.
    const html = read('gymshark-productgroup.html')
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.endsWith('.js') || u.pathname.endsWith('.json')) return textResponse('not found', 404)
      if (u.pathname === '/meta.json') return textResponse('not found', 404)
      return textResponse(html, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveProductUrl('https://www.gymshark.com/products/gymshark-peek-a-boo-sports-bra-white-ss24')
    expect(r.product?.variants).toHaveLength(7)
    // Real data: every size is genuinely $9 on this listing, but only XS is
    // in stock — the product-level in_stock flag has to say true because of
    // that one buyable size, not false because the FIRST size happened not
    // to be.
    expect(r.product?.in_stock).toBe(true)
    const xs = r.product?.variants.find((v) => v.name === 'xs')
    expect(xs?.available).toBe(true)
    expect(xs?.price).toEqual({ amount_minor: 900, currency: 'USD' })
  })
})

describe('WooCommerce Store API strategy', () => {
  it('resolves a real store with a fully custom permalink via the page\'s own wp-json discovery link', async () => {
    // offermanwoodshop.com: real product at /store/kindlin/hearth-home/
    // <slug> — nothing like the default /product/<slug>/ shape, proving the
    // slug is read from the URL's own last path segment, not a guessed
    // permalink pattern.
    const html = read('woocommerce-offermanwoodshop-product.html')
    const api = read('woocommerce-offermanwoodshop-store-api.json')
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.includes('wc/store/v1/products')) {
        expect(u.searchParams.get('slug')).toBe('ows-walnut-demi-cutting-board')
        return textResponse(api, 200, 'application/json')
      }
      return textResponse(html, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveProductUrl(
      'https://offermanwoodshop.com/store/kindlin/hearth-home/ows-walnut-demi-cutting-board',
    )
    expect(r.strategy).toBe('woocommerce')
    expect(r.product?.title).toBe('OWS Walnut Demi Cutting Board')
    // The Store API's price field is already scaled to currency_minor_unit
    // ("12500" for $125.00) — confirmed against this exact real response.
    expect(r.product?.price).toEqual({ amount_minor: 12500, currency: 'USD' })
  })

  it('does not mistake an ordinary WordPress blog for a WooCommerce store', async () => {
    const html = `<html><head><link rel="https://api.w.org/" href="https://example.com/wp-json/" /></head>
      <body class="single post"><h1>A blog post, not a shop</h1></body></html>`
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.includes('wc/store/v1')) return textResponse('{"code":"rest_no_route"}', 404, 'application/json')
      return textResponse(html, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveProductUrl('https://example.com/product/whatever')
    expect(r.strategy).not.toBe('woocommerce')
  })
})

describe('Accept-Language is deliberately withheld from Shopify/WooCommerce JSON API calls', () => {
  // Caught live: sending the default browser Accept-Language on a Shopify
  // product's .js endpoint made a currency-conversion app on that store
  // silently return a DIFFERENT market's price (a real $310.50 item came
  // back as an integer that, paired with the store's own declared "USD",
  // read as $22,500 — a 72x error) while /meta.json (fetched the same way)
  // kept reporting the base currency regardless. Node's own fetch defaults
  // to `Accept-Language: *` when the header is simply omitted, which was
  // enough on its own to trigger the same thing — so this has to be an
  // explicit empty override, not just "don't set the header".
  it('sends no Accept-Language on the Shopify .js/.json/meta.json requests', async () => {
    const seen: (string | null)[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.['accept-language'] ?? null)
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.endsWith('.js')) {
        return textResponse(
          JSON.stringify({ title: 'X', variants: [{ id: 1, title: 'Default Title', price: 1000 }] }),
          200,
          'application/json',
        )
      }
      return textResponse('{}', 200, 'application/json')
    })
    vi.stubGlobal('fetch', fetchMock)

    await resolveProductUrl('https://example.com/products/thing')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((h) => h === '')).toBe(true)
  })

  it('sends no Accept-Language on the WooCommerce Store API request either (same class of app exists there too)', async () => {
    const html = `<html><head><link rel="https://api.w.org/" href="https://example.com/wp-json/" /></head>
      <body class="woocommerce single-product"></body></html>`
    let wcHeader: string | null = 'unset'
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname.includes('wc/store/v1')) {
        wcHeader = (init?.headers as Record<string, string> | undefined)?.['accept-language'] ?? null
        return textResponse('[]', 200, 'application/json')
      }
      return textResponse(html, 200)
    })
    vi.stubGlobal('fetch', fetchMock)

    await resolveProductUrl('https://example.com/product/thing')
    expect(wcHeader).toBe('')
  })
})

describe('sources.ts — ShopifySource tags search results with the store\'s real currency', () => {
  it('does not hardcode USD for a non-US storefront', async () => {
    // Real, live bug: mamaearth.in and beardo.in (both in the default
    // search shelf) are INR stores. /search/suggest.json prices are plain
    // decimal strings with no currency marker at all, so a hardcoded 'USD'
    // fallback mislabeled every rupee price as dollars.
    const suggest = {
      resources: { results: { products: [{ title: 'Rosemary Shampoo', url: '/products/rosemary', price: '310.00', available: true }] } },
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const u = new URL(raw)
      if (u.pathname === '/meta.json') return textResponse('{"currency":"INR"}', 200, 'application/json')
      if (u.pathname === '/search/suggest.json') return textResponse(JSON.stringify(suggest), 200, 'application/json')
      return textResponse('not found', 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    const source = new ShopifySource(['mamaearth.in'])
    const { products } = await source.search('shampoo', { limit: 5 })
    expect(products).toHaveLength(1)
    expect(products[0]?.price).toEqual({ amount_minor: 31000, currency: 'INR' })
  })
})
