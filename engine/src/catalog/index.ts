import { PravaShopSource, ShopifySource } from './sources.js'
import { resolveProductUrl } from './resolver.js'
import type { CatalogSource, Product, ProductDetail, ResolveResult, SearchResult } from './types.js'

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

  constructor(opts: { shopifyDomains?: string[] } = {}) {
    this.sources = [new ShopifySource(opts.shopifyDomains ?? []), new PravaShopSource()]
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
          const products = await s.search(query, { ...opts, signal: AbortSignal.timeout(9000) })
          return { source: s, products, ms: Date.now() - t0, error: undefined as string | undefined }
        } catch (e) {
          return { source: s, products: [] as Product[], ms: Date.now() - t0, error: (e as Error).message }
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
      })),
      query,
      took_ms: Date.now() - started,
    }
  }

  /** Any product URL from any marketplace → a priced, cartable line. */
  async resolve(url: string): Promise<ResolveResult> {
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
