import { PravaShopSource, ShopifySource } from './sources.js'
import { resolveProductUrl } from './resolver.js'
import type { BlockedStore, CatalogSource, Product, ProductDetail, ResolveResult, SearchResult } from './types.js'
import { ShopifyAdminCatalogSource } from '../shopify/admin-catalog.js'
import type { ShopifyTestOrderClient } from '../shopify/test-order.js'

export * from './types.js'
export { resolveProductUrl } from './resolver.js'
export { parseMoney, formatMinor, minorUnits } from './parse.js'

/**
 * Federated discovery. Sources run concurrently, a slow or broken one never
 * blocks the others, and the response names which rail answered so the UI can
 * be honest about provenance instead of implying a single omniscient catalog.
 */
export class Catalog {
  private readonly sources: CatalogSource[]
  private readonly adminSource?: ShopifyAdminCatalogSource

  constructor(opts: { shopifyDomains?: string[]; shopifyTest?: ShopifyTestOrderClient } = {}) {
    // The Admin-sourced dev-store catalog goes first — its products are the
    // ones a group can actually complete on the capped card-mandate rail
    // (routes.ts's prava_mandates gate), so they win any product_url
    // collision against the plain storefront source below.
    this.adminSource = opts.shopifyTest ? new ShopifyAdminCatalogSource(opts.shopifyTest) : undefined
    this.sources = [
      ...(this.adminSource ? [this.adminSource] : []),
      new ShopifySource(opts.shopifyDomains ?? []),
      new PravaShopSource(),
    ]
  }

  /** A URL pasted into the search box is a resolve, not a search. */
  static looksLikeUrl(q: string): boolean {
    const s = q.trim()
    return /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+\/\S/.test(s)
  }

  async search(query: string, opts: { limit?: number; merchant?: string } = {}): Promise<SearchResult> {
    const started = Date.now()
    const live = this.sources.filter((s) => s.available())

    const settled = await Promise.all(
      live.map(async (s) => {
        const t0 = Date.now()
        try {
          const result = await s.search(query, { ...opts, signal: AbortSignal.timeout(9000) })
          return {
            source: s,
            products: result.products,
            blocked: result.blocked,
            ms: Date.now() - t0,
            error: undefined as string | undefined,
          }
        } catch (e) {
          return {
            source: s,
            products: [] as Product[],
            blocked: undefined as BlockedStore[] | undefined,
            ms: Date.now() - t0,
            error: (e as Error).message,
          }
        }
      }),
    )

    const seen = new Set<string>()
    const products: Product[] = []
    for (const r of settled) {
      for (const p of r.products) {
        if (seen.has(p.product_url)) continue
        seen.add(p.product_url)
        products.push(p)
      }
    }

    return {
      products,
      sources: settled.map((r) => ({
        kind: r.source.kind,
        label: r.source.label,
        count: r.products.length,
        ms: r.ms,
        error: r.error,
        ...(r.blocked && r.blocked.length > 0 ? { blocked: r.blocked } : {}),
      })),
      query,
      took_ms: Date.now() - started,
    }
  }

  /**
   * The dev-store shelf, unconditional on any query — the browsable "these
   * complete on the card rail" set the discover UI shows before anyone
   * types anything. Empty, honestly, when no card-mandate merchant is
   * configured on this deployment, or its Admin API has nothing published.
   * An Admin API outage is reported via `error`, not silently folded into
   * "nothing published" — a demo operator needs to tell those apart.
   */
  async featured(): Promise<{ products: Product[]; store_domain: string | null; error?: string }> {
    if (!this.adminSource) return { products: [], store_domain: null }
    try {
      return { products: await this.adminSource.list(), store_domain: this.adminSource.storeDomain }
    } catch (e) {
      return { products: [], store_domain: this.adminSource.storeDomain, error: (e as Error).message }
    }
  }

  /**
   * Any product URL from any marketplace → a priced, cartable line.
   *
   * A URL on the configured card-mandate store is routed to the Admin-API
   * source instead of the generic resolver: that store's storefront always
   * redirects to /password (a Shopify development-store rule, not a
   * setting), so the generic resolver would either see a clean 404-alike
   * and refuse, or — worse — read the PASSWORD PAGE itself as if it were
   * the product. Never falls through to the generic path for this host: a
   * handle the Admin catalog does not recognise is reported honestly rather
   * than silently re-tried against a page guaranteed to be the wrong one.
   */
  async resolve(url: string): Promise<ResolveResult> {
    if (this.adminSource?.matchesHost(url)) {
      const store = this.adminSource.storeDomain
      try {
        const product = await this.adminSource.detail(url)
        return product
          ? {
              product,
              strategy: 'shopify-admin-api',
              warnings: [
                `${store}'s own site asks visitors for a password — a Shopify development-store rule — so this was read from the store's Admin API instead.`,
              ],
            }
          : {
              product: null,
              strategy: 'shopify-admin-api',
              warnings: [`no product at that address in ${store}'s Admin catalog — check the link, or browse this store's shelf instead`],
            }
      } catch (e) {
        // The Admin API itself is unreachable right now — a real outage, not
        // "no such product". Reported as its own honest warning rather than
        // falling through to the generic resolver, which is guaranteed to
        // hit this store's password page instead of the item.
        return {
          product: null,
          strategy: 'shopify-admin-api',
          warnings: [`could not reach ${store}'s Admin API just now (${(e as Error).message}) — try again in a moment`],
        }
      }
    }
    return resolveProductUrl(url, AbortSignal.timeout(12_000))
  }

  async getProduct(url: string): Promise<ProductDetail | null> {
    return (await this.resolve(url)).product
  }

  /** Why a source is dark, surfaced in the UI rather than swallowed. */
  sourceStatus(): { kind: string; label: string; available: boolean; reason?: string }[] {
    return this.sources.map((s) => ({
      kind: s.kind,
      label: s.label,
      available: s.available(),
      reason: (s as PravaShopSource).unavailableReason,
    }))
  }
}
