import { minorUnits, stripTags } from '../catalog/parse.js'
import { productId } from '../catalog/resolver.js'
import type { CatalogSource, Product, ProductDetail, SearchOpts, SourceSearchResult, Variant } from '../catalog/types.js'
import type { ShopifyTestOrderClient } from './test-order.js'

// Reads the configured Shopify development store's real inventory through
// the Admin API instead of its public storefront.
//
// It exists because that store is password-protected — a Shopify
// development store's password page is a platform rule, not a setting the
// owner can turn off — so every public endpoint the plain ShopifySource
// (catalog/sources.ts) and the generic resolver (catalog/resolver.ts) both
// rely on (/search/suggest.json, /products.json, /<handle>.js) 302s to
// /password there and would otherwise see zero products, forever, no matter
// what is actually published. The engine already authenticates to this
// exact store for order creation (shopify/test-order.ts); this reuses that
// same client-credentials token to READ products too, for both search
// (`search`/`list`, used by Catalog.search and Catalog.featured) and full
// detail (`detail`, used by Catalog.resolve — the "Split this" / paste-a-
// link path) — so nothing about this store's catalog depends on the public
// storefront, or on a storefront password that can be changed at any time
// out from under a running deployment.
//
// Never invents a product: a store with nothing published answers with an
// honest empty list, and an unreachable Admin API is left to THROW out of
// fetchAll() rather than being swallowed into that same empty list — the
// caller (Catalog, in index.ts) turns that into a visible `error`, so a
// demo operator can tell "nothing published yet" apart from "the token
// expired". Every product this DOES return is real, Admin-verified
// inventory from the ONE merchant this deployment can actually complete a
// capped, per-person card mandate against (see the `prava_mandates` gate in
// routes.ts) — so every product here is tagged `completes_on_card_rail: true`.

const PRODUCTS_QUERY = `
  query SutraAdminCatalog($first: Int!) {
    products(first: $first, query: "status:active") {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          descriptionHtml
          images(first: 10) { edges { node { url } } }
          variants(first: 25) {
            edges {
              node {
                id
                title
                price
                availableForSale
                selectedOptions { name value }
              }
            }
          }
        }
      }
    }
    shop { currencyCode }
  }
`

interface AdminProductNode {
  id: string
  title: string
  handle: string
  status: string
  vendor?: string | null
  productType?: string | null
  descriptionHtml?: string | null
  images: { edges: { node: { url: string } }[] }
  variants: {
    edges: {
      node: {
        id: string
        title: string
        price: string
        availableForSale: boolean
        selectedOptions?: { name: string; value: string }[]
      }
    }[]
  }
}

interface ProductsQueryData {
  products: { edges: { node: AdminProductNode }[] }
  shop: { currencyCode: string }
}

// A demo does not need to pay an Admin API round trip on every keystroke,
// and the catalog on a development store used for a demo changes rarely —
// but a real edit in Shopify Admin should still show up without a redeploy,
// so this is a short cache, not a build-time snapshot.
const CACHE_TTL_MS = 5 * 60_000

function normaliseHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

export class ShopifyAdminCatalogSource implements CatalogSource {
  readonly kind = 'shopify' as const
  readonly label: string
  readonly storeDomain: string

  private cache: { at: number; nodes: AdminProductNode[]; currency: string } | null = null
  private inflight: Promise<{ nodes: AdminProductNode[]; currency: string }> | null = null

  constructor(
    private readonly client: ShopifyTestOrderClient,
    private readonly limit = 25,
  ) {
    this.storeDomain = client.storefrontDomain
    this.label = `${this.storeDomain} — this deployment's card-mandate merchant (Admin API)`
  }

  available(): boolean {
    return true
  }

  /** True when a URL points at this store — used by Catalog.resolve() to route here instead of the generic (password-blind) resolver. */
  matchesHost(rawUrl: string): boolean {
    try {
      return normaliseHost(new URL(rawUrl).hostname) === this.storeDomain
    } catch {
      return false
    }
  }

  /** Every active product this store's Admin API returns right now — real data only, cached briefly. */
  async list(): Promise<Product[]> {
    const { nodes, currency } = await this.load()
    return nodes.map((n) => toProduct(n, this.storeDomain, currency)).filter((p): p is Product => p !== null)
  }

  async search(query: string, opts: SearchOpts): Promise<SourceSearchResult> {
    // Scoped to a different merchant — this source only ever knows the one
    // store it was built for, so it stays out of the way rather than
    // pretending to answer for somewhere else.
    if (opts.merchant && normaliseHost(opts.merchant) !== this.storeDomain) return { products: [] }
    const all = await this.list()
    const q = query.trim().toLowerCase()
    const matched = q
      ? all.filter((p) => p.title.toLowerCase().includes(q) || (p.subtitle ?? '').toLowerCase().includes(q))
      : all
    return { products: matched.slice(0, opts.limit ?? matched.length) }
  }

  /**
   * Full product detail for a URL on this store — the "Split this" / paste-
   * a-link path. Reads the same handle straight out of the Admin-sourced
   * catalog rather than trying the storefront (which would just redirect to
   * /password and, worse, could resolve to the PASSWORD PAGE's own title —
   * exactly the "confidently wrong page" failure resolver.ts's own #!/ and
   * not-a-shop guards exist to prevent). Returns null, honestly, for a
   * handle this Admin catalog does not have — never a guess.
   */
  async detail(rawUrl: string): Promise<ProductDetail | null> {
    let handle: string | null = null
    try {
      const m = /\/products\/([^/?#]+)/.exec(new URL(rawUrl).pathname)
      handle = m?.[1] ? decodeURIComponent(m[1]) : null
    } catch {
      return null
    }
    if (!handle) return null
    const { nodes, currency } = await this.load()
    const node = nodes.find((n) => n.handle === handle)
    return node ? toDetail(node, this.storeDomain, currency) : null
  }

  private async load(): Promise<{ nodes: AdminProductNode[]; currency: string }> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache
    if (!this.inflight) {
      this.inflight = this.fetchAll().finally(() => {
        this.inflight = null
      })
    }
    const result = await this.inflight
    this.cache = { at: Date.now(), ...result }
    return result
  }

  /**
   * Deliberately does NOT catch: unlike ShopifySource's multi-domain shelf
   * (where one dark domain among eight should not alarm the whole search),
   * this is the ONE store this deployment can complete a real capped
   * mandate against, so an Admin API outage or an expired/misconfigured
   * token is worth surfacing, not swallowing into a shelf that looks merely
   * "empty right now". Callers (search/list/detail/featured) catch this and
   * turn it into an honest `error` field rather than invented products.
   */
  private async fetchAll(): Promise<{ nodes: AdminProductNode[]; currency: string }> {
    const data = await this.client.adminGraphQl<ProductsQueryData>(PRODUCTS_QUERY, { first: this.limit })
    const currency = (data.shop?.currencyCode ?? 'USD').toUpperCase()
    const nodes = data.products.edges.map((e) => e.node).filter((n) => n.status === 'ACTIVE')
    return { nodes, currency }
  }
}

function headlineVariant(node: AdminProductNode) {
  const variants = node.variants.edges.map((e) => e.node)
  return variants.find((v) => v.availableForSale) ?? variants[0]
}

/**
 * The password gates the product PAGE, not the CDN asset — verified live:
 * every image URL the Admin API returns answers 200, no auth, no cookie,
 * for anyone. But at their native size (this store's are ~2MB, 1600x1600)
 * that is a lot to ship for a search-result thumbnail. Shopify's CDN
 * resizes on request via a `width` query param (confirmed live: the same
 * file at `&width=600` came back 231,918 bytes instead of 1,987,098) — used
 * here rather than fetching and re-encoding the image ourselves, which
 * would need real image-processing infrastructure this engine does not have
 * and should not grow just for thumbnail sizing.
 */
function cdnResized(url: string, width: number): string {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('cdn.shopify.com')) return url
    u.searchParams.set('width', String(width))
    return u.toString()
  } catch {
    return url
  }
}

function toProduct(node: AdminProductNode, storeDomain: string, currency: string): Product | null {
  const variants = node.variants.edges.map((e) => e.node)
  const variant = headlineVariant(node)
  if (!variant) return null
  const amount = Number(variant.price)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const productUrl = `https://${storeDomain}/products/${node.handle}`
  const rawImage = node.images.edges[0]?.node.url
  return {
    id: productId('shopify', productUrl),
    title: node.title,
    subtitle: node.vendor ?? undefined,
    price: { amount_minor: Math.round(amount * minorUnits(currency)), currency },
    unit_label: 'each',
    merchant: {
      name: node.vendor || 'Sutra',
      url: `https://${storeDomain}`,
      country_code_iso2: currency === 'INR' ? 'IN' : 'US',
      domain: storeDomain,
    },
    // A grid-thumbnail size — the full-resolution image is still what
    // toDetail() below puts in `images[]` for a detail view.
    image_url: rawImage ? cdnResized(rawImage, 600) : undefined,
    product_url: productUrl,
    brand: node.vendor ?? undefined,
    in_stock: variants.some((v) => v.availableForSale),
    source: 'shopify',
    attributes: node.productType ? { Type: node.productType } : undefined,
    completes_on_card_rail: true,
  }
}

function toDetail(node: AdminProductNode, storeDomain: string, currency: string): ProductDetail | null {
  const base = toProduct(node, storeDomain, currency)
  if (!base) return null

  const variants: Variant[] = node.variants.edges
    .map((e) => e.node)
    .map((v): Variant | null => {
      const amount = Number(v.price)
      if (!Number.isFinite(amount) || amount <= 0) return null
      const options = (v.selectedOptions ?? []).reduce<Record<string, string>>((acc, o) => {
        if (o.value && o.value !== 'Default Title') acc[o.name] = o.value
        return acc
      }, {})
      return {
        id: v.id,
        name: v.title === 'Default Title' ? node.title : v.title,
        price: { amount_minor: Math.round(amount * minorUnits(currency)), currency },
        available: v.availableForSale,
        options: Object.keys(options).length > 0 ? options : undefined,
      }
    })
    .filter((v): v is Variant => v !== null)

  // Sized down from this store's native 1600x1600 (a detail view still
  // wants a sharp hero image, just not the full 2MB original) — same CDN
  // resize used for the thumbnail in toProduct() above, at a larger width.
  const images = node.images.edges.map((e) => cdnResized(e.node.url, 1200))

  return {
    ...base,
    images,
    image_url: images[0] ?? base.image_url,
    description: node.descriptionHtml ? stripTags(node.descriptionHtml) : undefined,
    variants: variants.length > 0 ? variants : [{ id: 'default', name: node.title, price: base.price, available: base.in_stock }],
    fine_print: [],
  }
}
