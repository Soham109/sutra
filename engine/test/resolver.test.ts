import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  aggregateOfferRange,
  collectNodes,
  decodeEntities,
  extractJsonLd,
  metaContent,
  microdata,
  parseAvailability,
  parseMoney,
  parseStructuredMoney,
  titleTag,
} from '../src/catalog/parse.js'
import { classifyPage } from '../src/catalog/resolver.js'

// Fixture readers for the tests below that check a fix against a REAL page
// rather than a hand-typed string — see fixtures/catalog/manifest.ts for
// where each of these was fetched from and what a human reading the page
// would pay.
const FIXDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/catalog')
const fixtureHtml = (id: string) => readFileSync(path.join(FIXDIR, `${id}.html`), 'utf8')
const productOffers = (html: string) => {
  const nodes = collectNodes(extractJsonLd(html), ['Product'])
  const node = nodes.find((n) => n['offers']) ?? nodes[0]!
  return node['offers'] as Record<string, unknown>
}

describe('parseMoney', () => {
  it('reads the shapes merchants actually publish', () => {
    expect(parseMoney('45.00')).toEqual({ amount_minor: 4500, currency: 'USD' })
    expect(parseMoney(45)).toEqual({ amount_minor: 4500, currency: 'USD' })
    expect(parseMoney('$1,234.56')).toEqual({ amount_minor: 123456, currency: 'USD' })
    expect(parseMoney('₹1,299')).toEqual({ amount_minor: 129900, currency: 'INR' })
    expect(parseMoney('USD 45')).toEqual({ amount_minor: 4500, currency: 'USD' })
    expect(parseMoney('£19.99')).toEqual({ amount_minor: 1999, currency: 'GBP' })
  })

  it('handles european separators (1.234,56)', () => {
    expect(parseMoney('1.234,56 €')).toEqual({ amount_minor: 123456, currency: 'EUR' })
    expect(parseMoney('2.500,00')).toEqual({ amount_minor: 250000, currency: 'USD' })
  })

  it('respects zero-decimal currencies', () => {
    expect(parseMoney('5000', 'JPY')).toEqual({ amount_minor: 5000, currency: 'JPY' })
    expect(parseMoney('¥5,000')).toEqual({ amount_minor: 5000, currency: 'JPY' })
  })

  it('returns null rather than guessing when there is no number', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney('Sold out')).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
  })

  it('property: a formatted amount round-trips back to the same minor units', () => {
    // min:1, not min:0 — parseMoney now refuses a zero amount at the source
    // (see the dedicated "never returns a zero or negative amount" test
    // below), so 0 is no longer a value that round-trips through amount_minor.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), (minor) => {
        const decimal = (minor / 100).toFixed(2)
        expect(parseMoney(decimal)?.amount_minor).toBe(minor)
      }),
    )
  })

  it('property: never returns a fractional or NaN minor amount', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const m = parseMoney(s)
        if (m) {
          expect(Number.isInteger(m.amount_minor)).toBe(true)
          expect(Number.isNaN(m.amount_minor)).toBe(false)
        }
      }),
    )
  })

  // A real Kuwaiti electronics retailer (xcite.com) and IKEA's own Kuwait and
  // Bahrain storefronts, fetched live — see manifest.ts for the URLs.
  it('gets three-decimal currencies (BHD/KWD/OMR/JOD/TND) exact', () => {
    expect(parseMoney('0.95', 'KWD')).toEqual({ amount_minor: 950, currency: 'KWD' })
    expect(parseMoney('28.5', 'BHD')).toEqual({ amount_minor: 28500, currency: 'BHD' })
    expect(parseMoney('169.9', 'KWD')).toEqual({ amount_minor: 169900, currency: 'KWD' })
    // The old code's fixed "1 or 2 trailing digits means decimal" cutoff read
    // a genuine three-decimal price as a thousands-grouped integer: "12.345"
    // KWD became 12345 KWD (12,345,000 fils) instead of 12.345 KWD (12,345
    // fils) — a thousandfold overcharge. No live fixture happened to show a
    // full three trailing digits (real Gulf storefronts round the display),
    // but the underlying ambiguity is exactly the same as the "$1,234"
    // thousands case below, just decided by the currency's own precision.
    expect(parseMoney('12.345', 'KWD')).toEqual({ amount_minor: 12345, currency: 'KWD' })
    // The same three-digit tail on a two-decimal currency is still a
    // thousands grouping, exactly as before.
    expect(parseMoney('$1,234')).toEqual({ amount_minor: 123400, currency: 'USD' })
  })

  // A real Magento storefront (ghirardelli.com), fetched live. Its JSON-LD
  // Offer.price for a discounted item was the string "21.710000" — six
  // trailing zeros, not two. The old code's decimal/thousands heuristic only
  // trusted 1–2 trailing digits as a decimal point, so anything else fell
  // through to "both separators are thousands marks": "21.710000" became the
  // integer 21710000, i.e. a $21.71 chocolate bag priced at $217,100,000.00.
  it('reads a JSON-LD price zero-padded past the currency\'s own precision (real Magento feed)', () => {
    const offers = productOffers(fixtureHtml('magento-ghirardelli-sale-discount'))
    expect(offers['price']).toBe('21.710000') // the exact string this merchant actually publishes
    expect(parseMoney(offers['price'], String(offers['priceCurrency']))).toEqual({
      amount_minor: 2171,
      currency: 'USD',
    })
  })

  it('never returns a zero or negative amount — refusing beats guessing', () => {
    // og:price:amount="0" is the real value a live Wix store (ogieyewear.com)
    // publishes for a product-line page with no fixed price — see manifest.ts.
    expect(parseMoney('0')).toBeNull()
    expect(parseMoney('0.00', 'INR')).toBeNull()
    expect(parseMoney(0)).toBeNull()
    // No real storefront publishes a negative price; this is a defensive
    // property of the parser itself (a scraped "-$5 off" fragment must never
    // read as the price), not something a live fixture can demonstrate.
    expect(parseMoney('-$5.00')).toBeNull()
    expect(parseMoney(-5)).toBeNull()
  })
})

describe('parseStructuredMoney — machine fields, not prose', () => {
  it('reads a clean decimal literal directly, without the thousands/decimal guess', () => {
    expect(parseStructuredMoney('38.00', 'USD')).toEqual({ amount_minor: 3800, currency: 'USD' })
    // The exact real Magento string again: parseStructuredMoney does not need
    // the currency-aware exception parseMoney needs, because it never treats
    // a clean "digits.digits" literal as a thousands grouping in the first
    // place — this is what "never goes through the same heuristics as
    // scraped text" means concretely.
    expect(parseStructuredMoney('21.710000', 'USD')).toEqual({ amount_minor: 2171, currency: 'USD' })
  })

  it('accepts a raw JSON number the same way it accepts a string', () => {
    // squarespace-grainandknot-number-price.html: Offer.price is the JSON
    // number 120, not the string "120" — real Squarespace-generated markup.
    const offers = productOffers(fixtureHtml('squarespace-grainandknot-number-price'))
    expect(typeof offers['price']).toBe('number')
    expect(parseStructuredMoney(offers['price'], String(offers['priceCurrency']))).toEqual({
      amount_minor: 12000,
      currency: 'GBP',
    })
  })

  it('falls back to the tolerant parser for a field that is not actually clean', () => {
    // Some feeds still emit locale-formatted structured fields despite the
    // spec — refusing a real price over that would be its own bug.
    expect(parseStructuredMoney('1,234.56', 'USD')).toEqual({ amount_minor: 123456, currency: 'USD' })
  })

  it('refuses zero and negative exactly like parseMoney', () => {
    expect(parseStructuredMoney('0', 'USD')).toBeNull()
    expect(parseStructuredMoney(0, 'USD')).toBeNull()
  })
})

describe('aggregateOfferRange — a range is not a price', () => {
  it('collapses to a single price when low === high', () => {
    // ikea-ae: AggregateOffer{lowPrice:395,highPrice:475} — but this is the
    // AggregateOffer's OWN range, kept separate here from the nested real
    // Offer the resolver actually quotes (see resolver.test.ts elsewhere /
    // the accuracy harness for that distinction).
    expect(aggregateOfferRange('395', '395', 'AED')).toEqual({
      kind: 'single',
      price: { amount_minor: 39500, currency: 'AED' },
    })
  })

  it('flags a genuine range instead of silently returning one end', () => {
    // The exact real numbers from landyachtz.com's Tugboat skateboard:
    // AggregateOffer{lowPrice:"99.99",highPrice:"199.99",offerCount:"2"},
    // no nested offers array at all — there is no single real price here.
    const html = fixtureHtml('woocommerce-landyachtz-aggregateoffer-range')
    const offers = productOffers(html)
    expect(offers['offers']).toBeUndefined() // confirms this fixture has no nested per-variant offers to fall back to
    const result = aggregateOfferRange(offers['lowPrice'], offers['highPrice'], String(offers['priceCurrency']))
    expect(result).toEqual({
      kind: 'range',
      low: { amount_minor: 9999, currency: 'USD' },
      high: { amount_minor: 19999, currency: 'USD' },
    })
  })

  it('is unpriced when neither end parses', () => {
    expect(aggregateOfferRange(undefined, undefined, 'USD')).toEqual({ kind: 'unpriced' })
    expect(aggregateOfferRange('Sold out', 'Sold out', 'USD')).toEqual({ kind: 'unpriced' })
  })
})

describe('JSON-LD extraction', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Organization","name":"Store"}
      </script>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList"},
        {"@type":"Product","name":"Merino Runner",
         "image":["https://cdn.example/a.jpg"],
         "brand":{"@type":"Brand","name":"Allbirds"},
         "offers":{"@type":"Offer","price":"98.00","priceCurrency":"USD",
                   "availability":"https://schema.org/InStock"}}
      ]}
      </script>
    </head><body></body></html>`

  it('pulls every ld+json block and finds Product inside @graph', () => {
    const blocks = extractJsonLd(html)
    expect(blocks).toHaveLength(2)
    const products = collectNodes(blocks, ['Product'])
    expect(products).toHaveLength(1)
    expect(products[0]!['name']).toBe('Merino Runner')
  })

  it('survives a block with trailing commas', () => {
    const sloppy = `<script type="application/ld+json">{"@type":"Product","name":"X",}</script>`
    expect(collectNodes(extractJsonLd(sloppy), ['Product'])).toHaveLength(1)
  })

  it('ignores an unparseable block without throwing', () => {
    const broken = `<script type="application/ld+json">{not json at all</script>`
    expect(() => extractJsonLd(broken)).not.toThrow()
    expect(extractJsonLd(broken)).toHaveLength(0)
  })
})

describe('meta and microdata', () => {
  it('reads og/product tags in either attribute order', () => {
    const a = `<meta property="og:title" content="Nice Shoe">`
    const b = `<meta content="42.50" property="product:price:amount">`
    expect(metaContent(a, 'og:title')).toBe('Nice Shoe')
    expect(metaContent(b, 'product:price:amount')).toBe('42.50')
  })

  it('reads microdata from content attributes and inner text', () => {
    expect(microdata(`<span itemprop="price" content="30.00"></span>`, 'price')).toBe('30.00')
    expect(microdata(`<span itemprop="name">Blue Mug</span>`, 'name')).toBe('Blue Mug')
  })

  it('decodes entities so titles are not mangled', () => {
    expect(decodeEntities('Tom &amp; Jerry&#39;s')).toBe("Tom & Jerry's")
    expect(titleTag('<title>Caf&eacute;  Chair</title>')).toBe('Caf&eacute; Chair')
  })
})

describe('page classification — the guard against charging for the wrong item', () => {
  const at = (html: string, pageUrl = 'https://shop.example/x') => classifyPage({ html, pageUrl })

  it('a Product node means item page', () => {
    expect(at(`<script type="application/ld+json">{"@type":"Product","name":"X"}</script>`)).toBe('product')
  })

  it('og:type=product means item page', () => {
    expect(at(`<meta property="og:type" content="product">`)).toBe('product')
  })

  it('a CollectionPage with no Product is a listing', () => {
    expect(at(`<script type="application/ld+json">{"@type":"CollectionPage","name":"Mens"}</script>`)).toBe('collection')
  })

  it('a listing that also carries Products is still an item page only if a Product exists', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"CollectionPage"},{"@type":"Product","name":"Y"}]}</script>`
    expect(at(html)).toBe('product')
  })

  it('falls back to path shape when the page declares nothing', () => {
    expect(at('<html></html>', 'https://shop.example/collections/mens')).toBe('collection')
    expect(at('<html></html>', 'https://shop.example/search/shoes')).toBe('collection')
  })

  // A /product/<slug> or /products/<handle> path is strong, platform-spread
  // evidence of a single item (Shopify, WooCommerce, Magento and most
  // generic carts all use exactly this shape for one thing, never a
  // listing) — deliberately strengthened from the old "stays unknown"
  // behaviour, because 'unknown' silently disqualified a bare product page
  // with no schema.org markup at all from the last-resort heuristic
  // strategy too (it requires kind === 'product' before it will even try).
  // A real item with no structured data was being refused outright instead
  // of getting a flagged, low-confidence price.
  it('a /product/<slug> or /products/<handle> path is treated as a product page even with no markup', () => {
    expect(at('<html></html>', 'https://shop.example/products/thing')).toBe('product')
    expect(at('<html></html>', 'https://shop.example/product/thing')).toBe('product')
    expect(at('<html></html>', 'https://shop.example/products/thing/')).toBe('product')
  })

  it('a declared collection still wins over a product-shaped path', () => {
    // Pathological, but the JSON-LD/og:type checks run first specifically so
    // a page that actively declares itself a listing is never overridden by
    // a path guess — this just pins that order.
    const html = `<script type="application/ld+json">{"@type":"CollectionPage","name":"Mens"}</script>`
    expect(at(html, 'https://shop.example/products/mens')).toBe('collection')
  })
})

describe('availability', () => {
  it('treats the schema.org spellings correctly', () => {
    expect(parseAvailability('https://schema.org/InStock')).toBe(true)
    expect(parseAvailability('https://schema.org/OutOfStock')).toBe(false)
    expect(parseAvailability('SoldOut')).toBe(false)
    expect(parseAvailability(undefined)).toBe(true) // absent means available
  })
})
