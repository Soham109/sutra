import { safeFetch } from './fetcher.js'
import { merchantFrom, productId } from './resolver.js'
import { parseMoney, stripTags } from './parse.js'
import type { CatalogSource, Product, SearchOpts } from './types.js'

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

  constructor(private readonly defaultDomains: string[]) {}

  available(): boolean {
    return true
  }

  async search(query: string, opts: SearchOpts): Promise<Product[]> {
    const domains = opts.merchant ? [opts.merchant] : this.defaultDomains
    if (domains.length === 0 || !query.trim()) return []

    const perDomain = Math.max(2, Math.ceil((opts.limit ?? 12) / domains.length))
    const batches = await Promise.all(
      domains.map((d) => this.searchOne(d, query, perDomain, opts.signal).catch(() => [])),
    )
    return batches.flat().slice(0, opts.limit ?? 12)
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

    const res = await safeFetch(url, { accept: 'application/json', signal })
    if (res.status >= 400 || !res.contentType.includes('json')) return []

    const data = JSON.parse(res.body) as {
      resources?: { results?: { products?: ShopifySuggestProduct[] } }
    }
    const products = data.resources?.results?.products ?? []

    return products.map((p): Product => {
      const productUrl = new URL(p.url ?? '/', `https://${host}`).toString()
      const price = parseMoney(p.price, 'USD') ?? { amount_minor: 0, currency: 'USD' }
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

  async search(): Promise<Product[]> {
    return []
  }

  readonly unavailableReason =
    'Prava discovery runs on the wallet host behind agent request-signing, not the merchant API key. ' +
    'Paste a product URL instead — the resolver reads the merchant page directly.'
}
