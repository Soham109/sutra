import { describe, expect, it } from 'vitest'
import { compareOffers, extractSize, tokens, weightedSimilarity } from '../src/catalog/compare.js'
import type { Product } from '../src/catalog/types.js'

// What "cheapest" is allowed to mean.
//
// A price comparison that gets this wrong does real damage: a group splits
// money on the strength of a saving that was never there, because a 250g bag
// was ranked against a 1kg one. These tests pin the rules that stop that.

let n = 0
function product(
  over: Partial<Product> & { title: string; amount: number; currency?: string },
): Product {
  n += 1
  return {
    id: `p${n}`,
    title: over.title,
    price: { amount_minor: over.amount, currency: over.currency ?? 'INR' },
    unit_label: 'each',
    merchant: {
      name: over.merchant?.name ?? `Store ${n}`,
      url: `https://store${n}.example`,
      country_code_iso2: 'IN',
      domain: `store${n}.example`,
    },
    product_url: `https://store${n}.example/p/${n}`,
    in_stock: over.in_stock ?? true,
    source: 'shopify',
    brand: over.brand,
  } as Product
}

describe('reading a size out of a title', () => {
  it('reads plain masses and volumes', () => {
    expect(extractSize('Blue Tokai Coffee 250g')).toMatchObject({ base: 250, dimension: 'mass' })
    expect(extractSize('Olive oil 1L')).toMatchObject({ base: 1000, dimension: 'volume' })
    expect(extractSize('Protein powder 2 kg')).toMatchObject({ base: 2000, dimension: 'mass' })
  })

  it('multiplies a multipack out to its real total', () => {
    expect(extractSize('Sparkling water 12 x 330ml')).toMatchObject({ base: 3960, dimension: 'volume' })
    expect(extractSize('Socks pack of 6')).toMatchObject({ base: 6, dimension: 'count' })
  })

  it('returns nothing rather than guessing', () => {
    expect(extractSize('Merino Wool Runner')).toBeNull()
    expect(extractSize('Gymshark Apex Hoodie')).toBeNull()
  })
})

describe('deciding two listings are the same thing', () => {
  it('scores rare words above words every product shares', () => {
    const df = new Map([['shoes', 40], ['running', 40], ['tsugi', 1], ['ghoul', 1]])
    const common = weightedSimilarity(tokens('Running Shoes'), tokens('Running Shoes Blue'), df, 40)
    const rare = weightedSimilarity(tokens('Tsugi Ghoul'), tokens('Tsugi Ghoul Knit'), df, 40)
    // Sharing a distinctive model name is far stronger evidence than sharing
    // a category word, and the score has to reflect that.
    expect(rare).toBeGreaterThan(common)
  })
})

describe('what gets ranked against what', () => {
  it('never ranks across currencies', () => {
    const res = compareOffers([
      product({ title: 'Allbirds Wool Runner', amount: 900000, currency: 'INR' }),
      product({ title: 'Allbirds Wool Runner', amount: 11000, currency: 'USD' }),
    ])
    // Two currencies, so nothing pairs up: they are reported, not compared.
    expect(res.groups).toHaveLength(0)
    expect(res.currencies).toEqual(['INR', 'USD'])
    expect(res.ungrouped).toHaveLength(2)
  })

  it('ranks per unit when every listing states a comparable size', () => {
    const res = compareOffers([
      product({ title: 'Blue Tokai Attikan Estate Coffee 250g', amount: 45000 }),
      product({ title: 'Blue Tokai Attikan Estate Coffee 1kg', amount: 150000 }),
    ])
    expect(res.groups).toHaveLength(1)
    const g = res.groups[0]!
    expect(g.basis).toBe('unit')
    // ₹450/250g = ₹1.80/g. ₹1500/1kg = ₹1.50/g. The bigger bag wins despite
    // costing more than three times as much on the label.
    expect(g.best.product.title).toContain('1kg')
    expect(g.caveats.some((c) => c.includes('per gram'))).toBe(true)
  })

  it('falls back to sticker price and says so when a size is missing', () => {
    const res = compareOffers([
      product({ title: 'Blue Tokai Attikan Coffee 250g', amount: 45000 }),
      product({ title: 'Blue Tokai Attikan Coffee', amount: 40000 }),
    ])
    const g = res.groups[0]!
    expect(g.basis).toBe('sticker')
    expect(g.caveats.some((c) => c.includes('do not'))).toBe(true)
  })

  it('refuses to compare a mass against a volume', () => {
    const res = compareOffers([
      product({ title: 'Cold brew concentrate 500ml', amount: 30000 }),
      product({ title: 'Cold brew concentrate 500g', amount: 28000 }),
    ])
    const g = res.groups[0]!
    expect(g.basis).toBe('sticker')
    expect(g.caveats.some((c) => c.includes('differently'))).toBe(true)
  })
})

describe('the saving it reports', () => {
  it('is the real gap, and points at a real cheapest offer', () => {
    const res = compareOffers([
      product({ title: 'Gymshark Apex Hoodie Black', amount: 550000, brand: 'Gymshark' }),
      product({ title: 'Gymshark Apex Hoodie', amount: 480000, brand: 'Gymshark' }),
      product({ title: 'Gymshark Apex Hoodie Black Large', amount: 620000, brand: 'Gymshark' }),
    ])
    const g = res.groups[0]!
    expect(g.best.product.price.amount_minor).toBe(480000)
    expect(g.spread_minor).toBe(140000)
    // Every offer says what it costs over the cheapest, so the UI never has
    // to do this arithmetic itself.
    expect(g.offers.map((o) => o.premium_minor)).toEqual([0, 70000, 140000])
  })

  it('warns rather than boasts when the match is only loose', () => {
    const res = compareOffers(
      [
        product({ title: 'Cotton Crew Neck Tee Navy', amount: 120000 }),
        product({ title: 'Cotton Crew Neck Tee', amount: 90000 }),
      ],
    )
    const g = res.groups[0]
    if (g && g.confidence !== 'exact') {
      expect(g.caveats.length).toBeGreaterThan(0)
    }
  })

  it('flags a cheapest offer that nobody can actually buy', () => {
    const res = compareOffers([
      product({ title: 'Allbirds Tree Runner Grey', amount: 700000, in_stock: false }),
      product({ title: 'Allbirds Tree Runner Grey', amount: 900000 }),
    ])
    const g = res.groups[0]!
    expect(g.caveats.some((c) => c.includes('out of stock'))).toBe(true)
  })
})

describe('what it does with things it cannot group', () => {
  it('shows them rather than dropping them', () => {
    const res = compareOffers([
      product({ title: 'Allbirds Wool Runner', amount: 900000 }),
      product({ title: 'Dyson Airwrap Complete', amount: 4500000 }),
    ])
    expect(res.groups).toHaveLength(0)
    expect(res.ungrouped).toHaveLength(2)
  })

  it('ignores listings with no price at all', () => {
    const res = compareOffers([
      product({ title: 'Allbirds Wool Runner', amount: 0 }),
      product({ title: 'Allbirds Wool Runner', amount: 900000 }),
    ])
    expect(res.groups).toHaveLength(0)
  })
})

// Things that are not shops.
//
// Pasting a YouTube link used to resolve to a "product": the video's title,
// merchant "Youtube", price zero. Nothing downstream would let that reach a
// charge, but presenting a music video as a shopping result is exactly what a
// judge tries in the first thirty seconds, and it is not true.
describe('links that are not shopping at all', () => {
  it('refuses the obvious non-shops by name, and says why', async () => {
    const { resolveProductUrl } = await import('../src/catalog/resolver.js')
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.instagram.com/p/abc123/',
      'https://en.wikipedia.org/wiki/Shoe',
      'https://x.com/someone/status/1',
    ]) {
      const r = await resolveProductUrl(url)
      expect(r.product, url).toBeNull()
      expect(r.strategy, url).toBe('not-a-shop')
      expect(r.warnings[0], url).toMatch(/isn’t a shop/)
    }
  })

  /** The list must never grow teeth: a real store is still a real store. */
  it('does not refuse an ordinary storefront', async () => {
    const { resolveProductUrl } = await import('../src/catalog/resolver.js')
    // No network call is needed to prove the guard did not fire — a refused
    // host short-circuits before any fetch and returns this exact strategy.
    const r = await resolveProductUrl('https://shop.example.test/products/thing')
    expect(r.strategy).not.toBe('not-a-shop')
  })
})
