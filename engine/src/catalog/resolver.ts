import { createHash } from 'node:crypto'
import { FetchRefused, assertHttps, safeFetch } from './fetcher.js'
import {
  absoluteUrl,
  collectNodes,
  extractJsonLd,
  metaContent,
  microdata,
  parseAvailability,
  parseMoney,
  stripTags,
  titleTag,
} from './parse.js'
import type { Money, ProductDetail, ResolveResult, Variant } from './types.js'
export type { Money }

// Universal product resolver.
//
// Strategies run in confidence order and the first complete answer wins;
// later strategies still backfill missing fields. Every strategy is generic —
// there is no per-merchant branch anywhere in this file, which is what makes
// "any marketplace" true rather than a slogan.

type Strategy = (ctx: Ctx) => Promise<Partial<ProductDetail> | null>

interface Ctx {
  url: URL
  html: string
  pageUrl: string
  warnings: string[]
  signal?: AbortSignal
}

export async function resolveProductUrl(raw: string, signal?: AbortSignal): Promise<ResolveResult> {
  const warnings: string[] = []
  let url: URL
  try {
    url = assertHttps(raw)
  } catch (e) {
    return { product: null, strategy: 'none', warnings: [(e as Error).message] }
  }

  // Shopify storefronts answer with exact JSON — try that before parsing HTML.
  const shopify = await tryShopifyJson(url, signal, warnings)
  if (shopify) return { product: shopify, strategy: 'shopify-json', warnings }

  let page
  try {
    page = await safeFetch(url.toString(), { signal })
  } catch (e) {
    const msg = e instanceof FetchRefused ? e.message : `could not load the page (${(e as Error).message})`
    return { product: null, strategy: 'none', warnings: [msg] }
  }
  if (page.status >= 400) {
    return { product: null, strategy: 'none', warnings: [`the merchant returned ${page.status} for that URL`] }
  }

  const ctx: Ctx = { url, html: page.body, pageUrl: page.url, warnings, signal }

  // A category, search or collection page will happily yield *a* title and
  // *a* price — belonging to some other product. Refusing is the only safe
  // answer: a confidently wrong price is worse than no answer in a payments
  // flow. Note we test the FINAL url, since stale product links often 301
  // onto a collection.
  const kind = classifyPage(ctx)
  if (kind === 'collection') {
    return {
      product: null,
      strategy: 'rejected-collection',
      warnings: [
        ...warnings,
        'that link is a category or search page, not a single item — open the product you want and paste its URL',
      ],
    }
  }

  const strategies: [string, Strategy][] = [
    ['json-ld', fromJsonLd],
    ['open-graph', fromOpenGraph],
    ['microdata', fromMicrodata],
    ['heuristic', fromHeuristics],
  ]

  let merged: Partial<ProductDetail> = {}
  let winner = 'none'
  for (const [name, run] of strategies) {
    let part: Partial<ProductDetail> | null = null
    try {
      part = await run(ctx)
    } catch {
      /* a broken strategy must never sink the resolve */
    }
    if (!part) continue
    if (winner === 'none' && part.price) winner = name
    merged = backfill(merged, part)
    if (merged.title && merged.price) break
  }

  if (!merged.title) {
    return {
      product: null,
      strategy: winner,
      warnings: [...warnings, 'no product markup found on that page — paste the item page URL, not a search or category page'],
    }
  }
  if (!merged.price) {
    warnings.push('the merchant did not publish a machine-readable price — enter it yourself before inviting the group')
  }

  return { product: finalize(merged, ctx), strategy: winner === 'none' ? 'title-only' : winner, warnings }
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** schema.org/Product in JSON-LD — the richest and most widely published. */
async function fromJsonLd(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const blocks = extractJsonLd(ctx.html)
  const nodes = collectNodes(blocks, ['Product', 'ProductGroup', 'Event', 'Movie', 'IndividualProduct'])
  if (nodes.length === 0) return null

  // Prefer the node with an offer; a page often also carries Organization etc.
  const node = nodes.find((n) => n['offers']) ?? nodes[0]!
  const offers = flattenOffers(node['offers'])
  const primary = offers[0]

  const variants: Variant[] = offers
    .map((o, i) => {
      const price = offerPrice(o)
      if (!price) return null
      return {
        id: String(o['sku'] ?? o['@id'] ?? `offer-${i}`),
        name: String(o['name'] ?? node['name'] ?? 'Standard'),
        price,
        available: parseAvailability(o['availability']),
      } satisfies Variant
    })
    .filter((v): v is Variant => v !== null)

  const images = toArray(node['image'])
    .map((i) => (typeof i === 'string' ? i : (i as Record<string, unknown>)?.['url']))
    .filter((x): x is string => typeof x === 'string')

  const ratingNode = node['aggregateRating'] as Record<string, unknown> | undefined
  const rating = ratingNode
    ? {
        value: Number(ratingNode['ratingValue'] ?? 0),
        count: Number(ratingNode['reviewCount'] ?? ratingNode['ratingCount'] ?? 0),
      }
    : undefined

  // Stores commonly publish one offer per size. The product is buyable if ANY
  // of them is — judging by offers[0] alone marks live items as sold out.
  const anyAvailable = offers.length > 0 ? offers.some((o) => parseAvailability(o['availability'])) : true
  // Quote the cheapest available offer, so the price shown is one a member can
  // actually be charged.
  const buyable = variants.filter((v) => v.available)
  const headline = (buyable.length ? buyable : variants).reduce<Money | undefined>(
    (min, v) => (!min || v.price.amount_minor < min.amount_minor ? v.price : min),
    undefined,
  )

  return {
    title: str(node['name']),
    description: node['description'] ? stripTags(String(node['description'])) : undefined,
    price: headline ?? (primary ? offerPrice(primary) ?? undefined : undefined),
    brand: str(brandName(node['brand'])),
    images,
    variants,
    in_stock: anyAvailable,
    rating: rating && rating.value > 0 ? rating : undefined,
    attributes: pickAttributes(node),
  }
}

/** OpenGraph / product meta tags — what social scrapers read. */
async function fromOpenGraph(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const title = metaContent(ctx.html, 'og:title', 'twitter:title')
  const amount = metaContent(
    ctx.html,
    'product:price:amount', 'og:price:amount', 'twitter:data1', 'product:sale_price:amount',
  )
  const currency = metaContent(ctx.html, 'product:price:currency', 'og:price:currency', 'product:sale_price:currency')
  if (!title && !amount) return null

  const price = amount ? parseMoney(amount, currency ?? 'USD') : null
  return {
    title,
    description: metaContent(ctx.html, 'og:description', 'description', 'twitter:description'),
    price: price ?? undefined,
    images: [metaContent(ctx.html, 'og:image', 'og:image:secure_url', 'twitter:image')].filter(
      (x): x is string => !!x,
    ),
    in_stock: parseAvailability(metaContent(ctx.html, 'product:availability', 'og:availability')),
    brand: metaContent(ctx.html, 'product:brand', 'og:brand'),
  }
}

/** schema.org microdata attributes sprinkled through the markup. */
async function fromMicrodata(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const name = microdata(ctx.html, 'name')
  const priceRaw = microdata(ctx.html, 'price') ?? microdata(ctx.html, 'lowPrice')
  const currency = microdata(ctx.html, 'priceCurrency')
  if (!name && !priceRaw) return null
  return {
    title: name,
    price: priceRaw ? parseMoney(priceRaw, currency ?? 'USD') ?? undefined : undefined,
    description: microdata(ctx.html, 'description'),
    images: [microdata(ctx.html, 'image')].filter((x): x is string => !!x),
    in_stock: parseAvailability(microdata(ctx.html, 'availability')),
  }
}

/**
 * Last resort: the <title>, and a currency-anchored price — but the price is
 * only taken when the page actually declares itself a product. Scraping an
 * amount off arbitrary markup is how you charge a group for the wrong thing.
 */
async function fromHeuristics(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const title = titleTag(ctx.html)
  if (classifyPage(ctx) !== 'product') return { title }

  const m = /(?:[$₹€£¥]|USD|EUR|GBP|INR|AUD|CAD)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/i.exec(
    ctx.html.replace(/<script[\s\S]*?<\/script>/gi, ' '),
  )
  const price = m ? parseMoney(m[0]) : null
  if (price) ctx.warnings.push('price was read from page text, not structured data — confirm it before inviting anyone')
  return { title, price: price ?? undefined }
}

/**
 * What kind of page is this? Decided from what the merchant itself declares:
 * a Product node or og:type=product means item page; a CollectionPage /
 * SearchResultsPage / ItemList with no Product means listing.
 */
export function classifyPage(ctx: { html: string; pageUrl: string }): 'product' | 'collection' | 'unknown' {
  const blocks = extractJsonLd(ctx.html)
  if (collectNodes(blocks, ['Product', 'ProductGroup', 'IndividualProduct']).length > 0) return 'product'

  const ogType = metaContent(ctx.html, 'og:type')?.toLowerCase()
  if (ogType === 'product' || ogType === 'product.item') return 'product'

  const listing = collectNodes(blocks, ['CollectionPage', 'SearchResultsPage', 'ItemList', 'OfferCatalog'])
  if (listing.length > 0) return 'collection'

  // Path shape is weak evidence, so it only decides when nothing else did.
  if (/\/(collections|category|categories|search|shop|c)\/[^/]+\/?$/.test(new URL(ctx.pageUrl).pathname)) {
    return 'collection'
  }
  return 'unknown'
}

/** Every Shopify storefront serves the exact product JSON at <path>.js */
async function tryShopifyJson(
  url: URL,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<ProductDetail | null> {
  const m = /\/products\/([^/?#]+)/.exec(url.pathname)
  if (!m) return null
  const jsonUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}.js`

  try {
    const res = await safeFetch(jsonUrl, { accept: 'application/json', signal })
    if (res.status >= 400 || !res.contentType.includes('json')) return null
    const p = JSON.parse(res.body) as ShopifyProduct
    if (!p?.title || !Array.isArray(p.variants)) return null

    const currency = 'USD' // Shopify .js reports cents in the store's currency
    const variants: Variant[] = p.variants.map((v) => ({
      id: String(v.id),
      name: v.title === 'Default Title' ? p.title : v.title,
      price: { amount_minor: Math.round(v.price), currency },
      available: v.available !== false,
      options: zipOptions(p.options, v.options),
    }))
    const first = variants.find((v) => v.available) ?? variants[0]
    if (!first) return null

    const images = (p.images ?? []).map((i) => absoluteUrl(i, url.origin)).filter((x): x is string => !!x)
    return {
      id: productId('shopify', `${url.hostname}/${m[1]}`),
      title: p.title,
      subtitle: p.vendor,
      price: first.price,
      unit_label: 'each',
      merchant: merchantFrom(url, p.vendor),
      image_url: images[0],
      images,
      product_url: url.toString(),
      brand: p.vendor,
      in_stock: variants.some((v) => v.available),
      source: 'shopify',
      description: p.description ? stripTags(p.description) : undefined,
      variants,
      fine_print: [],
      attributes: p.type ? { Type: p.type } : undefined,
    }
  } catch {
    warnings.push('this looked like a Shopify URL but the JSON endpoint did not answer — falling back to page parsing')
    return null
  }
}

interface ShopifyProduct {
  title: string
  vendor?: string
  type?: string
  description?: string
  images?: string[]
  options?: (string | { name: string })[]
  variants: { id: number | string; title: string; price: number; available?: boolean; options?: string[] }[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finalize(p: Partial<ProductDetail>, ctx: Ctx): ProductDetail {
  const images = dedupe(
    (p.images ?? []).map((i) => absoluteUrl(i, ctx.pageUrl)).filter((x): x is string => !!x),
  )
  const price: Money = p.price ?? { amount_minor: 0, currency: 'USD' }
  const variants =
    p.variants && p.variants.length > 0
      ? p.variants
      : [{ id: 'default', name: p.title ?? 'Item', price, available: p.in_stock !== false }]

  return {
    id: productId('url', ctx.pageUrl),
    title: (p.title ?? 'Untitled item').slice(0, 160),
    subtitle: p.brand,
    price,
    unit_label: 'each',
    merchant: merchantFrom(ctx.url, p.brand),
    image_url: images[0],
    images,
    product_url: ctx.pageUrl,
    brand: p.brand,
    rating: p.rating,
    in_stock: p.in_stock !== false,
    source: 'url',
    description: p.description,
    variants,
    fine_print: [],
    attributes: p.attributes,
  }
}

/** Fill blanks only — an earlier, higher-confidence strategy always wins. */
function backfill(base: Partial<ProductDetail>, extra: Partial<ProductDetail>): Partial<ProductDetail> {
  const out: Partial<ProductDetail> = { ...base }
  for (const [k, v] of Object.entries(extra) as [keyof ProductDetail, unknown][]) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    const current = out[k]
    if (current === undefined || current === null || (Array.isArray(current) && current.length === 0)) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

export function merchantFrom(url: URL, brand?: string): ProductDetail['merchant'] {
  const domain = url.hostname.replace(/^www\./, '')
  const guess = domain.split('.')[0] ?? domain
  return {
    name: brand || guess.charAt(0).toUpperCase() + guess.slice(1),
    url: `${url.protocol}//${url.hostname}`,
    country_code_iso2: 'US',
    domain,
  }
}

export function productId(prefix: string, seed: string): string {
  return `${prefix}:${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
}

function flattenOffers(offers: unknown): Record<string, unknown>[] {
  const list = toArray(offers)
  const out: Record<string, unknown>[] = []
  for (const o of list) {
    if (!o || typeof o !== 'object') continue
    const node = o as Record<string, unknown>
    const type = String(node['@type'] ?? '')
    if (type === 'AggregateOffer') {
      const nested = toArray(node['offers'])
      if (nested.length) {
        out.push(...(nested as Record<string, unknown>[]))
        continue
      }
      out.push({ ...node, price: node['lowPrice'] ?? node['highPrice'] })
      continue
    }
    out.push(node)
  }
  return out
}

function offerPrice(offer: Record<string, unknown>): Money | null {
  const spec = offer['priceSpecification'] as Record<string, unknown> | undefined
  const raw = offer['price'] ?? spec?.['price'] ?? offer['lowPrice']
  const currency = String(offer['priceCurrency'] ?? spec?.['priceCurrency'] ?? 'USD')
  return parseMoney(raw, currency)
}

function brandName(brand: unknown): string | undefined {
  if (!brand) return undefined
  if (typeof brand === 'string') return brand
  const b = brand as Record<string, unknown>
  return b['name'] ? String(b['name']) : undefined
}

function pickAttributes(node: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const key of ['color', 'material', 'size', 'model', 'sku', 'gtin13', 'category']) {
    const v = node[key]
    if (typeof v === 'string' && v.length < 80) out[key.toUpperCase() === key ? key : cap(key)] = v
  }
  return Object.keys(out).length ? out : undefined
}

function zipOptions(names: (string | { name: string })[] | undefined, values: string[] | undefined) {
  if (!names || !values) return undefined
  const out: Record<string, string> = {}
  names.forEach((n, i) => {
    const key = typeof n === 'string' ? n : n.name
    if (values[i]) out[key] = values[i]!
  })
  return Object.keys(out).length ? out : undefined
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const dedupe = <T,>(a: T[]) => [...new Set(a)]
