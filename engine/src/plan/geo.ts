import type { Place } from './types.js'

// ---------------------------------------------------------------------------
// Spherical geometry for the coordination layer.
//
// Everything here is great-circle distance on a sphere. That is a deliberate
// modelling choice, not an approximation we are hiding:
//
//  - The earth is an oblate spheroid. Using the IUGG mean radius, spherical
//    distances differ from the WGS84 ellipsoid by up to ~0.5% (a few hundred
//    metres over a 100 km trip, metres over a city).
//  - Nobody travels along a great circle anyway. Real road/transit distance is
//    typically 1.2–1.4× the straight line, and that detour factor dwarfs the
//    ellipsoid error by two orders of magnitude.
//
// So the honest framing is: these numbers are a fair, symmetric, cheap proxy
// for "how far out of your way is this", good enough to compare options
// against each other, and never presented as a route. If we ever want real
// travel time it comes from a routing service, not from a better ellipsoid.
//
// Pure. No I/O.
// ---------------------------------------------------------------------------

/** IUGG mean earth radius, km. The standard choice for haversine. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088

/** Anything with coordinates. `Place` satisfies this structurally. */
export interface LatLng {
  lat: number
  lng: number
}

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => (rad * 180) / Math.PI
const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Great-circle distance in kilometres.
 *
 * The asin form (rather than atan2) with the argument clamped to 1 is the
 * numerically stable variant: floating-point error can push `sqrt(h)` a hair
 * above 1 for antipodal points, which would produce NaN.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Spherical centroid: project each point onto the unit sphere in 3D, average
 * the cartesian vectors, project back to lat/lng.
 *
 * NOT the arithmetic mean of degrees, which is wrong in two ways that both
 * show up in real groups:
 *
 *  1. Longitude wraps. Averaging +179° and -179° gives 0° — the middle of the
 *     wrong ocean — when the true midpoint is 180°. Same bug at the prime
 *     meridian for anyone whose group straddles London.
 *  2. Degrees of longitude are not a constant distance. At 60°N a degree of
 *     longitude is half the width it is at the equator, so a degree-space mean
 *     silently over-weights the northern members of a spread-out group.
 *
 * The cartesian mean has neither problem: it is the direction of the sum of
 * unit vectors, which is coordinate-system independent.
 *
 * Degenerate case: if the points cancel out (antipodal pairs, or an even
 * spread around a great circle) the mean vector is ~zero and no direction is
 * meaningful. We fall back to the first point rather than returning a
 * fabricated coordinate — the caller's `boundingRadiusM` will then be huge,
 * which is the correct signal that this group has no useful centre.
 */
export function centroid(points: LatLng[]): LatLng {
  const first = points[0]
  if (!first) throw new Error('centroid: no points')

  let x = 0
  let y = 0
  let z = 0
  for (const p of points) {
    const lat = toRad(p.lat)
    const lng = toRad(p.lng)
    const cosLat = Math.cos(lat)
    x += cosLat * Math.cos(lng)
    y += cosLat * Math.sin(lng)
    z += Math.sin(lat)
  }
  const n = points.length
  x /= n
  y /= n
  z /= n

  const hyp = Math.hypot(x, y)
  if (hyp < 1e-12 && Math.abs(z) < 1e-12) return { lat: first.lat, lng: first.lng }

  return { lat: toDeg(Math.atan2(z, hyp)), lng: toDeg(Math.atan2(y, x)) }
}

export interface TravelPoint {
  km: number
  /** which origin this leg belongs to, so the UI can name the worst trip */
  label: string
}

export interface TravelCost {
  total_km: number
  /** the single longest trip anyone has to make */
  max_km: number
  mean_km: number
  /** one entry per origin, in input order */
  per_point: TravelPoint[]
}

/**
 * Distance from each origin to a destination, plus the aggregates the ranker
 * needs.
 *
 * `max_km` exists because fairness is not the average. Four people 1 km away
 * and one person 40 km away have a mean of 8.8 km, which reads as "close by"
 * and quietly hides the one person who has to cross the city. Reporting the
 * worst individual trip alongside the mean is what lets the scorer — and the
 * UI — say the true thing instead of the flattering one.
 *
 * All distances are rounded to 2 decimal places (10 m) on the way out, so the
 * numbers a human reads are the exact numbers the score was computed from.
 */
export function travelCost(from: Place[], to: Place): TravelCost {
  if (from.length === 0) {
    return { total_km: 0, max_km: 0, mean_km: 0, per_point: [] }
  }
  const per_point = from.map((p) => ({ km: round2(haversineKm(p, to)), label: p.label }))
  const kms = per_point.map((p) => p.km)
  const total = kms.reduce((a, b) => a + b, 0)
  return {
    total_km: round2(total),
    max_km: Math.max(...kms),
    mean_km: round2(total / kms.length),
    per_point,
  }
}

/**
 * Radius in metres needed, from the group's centroid, to reach every point.
 *
 * This is what sizes a venue search: search a smaller circle and you exclude
 * somebody's neighbourhood entirely. Returns 0 for a single point (or none) —
 * the caller is expected to apply its own floor, since a 0 m search finds
 * nothing.
 */
export function boundingRadiusM(points: LatLng[]): number {
  if (points.length < 2) return 0
  const c = centroid(points)
  const maxKm = points.reduce((max, p) => Math.max(max, haversineKm(c, p)), 0)
  return Math.round(maxKm * 1000)
}
