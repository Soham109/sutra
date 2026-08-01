import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  collectNodes,
  decodeEntities,
  extractJsonLd,
  metaContent,
  microdata,
  parseAvailability,
  parseMoney,
  titleTag,
} from '../src/catalog/parse.js'
import { classifyPage } from '../src/catalog/resolver.js'

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
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (minor) => {
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
    expect(at('<html></html>', 'https://shop.example/products/thing')).toBe('unknown')
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
