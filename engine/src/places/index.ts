import type { Place } from '../plan/types.js'
import { geocode as nominatimGeocode, reverse as nominatimReverse } from './nominatim.js'
import { type Venue, findVenues } from './overpass.js'
import { categoryFilters, resolveCategory } from './taxonomy.js'

export * from './taxonomy.js'
export {
  type Venue,
  type OverpassElement,
  type FindVenuesOpts,
  buildQuery,
  composeAddress,
  distanceM,
  findVenues,
  normalise,
  rankByDistance,
  toVenue,
} from './overpass.js'
export { geocode as geocodeRaw, reverse as reverseRaw } from './nominatim.js'
export { OSM_UA } from './http.js'

// The venue rail.
//
// Mirrors the Catalog federation: one facade, sources that can be dark, and a
// response that names what answered instead of implying omniscience. Two
// differences, both because OSM is donated infrastructure rather than a vendor:
// results are cached hard, and a failure is a `reason` string on an empty list,
// never a throw. A plan board that shows "Overpass is rate-limiting us" is
// honest; one that 500s because a free tile server hiccuped is not.

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 200
const DEFAULT_RADIUS_M = 8000
const DEFAULT_LIMIT = 30

export type PlaceSourceKind = 'nominatim' | 'overpass'

export interface VenueSearchResult {
  venues: Venue[]
  /** the category we understood, or null when we fell back to a name search */
  category: { id: string; label: string } | null
  /** why the list is empty or short — rendered verbatim, never swallowed */
  reason?: string
  cached: boolean
  took_ms: number
}

export interface GeocodeResult {
  places: Place[]
  reason?: string
  cached: boolean
  took_ms: number
}

export interface SourceStatus {
  kind: PlaceSourceKind
  label: string
  /** last observed reachability; true until something proves otherwise */
  available: boolean
  reason?: string
  checked_at?: string
}

export interface SearchOpts {
  near: Place | { lat: number; lng: number }
  category: string
  radius_m?: number
  limit?: number
  signal?: AbortSignal
}

interface CacheEntry<T> {
  at: number
  value: T
}

export class Places {
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  private readonly health = new Map<PlaceSourceKind, { ok: boolean; at: number; reason?: string }>()

  constructor(private readonly ttl_ms: number = CACHE_TTL_MS) {}

  /** Free text → candidate places. Empty list + reason when the geocoder is down. */
  async geocode(query: string, signal?: AbortSignal): Promise<GeocodeResult> {
    const started = Date.now()
    const q = query.trim()
    if (!q) return { places: [], reason: 'nothing to geocode', cached: false, took_ms: 0 }

    const key = `geocode:${normaliseKey(q)}`
    const hit = this.read<Place[]>(key)
    if (hit) return { places: hit, cached: true, took_ms: Date.now() - started }

    try {
      const places = await nominatimGeocode(q, signal)
      this.mark('nominatim', true)
      this.write(key, places)
      return {
        places,
        reason: places.length === 0 ? `no place matched “${q}”` : undefined,
        cached: false,
        took_ms: Date.now() - started,
      }
    } catch (e) {
      const reason = describe(e, 'Nominatim')
      this.mark('nominatim', false, reason)
      return { places: [], reason, cached: false, took_ms: Date.now() - started }
    }
  }

  /** A device coordinate → a label. Null, never a throw, when the geocoder is down. */
  async reverse(lat: number, lng: number, signal?: AbortSignal): Promise<Place | null> {
    const key = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`
    const hit = this.read<Place | null>(key)
    if (hit !== undefined) return hit

    try {
      const place = await nominatimReverse(lat, lng, signal)
      this.mark('nominatim', true)
      this.write(key, place)
      return place
    } catch (e) {
      this.mark('nominatim', false, describe(e, 'Nominatim'))
      return null
    }
  }

  /** Real venues of a category near a point, nearest first. */
  async search(opts: SearchOpts): Promise<VenueSearchResult> {
    const started = Date.now()
    const center = { lat: opts.near.lat, lng: opts.near.lng }
    const radius_m = clamp(opts.radius_m ?? DEFAULT_RADIUS_M, 200, 50_000)
    const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, 200)

    const known = resolveCategory(opts.category)
    const { id, label, filters } = categoryFilters(opts.category)
    const category = known ? { id: known.id, label: known.label } : null

    if (filters.length === 0) {
      return { venues: [], category, reason: 'no category to search for', cached: false, took_ms: 0 }
    }

    const key = [
      'venues',
      center.lat.toFixed(4),
      center.lng.toFixed(4),
      radius_m,
      limit,
      id,
      // the fallback's filters depend on the raw words, so they belong in the key
      known ? '' : normaliseKey(opts.category),
    ].join(':')

    const hit = this.read<Venue[]>(key)
    if (hit) {
      return { venues: hit, category, cached: true, took_ms: Date.now() - started }
    }

    try {
      const venues = await findVenues({ center, radius_m, filters, limit, signal: opts.signal })
      this.mark('overpass', true)
      this.write(key, venues)
      return {
        venues,
        category,
        reason: venues.length === 0 ? `no ${label} mapped within ${Math.round(radius_m / 1000)}km` : undefined,
        cached: false,
        took_ms: Date.now() - started,
      }
    } catch (e) {
      const reason = describe(e, 'Overpass')
      this.mark('overpass', false, reason)
      return { venues: [], category, reason, cached: false, took_ms: Date.now() - started }
    }
  }

  /**
   * Reachability as last observed, not as probed. Probing a donated endpoint to
   * render a status dot would be exactly the kind of traffic their usage policy
   * asks us not to send.
   */
  status(): SourceStatus[] {
    const labels: Record<PlaceSourceKind, string> = {
      nominatim: 'OpenStreetMap Nominatim (geocoding)',
      overpass: 'OpenStreetMap Overpass (venues)',
    }
    return (Object.keys(labels) as PlaceSourceKind[]).map((kind) => {
      const h = this.health.get(kind)
      return {
        kind,
        label: labels[kind],
        available: h?.ok ?? true,
        reason: h?.ok === false ? h.reason : undefined,
        checked_at: h ? new Date(h.at).toISOString() : undefined,
      }
    })
  }

  clearCache(): void {
    this.cache.clear()
  }

  private read<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.at > this.ttl_ms) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value as T
  }

  private write<T>(key: string, value: T): void {
    // Insertion-ordered Map: the first key is the oldest write.
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(key, { at: Date.now(), value })
  }

  private mark(kind: PlaceSourceKind, ok: boolean, reason?: string): void {
    this.health.set(kind, { ok, at: Date.now(), reason })
  }
}

/** A sensible process-wide instance; the cache is only useful when shared. */
export const places = new Places()

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function normaliseKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Turn an exception into something a participant can read on the board. */
function describe(e: unknown, who: string): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/abort|timeout|timed out/i.test(msg)) return `${who} did not answer in time`
  if (/429/.test(msg)) return `${who} is rate-limiting us; try again in a minute`
  if (/5\d\d/.test(msg)) return `${who} is having a bad moment (${msg})`
  return `${who} unavailable: ${msg}`
}
