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

// Every host here was hand-verified on 2026-08-01 against the exact POST body
// this module sends: HTTP 200, a fresh `timestamp_osm_base`, and real elements
// for a known-dense Bangalore bbox. Hosts that looked reachable but answered
// wrong were deliberately excluded rather than added on faith:
//   - overpass.osm.ch          200 OK, 0 elements, no remark — its database
//                               is not actually populated (timestamp_osm_base
//                               was a bare counter, not a date). A confident
//                               empty answer is worse than a timeout here.
//   - overpass.openstreetmap.ru, overpass.private.coffee, overpass.monicz.dev,
//     overpass.nchc.org.tw     connection accepted, then nothing — hung for
//                               the full probe with zero bytes back.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  // Fastest, most consistent mirror in testing (~2s on a query the primary
  // sometimes 504s under demo load). Genuinely independent infrastructure,
  // not a DNS alias of the primary.
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  // Kept even though it was unresponsive in testing: racing means a dead
  // mirror only loses, it no longer costs the caller anything, and it may
  // well be back by the time this runs.
  'https://overpass.kumi.systems/api/interpreter',
]

/**
 * Overpass asks clients not to run queries in parallel *against one server*.
 * That is a per-host rule, not a global one — racing several independently
 * operated mirrors at once is the normal, polite way to use this network, so
 * each host gets its own gate rather than sharing a single process-wide one.
 */
const gates = new Map<string, RateGate>()
function gateFor(host: string): RateGate {
  let g = gates.get(host)
  if (!g) {
    g = new RateGate(250)
    gates.set(host, g)
  }
  return g
}

// A query that is merely slow and legitimately working can take ~10s on a
// loaded free instance (measured), so the server-side and per-attempt budgets
// stay generous enough to let that finish rather than mistaking load for
// failure. What changed from the old sequential design is HEDGE_DELAY_MS: mirrors
// start racing a few seconds apart instead of only after the previous one is
// declared dead, so a single hung mirror can no longer consume the whole budget.
const SERVER_TIMEOUT_S = 15
// Headroom over the server-side timeout so a query that Overpass itself gives
// up on comes back as a remark we can read rather than a dead socket.
const ATTEMPT_TIMEOUT_MS = 18_000
// How long a mirror gets to answer before the next one starts racing it too.
//
// Measured against the live primary on 2026-08-02 (10 back-to-back queries):
// overpass-api.de was the one to actually answer exactly once, in 1.6s: every
// other run it was still silent when the hedge fired, and overpass.openstreetmap.fr
// closed it out ~1-1.5s after ITS turn started. At the old 3000ms stagger that
// made the typical demo wait ~4.2-5.3s — almost entirely spent waiting out a
// primary that was not going to answer anyway, not doing useful work. 1200ms
// keeps a real head start for the primary (a genuinely fast answer still wins
// outright) while cutting the common-case floor to ~2.3s.
const HEDGE_DELAY_MS = 1_200
// Shared across every hedge: without it, a run of hung mirrors still costs a
// caller the sum of their timeouts instead of one bounded wait.
const TOTAL_BUDGET_MS = 20_000
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

  const tasks: RaceTask<Venue[]>[] = ENDPOINTS.map((endpoint, i) => ({
    delay_ms: i * HEDGE_DELAY_MS,
    run: (signal) => fetchFrom(endpoint, body, opts.center, signal),
  }))

  return raceHedged(tasks, { budget_ms: TOTAL_BUDGET_MS, signal: opts.signal })
}

/** One mirror's turn: fetch, parse, and treat a remark or bad status as a rejection. */
function fetchFrom(
  endpoint: string,
  body: string,
  center: { lat: number; lng: number },
  signal: AbortSignal,
): Promise<Venue[]> {
  const host = new URL(endpoint).hostname
  return (async () => {
    const res = await gateFor(host).run(() =>
      osmFetch(endpoint, { method: 'POST', body, timeout_ms: ATTEMPT_TIMEOUT_MS, signal }),
    )
    // 429 = over the slot limit, 504 = the query outran the server. Both mean
    // "ask someone else", not "there are no venues here".
    if (res.status === 429 || res.status === 504 || res.status >= 500) {
      throw new Error(`overpass ${host} returned ${res.status}`)
    }
    if (res.status !== 200) throw new Error(`overpass ${host} returned ${res.status}`)

    const parsed = JSON.parse(res.body) as { elements?: OverpassElement[]; remark?: string }
    // Overpass reports server-side trouble as HTTP 200 with a remark and an
    // empty element list. Any remark on a plain venue query means the answer
    // is incomplete, and an incomplete answer rendered as "nothing near you"
    // is the one lie this module must not tell.
    const remark = parsed.remark?.trim()
    if (remark) throw new Error(`overpass ${host}: ${remark}`)

    return rankByDistance(normalise(parsed.elements ?? []), center)
  })()
}

// ---------------------------------------------------------------------------
// Hedged racing — deliberately knows nothing about Overpass. Given several
// tasks staggered by `delay_ms`, the first to fulfil wins and everyone else
// is aborted; if all of them reject, the caller gets the most informative
// one rather than a generic "nothing answered". Exported and tested on its
// own (see overpass-race.test.ts) because the timing logic is the part most
// likely to hide a bug, and it is the part that must not need a live mirror
// to verify.
// ---------------------------------------------------------------------------

export interface RaceTask<T> {
  /** how long this task waits for an earlier one before it gets its own turn */
  delay_ms: number
  run: (signal: AbortSignal) => Promise<T>
}

export async function raceHedged<T>(tasks: RaceTask<T>[], opts: { budget_ms: number; signal?: AbortSignal }): Promise<T> {
  // One clock for the whole race: aborting on a winner (below) or on the
  // budget running out (here) both flow through the same signal, so every
  // in-flight or not-yet-started task hears about it the same way.
  const raceOver = new AbortController()
  const signal = opts.signal ? AbortSignal.any([raceOver.signal, opts.signal]) : raceOver.signal
  const budgetTimer = setTimeout(() => raceOver.abort(), opts.budget_ms)

  try {
    // Promise.any: first fulfilment wins outright; it only rejects once every
    // task has, which is exactly "ask several, take whoever answers first".
    return await Promise.any(tasks.map((task) => runOne(task, signal)))
  } catch (e) {
    // An abort is the caller's decision, not a task failure. Surface the
    // signal's own reason rather than the AggregateError every task rejected
    // with once it fired — that error has no useful `.message`.
    if (opts.signal?.aborted) {
      throw opts.signal.reason instanceof Error ? opts.signal.reason : (e as Error)
    }
    const errors = e instanceof AggregateError ? (e.errors as Error[]) : [e as Error]
    // Last to settle is usually the most informative: earlier rejections tend
    // to be the fast, generic "someone else answered first" kind.
    throw errors[errors.length - 1] ?? new Error('every attempt failed')
  } finally {
    clearTimeout(budgetTimer)
    // Stop any stragglers now that the race is decided either way — finishing
    // a race that is already lost or already won is pointless load.
    raceOver.abort()
  }
}

function runOne<T>(task: RaceTask<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const fire = () => {
      // Not necessarily this task losing — the caller's own abort looks the
      // same from here. raceHedged reads the caller's signal separately, so
      // this message only ever surfaces when every task truly failed.
      if (signal.aborted) return reject(new Error('cancelled before this attempt\'s turn'))
      task.run(signal).then(resolve, reject)
    }
    if (task.delay_ms <= 0) {
      fire()
      return
    }
    const timer = setTimeout(fire, task.delay_ms)
    // The race ending before this task's turn even starts is the common case
    // (an early task wins). Skipping the wait is not enough on its own,
    // though: Promise.any only rejects once *every* input has settled, so a
    // cancelled task must reject rather than sit forever unsettled — left
    // pending, it would make raceHedged hang whenever this was the last task
    // still owed an answer.
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('cancelled before this attempt\'s turn'))
      },
      { once: true },
    )
  })
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
