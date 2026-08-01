import type { Place } from '../plan/types.js'
import { RateGate, osmFetch } from './http.js'

// Geocoding. Turns "Koramangala, Bangalore" or a device fix into a Place with
// real coordinates and the provenance to prove where they came from.
//
// Nominatim's usage policy caps clients at one request per second — absolutely,
// not on average — and requires an identifying User-Agent. Both are honoured
// here rather than in the caller, because a policy a caller can forget is a
// policy that gets us blocked.

const ENDPOINT = 'https://nominatim.openstreetmap.org'

// 1100ms, not 1000: clock skew and the round-trip should not be the thing that
// puts us over an absolute limit.
const gate = new RateGate(1100)

interface NominatimRow {
  lat?: string
  lon?: string
  name?: string
  display_name?: string
  addresstype?: string
  type?: string
  error?: string
  address?: { country_code?: string }
}

/** Free-text search → up to 5 candidate places, best first. */
export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim()
  if (!q) return []

  const url = `${ENDPOINT}/search?${new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '5',
    addressdetails: '1',
  })}`

  const { status, body } = await gate.run(() => osmFetch(url, { signal, timeout_ms: 12_000 }))
  if (status !== 200) throw new Error(`nominatim search returned ${status}`)

  const rows = parseJson<NominatimRow[]>(body)
  if (!Array.isArray(rows)) return []
  return rows.map(toPlace).filter((p): p is Place => p !== null)
}

/** A device coordinate → a label a human recognises. */
export async function reverse(lat: number, lng: number, signal?: AbortSignal): Promise<Place | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const url = `${ENDPOINT}/reverse?${new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  })}`

  const { status, body } = await gate.run(() => osmFetch(url, { signal, timeout_ms: 12_000 }))
  if (status !== 200) throw new Error(`nominatim reverse returned ${status}`)

  const row = parseJson<NominatimRow>(body)
  if (!row || row.error) return null

  // Reverse echoes the query coordinate back; prefer ours, since that is the
  // point the user actually is, not the centroid of whatever matched it.
  const place = toPlace(row)
  return place ? { ...place, lat, lng } : null
}

/** Exported for tests: the pure row → Place shaping, no network involved. */
export function toPlace(row: NominatimRow): Place | null {
  const lat = Number(row.lat)
  const lng = Number(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  const display = (row.display_name ?? '').trim()
  const label = (row.name?.trim() || display.split(',')[0]?.trim() || display).slice(0, 200)
  if (!label) return null

  return {
    label,
    lat,
    lng,
    address: display ? display.slice(0, 300) : undefined,
    // Carried because a resolved country is the only honest way to guess a
    // currency for "under 800" — a bare number is not USD just because that is
    // the schema default.
    country_code: row.address?.country_code?.toUpperCase(),
    source: 'nominatim',
  }
}

function parseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}
