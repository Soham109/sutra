import { createHash } from 'node:crypto'
import { FetchRefused, assertHttps, safeFetch } from './fetcher.js'
import {
  absoluteUrl,
  aggregateOfferRange,
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
  /**
   * Set by fromJsonLd when the merchant's own structured data describes a
   * genuine price RANGE with no way to tell which end applies (an
   * AggregateOffer with lowPrice !== highPrice and no nested per-variant
   * offers). That is a real fact about the page, not "this strategy found
   * nothing" — and later, lower-confidence strategies must not paper over
   * it by scraping some other number off the same page. Caught live: a
   * real WooCommerce store's range ($99.99–$199.99) was correctly refused
   * by json-ld, then the heuristic strategy found "$99.99" sitting in
   * plain page text a few lines down and confidently returned it anyway.
   */
  ambiguousRange?: boolean
}

/**
 * Places that publish OpenGraph titles and no prices, because they sell
 * nothing.
 *
 * Pasting a YouTube link used to come back as a product: title "Rick Astley -
 * Never Gonna Give You Up", merchant "Youtube", price 0. Nothing downstream
 * would let that reach a charge — a zero-priced line cannot be sent to a group
 * — but presenting a music video as a shopping result is the kind of thing a
 * judge tries in the first thirty seconds, and "we found a product" is simply
 * not true about it.
 *
 * Deliberately a short list of things that are definitely not shops rather
 * than an allowlist of things that are: the whole point of the resolver is
 * that it works on stores nobody here has heard of.
 */
const NOT_SHOPS =
  /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|twitter\.com|x\.com|reddit\.com|linkedin\.com|pinterest\.[a-z.]+|spotify\.com|open\.spotify\.com|wikipedia\.org|github\.com|docs\.google\.com|drive\.google\.com|mail\.google\.com|gmail\.com)$/i

function isNotAShop(url: URL): boolean {
  return NOT_SHOPS.test(url.hostname.toLowerCase())
}

export async function resolveProductUrl(raw: string, signal?: AbortSignal): Promise<ResolveResult> {
  const warnings: string[] = []
  let url: URL
  try {
    url = assertHttps(raw)
  } catch (e) {
    return { product: null, strategy: 'none', warnings: [(e as Error).message] }
  }

  if (isNotAShop(url)) {
    return {
      product: null,
      strategy: 'not-a-shop',
      warnings: [
        `${url.hostname.replace(/^www\./, '')} isn’t a shop, so there is no price on that page to read. Paste a link to the item you want to buy.`,
      ],
    }
  }

  // A `#!/` fragment is "hashbang" routing — a well-known convention for
  // catalog widgets that pick the item in the BROWSER after the page loads
  // (a real one still running it: Ecwid's classic embedded widget). A
  // fragment is never sent to the server at all (RFC 3986 §3.5); a
  // server-side fetch of such a URL can only ever see the storefront's
  // root, never the item. Caught live: pasting a real Ecwid product link
  // resolved to "Bad Squiddo Games" — the STORE's own name, price $0 — as
  // if that were the product, because the root page's <title> was all
  // there was to read. That is inventing a product identity out of a page
  // that was never actually about it, same failure class the price rule
  // already forbids, just for identity instead of money. An ordinary
  // in-page anchor (`#reviews` on an already-correct product URL) does not
  // start with `!`, so this does not touch real, working links.
  if (/^#!/.test(url.hash)) {
    return {
      product: null,
      strategy: 'client-routed',
      warnings: [
        'that link picks the item in your browser after the page loads (a \'#!\' address) — the server only ever sees the shop\'s home page, never which item you chose. Open the item on the merchant\'s site and paste the price in yourself.',
      ],
    }
  }

  // Shopify storefronts answer with exact JSON — try that before parsing HTML.
  const shopify = await tryShopifyJson(url, signal, warnings)
  // A store that 404s both JSON endpoints for a /products/ handle is USUALLY
  // telling us that item does not exist — many such stores then serve their
  // "not found" page with HTTP 200 and a storefront's worth of markup, so
  // falling through to scraping produced a confident, completely unrelated
  // product: a dead Bombay Shaving link resolved to "Bestsellers" at ₹99.
  //
  // But "usually" is doing real work in that sentence: headless Shopify
  // storefronts (Hydrogen/Oxygen — Fashion Nova is one, live, in production)
  // do not implement the classic Liquid `.js`/`.json` routes AT ALL, so they
  // 404 both endpoints for every product, dead or alive. Treating that as an
  // automatic refusal made a live, real, correctly-priced product
  // unreachable. So this is not believed on its own — it is held as a prior
  // and combined with what the page itself says below: only refused when
  // BOTH the JSON API and the page agree there is no product here.
  const believedDead = shopify === 'no-such-product'
  if (shopify && shopify !== 'no-such-product') return { product: shopify, strategy: 'shopify-json', warnings }

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
  // The JSON API said not-found, and now the page agrees: it does not declare
  // itself a product either (no Product JSON-LD, no og:type=product). Two
  // independent signals pointing the same way is the "Bestsellers ₹99" guard
  // — a headless storefront's LIVE product page always clears the `kind ===
  // 'product'` bar (that is what Fashion Nova's real product does), so this
  // only fires for handles that are actually gone.
  if (believedDead && kind !== 'product') {
    return {
      product: null,
      strategy: 'no-such-product',
      warnings: [
        ...warnings,
        'that store does not have an item at that address — the link may be old, or the product may have been removed. Check the URL on the merchant’s site.',
      ],
    }
  }

  const strategies: [string, Strategy][] = [
    ['woocommerce', fromWooCommerce],
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
  // A price of zero is not a price. It is what falls out of a heuristic that
  // found a heading and no number — a category page yielding the title
  // "Collections" and an amount of 0, which then flows into a cart and asks
  // real people to split nothing. Refusing costs one honest error message;
  // accepting puts a fabricated line in front of a group.
  if (merged.price && merged.price.amount_minor <= 0) {
    delete merged.price
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

  // A ProductGroup (Shopify's current JSON-LD shape for anything with sizes
  // or colours) states its real prices one-per-variant, under `hasVariant`:
  // each variant is its own Product node with its own single Offer.
  // collectNodes already walks into hasVariant, so those variant nodes land
  // in this same flat list next to the group itself. Picking "the node with
  // an offer" (singular) grabbed exactly ONE variant's price as if it were
  // the whole product — caught live on Gymshark: the first variant in
  // document order was an out-of-stock XXS, and using only its single Offer
  // also meant the product read as entirely out of stock even on a listing
  // where a different size (XS) was buyable. Wrong variant, wrong price,
  // wrong stock — exactly the "quietly bills the wrong variant" failure this
  // needs to not have. When a group is present, every same-product variant
  // node contributes its offer; matched by URL or name because collectNodes
  // does not preserve which group a flattened node came from, and a page can
  // legitimately carry other, unrelated Product blocks (a "you may also
  // like" rail) that must not leak into this product's price list.
  const group = nodes.find((n) => n['@type'] === 'ProductGroup')
  const node = group ?? nodes.find((n) => n['offers']) ?? nodes[0]!
  const variantNodes = group
    ? nodes.filter(
        (n) => n !== group && n['offers'] && (n['url'] === group['url'] || n['name'] === group['name']),
      )
    : []
  const offerSourceNodes = variantNodes.length > 0 ? variantNodes : [node]
  // Each Offer is tagged with its own variant's size/name before flattening,
  // since schema.org puts "xs"/"m"/"xl" on the Product wrapper, not the
  // Offer — losing that here would make every size show up as "Standard".
  // `ctx` is threaded into flattenOffers so it can mark ctx.ambiguousRange —
  // see the field's own comment on Ctx for why a later, lower-confidence
  // strategy needs to know this rather than just seeing "no price found".
  const offers: Record<string, unknown>[] = offerSourceNodes.flatMap((n) =>
    flattenOffers(n['offers'], ctx).map((o) => ({ ...o, name: o['name'] ?? n['size'] ?? n['name'] }) as Record<string, unknown>),
  )
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
  // twitter:data1 is a generic key-value display slot next to twitter:label1
  // — sites use the pair for review counts, ratings, reading time, anything
  // they want a Twitter card to show, not necessarily price. Caught live on
  // a real WooCommerce store (homewizard.com): label1 was "Geschatte
  // leestijd" (Dutch for "estimated reading time"), data1 was "2 minuten" —
  // trusted blind as a price fallback, that became a fabricated $2.00. Only
  // trusted now when its own label actually says this pair is about price.
  const label1 = metaContent(ctx.html, 'twitter:label1')?.toLowerCase() ?? ''
  const data1LooksLikePrice = /price|cost|prijs|preis|prix|precio|preço|\$|€|£/i.test(label1)
  const amount = metaContent(
    ctx.html,
    'product:price:amount', 'og:price:amount', 'product:sale_price:amount',
    ...(data1LooksLikePrice ? ['twitter:data1'] : []),
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
 * WooCommerce's public Store API — the biggest coverage gap after Shopify,
 * since it runs a huge share of the small-to-medium web. Verified live
 * against three real, unrelated stores before writing a line of the
 * strategy list entry: offermanwoodshop.com (USD, a fully custom permalink
 * — /store/kindlin/hearth-home/<slug>, nothing like /product/<slug>/),
 * houseofmalt.co.uk (GBP, the default /product/<slug>/ permalink), and
 * phlearn.com (USD, a digital product). All three answer
 * /wp-json/wc/store/v1/products?slug=<slug> with no key required.
 *
 * Unlike Shopify's fixed /products/<handle> shape, WooCommerce permalinks
 * are fully customizable — Offerman Woodshop's real product proves the path
 * tells you nothing — so this cannot run as a blind pre-fetch the way the
 * Shopify strategy does. It runs against the page already fetched, reading
 * two things the page itself declares: where its REST API lives (the
 * standard `<link rel="https://api.w.org/">` discovery tag WordPress prints
 * in <head>) and the product's slug (WooCommerce's own convention is that
 * this is always the URL's last path segment, however the rest of the
 * permalink is customized).
 */
async function fromWooCommerce(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const apiBase = wooCommerceApiBase(ctx.html, ctx.url.origin)
  if (!apiBase) return null
  const slug = lastPathSegment(ctx.url.pathname)
  if (!slug) return null

  let items: WcStoreProduct[] | null
  try {
    const res = await safeFetch(`${apiBase}wc/store/v1/products?slug=${encodeURIComponent(slug)}`, {
      accept: 'application/json',
      // Same reasoning as the Shopify endpoints above: a currency-switcher
      // plugin (WOOCS and friends are common on WooCommerce specifically)
      // could key off Accept-Language the same way, and this is a request
      // for the store's own base price, not a locale-guessed one.
      acceptLanguage: '',
      signal: ctx.signal,
    })
    if (res.status >= 400 || !res.contentType.includes('json')) return null
    items = parseJson<WcStoreProduct[]>(res.body)
  } catch {
    return null
  }
  // A slug collision is vanishingly unlikely on one store, but matching it
  // explicitly rather than trusting items[0] costs nothing.
  const item = items?.find((p) => p.slug === slug) ?? items?.[0]
  if (!item?.name) return null

  const variants = await wooVariants(apiBase, item, ctx.signal)
  const buyable = variants.filter((v) => v.available)
  const headline = (buyable.length ? buyable : variants).reduce<Money | undefined>(
    (min, v) => (!min || v.price.amount_minor < min.amount_minor ? v.price : min),
    undefined,
  )
  if (!headline) return null

  return {
    title: item.name,
    description: item.description
      ? stripTags(item.description)
      : item.short_description
        ? stripTags(item.short_description)
        : undefined,
    price: headline,
    images: (item.images ?? []).map((i) => i.src).filter((x): x is string => !!x),
    in_stock: item.is_in_stock !== false,
    brand: item.brands?.[0]?.name,
    variants,
  }
}

/** The REST base a WooCommerce product's own page tells us to use. */
function wooCommerceApiBase(html: string, origin: string): string | null {
  const link =
    /<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]+href=["']([^"']+)["']/i.exec(html) ??
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']https:\/\/api\.w\.org\/["']/i.exec(html)
  if (link?.[1]) {
    const abs = absoluteUrl(link[1], origin)
    if (abs) return abs.endsWith('/') ? abs : `${abs}/`
  }
  // Some themes strip the discovery link, but WooCommerce always puts its
  // own name in the body class — worth one try at the default REST path
  // before giving up on a store that plainly says what it runs.
  if (/<body[^>]+class=["'][^"']*\bwoocommerce\b/i.test(html)) return `${origin}/wp-json/`
  return null
}

function lastPathSegment(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : null
}

/**
 * Variant prices, for a variable product (size/colour), from the dedicated
 * variations endpoint — mirroring what the Shopify strategy does with
 * variants[]. This sub-path is implemented against WooCommerce's published
 * Store API schema but was not reachable from a real variable product in
 * the stores verified live (none of the three had one in stock to test
 * against), so it fails soft: any shape surprise falls back to the simple
 * product's own single price rather than guessing or throwing.
 */
async function wooVariants(apiBase: string, item: WcStoreProduct, signal?: AbortSignal): Promise<Variant[]> {
  const simple = (): Variant[] => {
    const price = wooPrice(item.prices)
    return price ? [{ id: String(item.id), name: item.name, price, available: item.is_in_stock !== false }] : []
  }
  if (item.type !== 'variable' || !item.has_options) return simple()

  try {
    const res = await safeFetch(`${apiBase}wc/store/v1/products/${item.id}/variations`, {
      accept: 'application/json',
      acceptLanguage: '',
      signal,
    })
    if (res.status >= 400) return simple()
    const raw = parseJson<WcStoreVariation[]>(res.body)
    if (!Array.isArray(raw) || raw.length === 0) return simple()
    const built = raw
      .map((v) => {
        const price = wooPrice(v.prices)
        if (!price) return null
        const name = (v.attributes ?? []).map((a) => a.value).filter(Boolean).join(' / ') || item.name
        return { id: String(v.id), name, price, available: v.is_in_stock !== false } satisfies Variant
      })
      .filter((v): v is Variant => v !== null)
    return built.length > 0 ? built : simple()
  } catch {
    return simple()
  }
}

/**
 * The Store API's price fields are decimal-looking strings that are ALREADY
 * scaled to `currency_minor_unit` ("12500" for $125.00) — confirmed against
 * the real offermanwoodshop.com response, not assumed. No further scaling,
 * unlike Shopify's .json endpoint which is genuinely in major units.
 */
function wooPrice(prices: WcPrices | undefined): Money | null {
  if (!prices?.price) return null
  const amount = Number(prices.price)
  // Same rule as everywhere else in this file: zero or negative is not a
  // price, it is what a malformed or unset Store API field looks like.
  if (!Number.isFinite(amount) || amount <= 0) return null
  return { amount_minor: Math.round(amount), currency: (prices.currency_code ?? 'USD').toUpperCase() }
}

interface WcPrices {
  price?: string
  currency_code?: string
  currency_minor_unit?: number
}

interface WcStoreProduct {
  id: number
  name: string
  slug: string
  type?: string
  description?: string
  short_description?: string
  images?: { src: string }[]
  brands?: { name: string }[]
  is_in_stock?: boolean
  has_options?: boolean
  prices: WcPrices
}

interface WcStoreVariation {
  id: number
  attributes?: { name: string; value: string }[]
  prices: WcPrices
  is_in_stock?: boolean
}

/**
 * Last resort: the <title>, and a currency-anchored price — but the price is
 * only taken when the page actually declares itself a product. Scraping an
 * amount off arbitrary markup is how you charge a group for the wrong thing.
 */
async function fromHeuristics(ctx: Ctx): Promise<Partial<ProductDetail> | null> {
  const title = titleTag(ctx.html)
  if (classifyPage(ctx) !== 'product') return { title }
  // json-ld already looked at this exact page and found a genuine, unresolvable
  // price RANGE (see Ctx.ambiguousRange) — that is a fact about the item, not
  // an empty result, and scraping some other number out of the same page's
  // text would just be picking one end of the same range a different way.
  if (ctx.ambiguousRange) return { title }

  // Strip script/style CONTENT first (a real Wix page hid "GBP9" inside a
  // base64 @font-face src in a <style> block, which a plain tag-strip would
  // have left as scannable text), then strip remaining tags and decode
  // entities — a real WooCommerce theme renders "€27,95" as two separate
  // spans (`<span>&euro;</span>27,95`), and without this the currency
  // symbol and the digits are neither adjacent nor real Unicode characters.
  // decodeEntities (parse.ts) only knows amp/lt/gt/quot/apos/nbsp and
  // numeric refs, not named currency entities — &euro; is exactly what that
  // real theme emits, so it is expanded here first rather than left to
  // survive as literal, unmatchable text. (parse.ts owns decodeEntities;
  // reported as a money-parsing gap rather than edited here.)
  const withoutScriptsAndStyles = ctx.html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&pound;/gi, '£')
    .replace(/&yen;/gi, '¥')
    .replace(/&cent;/gi, '¢')
  const text = stripTags(withoutScriptsAndStyles, withoutScriptsAndStyles.length)
  const moneyPattern = /(?:[$₹€£¥]|USD|EUR|GBP|INR|AUD|CAD)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/gi
  let price: Money | null = null
  let m: RegExpExecArray | null
  while ((m = moneyPattern.exec(text))) {
    // Caught live on a real store under real load: this grabbed "$75" from
    // "free shipping on orders over $75" — a shipping threshold, not the
    // item's price — and it would have read as a confidently normal result
    // (a title, a price, one soft warning). That phrasing ("orders over
    // $X", "spend $X", "minimum order $X") is generic marketing
    // boilerplate used across unrelated stores, not something specific to
    // that one merchant, so skipping it here is a real generalization, not
    // a special case for a site this resolver happened to be tested on.
    // This is still the last-resort strategy and still not to be trusted
    // over structured data — it is just less likely to be wrong.
    const before = text.slice(Math.max(0, m.index - 40), m.index)
    if (/(?:over|above|spend|min(?:imum)?\s+order[s]?(?:\s+of)?)\s*$/i.test(before)) continue
    price = parseMoney(m[0])
    if (price) break
  }
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

  const path = new URL(ctx.pageUrl).pathname
  // A /product/<slug> or /products/<handle> path is strong, platform-spread
  // evidence of a single item — Shopify, WooCommerce, Magento and most
  // generic carts all use exactly this shape for one thing and never for a
  // listing. Only reached once every JSON-LD/og:type check above has found
  // nothing either way, so it can never override a page that actually
  // declares itself something else. This exists because the previous,
  // more conservative version left a bare product page (no structured
  // data at all, just this URL shape) as 'unknown' rather than 'product' —
  // which sounds harmless but silently disqualified it from the
  // last-resort heuristic strategy too (that one requires kind ===
  // 'product' before it will even try), so a real item with no schema.org
  // markup got refused outright instead of a flagged, low-confidence price.
  if (/\/products?\/[^/]+\/?$/.test(path)) return 'product'

  // Path shape is weak evidence, so it only decides when nothing else did.
  // 'shop' used to be in this list and is deliberately not anymore: caught
  // live on a real WooCommerce store (homewizard.com), whose actual product
  // page lives at /nl/shop/wi-fi-energy-socket/ — a single item, not a
  // listing. 'shop' is used both ways across real stores (a listing root on
  // some, a product namespace on others, Squarespace among them), so it is
  // not reliable evidence in either direction and guessing 'collection' from
  // it was rejecting real, live product pages outright before any strategy
  // ever ran. 'collections'/'category'/'categories'/'search' have not shown
  // a live counter-example and stay.
  if (/\/(collections|category|categories|search|c)\/[^/]+\/?$/.test(path)) {
    return 'collection'
  }
  return 'unknown'
}

/** Every Shopify storefront serves the exact product JSON at <path>.js */
async function tryShopifyJson(
  url: URL,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<ProductDetail | 'no-such-product' | null> {
  const m = /\/products\/([^/?#]+)/.exec(url.pathname)
  if (!m) return null
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`

  try {
    const read = await readShopifyProduct(base, signal)
    if (read === 'not-found') return 'no-such-product'
    if (!read) return null
    const { product: p, currency } = read
    if (!p?.title || !Array.isArray(p.variants)) return null

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

/**
 * Read a Shopify product, from whichever of the two endpoints answers.
 *
 * `<path>.js` is the one this used to use, and it is the better shape: prices
 * are already integer minor units. But it is served as `text/javascript` by a
 * good number of real storefronts — Gymshark among them — and the old check
 * demanded `application/json`, so a perfectly good product page came back as
 * "no product markup found". That store also ships no JSON-LD, so every later
 * strategy failed too and the whole resolve died on a URL that works.
 *
 * `<path>.json` is the fallback, and its prices are DECIMAL STRINGS in major
 * units ("38.00"), not cents. Reading one as the other is a hundredfold error
 * in a number somebody is about to be asked to pay, so the two shapes are
 * converted separately and never share a code path.
 *
 * Every request in this function asks for no Accept-Language at all
 * (acceptLanguage: ''), and that is load-bearing, not cosmetic. Caught live
 * on a real store (en.bentoandco.com, USD base price $310.50): sending the
 * ordinary browser `Accept-Language: en-US` made the SAME `.js` endpoint
 * return `2250000` instead of `31050` — a Shopify Markets-style app on that
 * store silently currency-converts the price it serves based on request
 * headers (₹22,500 masquerading as a plain integer), while `/meta.json`'s
 * `currency` field is static and kept reporting "USD" regardless. Paired
 * together that produced "$22,500" for a $310 item: a 72x error presented
 * with total confidence. Dropping Accept-Language on these requests reliably
 * gets the store's own base-market price back, matching what /meta.json
 * declares — verified stable across a dozen repeated live requests.
 */
async function readShopifyProduct(
  base: string,
  signal: AbortSignal | undefined,
): Promise<{ product: ShopifyProduct; currency: string } | 'not-found' | null> {
  const currency = await shopCurrency(base, signal)

  // Shopify's own content types for these are inconsistent across shops, so
  // the body is what decides, not the header.
  const dotJs = await safeFetch(`${base}.js`, { accept: 'application/json', acceptLanguage: '', signal }).catch(() => null)
  if (dotJs && dotJs.status < 400) {
    const parsed = parseJson<ShopifyProduct>(dotJs.body)
    if (parsed?.title && Array.isArray(parsed.variants)) return { product: parsed, currency }
  }

  const dotJson = await safeFetch(`${base}.json`, { accept: 'application/json', acceptLanguage: '', signal }).catch(() => null)

  // Both endpoints answered, and both said this handle does not exist. That is
  // the store's own verdict on its own catalogue, and it is worth more than
  // anything scraped off the page it serves instead.
  if (dotJs?.status === 404 && dotJson?.status === 404) return 'not-found'

  if (dotJson && dotJson.status < 400) {
    const wrapper = parseJson<{ product?: RawShopifyJson }>(dotJson.body)
    const raw = wrapper?.product
    if (raw?.title && Array.isArray(raw.variants)) {
      const minor = currency === 'JPY' || currency === 'KRW' ? 1 : 100
      return {
        currency,
        product: {
          ...raw,
          images: (raw.images ?? []).map((i) => (typeof i === 'string' ? i : i.src)).filter(Boolean),
          variants: raw.variants.map((v) => ({
            id: v.id,
            title: v.title,
            // "38.00" -> 3800. Round after multiplying: 19.99 * 100 is
            // 1998.9999999999998 in floating point.
            price: Math.round(Number(v.price) * minor),
            available: v.available !== false,
            options: [v.option1, v.option2, v.option3].filter((o): o is string => !!o),
          })),
        },
      }
    }
  }
  return null
}

function parseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}

/**
 * A storefront's own currency, from the endpoint Shopify serves for exactly
 * this. The old code hardcoded USD and commented that .js "reports cents in
 * the store's currency" — which is true, and is precisely why assuming the
 * currency is wrong. A UK shop's £38 was being shown as $38.
 *
 * Exported so sources.ts can tag Shopify search results with the right
 * currency too, instead of the hardcoded USD it used to fall back to (every
 * Indian store in the default search shelf was showing rupee prices under a
 * dollar sign). No Accept-Language here either, for the same reason as
 * readShopifyProduct above — this value has to describe the SAME market the
 * price was read in, and the only way to guarantee that is to ask for none.
 */
export async function shopCurrency(base: string, signal: AbortSignal | undefined): Promise<string> {
  try {
    const origin = new URL(base).origin
    const res = await safeFetch(`${origin}/meta.json`, { accept: 'application/json', acceptLanguage: '', signal })
    if (res.status >= 400) return 'USD'
    const meta = parseJson<{ currency?: string }>(res.body)
    const code = meta?.currency?.trim().toUpperCase()
    return code && /^[A-Z]{3}$/.test(code) ? code : 'USD'
  } catch {
    return 'USD'
  }
}

/** The `<path>.json` shape, which differs from `.js` in every field that matters. */
interface RawShopifyJson {
  title: string
  vendor?: string
  product_type?: string
  body_html?: string
  images?: ({ src: string } | string)[]
  options?: { name: string }[] | string[]
  variants: {
    id: number | string
    title: string
    /** decimal string in MAJOR units — "38.00", not 3800 */
    price: string
    available?: boolean
    option1?: string | null
    option2?: string | null
    option3?: string | null
  }[]
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

function flattenOffers(offers: unknown, flags?: { ambiguousRange?: boolean }): Record<string, unknown>[] {
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
      // No nested per-variant offers, so lowPrice/highPrice IS all there is.
      // When they agree that is a real single price; when they genuinely
      // differ, picking either end and calling it "the" price undercharges
      // or overcharges whoever wants the other one — caught live on a real
      // WooCommerce store (landyachtz.com), AggregateOffer{lowPrice:99.99,
      // highPrice:199.99}, no nested offers at all. aggregateOfferRange
      // (parse.ts) is used only to DECIDE which situation this is; the raw
      // value still flows through the normal offer['price'] → parseMoney
      // path below so there is exactly one place numbers get parsed.
      const currency = String(node['priceCurrency'] ?? 'USD')
      const range = aggregateOfferRange(node['lowPrice'], node['highPrice'], currency)
      if (range.kind === 'range' && flags) flags.ambiguousRange = true
      if (range.kind !== 'single') continue
      out.push({ ...node, price: node['lowPrice'] ?? node['highPrice'] })
      continue
    }
    out.push(node)
  }
  return out
}

function offerPrice(offer: Record<string, unknown>): Money | null {
  // schema.org allows priceSpecification to be a single node OR an array of
  // them (UnitPriceSpecification, one per quantity break, most commonly a
  // one-element array with nothing else). Caught live on a real store
  // (jococups.com): the Offer had no top-level price at all, only
  // priceSpecification: [{price:"39.95", priceCurrency:"AUD"}] — casting
  // that array straight to a Record and reading .price off it reads a key
  // an array does not have, silently returns undefined, and the resolver
  // fell through to a wrong, unrelated number elsewhere on the page.
  const specRaw = offer['priceSpecification']
  const spec = (Array.isArray(specRaw) ? specRaw[0] : specRaw) as Record<string, unknown> | undefined
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
