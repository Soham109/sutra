import { findVenues, buildQuery } from './src/places/overpass.ts'
import { categoryFilters } from './src/places/taxonomy.ts'

const center = { lat: 12.9352, lng: 77.6245 }
const radius_m = 6000

for (const cat of ['restaurant', 'cafe', 'bar', 'cinema']) {
  const { filters } = categoryFilters(cat)
  const q = buildQuery({ center, radius_m, filters, limit: 30 })
  console.log('=== ' + cat + ' ===')
  console.log(JSON.stringify(q))
  const start = Date.now()
  try {
    const venues = await findVenues({ center, radius_m, filters, limit: 30 })
    console.log(cat, 'OK', venues.length, 'venues in', Date.now() - start, 'ms')
  } catch (e) {
    console.log(cat, 'FAIL', e.message, 'in', Date.now() - start, 'ms')
  }
}
