#!/usr/bin/env tsx
// Manual smoke test for the universal resolver against real merchant pages.
// Not part of `npm test` — it hits the public internet and third-party sites
// change. Run it when touching the parsers:
//
//   npx tsx engine/test/live-resolve.ts [url ...]
import { resolveProductUrl } from '../src/catalog/resolver.js'

const DEFAULTS = [
  // a real Shopify item page (exercises the .js fast path)
  'https://www.allbirds.com/products/mens-wool-runner-go',
  // a category page — MUST be refused, not guessed at
  'https://www.allbirds.com/collections/mens',
  // schema.org JSON-LD on a non-Shopify store
  'https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html',
]

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS

for (const url of urls) {
  process.stdout.write(`\n▶ ${url}\n`)
  const t0 = Date.now()
  try {
    const { product, strategy, warnings } = await resolveProductUrl(url)
    if (!product) {
      console.log(`  ✗ no product — ${warnings.join('; ')}`)
      continue
    }
    console.log(`  ✓ ${strategy} in ${Date.now() - t0}ms`)
    console.log(`    title    ${product.title}`)
    console.log(`    price    ${(product.price.amount_minor / 100).toFixed(2)} ${product.price.currency}`)
    console.log(`    merchant ${product.merchant.name} (${product.merchant.domain})`)
    console.log(`    stock    ${product.in_stock ? 'in stock' : 'out of stock'}`)
    console.log(`    variants ${product.variants.length}`)
    console.log(`    image    ${product.image_url ?? '—'}`)
    if (warnings.length) console.log(`    warnings ${warnings.join('; ')}`)
  } catch (e) {
    console.log(`  ✗ threw: ${(e as Error).message}`)
  }
}
