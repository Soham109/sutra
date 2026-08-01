#!/usr/bin/env tsx
// Manual smoke test: geocode a real place, then find real venues around it.
// Hits OpenStreetMap's public endpoints; not part of `npm test`.
//
//   npx tsx engine/test/live-places.ts "Koramangala, Bangalore" cinema 8000
import { Places } from '../src/places/index.js'

const where = process.argv[2] ?? 'Koramangala, Bangalore'
const category = process.argv[3] ?? 'cinema'
const radius_m = Number(process.argv[4] ?? 8000)

const places = new Places()

console.log(`\n▶ geocode "${where}"`)
const geo = await places.geocode(where)
if (geo.reason) console.log(`  ! ${geo.reason}`)
for (const p of geo.places) {
  console.log(`  · ${p.label}  (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`)
  console.log(`    ${p.address ?? '—'}`)
}

const anchor = geo.places[0]
if (!anchor) {
  console.log('\nno anchor — nothing to search around')
  process.exit(1)
}

console.log(`\n▶ ${category} within ${radius_m}m of ${anchor.label}`)
const res = await places.search({ near: anchor, category, radius_m, limit: 15 })
console.log(
  `  category ${res.category ? `${res.category.id} (${res.category.label})` : 'unrecognised → name search'}` +
    ` · ${res.venues.length} venues in ${res.took_ms}ms${res.cached ? ' (cached)' : ''}`,
)
if (res.reason) console.log(`  ! ${res.reason}`)

for (const v of res.venues) {
  console.log(`  · ${v.name}  (${v.place.lat.toFixed(5)}, ${v.place.lng.toFixed(5)})`)
  if (v.place.address) console.log(`    ${v.place.address}`)
  const extras = [
    v.cuisine ? `cuisine ${v.cuisine}` : null,
    v.opening_hours ? `hours ${v.opening_hours}` : null,
    v.phone ? `tel ${v.phone}` : null,
  ].filter(Boolean)
  if (extras.length) console.log(`    ${extras.join(' · ')}`)
  if (v.website) console.log(`    ${v.website}`)
  console.log(`    ${v.osm_url}`)
}

// Second run proves the TTL cache, so a demo does not hammer a donated endpoint.
const again = await places.search({ near: anchor, category, radius_m, limit: 15 })
console.log(`\n▶ repeat search: cached=${again.cached}, ${again.took_ms}ms`)

console.log('\n▶ source status')
for (const s of places.status()) {
  console.log(`  ${s.available ? '✓' : '✗'} ${s.label}${s.reason ? ` — ${s.reason}` : ''}`)
}

console.log(`\n▶ reverse ${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)}`)
const back = await places.reverse(anchor.lat, anchor.lng)
console.log(`  ${back ? `${back.label} — ${back.address ?? '—'}` : 'no label'}`)
