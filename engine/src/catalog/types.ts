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
}

export interface ProductDetail extends Product {
  description?: string
  variants: Variant[]
  images: string[]
  /** anything the merchant states that a group should read before committing */
  fine_print: string[]
}

export interface SearchResult {
  products: Product[]
  /** honest provenance — the UI names the rail that answered */
  sources: { kind: SourceKind; label: string; count: number; ms: number; error?: string }[]
  query: string
  took_ms: number
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
  search(query: string, opts: SearchOpts): Promise<Product[]>
}

export interface SearchOpts {
  limit?: number
  /** restrict to one merchant domain, e.g. "shop.example.com" */
  merchant?: string
  signal?: AbortSignal
}
