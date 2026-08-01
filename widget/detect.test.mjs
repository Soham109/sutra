/* Tests for widget/detect.js against REAL captured pages.
 *
 *   node --test widget/detect.test.mjs
 *
 * Fixtures under widget/fixtures/ are verbatim curl captures of live pages
 * (see SOURCES.json). They are not trimmed to make the detector look good —
 * berkeley-coa and wikipedia-negative are in here precisely because they are
 * the cases where structured data does not exist and the honest answer is
 * "low confidence" or "nothing".
 *
 * Prices on the live web change. When a fixture is refetched these numbers
 * will need updating — that is the intended maintenance cost of testing
 * against reality instead of against markup we wrote ourselves.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { parseHTML } from 'linkedom'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const D = require('./detect.js')

const SOURCES = JSON.parse(readFileSync(join(here, 'fixtures', 'SOURCES.json'), 'utf8'))
const urlOf = (file) => SOURCES.fixtures.find((f) => f.file === file)?.url

const cache = new Map()
function load(file) {
  if (!cache.has(file)) cache.set(file, readFileSync(join(here, 'fixtures', file), 'utf8'))
  return cache.get(file)
}

/** Run the detector over a fixture exactly as a browser would see it. */
async function detect(file, opts = {}) {
  const { document, window } = parseHTML(load(file))
  const loc = new URL(opts.url || urlOf(file))
  return D.detectCart(document, loc, { win: window, fetch: null, selectionText: '', ...opts })
}

const money = (r) => (r.total_minor === null ? null : `${r.currency} ${D.formatMinor(r.total_minor, r.currency)}`)

// =====================================================================
// Money parsing — the part everything else depends on
// =====================================================================

test('parseMoney: the formats real merchants actually ship', () => {
  const cases = [
    ['$1,234.56', null, 123456, 'USD'],
    ['1.234,56 €', null, 123456, 'EUR'],
    ['£12', null, 1200, 'GBP'],
    ['12.50 USD', null, 1250, 'USD'],
    ['USD 45', null, 4500, 'USD'],
    ['₹1,23,456', null, 12345600, 'INR'], // Indian lakh grouping
    ['₹8,31,777', null, 83177700, 'INR'],
    ['Rs. 2,999', null, 299900, 'INR'],
    ['¥1,200', null, 1200, 'JPY'], // zero-decimal currency
    ['1 234,56', 'EUR', 123456, 'EUR'], // space grouping
    ['45', 'USD', 4500, 'USD'],
    [45, 'USD', 4500, 'USD'],
    [45.5, 'USD', 4550, 'USD'],
    ['CHF 89.90', null, 8990, 'CHF'],
    ['R$ 1.499,00', null, 149900, 'BRL'],
    ['A$25.00', null, 2500, 'AUD'],
  ]
  for (const [input, fallback, minor, currency] of cases) {
    const got = D.parseMoney(input, fallback)
    assert.ok(got, `parseMoney(${JSON.stringify(input)}) returned null`)
    assert.equal(got.amount_minor, minor, `amount for ${JSON.stringify(input)}`)
    assert.equal(got.currency, currency, `currency for ${JSON.stringify(input)}`)
  }
})

test('parseMoney: structured fields treat 1.234 as a decimal, loose text as grouping', () => {
  // schema.org price="1.234" means one-point-two-three-four.
  assert.equal(D.parseMoney('1.234', 'EUR', { structured: true }).amount_minor, 123)
  // The same string scraped out of German page text means one thousand.
  assert.equal(D.parseMoney('1.234', 'EUR').amount_minor, 123400)
})

test('parseMoney: refuses to invent money', () => {
  assert.equal(D.parseMoney('', 'USD'), null)
  assert.equal(D.parseMoney(null, 'USD'), null)
  assert.equal(D.parseMoney('Free', 'USD'), null)
  assert.equal(D.parseMoney('sold out', 'USD'), null)
  assert.equal(D.parseMoney('1.23456', 'USD'), null) // not a currency shape
})

test('findMoney: a bare number is never money', () => {
  assert.equal(D.findMoney('Total 4 items', 'USD').length, 0)
  assert.equal(D.findMoney('Save 20% today', 'USD').length, 0)
  assert.equal(D.findMoney('Order total $48.00', 'USD')[0].money.amount_minor, 4800)
})

// =====================================================================
// Real pages
// =====================================================================

test('shopify product page (allbirds.com) — JSON-LD Product + Offer', async () => {
  const r = await detect('shopify-allbirds-product.html')
  assert.equal(r.title, "Men's Allbirds Flip Flop")
  assert.equal(money(r), 'USD 25.00')
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.ok(r.strategy.includes('json-ld'))
  assert.ok(r.confidence >= 0.85, `confidence ${r.confidence}`)
  assert.equal(r.merchant.domain, 'allbirds.com')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].sku, 'MENS_ALLBIRDS_FLIP_FLOP')
  assert.equal(r.items[0].unit_amount, 2500)
})

test('shopify storefront in INR (bombayshavingcompany.com) — JSON-LD has no price, og does', async () => {
  const r = await detect('shopify-india-product.html')
  assert.equal(r.title, 'Air Trimmer')
  // og:price:amount is the string "2,999" — comma grouping in a machine field.
  assert.equal(money(r), 'INR 2999.00')
  assert.equal(r.currency, 'INR')
  assert.equal(r.provenance.total_minor, 'og')
  assert.ok(r.confidence >= 0.6 && r.confidence < 0.8, `og-sourced price should be mid confidence, got ${r.confidence}`)
})

test('event ticket page (eventbrite.com) — Event + AggregateOffer + startDate + venue', async () => {
  const r = await detect('eventbrite-tour.html')
  assert.equal(r.title, 'Chelsea Market, High Line & Hudson Yards Food & History Tour')
  assert.equal(money(r), 'USD 76.22')
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.ok(r.event, 'expected event detail')
  assert.match(r.event.start, /^2026-08-01T11:00/)
  assert.equal(r.event.venue, 'Chelsea Market')
  assert.match(r.event.address, /75 9th Avenue/)
  assert.equal(r.merchant.name, 'Like A Local Tours') // JSON-LD organizer, not the domain
  assert.ok(r.warnings.some((w) => /price range/.test(w)), 'AggregateOffer should be flagged as a range')
})

test('eventbrite puts a street address in twitter:data1 — do not price it', async () => {
  const { document, window } = parseHTML(load('eventbrite-tour.html'))
  const ctx = D._internals.makeCtx(document, new URL(urlOf('eventbrite-tour.html')), { win: window, fetch: null })
  const og = D._internals.fromMeta(document, new URL(urlOf('eventbrite-tour.html')), ctx)
  assert.ok(og, 'meta strategy should still find the title')
  assert.equal(og.total_minor, null, `twitter:data1 "75 9th Avenue…" must not become a price (got ${og.total_minor})`)
})

test('big-box retailer (ikea.com) — Product buried under a graph of other types', async () => {
  const r = await detect('ikea-product.html')
  assert.match(r.title, /^BILLY Bookcase/)
  assert.equal(money(r), 'USD 59.00')
  assert.equal(r.items[0].sku, '405.949.28')
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.ok(r.confidence >= 0.85)
})

test('SPA product page (nike.com) — price lives on a hasVariant child', async () => {
  const r = await detect('nike-product.html')
  assert.equal(r.title, "Nike Air Force 1 '07 Men's Shoes")
  assert.equal(money(r), 'USD 115.00')
  assert.equal(r.provenance.total_minor, 'json-ld')
})

test('indian retail (cardekho.com) — INR from a graph mixing Car, FAQPage and BreadcrumbList', async () => {
  const r = await detect('cardekho.html')
  assert.equal(r.title, 'Tata Nexon')
  assert.equal(r.currency, 'INR')
  assert.equal(money(r), 'INR 739990.00') // ₹7.40 Lakh ex-showroom
  assert.equal(r.provenance.total_minor, 'json-ld')
})

test('creative work (bandcamp) — Offer nested under albumRelease', async () => {
  const r = await detect('bandcamp.html')
  assert.equal(r.title, 'Monstercat Uncaged Vol. 1')
  assert.equal(money(r), 'USD 10.00')
  assert.equal(r.provenance.total_minor, 'json-ld')
})

test('search results page (craigslist) — 309 products, none of them "the" product', async () => {
  const r = await detect('craigslist.html')
  // It still returns something usable, because picking the first listing and
  // saying so beats refusing outright. But it must not sound confident.
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.ok(r.total_minor > 0)
  assert.ok(r.confidence <= 0.65, `a coin flip between 309 listings must not read as confident, got ${r.confidence}`)
  assert.match(r.warnings.join(' '), /describes \d+ products — picked the first one/)
})

test('no structured data at all (berkeley.edu) — DOM heuristic, honestly labelled', async () => {
  const r = await detect('berkeley-coa.html')
  assert.equal(r.provenance.total_minor, 'dom-total')
  assert.ok(r.strategy.includes('dom-total'))
  assert.equal(r.currency, 'USD')
  assert.ok(r.total_minor > 0)
  // This is a scrape. It must never claim to be sure.
  assert.ok(r.confidence <= 0.5, `DOM scraping must stay low confidence, got ${r.confidence}`)
  assert.ok(
    r.warnings.some((w) => /read off the page text/.test(w)),
    'the UI needs a warning it can show verbatim',
  )
  assert.match(r.warnings.join(' '), /Total/i)
})

test('negative control (wikipedia) — prose about money is not a cart', async () => {
  const r = await detect('wikipedia-negative.html')
  assert.equal(r.total_minor, null, `must not price an encyclopedia article (got ${r.total_minor})`)
  assert.equal(r.items.length, 0)
  assert.ok(r.confidence < 0.2, `confidence should be near zero, got ${r.confidence}`)
  // It still identifies the page, which is what the "nothing found" UI shows.
  assert.equal(r.title, 'Movie theater - Wikipedia')
  assert.equal(r.merchant.name, 'Wikipedia')
})

// =====================================================================
// Strategies that need a live browser — driven with real payload shapes
// =====================================================================

test('shopify /cart.js outranks the page markup and brings quantities', async () => {
  // Verbatim shape of a Shopify Ajax API cart response.
  const cartJson = {
    token: 'c1-abc',
    item_count: 3,
    currency: 'USD',
    total_price: 9800,
    items: [
      {
        id: 4111, quantity: 2, variant_id: 4111, key: '4111:aa',
        title: 'Wool Runner - Natural Black', product_title: 'Wool Runner',
        variant_title: 'Natural Black / 10', price: 3900, final_price: 3900,
        line_price: 7800, sku: 'WR-NB-10',
      },
      {
        id: 4222, quantity: 1, variant_id: 4222, key: '4222:bb',
        title: 'Trino Sock', product_title: 'Trino Sock',
        variant_title: 'Default Title', price: 2000, final_price: 2000,
        line_price: 2000, sku: 'TS-1',
      },
    ],
  }
  const calls = []
  const fetchStub = async (url) => {
    calls.push(url)
    return { ok: true, json: async () => cartJson }
  }
  const r = await detect('shopify-allbirds-product.html', { fetch: fetchStub })

  assert.deepEqual(calls, ['https://www.allbirds.com/cart.js'])
  assert.equal(r.provenance.total_minor, 'shopify-cart')
  assert.equal(money(r), 'USD 98.00')
  assert.equal(r.items.length, 2)
  assert.equal(r.items[0].name, 'Wool Runner — Natural Black / 10')
  assert.equal(r.items[0].qty, 2)
  assert.equal(r.items[0].unit_amount, 3900)
  assert.equal(r.items[1].name, 'Trino Sock') // "Default Title" variant is not appended
  assert.ok(r.confidence >= 0.95, `the real cart is the strongest signal, got ${r.confidence}`)
  assert.equal(r.strategy[0], 'shopify-cart')
})

test('an empty shopify cart falls back to the product on the page', async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ item_count: 0, items: [], total_price: 0 }) })
  const r = await detect('shopify-allbirds-product.html', { fetch: fetchStub })
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.equal(money(r), 'USD 25.00')
})

test('a dead /cart.js never breaks detection', async () => {
  const boom = async () => { throw new Error('network down') }
  const r = await detect('shopify-allbirds-product.html', { fetch: boom })
  assert.equal(money(r), 'USD 25.00')
})

test('highlighted text wins — this is how you fix a bad detection by hand', async () => {
  const r = await detect('berkeley-coa.html', { selectionText: 'Housing deposit $1,250.00' })
  assert.equal(r.provenance.total_minor, 'selection')
  assert.equal(money(r), 'USD 1250.00')
  assert.equal(r.items[0].name, 'Housing deposit')
  assert.ok(r.warnings.some((w) => /highlighted/.test(w)))
})

test('highlighting a price on a JSON-LD page still overrides it', async () => {
  const r = await detect('ikea-product.html', { selectionText: '$118.00' })
  assert.equal(r.provenance.total_minor, 'selection')
  assert.equal(money(r), 'USD 118.00')
  assert.equal(r.title, 'BILLY Bookcase - blue 15 3/4x11x79 1/2 "') // title still from JSON-LD
})

// =====================================================================
// Synthetic markup for shapes the captured pages happen not to contain
// =====================================================================

function synth(html, url = 'https://tickets.example.com/checkout') {
  const { document, window } = parseHTML(html)
  return D.detectCart(document, new URL(url), { win: window, fetch: null, selectionText: '' })
}

test('JSON-LD Order with orderedItem lines', async () => {
  const r = await synth(`<html lang="en"><head><title>Your order</title>
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Order',
      orderNumber: 'A-1042',
      seller: { '@type': 'Organization', name: 'Velvet Ticket Co.' },
      totalPaymentDue: { '@type': 'MonetaryAmount', price: '180.00', priceCurrency: 'USD' },
      orderedItem: [
        { '@type': 'OrderItem', orderQuantity: 4, orderedItem: { '@type': 'Product', name: 'GA ticket', sku: 'GA' },
          acceptedOffer: { '@type': 'Offer', price: '45.00', priceCurrency: 'USD' } },
      ],
    })}</script></head><body></body></html>`)
  assert.equal(r.provenance.total_minor, 'json-ld')
  assert.equal(money(r), 'USD 180.00')
  assert.equal(r.items[0].name, 'GA ticket')
  assert.equal(r.items[0].qty, 4)
  assert.equal(r.items[0].unit_amount, 4500)
  assert.equal(r.merchant.name, 'Velvet Ticket Co.')
  assert.ok(r.confidence >= 0.9)
})

test('JSON-LD @graph with a nested @type array', async () => {
  const r = await synth(`<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Shop' },
      { '@type': ['Product', 'IndividualProduct'], name: 'Deep Dish', offers: { '@type': 'Offer', price: 32, priceCurrency: 'USD' } },
    ],
  })}</script></head><body></body></html>`)
  assert.equal(r.title, 'Deep Dish')
  assert.equal(money(r), 'USD 32.00')
})

test('microdata Product', async () => {
  const r = await synth(`<html><body>
    <div itemscope itemtype="http://schema.org/Product">
      <h1 itemprop="name">Sunday Matinee — Row F</h1>
      <img itemprop="image" src="/seat.jpg">
      <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
        <meta itemprop="priceCurrency" content="GBP">
        <span itemprop="price" content="18.50">£18.50</span>
        <link itemprop="availability" href="http://schema.org/InStock">
      </div>
    </div></body></html>`, 'https://cinema.example.co.uk/book')
  assert.equal(r.provenance.total_minor, 'microdata')
  assert.equal(r.title, 'Sunday Matinee — Row F')
  assert.equal(money(r), 'GBP 18.50')
  assert.ok(r.confidence >= 0.7 && r.confidence < 0.9)
})

test('DOM heuristic: grand total beats subtotal on a checkout page', async () => {
  const r = await synth(`<html lang="en"><head><title>Checkout · Reel Cinema</title></head><body>
    <table><tbody>
      <tr><td>Subtotal</td><td>$36.00</td></tr>
      <tr><td>Booking fee</td><td>$4.50</td></tr>
      <tr class="order-total"><td>Grand total</td><td>$40.50</td></tr>
    </tbody></table></body></html>`)
  assert.equal(r.provenance.total_minor, 'dom-total')
  assert.equal(money(r), 'USD 40.50')
  assert.match(r.warnings.join(' '), /Grand total/i)
  assert.ok(r.confidence <= 0.5)
})

test('DOM heuristic: subtotal alone is not good enough to return', async () => {
  const r = await synth(`<html><body><div><span>Subtotal</span><span>$36.00</span></div></body></html>`)
  assert.equal(r.total_minor, null)
})

test('currency inference from <html lang> when the page never says so', async () => {
  const r = await synth(`<html lang="en-IN"><head><title>Cart</title></head><body>
    <div class="totals"><span>Order total</span><span>1,299</span><span>₹1,299</span></div></body></html>`,
  'https://kart.example.in/cart')
  assert.equal(r.currency, 'INR')
  assert.equal(money(r), 'INR 1299.00')
})

test('currency inference from the TLD, flagged as a guess', async () => {
  const r = await synth(`<html><head><title>Basket</title></head><body>
    <div><span>Total to pay</span><span>49,99</span></div></body></html>`, 'https://shop.example.de/basket')
  // No symbol anywhere: we refuse rather than guess a number out of "49,99".
  assert.equal(r.total_minor, null)
  assert.equal(r.currency, 'EUR')
  assert.equal(r.provenance.currency, 'tld')
})

test('never throws, whatever it is handed', async () => {
  const weird = [
    '<html><body></body></html>',
    '<html><head><script type="application/ld+json">{ not json </script></head><body>Total: $5</body></html>',
    '<html><head><script type="application/ld+json">null</script></head><body></body></html>',
    '<html><body><div itemscope itemtype="http://schema.org/Product"></div></body></html>',
  ]
  for (const html of weird) {
    const r = await synth(html)
    assert.ok(r && typeof r.confidence === 'number')
    assert.ok(Array.isArray(r.strategy) && Array.isArray(r.warnings))
    assert.ok(r.total_minor === null || Number.isInteger(r.total_minor))
  }
})

test('every result is shaped the way the widget and the engine expect', async () => {
  for (const f of SOURCES.fixtures) {
    const r = await detect(f.file)
    assert.equal(typeof r.title, 'string', `${f.file}: title`)
    assert.equal(typeof r.currency, 'string')
    assert.equal(r.currency.length, 3, `${f.file}: currency must be ISO 4217`)
    assert.ok(r.merchant && typeof r.merchant.name === 'string' && r.merchant.domain)
    assert.ok(Array.isArray(r.items) && Array.isArray(r.fees))
    for (const it of r.items) {
      assert.ok(Number.isInteger(it.unit_amount), `${f.file}: unit_amount must be integer minor units`)
      assert.ok(Number.isInteger(it.qty) && it.qty > 0)
      assert.equal(typeof it.name, 'string')
    }
    assert.ok(r.total_minor === null || Number.isInteger(r.total_minor), `${f.file}: total_minor`)
    assert.ok(r.confidence > 0 && r.confidence <= 1)
    assert.ok(Array.isArray(r.strategy))
    assert.equal(r.page_url, urlOf(f.file))
  }
})

// =====================================================================
// The detector is inlined into widget.js and copied into the extension.
// If those copies drift, the browser runs code these tests never saw.
// =====================================================================

test('widget.js and extension/detect.js carry the same detector as detect.js', () => {
  const source = readFileSync(join(here, 'detect.js'), 'utf8')
  const widget = readFileSync(join(here, 'widget.js'), 'utf8')
  const begin = '/* >>> BEGIN INLINED widget/detect.js'
  const end = '/* <<< END INLINED widget/detect.js'
  const i = widget.indexOf(begin)
  const j = widget.indexOf(end)
  assert.ok(i !== -1 && j !== -1, 'widget.js is missing the inlined detector markers')
  const inlined = widget.slice(widget.indexOf('\n', i) + 1, j)
  assert.equal(
    inlined.trim(),
    source.trim(),
    'widget.js is stale — run `node widget/build-bookmarklet.mjs`',
  )

  const ext = readFileSync(join(here, '..', 'extension', 'detect.js'), 'utf8')
  assert.equal(ext.trim(), source.trim(), 'extension/detect.js is stale — run `node widget/build-bookmarklet.mjs`')
})
