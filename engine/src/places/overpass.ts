import type { Place } from '../plan/types.js'
import { RateGate, osmFetch } from './http.js'
import type { OverpassFilter } from './taxonomy.js'

// Overpass — the actual venue lookup. Real places, real coordinates, straight
// out of OpenStreetMap, anywhere on earth, no key.
//
// Overpass is donated infrastructure with no SLA. Everything here assumes it
// will be slow, rate-limited or down: a bounded server-side timeout, a mirror,
// a process-wide gate so we never open two connections at once, and a caller
// contract (see index.ts) where failure degrades to an empty board rather than
// an exception in the request path.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  // The mirror is not a load-balancing trick — it is only tried when the
  // primary rate-limits or times out, which it does under demo traffic.
  'https://overpass.kumi.systems/api/interpreter',
]

/** Overpass asks clients not to run queries in parallel. One at a time it is. */
const gate = new RateGate(250)

const SERVER_TIMEOUT_S = 20
// Per attempt, with headroom over the server-side timeout so a query that Overpass
// itself gives up on comes back as a remark we can read rather than a dead socket.
const ATTEMPT_TIMEOUT_MS = 25_000
// Shared across attempts: without it, two hung endpoints cost a caller a minute.
const TOTAL_BUDGET_MS = 40_000
const DEFAULT_LIMIT = 30

export interface Venue {
  /** `${type}/${id}`, e.g. 'node/1459472858' — stable across Overpass runs */
  id: string
  name: string
  place: Place
  /** every tag OSM had, so the UI can show what it actually knows */
  tags: Record<string, string>
  website?: string
  phone?: string
  opening_hours?: string
  cuisine?: string
  osm_url: string
}

export interface OverpassElement {
  type?: string
  id?: number
  lat?: number
  lon?: number
  /** ways and relations carry a computed centroid instead of a coordinate */
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}

export interface FindVenuesOpts {
  center: { lat: number; lng: number }
  radius_m: number
  filters: OverpassFilter[]
  limit?: number
  signal?: AbortSignal
}

export async function findVenues(opts: FindVenuesOpts): Promise<Venue[]> {
  if (opts.filters.length === 0) return []

  const query = buildQuery(opts)
  const body = `data=${encodeURIComponent(query)}`

  const deadline = Date.now() + TOTAL_BUDGET_MS
  let lastError: Error | null = null

  for (const endpoint of ENDPOINTS) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const host = new URL(endpoint).hostname

    try {
      const res = await gate.run(() =>
        osmFetch(endpoint, {
          method: 'POST',
          body,
          timeout_ms: Math.min(ATTEMPT_TIMEOUT_MS, remaining),
          signal: opts.signal,
        }),
      )
      // 429 = over the slot limit, 504 = the query outran the server. Both mean
      // "ask someone else", not "there are no venues here".
      if (res.status === 429 || res.status === 504 || res.status >= 500) {
        lastError = new Error(`overpass ${host} returned ${res.status}`)
        continue
      }
      if (res.status !== 200) throw new Error(`overpass ${host} returned ${res.status}`)

      const parsed = JSON.parse(res.body) as { elements?: OverpassElement[]; remark?: string }
      // Overpass reports server-side trouble as HTTP 200 with a remark and an
      // empty element list. Any remark on a plain venue query means the answer
      // is incomplete, and an incomplete answer rendered as "nothing near you"
      // is the one lie this module must not tell.
      const remark = parsed.remark?.trim()
      if (remark) {
        lastError = new Error(`overpass ${host}: ${remark}`)
        continue
      }
      return rankByDistance(normalise(parsed.elements ?? []), opts.center)
    } catch (e) {
      // An abort is the caller's decision, not an endpoint fault — do not retry.
      if (opts.signal?.aborted) throw e
      lastError = e as Error
    }
  }
  throw lastError ?? new Error('overpass unreachable')
}

/** Exported for tests: the query text is the contract with Overpass. */
export function buildQuery(opts: Pick<FindVenuesOpts, 'center' | 'radius_m' | 'filters' | 'limit'>): string {
  const lat = opts.center.lat.toFixed(7)
  const lng = opts.center.lng.toFixed(7)
  const radius = Math.max(1, Math.round(opts.radius_m))
  const limit = Math.max(1, Math.round(opts.limit ?? DEFAULT_LIMIT))

  // `nwr` is node+way+relation in one clause: a cinema is a node in one city and
  // a building outline in the next, and a group does not care which.
  const clauses = opts.filters
    .map((f) => `  nwr(around:${radius},${lat},${lng})${selectors(f)};`)
    .join('\n')

  return `[out:json][timeout:${SERVER_TIMEOUT_S}];\n(\n${clauses}\n);\nout tags center ${limit};`
}

function selectors(f: OverpassFilter): string {
  let out = f.value === undefined ? `["${quoted(f.key)}"]` : `["${quoted(f.key)}"="${quoted(f.value)}"]`
  for (const [k, v] of Object.entries(f.also ?? {})) out += `["${quoted(k)}"="${quoted(v)}"]`
  if (f.nameMatch) out += `["name"~"${quotedRegex(f.nameMatch)}",i]`
  return out
}

/** Exported for tests: raw Overpass elements → Venues, node/way/relation alike. */
export function normalise(elements: OverpassElement[]): Venue[] {
  const out: Venue[] = []
  const seen = new Set<string>()
  for (const el of elements) {
    const venue = toVenue(el)
    if (!venue || seen.has(venue.id)) continue
    seen.add(venue.id)
    out.push(venue)
  }
  return out
}

export function toVenue(el: OverpassElement): Venue | null {
  const tags = el.tags ?? {}
  const name = (tags.name ?? '').trim()
  // An unnamed node is a data point, not somewhere a human can agree to meet.
  if (!name) return null

  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  const type = el.type ?? 'node'
  if (el.id === undefined) return null
  const id = `${type}/${el.id}`
  const address = composeAddress(tags)

  const place: Place = {
    label: name.slice(0, 200),
    lat,
    lng,
    address,
    source: 'overpass',
  }

  return {
    id,
    name: name.slice(0, 200),
    place,
    tags,
    website: first(tags['website'], tags['contact:website'], tags['url']),
    phone: first(tags['phone'], tags['contact:phone']),
    opening_hours: first(tags['opening_hours']),
    cuisine: first(tags['cuisine']),
    osm_url: `https://www.openstreetmap.org/${type}/${el.id}`,
  }
}

/**
 * addr:* → one line a human can read out to a taxi driver. Fields are joined in
 * postal order and any of them may be missing; OSM address completeness varies
 * enormously by country and we render whatever is actually there.
 */
export function composeAddress(tags: Record<string, string>): string | undefined {
  const street = first(tags['addr:street'])
  const number = first(tags['addr:housenumber'])
  const houseLine = street ? [number, street].filter(Boolean).join(' ') : first(tags['addr:housename'])

  const parts = [
    first(tags['addr:unit']),
    houseLine,
    first(tags['addr:suburb'], tags['addr:neighbourhood']),
    first(tags['addr:district']),
    first(tags['addr:city']),
    first(tags['addr:state'], tags['addr:province']),
    first(tags['addr:postcode']),
    first(tags['addr:country']),
  ].filter((p): p is string => Boolean(p))

  if (parts.length === 0) return undefined
  return parts.join(', ').slice(0, 300)
}

/** Metres between two coordinates. Spherical earth is well inside OSM's error. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Overpass returns in database order; nearest-first is what a group wants. */
export function rankByDistance(venues: Venue[], center: { lat: number; lng: number }): Venue[] {
  return [...venues].sort((a, b) => distanceM(center, a.place) - distanceM(center, b.place))
}

const quoted = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const quotedRegex = (s: string): string => quoted(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

function first(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return undefined
}
