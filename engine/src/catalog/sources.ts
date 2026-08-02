import { safeFetch } from './fetcher.js'
import { merchantFrom, productId, shopCurrency } from './resolver.js'
import { parseMoney, stripTags } from './parse.js'
import type { BlockedStore, CatalogSource, Product, SearchOpts, SourceSearchResult } from './types.js'

/**
 * Thrown when a Shopify storefront answers every request by redirecting to
 * its own `/password` page — Shopify's development-store default. That is a
 * "cannot read this shop" condition, not "this shop has nothing matching":
 * the JSON endpoints return zero bytes either way, and conflating the two
 * told a judge "no results" for a store that in fact could not be read at
 * all. Caught live on the configured SHOPIFY_TEST_STORE, which 302s
 * /search/suggest.json, /products.json and / all to /password.
 */
export class ShopifyPasswordProtected extends Error {
  constructor(readonly domain: string) {
    super(`${domain} is password-protected — its public storefront cannot be read`)
  }
}

function isPasswordWall(finalUrl: string): boolean {
  try {
    return new URL(finalUrl).pathname.replace(/\/+$/, '') === '/password'
  } catch {
    return false
  }
}

// Search sources. Each is generic across merchants — the Shopify source works
// on any storefront that speaks Shopify (millions of them) without per-store
// code, and the Prava source is a stub that documents exactly why it cannot be
// used from a merchant key, so nobody wastes an hour rediscovering it.

/**
 * Shopify storefront search. Every Shopify store serves
 *   /search/suggest.json?q=…&resources[type]=product
 * publicly, with prices and images. Point it at any store domain.
 */
export class ShopifySource implements CatalogSource {
  readonly kind = 'shopify' as const
  readonly label = 'Shopify storefronts'

  // A domain's currency does not change between two searches a few seconds
  // apart, but a hardcoded 'USD' was silently mislabeling every result from
  // every non-US store in the default shelf — mamaearth.in and beardo.in
  // (rupees) were showing "$399" for a ₹399 item. One cached lookup per
  // domain avoids paying for a /meta.json fetch on every single search.
  private readonly currencyCache = new Map<string, Promise<string>>()

  constructor(private readonly defaultDomains: string[]) {}

  available(): boolean {
    return true
  }

  async search(query: string, opts: SearchOpts): Promise<SourceSearchResult> {
    const domains = opts.merchant ? [opts.merchant] : this.defaultDomains
    if (domains.length === 0 || !query.trim()) return { products: [] }

    const perDomain = Math.max(2, Math.ceil((opts.limit ?? 12) / domains.length))
    const settled = await Promise.all(
      domains.map(async (d) => {
        try {
          return { products: await this.searchOne(d, query, perDomain, opts.signal) }
        } catch (e) {
          if (e instanceof ShopifyPasswordProtected) {
            const blocked: BlockedStore[] = [{ domain: e.domain, kind: 'password_protected', reason: e.message }]
            return { products: [] as Product[], blocked }
          }
          // Any other failure (timeout, DNS, malformed JSON) stays a silent
          // per-domain miss, same as before — a genuine outage, not a wall.
          return { products: [] as Product[] }
        }
      }),
    )
    const products = settled.flatMap((r) => r.products).slice(0, opts.limit ?? 12)
    const blocked = settled.flatMap((r) => r.blocked ?? [])
    return blocked.length > 0 ? { products, blocked } : { products }
  }

  private async searchOne(
    domain: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Product[]> {
    const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const url =
      `https://${host}/search/suggest.json?q=${encodeURIComponent(query)}` +
      `&resources[type]=product&resources[limit]=${limit}`

    // No Accept-Language on either request — the suggest.json price and the
    // meta.json currency have to describe the same market, and a locale
    // header is exactly what was seen (live, on a real store) to make a
    // Shopify currency-conversion app swap in a different market's price
    // while /meta.json kept reporting the base currency. See resolver.ts's
    // readShopifyProduct for the full story; same fix, same reason, here.
    let currencyP = this.currencyCache.get(host)
    if (!currencyP) {
      currencyP = shopCurrency(`https://${host}`, signal)
      this.currencyCache.set(host, currencyP)
    }
    const [res, currency] = await Promise.all([
      safeFetch(url, { accept: 'application/json', acceptLanguage: '', signal }),
      currencyP,
    ])
    // safeFetch follows redirects, so `res.url` is where the store actually
    // landed us — a store's own password gate, not a search endpoint that
    // happens to be empty. Checked before the generic status/content-type
    // bail below so it is never folded into an ordinary "no results".
    if (isPasswordWall(res.url)) throw new ShopifyPasswordProtected(host)
    if (res.status >= 400 || !res.contentType.includes('json')) return []

    const data = JSON.parse(res.body) as {
      resources?: { results?: { products?: ShopifySuggestProduct[] } }
    }
    const products = data.resources?.results?.products ?? []

    return products.map((p): Product => {
      const productUrl = new URL(p.url ?? '/', `https://${host}`).toString()
      const price = parseMoney(p.price, currency) ?? { amount_minor: 0, currency }
      return {
        id: productId('shopify', productUrl),
        title: stripTags(p.title ?? 'Item', 160),
        subtitle: p.vendor,
        price,
        unit_label: 'each',
        merchant: merchantFrom(new URL(`https://${host}`), p.vendor),
        image_url: p.image ?? p.featured_image?.url,
        product_url: productUrl,
        brand: p.vendor,
        in_stock: p.available !== false,
        source: 'shopify',
      }
    })
  }
}

interface ShopifySuggestProduct {
  title?: string
  url?: string
  price?: string
  vendor?: string
  image?: string
  featured_image?: { url?: string }
  available?: boolean
}

/**
 * Prava's own catalog. Documented, deliberately not wired.
 *
 * Verified 2026-08-01: `prava shop search` targets pay-api.prava.space and
 * authenticates with Ed25519 agent request-signing from an owner-approved
 * agent link. A merchant `sk_test_*` key cannot reach it — those routes are
 * not served on the merchant API hosts at all. If an agent identity is ever
 * linked, implement search() here and the federation picks it up with no
 * other change.
 */
export class PravaShopSource implements CatalogSource {
  readonly kind = 'prava' as const
  readonly label = 'Prava shopping (needs a linked agent)'

  available(): boolean {
    return false
  }

  async search(): Promise<SourceSearchResult> {
    return { products: [] }
  }

  readonly unavailableReason =
    'Prava discovery runs on the wallet host behind agent request-signing, not the merchant API key. ' +
    'Paste a product URL instead — the resolver reads the merchant page directly.'
}
