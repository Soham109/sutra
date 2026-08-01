#!/usr/bin/env tsx
// Manual smoke test: federated search, then resolve the first hit end to end.
// Hits the public internet; not part of `npm test`.
//
//   npx tsx engine/test/live-search.ts "wool runner" allbirds.com
import { Catalog } from '../src/catalog/index.js'
import { resolveProductUrl } from '../src/catalog/resolver.js'

const query = process.argv[2] ?? 'runner'
const domain = process.argv[3] ?? 'www.allbirds.com'

const catalog = new Catalog({ shopifyDomains: [domain] })

console.log(`\n▶ search "${query}" on ${domain}`)
const res = await catalog.search(query, { limit: 5 })
for (const s of res.sources) {
  console.log(`  source ${s.kind}: ${s.count} results in ${s.ms}ms${s.error ? ` (error: ${s.error})` : ''}`)
}
for (const p of res.products) {
  console.log(`  · ${p.title} — ${(p.price.amount_minor / 100).toFixed(2)} ${p.price.currency}`)
  console.log(`    ${p.product_url}`)
}

const first = res.products[0]
if (!first) {
  console.log('\nno results — nothing to resolve')
  process.exit(0)
}

console.log(`\n▶ resolve the first hit`)
const { product, strategy, warnings } = await resolveProductUrl(first.product_url)
if (!product) {
  console.log(`  ✗ ${warnings.join('; ')}`)
  process.exit(1)
}
console.log(`  ✓ ${strategy}`)
console.log(`    title    ${product.title}`)
console.log(`    price    ${(product.price.amount_minor / 100).toFixed(2)} ${product.price.currency}`)
console.log(`    merchant ${product.merchant.name} (${product.merchant.domain})`)
console.log(`    variants ${product.variants.length}`)
console.log(`    image    ${product.image_url ?? '—'}`)
if (warnings.length) console.log(`    warnings ${warnings.join('; ')}`)
