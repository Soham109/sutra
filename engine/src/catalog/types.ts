// Discovery layer.
//
// The engine coordinates consent for *a purchase*. It should not care what is
// being bought or where. So discovery is a federation of sources behind one
// interface, and the load-bearing one is the universal resolver: give it any
// product URL from any marketplace and it returns a real, priced cart line.
// That works because merchants publish structured product data for Google
// Shopping (schema.org/Product JSON-LD, OpenGraph product tags) and because
// every Shopify storefront exposes JSON endpoints. Nothing is hardcoded per
// merchant; the parsers are generic.

export type SourceKind = 'url' | 'shopify' | 'prava' | 'starter'

export interface Money {
  amount_minor: number
  currency: string
}

export interface Variant {
  id: string
  name: string
  price: Money
  available: boolean
  /** e.g. { Size: 'M', Colour: 'Black' } */
  options?: Record<string, string>
}

export interface Product {
  /** stable id: `${source}:${hash-or-handle}` */
  id: string
  title: string
  subtitle?: string
  price: Money
  /** what one unit means to a human: "per seat", "each", "per night" */
  unit_label: string
  merchant: { name: string; url: string; country_code_iso2: string; domain: string }
  image_url?: string
  product_url: string
  brand?: string
  rating?: { value: number; count: number }
  in_stock: boolean
  source: SourceKind
  /** free-form facets the merchant published — rendered as-is, never assumed */
  attributes?: Record<string, string>
  /**
   * True only for real, Admin-API-sourced products from the merchant this
   * deployment has a server-verified payment adapter for (see
   * shopify/admin-catalog.ts and the `prava_mandates` gate in routes.ts).
   * These are the ONLY products that can complete on the capped, per-person
   * card-mandate rail — everything else lands on a zero-charge rail. Never
   * set on an invented or unverified product; absent (not false) when the
   * question does not apply.
   */
  completes_on_card_rail?: boolean
}

export interface ProductDetail extends Product {
  description?: string
  variants: Variant[]
  images: string[]
  /** anything the merchant states that a group should read before committing */
  fine_print: string[]
}

/** A store this source could not read at all — a hard block, distinct from "found nothing there". */
export interface BlockedStore {
  domain: string
  /** e.g. 'password_protected' — machine-checkable, so the UI can pick wording without parsing prose. */
  kind: 'password_protected'
  reason: string
}

export interface SearchResult {
  products: Product[]
  /** honest provenance — the UI names the rail that answered */
  sources: { kind: SourceKind; label: string; count: number; ms: number; error?: string; blocked?: BlockedStore[] }[]
  query: string
  took_ms: number
}

/** What one CatalogSource.search() call returns: real hits, plus any store it flatly could not read. */
export interface SourceSearchResult {
  products: Product[]
  blocked?: BlockedStore[]
}

export interface ResolveResult {
  product: ProductDetail | null
  /** which parser won — shown in the UI so nothing looks magic */
  strategy: string
  warnings: string[]
}

export interface CatalogSource {
  readonly kind: SourceKind
  readonly label: string
  /** whether this source can answer right now (keys present, host reachable) */
  available(): boolean
  search(query: string, opts: SearchOpts): Promise<SourceSearchResult>
}

export interface SearchOpts {
  limit?: number
  /** restrict to one merchant domain, e.g. "shop.example.com" */
  merchant?: string
  signal?: AbortSignal
}
