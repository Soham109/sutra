import { osmFetch } from './src/places/http.ts'
import { buildQuery } from './src/places/overpass.ts'
import { categoryFilters } from './src/places/taxonomy.ts'

const center = { lat: 12.9352, lng: 77.6245 }
const radius_m = 6000
const { filters } = categoryFilters('restaurant')
const query = buildQuery({ center, radius_m, filters, limit: 30 })
const body = `data=${encodeURIComponent(query)}`

for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
  const start = Date.now()
  try {
    const res = await osmFetch(endpoint, { method: 'POST', body, timeout_ms: 30000 })
    console.log(endpoint, 'status', res.status, 'in', Date.now() - start, 'ms', 'bodylen', res.body.length)
    if (res.status === 200) {
      const parsed = JSON.parse(res.body)
      console.log('  remark:', parsed.remark, 'elements:', (parsed.elements||[]).length)
    } else {
      console.log('  body:', res.body.slice(0, 300))
    }
  } catch (e) {
    console.log(endpoint, 'ERROR', e.message, 'in', Date.now() - start, 'ms')
  }
}
