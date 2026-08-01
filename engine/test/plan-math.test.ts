import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  bestCommonWindows,
  coversInstant,
  coversWindow,
  intersect,
  normalise,
  overlapMs,
  totalDurationMs,
} from '../src/plan/time.js'
import { boundingRadiusM, centroid, haversineKm, travelCost } from '../src/plan/geo.js'
import { DEFAULT_WEIGHTS, rankOptions, scoreOption, type RankParticipant } from '../src/plan/rank.js'
import type { OptionInput, Place, SignalPayload, TimeWindow } from '../src/plan/types.js'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const iso = (s: string) => new Date(s).toISOString()
const w = (start: string, end: string): TimeWindow => ({ start: iso(start), end: iso(end) })
/** 2026-08-08 is a Saturday; every time-of-day below is UTC on that day. */
const sat = (hhmm: string) => `2026-08-08T${hhmm}:00Z`
const W = (from: string, to: string) => w(sat(from), sat(to))
const HOUR = 3_600_000

const NOW = new Date('2026-08-01T12:00:00Z')

const place = (label: string, lat: number, lng: number): Place => ({
  label,
  lat,
  lng,
  source: 'manual',
})

/**
 * 1° of latitude on the mean-radius sphere. Derived, not guessed:
 * 6371.0088 km * π/180 = 111.1950802335329 km, which matches the textbook
 * "a degree of latitude is about 111 km".
 */
const KM_PER_DEG_LAT = 111.1950802335329
/** A place exactly `km` due north of (0,0). */
const northKm = (km: number): Place => place(`${km}km north`, km / KM_PER_DEG_LAT, 0)
const ORIGIN = place('origin', 0, 0)

const option = (over: Partial<OptionInput> & { id: string }): OptionInput & { id: string } => ({
  source: 'overpass',
  title: 'Test option',
  raw: {},
  ...over,
})

const P = (id: string, signals: SignalPayload[], name = id.toUpperCase()): RankParticipant => ({
  id,
  name,
  signals,
})

const rsvpIn: SignalPayload = { kind: 'rsvp', in: true }
const avail = (windows: TimeWindow[], anytime = false): SignalPayload => ({
  kind: 'availability',
  windows,
  anytime,
})
const at = (p: Place): SignalPayload => ({ kind: 'location', place: p })
const budget = (ceiling_minor: number, currency = 'USD'): SignalPayload => ({
  kind: 'budget',
  ceiling_minor,
  currency,
})
const vote = (option_id: string, score: -1 | 0 | 1): SignalPayload => ({
  kind: 'vote',
  option_id,
  score,
})
const constraint = (text: string): SignalPayload => ({ kind: 'constraint', text })

const factor = (s: ReturnType<typeof scoreOption>, key: string) => {
  const f = s.factors.find((x) => x.key === key)
  if (!f) throw new Error(`missing factor ${key}`)
  return f
}

// ===========================================================================
// time.ts
// ===========================================================================

describe('normalise', () => {
  it('sorts, merges overlapping windows', () => {
    expect(normalise([W('12', '14'), W('10', '13')])).toEqual([W('10', '14')])
  })

  it('merges adjacent windows (half-open, so [10,11) ∪ [11,12) = [10,12))', () => {
    expect(normalise([W('10', '11'), W('11', '12')])).toEqual([W('10', '12')])
  })

  it('keeps a real gap', () => {
    expect(normalise([W('10', '11'), W('12', '13')])).toEqual([W('10', '11'), W('12', '13')])
  })

  it('drops zero-length and inverted windows', () => {
    expect(normalise([{ start: iso(sat('10')), end: iso(sat('10')) }])).toEqual([])
    expect(normalise([{ start: iso(sat('12')), end: iso(sat('10')) }])).toEqual([])
  })

  it('swallows a window fully contained in another', () => {
    expect(normalise([W('10', '18'), W('12', '13')])).toEqual([W('10', '18')])
  })

  it('is timezone-agnostic: the same instant in two notations merges', () => {
    // 14:00+02:00 is 12:00Z — adjacent to [10:00Z, 12:00Z).
    const a: TimeWindow = { start: sat('10'), end: sat('12') }
    const b: TimeWindow = { start: '2026-08-08T14:00:00+02:00', end: '2026-08-08T16:00:00+02:00' }
    expect(normalise([a, b])).toEqual([W('10', '14')])
  })
})

describe('intersect', () => {
  it('returns the shared middle', () => {
    expect(intersect([W('10', '14')], [W('12', '16')])).toEqual([W('12', '14')])
  })

  it('returns nothing for disjoint sets', () => {
    expect(intersect([W('10', '11')], [W('12', '13')])).toEqual([])
  })

  it('touching windows do not intersect (half-open)', () => {
    expect(intersect([W('10', '12')], [W('12', '14')])).toEqual([])
  })

  it('handles many-to-many', () => {
    const a = [W('09', '12'), W('14', '18')]
    const b = [W('11', '15'), W('16', '17')]
    expect(intersect(a, b)).toEqual([W('11', '12'), W('14', '15'), W('16', '17')])
  })
})

describe('overlapMs / coversInstant / coversWindow', () => {
  it('overlapMs sums the covered parts of w', () => {
    // [10,14) against [11,12) + [13,15): 1h inside + 1h inside = 2h.
    expect(overlapMs(W('10', '14'), [W('11', '12'), W('13', '15')])).toBe(2 * HOUR)
  })

  it('overlapMs is 0 when nothing overlaps', () => {
    expect(overlapMs(W('10', '11'), [W('12', '13')])).toBe(0)
  })

  it('coversInstant excludes the end instant', () => {
    expect(coversInstant([W('10', '12')], sat('10'))).toBe(true)
    expect(coversInstant([W('10', '12')], sat('11'))).toBe(true)
    expect(coversInstant([W('10', '12')], sat('12'))).toBe(false)
  })

  it('coversWindow needs total coverage, and a merge across adjacency counts', () => {
    expect(coversWindow([W('10', '14')], W('11', '12'))).toBe(true)
    expect(coversWindow([W('10', '11'), W('11', '14')], W('10', '14'))).toBe(true)
    expect(coversWindow([W('10', '11'), W('12', '14')], W('10', '14'))).toBe(false)
  })
})

describe('bestCommonWindows', () => {
  const ppl = (
    ...entries: [string, TimeWindow[], boolean?][]
  ): { id: string; windows: TimeWindow[]; anytime: boolean }[] =>
    entries.map(([id, windows, anytime]) => ({ id, windows, anytime: anytime ?? false }))

  it('full overlap: one window, everybody', () => {
    const out = bestCommonWindows(
      ppl(['a', [W('18', '22')]], ['b', [W('18', '22')]], ['c', [W('18', '22')]]),
      { minDurationMs: HOUR },
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.window).toEqual(W('18', '22'))
    expect(out[0]?.count).toBe(3)
    expect(out[0]?.available).toEqual(['a', 'b', 'c'])
    expect(out[0]?.unavailable).toEqual([])
  })

  it('no overlap: the best is still reported, with who exactly it suits', () => {
    const out = bestCommonWindows(ppl(['a', [W('10', '12')]], ['b', [W('14', '16')]]), {
      minDurationMs: HOUR,
    })
    expect(out).toHaveLength(2)
    expect(out.every((c) => c.count === 1)).toBe(true)
    // earliest first once count and duration tie
    expect(out[0]?.window).toEqual(W('10', '12'))
    expect(out[0]?.available).toEqual(['a'])
    expect(out[0]?.unavailable).toEqual(['b'])
    expect(out[1]?.available).toEqual(['b'])
  })

  it('partial overlap: a clear winner, then the runner-up subsets', () => {
    // a 18–22, b 19–23, c 19–21  →  19–21 is the only slot all three share.
    const out = bestCommonWindows(
      ppl(['a', [W('18', '22')]], ['b', [W('19', '23')]], ['c', [W('19', '21')]]),
      { minDurationMs: HOUR },
    )
    expect(out[0]?.window).toEqual(W('19', '21'))
    expect(out[0]?.count).toBe(3)
    expect(out[0]?.available).toEqual(['a', 'b', 'c'])

    // The next best drops c and gains an hour: a+b share 19–22.
    expect(out[1]?.window).toEqual(W('19', '22'))
    expect(out[1]?.count).toBe(2)
    expect(out[1]?.available).toEqual(['a', 'b'])
    expect(out[1]?.unavailable).toEqual(['c'])
  })

  it('a maximal window is not fragmented by a busier slot inside it', () => {
    // a is free 10–14 throughout; b only 11–12. a's own best window must come
    // back as the whole 10–14, not as the two shards either side of b's slot.
    const out = bestCommonWindows(ppl(['a', [W('10', '14')]], ['b', [W('11', '12')]]), {
      minDurationMs: HOUR,
    })
    expect(out[0]?.window).toEqual(W('11', '12'))
    expect(out[0]?.count).toBe(2)
    const aOnly = out.find((c) => c.count === 1 && c.available[0] === 'a')
    expect(aOnly?.window).toEqual(W('10', '14'))
  })

  it('anytime participants join every window without inventing one', () => {
    const out = bestCommonWindows(ppl(['a', [W('18', '20')]], ['b', [], true]), {
      minDurationMs: HOUR,
    })
    expect(out).toHaveLength(1)
    // b contributed no boundaries — the slot is exactly a's window.
    expect(out[0]?.window).toEqual(W('18', '20'))
    expect(out[0]?.count).toBe(2)
    expect(out[0]?.available).toEqual(['a', 'b'])
  })

  it('a participant who sent nothing is never counted as available, but is reported', () => {
    const out = bestCommonWindows(
      ppl(['a', [W('18', '20')]], ['b', [W('18', '20')]], ['quiet', []]),
      { minDurationMs: HOUR },
    )
    expect(out[0]?.count).toBe(2)
    expect(out[0]?.available).toEqual(['a', 'b'])
    expect(out[0]?.unavailable).toEqual(['quiet'])
  })

  it('an availability signal with no windows is not "free never"', () => {
    expect(bestCommonWindows(ppl(['a', []], ['b', []]), { minDurationMs: HOUR })).toEqual([])
  })

  it('returns nothing when only anytime answers exist — no evidence to anchor on', () => {
    expect(
      bestCommonWindows(ppl(['a', [], true], ['b', [], true]), { minDurationMs: HOUR }),
    ).toEqual([])
  })

  it('respects minDurationMs', () => {
    // The all-three slot is only 30 minutes; asking for an hour must drop it.
    const people = ppl(['a', [W('18', '22')]], ['b', [W('19', '23')]], [
      'c',
      [w(sat('19'), '2026-08-08T19:30:00Z')],
    ])
    const half = bestCommonWindows(people, { minDurationMs: HOUR / 2 })
    expect(half[0]?.count).toBe(3)
    const full = bestCommonWindows(people, { minDurationMs: HOUR })
    expect(full.every((c) => c.count <= 2)).toBe(true)
  })

  it('respects limit', () => {
    const out = bestCommonWindows(
      ppl(['a', [W('18', '22')]], ['b', [W('19', '23')]], ['c', [W('19', '21')]]),
      { minDurationMs: HOUR, limit: 1 },
    )
    expect(out).toHaveLength(1)
  })

  it('handles a gap: availability either side of a break does not merge', () => {
    const out = bestCommonWindows(
      ppl(['a', [W('10', '12'), W('14', '16')]], ['b', [W('10', '12'), W('14', '16')]]),
      { minDurationMs: HOUR },
    )
    expect(out.map((c) => c.window)).toEqual([W('10', '12'), W('14', '16')])
    expect(out.every((c) => c.count === 2)).toBe(true)
  })
})

// ===========================================================================
// geo.ts
// ===========================================================================

describe('haversineKm', () => {
  const LDN = place('London', 51.5074, -0.1278)
  const PAR = place('Paris', 48.8566, 2.3522)
  const NYC = place('New York', 40.7128, -74.006)
  const LAX = place('Los Angeles', 34.0522, -118.2437)

  it('matches the published London–Paris great-circle distance (~343.5 km)', () => {
    expect(haversineKm(LDN, PAR)).toBeCloseTo(343.56, 1)
  })

  it('matches the published New York–Los Angeles great-circle distance (~3936 km)', () => {
    expect(haversineKm(NYC, LAX)).toBeCloseTo(3935.75, 1)
  })

  it('one degree of latitude is ~111.195 km', () => {
    expect(haversineKm(place('a', 0, 0), place('b', 1, 0))).toBeCloseTo(111.195, 3)
  })

  it('a quarter of the equator is a quarter of the circumference', () => {
    const quarter = haversineKm(place('a', 0, 0), place('b', 0, 90))
    expect(quarter).toBeCloseTo((2 * Math.PI * 6371.0088) / 4, 6)
  })

  it('is symmetric and zero for identical points', () => {
    expect(haversineKm(LDN, PAR)).toBeCloseTo(haversineKm(PAR, LDN), 9)
    expect(haversineKm(LDN, LDN)).toBe(0)
  })

  it('does not blow up on antipodes', () => {
    const d = haversineKm(place('a', 0, 0), place('b', 0, 180))
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeCloseTo(Math.PI * 6371.0088, 6)
  })
})

describe('centroid', () => {
  it('crosses the antimeridian correctly (a naive mean of degrees gives 0)', () => {
    const c = centroid([place('a', 0, 179), place('b', 0, -179)])
    expect(Math.abs(c.lng)).toBeCloseTo(180, 6)
    expect(c.lat).toBeCloseTo(0, 9)
    // The naive answer would be lng 0 — half a planet away.
    expect(Math.abs(c.lng)).not.toBeCloseTo(0, 1)
  })

  it('bulges poleward at high latitude, unlike a mean of degrees', () => {
    // Two points on the 60°N parallel: the great circle between them passes
    // slightly NORTH of the parallel, so the true centroid is above 60°.
    const c = centroid([place('a', 60, -1), place('b', 60, 1)])
    expect(c.lng).toBeCloseTo(0, 9)
    expect(c.lat).toBeGreaterThan(60)
    expect(c.lat).toBeCloseTo(60.0038, 3)
  })

  it('returns the point itself for a single point', () => {
    const c = centroid([place('a', 51.5074, -0.1278)])
    expect(c.lat).toBeCloseTo(51.5074, 9)
    expect(c.lng).toBeCloseTo(-0.1278, 9)
  })

  it('falls back rather than fabricating a direction for antipodal points', () => {
    const c = centroid([place('a', 0, 0), place('b', 0, 180)])
    expect(c).toEqual({ lat: 0, lng: 0 })
  })

  it('throws on an empty set', () => {
    expect(() => centroid([])).toThrow(/no points/)
  })
})

describe('travelCost', () => {
  it('reports every leg, the total, the mean and — crucially — the worst', () => {
    const cost = travelCost([northKm(1), northKm(1), northKm(1), northKm(40)], ORIGIN)
    expect(cost.per_point.map((p) => p.km)).toEqual([1, 1, 1, 40])
    expect(cost.total_km).toBe(43)
    expect(cost.mean_km).toBe(10.75)
    // The mean says "10.75 km, fine". max_km is the one that says somebody is
    // crossing the city.
    expect(cost.max_km).toBe(40)
  })

  it('labels each leg so the worst trip can be named', () => {
    const cost = travelCost([place('Ana', 0, 0), northKm(12)], ORIGIN)
    expect(cost.per_point[0]).toEqual({ km: 0, label: 'Ana' })
    expect(cost.per_point[1]?.km).toBe(12)
  })

  it('is all zeroes for no origins', () => {
    expect(travelCost([], ORIGIN)).toEqual({ total_km: 0, max_km: 0, mean_km: 0, per_point: [] })
  })
})

describe('boundingRadiusM', () => {
  it('is half the separation for two points', () => {
    const d = haversineKm(place('a', 0, 0), northKm(10))
    expect(boundingRadiusM([place('a', 0, 0), northKm(10)])).toBe(Math.round((d / 2) * 1000))
  })

  it('is 0 for fewer than two points', () => {
    expect(boundingRadiusM([])).toBe(0)
    expect(boundingRadiusM([ORIGIN])).toBe(0)
  })

  it('covers the furthest member of a spread group', () => {
    const pts = [northKm(0), northKm(2), northKm(30)]
    const r = boundingRadiusM(pts)
    const c = centroid(pts)
    for (const p of pts) expect(haversineKm(c, p) * 1000).toBeLessThanOrEqual(r + 1)
  })
})

// ===========================================================================
// rank.ts
// ===========================================================================

describe('scoreOption: time_fit', () => {
  it('is the fraction of those who shared availability that can make the slot', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: W('19', '21') }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')])]),
        P('b', [rsvpIn, avail([W('19', '23')])]),
        P('c', [rsvpIn, avail([W('09', '12')])]),
      ],
      now: NOW,
    })
    const f = factor(s, 'time_fit')
    expect(f.value).toBeCloseTo(2 / 3, 3)
    expect(f.why).toContain('2 of 3')
    expect(f.weight).toBe(DEFAULT_WEIGHTS.time_fit)
  })

  it('counts anytime as available and drops the silent from the denominator', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: W('19', '21') }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')])]),
        P('b', [rsvpIn, avail([], true)]),
        P('quiet', [rsvpIn]),
      ],
      now: NOW,
    })
    const f = factor(s, 'time_fit')
    expect(f.value).toBe(1)
    expect(f.why).toContain('2 of 2')
    // ...but the silent participant is named, not hidden.
    expect(f.why).toContain('1 of 3 have not shared times')
    expect(s.per_participant.find((p) => p.participant_id === 'quiet')?.time_ok).toBeNull()
  })

  it('ignores people who RSVP’d out', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: W('19', '21') }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')])]),
        P('gone', [{ kind: 'rsvp', in: false }, avail([W('09', '10')])]),
      ],
      now: NOW,
    })
    expect(factor(s, 'time_fit').value).toBe(1)
    expect(factor(s, 'time_fit').why).toContain('1 of 1')
  })

  it('falls back to bestCommonWindows when the option has no time, and says so', () => {
    const s = scoreOption({
      option: option({ id: 'o1' }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')])]),
        P('b', [rsvpIn, avail([W('19', '23')])]),
        P('c', [rsvpIn, avail([W('09', '12')])]),
      ],
      now: NOW,
    })
    const f = factor(s, 'time_fit')
    expect(f.why).toContain('No fixed time')
    expect(f.why).toContain('best common slot')
    expect(f.why).toContain('19:00–22:00')
    expect(f.value).toBeCloseTo(2 / 3, 3)
    // per-participant answers are measured against that proposed slot
    expect(s.per_participant.find((p) => p.participant_id === 'c')?.time_ok).toBe(false)
  })

  it('carries zero weight when nobody has shared availability', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: W('19', '21') }),
      participants: [P('a', [rsvpIn]), P('b', [rsvpIn])],
      now: NOW,
    })
    const f = factor(s, 'time_fit')
    expect(f.weight).toBe(0)
    expect(f.why).toContain('Nobody has shared availability')
  })
})

describe('scoreOption: travel_fit', () => {
  const travelling = (...kms: number[]) =>
    kms.map((km, i) => P(`p${i}`, [rsvpIn, at(northKm(km))]))

  const travelValue = (...kms: number[]) =>
    factor(
      scoreOption({
        option: option({ id: 'o1', place: ORIGIN }),
        participants: travelling(...kms),
        now: NOW,
      }),
      'travel_fit',
    ).value

  it('is 1.0 when everyone is already there, and 0 at the ceiling', () => {
    expect(travelValue(0, 0)).toBe(1)
    expect(travelValue(25, 25)).toBe(0)
  })

  it('decays linearly: half the 25 km ceiling scores 0.5', () => {
    expect(travelValue(12.5, 12.5)).toBeCloseTo(0.5, 3)
  })

  it('penalises the worst trip instead of averaging it away', () => {
    // Both groups have a 5 km mean. The uneven one must score lower.
    const even = travelValue(5, 5) //  fits 0.8/0.8 → mean 0.8, worst 0.8 → 0.80
    const uneven = travelValue(0, 10) // fits 1.0/0.6 → mean 0.8, worst 0.6 → 0.70
    expect(even).toBeCloseTo(0.8, 3)
    expect(uneven).toBeCloseTo(0.7, 3)
    expect(uneven).toBeLessThan(even)
  })

  it('names the longest trip and its owner', () => {
    const s = scoreOption({
      option: option({ id: 'o1', place: ORIGIN }),
      participants: [P('a', [rsvpIn, at(northKm(1))]), P('far', [rsvpIn, at(northKm(20))])],
      now: NOW,
    })
    const f = factor(s, 'travel_fit')
    expect(f.why).toContain('longest 20 km (FAR)')
    expect(f.why).toContain('25 km ceiling')
    expect(s.per_participant.find((p) => p.participant_id === 'far')?.travel_km).toBe(20)
  })

  it('honours a custom ceiling', () => {
    const s = scoreOption({
      option: option({ id: 'o1', place: ORIGIN }),
      participants: travelling(25, 25),
      now: NOW,
      maxAcceptableKm: 50,
    })
    expect(factor(s, 'travel_fit').value).toBeCloseTo(0.5, 3)
  })

  it('carries zero weight — never a guess — when locations or the venue are unknown', () => {
    const noVenue = scoreOption({
      option: option({ id: 'o1' }),
      participants: travelling(5),
      now: NOW,
    })
    expect(factor(noVenue, 'travel_fit').weight).toBe(0)

    const noLocations = scoreOption({
      option: option({ id: 'o1', place: ORIGIN }),
      participants: [P('a', [rsvpIn])],
      now: NOW,
    })
    expect(factor(noLocations, 'travel_fit').weight).toBe(0)
    expect(noLocations.per_participant[0]?.travel_km).toBeNull()
  })
})

describe('scoreOption: budget_fit', () => {
  const priced = (amount_minor: number, basis: 'per_person' | 'total' | 'unknown', currency = 'USD') =>
    option({ id: 'o1', price: { amount_minor, currency, basis } })

  it('compares a per-person price directly', () => {
    const s = scoreOption({
      option: priced(3000, 'per_person'),
      participants: [
        P('a', [rsvpIn, budget(5000)]),
        P('b', [rsvpIn, budget(3000)]),
        P('c', [rsvpIn, budget(2000)]),
      ],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    expect(f.value).toBeCloseTo(2 / 3, 3)
    expect(f.why).toContain('USD 30.00 per person')
    expect(f.why).toContain('within 2 of 3 shared budgets')
    expect(s.per_participant.map((p) => p.budget_ok)).toEqual([true, true, false])
  })

  it('divides a total by the RSVP’d-in headcount', () => {
    const s = scoreOption({
      option: priced(12000, 'total'),
      participants: [
        P('a', [rsvpIn, budget(3500)]),
        P('b', [rsvpIn, budget(3500)]),
        P('c', [rsvpIn, budget(3500)]),
        P('d', [rsvpIn, budget(2000)]),
        P('gone', [{ kind: 'rsvp', in: false }, budget(100)]),
      ],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    // 4 attending (the one who dropped out does not dilute the bill)
    expect(f.why).toContain('USD 120.00 total ÷ 4 people = USD 30.00 each')
    expect(f.value).toBeCloseTo(3 / 4, 3)
  })

  it('never silently compares across currencies', () => {
    const s = scoreOption({
      option: priced(3000, 'per_person', 'USD'),
      participants: [
        P('a', [rsvpIn, budget(5000, 'USD')]),
        P('euro', [rsvpIn, budget(1000, 'EUR')]),
      ],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    // The EUR ceiling of 10.00 would have failed a naive 30.00 comparison.
    expect(f.value).toBe(1)
    expect(f.why).toContain('within 1 of 1 shared budget')
    expect(f.why).toContain('1 budget in EUR could not be compared with a USD price')
    expect(s.per_participant.find((p) => p.participant_id === 'euro')?.budget_ok).toBeNull()
  })

  it('cannot be scored when every budget is in the wrong currency', () => {
    const s = scoreOption({
      option: priced(3000, 'per_person', 'USD'),
      participants: [P('euro', [rsvpIn, budget(1000, 'EUR')])],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    expect(f.weight).toBe(0)
    expect(f.why).toContain('EUR')
  })

  it('an unknown basis is neutral and weightless, and says why', () => {
    const s = scoreOption({
      option: priced(3000, 'unknown'),
      participants: [P('a', [rsvpIn, budget(100)])],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    expect(f.weight).toBe(0)
    expect(f.value).toBe(0.5)
    expect(f.why).toContain('without a basis')
    expect(s.excluded).toBeNull()
    expect(s.per_participant[0]?.budget_ok).toBeNull()
  })

  it('a missing budget signal is not consent', () => {
    const s = scoreOption({
      option: priced(3000, 'per_person'),
      participants: [P('a', [rsvpIn, budget(5000)]), P('quiet', [rsvpIn])],
      now: NOW,
    })
    const f = factor(s, 'budget_fit')
    expect(f.value).toBe(1)
    expect(f.why).toContain('within 1 of 1 shared budget')
    expect(f.why).toContain('1 of 2 shared no budget')
    expect(s.per_participant.find((p) => p.participant_id === 'quiet')?.budget_ok).toBeNull()
  })
})

describe('scoreOption: preference', () => {
  const withVotes = (...scores: (-1 | 0 | 1)[]) =>
    scoreOption({
      option: option({ id: 'o1' }),
      participants: scores.map((v, i) => P(`p${i}`, [rsvpIn, vote('o1', v)])),
      now: NOW,
    })

  it('maps the mean vote onto [0,1]', () => {
    expect(factor(withVotes(1, 1), 'preference').value).toBe(1)
    expect(factor(withVotes(0, 0), 'preference').value).toBe(0.5)
    expect(factor(withVotes(-1, -1), 'preference').value).toBe(0)
    expect(factor(withVotes(1, -1), 'preference').value).toBe(0.5)
  })

  it('surfaces a single −1 as a block, not just arithmetic', () => {
    const f = factor(withVotes(1, 1, 1, -1), 'preference')
    expect(f.why).toContain('3 for, 1 against')
    expect(f.why).toContain('blocked')
    expect(f.why).toContain('somebody saying no')
  })

  it('adding a positive vote raises the factor', () => {
    expect(factor(withVotes(1), 'preference').value).toBeGreaterThan(
      factor(withVotes(-1), 'preference').value,
    )
    expect(factor(withVotes(-1, 1), 'preference').value).toBeGreaterThan(
      factor(withVotes(-1), 'preference').value,
    )
  })

  it('only counts votes for THIS option', () => {
    const s = scoreOption({
      option: option({ id: 'o1' }),
      participants: [P('a', [rsvpIn, vote('o2', -1)])],
      now: NOW,
    })
    expect(factor(s, 'preference').weight).toBe(0)
    expect(s.per_participant[0]?.vote).toBeNull()
  })

  it('silence is not a neutral vote', () => {
    const f = factor(
      scoreOption({
        option: option({ id: 'o1' }),
        participants: [P('a', [rsvpIn, vote('o1', 1)]), P('quiet', [rsvpIn])],
        now: NOW,
      }),
      'preference',
    )
    expect(f.value).toBe(1)
    expect(f.why).toContain('out of 1 vote')
  })
})

describe('scoreOption: freshness and the past', () => {
  it('a future option is fresh', () => {
    const f = factor(
      scoreOption({
        option: option({ id: 'o1', when: W('19', '21') }),
        participants: [P('a', [rsvpIn])],
        now: NOW,
      }),
      'freshness',
    )
    expect(f.value).toBe(1)
    expect(f.why).toContain('Starts in 7d')
  })

  it('an option under way scores the fraction left', () => {
    const f = factor(
      scoreOption({
        option: option({ id: 'o1', when: w('2026-08-01T11:00:00Z', '2026-08-01T15:00:00Z') }),
        participants: [P('a', [rsvpIn])],
        now: NOW,
      }),
      'freshness',
    )
    expect(f.value).toBeCloseTo(0.75, 6)
    expect(f.why).toContain('3h left of 4h')
  })

  it('an option entirely in the past is EXCLUDED, not merely low-scored', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: w('2026-07-31T18:00:00Z', '2026-07-31T20:00:00Z') }),
      participants: [P('a', [rsvpIn, avail([w('2026-07-31T18:00:00Z', '2026-07-31T20:00:00Z')])])],
      now: NOW,
    })
    expect(s.excluded).toContain('in the past')
    expect(factor(s, 'freshness').value).toBe(0)
    // still visible, still scored — the group sees why it was dropped
    expect(s.score).not.toBeNull()
  })

  it('an option with no time is unscheduled, not stale', () => {
    const f = factor(
      scoreOption({ option: option({ id: 'o1' }), participants: [P('a', [rsvpIn])], now: NOW }),
      'freshness',
    )
    expect(f.weight).toBe(0)
    expect(f.why).toContain('no fixed time')
  })
})

describe('scoreOption: hard exclusions', () => {
  it('excludes a price above every shared ceiling', () => {
    const s = scoreOption({
      option: option({
        id: 'o1',
        price: { amount_minor: 9000, currency: 'USD', basis: 'per_person' },
      }),
      participants: [P('a', [rsvpIn, budget(3000)]), P('b', [rsvpIn, budget(4000)])],
      now: NOW,
    })
    expect(s.excluded).toContain('above every budget shared so far')
    expect(s.excluded).toContain('USD 40.00')
    expect(s.excluded).toContain('B')
    expect(factor(s, 'budget_fit').value).toBe(0)
  })

  it('does not exclude when at least one ceiling clears it', () => {
    const s = scoreOption({
      option: option({
        id: 'o1',
        price: { amount_minor: 3500, currency: 'USD', basis: 'per_person' },
      }),
      participants: [P('a', [rsvpIn, budget(3000)]), P('b', [rsvpIn, budget(4000)])],
      now: NOW,
    })
    expect(s.excluded).toBeNull()
    expect(factor(s, 'budget_fit').value).toBe(0.5)
  })

  it('does not exclude on price when nobody has named a budget', () => {
    const s = scoreOption({
      option: option({
        id: 'o1',
        price: { amount_minor: 900000, currency: 'USD', basis: 'per_person' },
      }),
      participants: [P('a', [rsvpIn])],
      now: NOW,
    })
    expect(s.excluded).toBeNull()
  })

  it('excludes on an explicit tag contradiction of a stated constraint', () => {
    const s = scoreOption({
      option: option({ id: 'o1', raw: { tags: { amenity: 'restaurant', 'diet:vegetarian': 'no' } } }),
      participants: [P('veg', [rsvpIn, constraint('vegetarian')], 'Priya'), P('b', [rsvpIn])],
      now: NOW,
    })
    expect(s.excluded).toContain('Priya')
    expect(s.excluded).toContain('vegetarian')
    expect(s.excluded).toContain('diet:vegetarian=no')
  })

  it('reads OSM semicolon lists', () => {
    const s = scoreOption({
      option: option({ id: 'o1', raw: { tags: { cuisine: 'american;steak_house' } } }),
      participants: [P('veg', [rsvpIn, constraint('I am vegetarian')])],
      now: NOW,
    })
    expect(s.excluded).toContain('cuisine=steak_house')
  })

  it('is conservative: an unrelated or merely unstated tag never excludes', () => {
    const italian = scoreOption({
      option: option({ id: 'o1', raw: { tags: { amenity: 'restaurant', cuisine: 'italian' } } }),
      participants: [P('veg', [rsvpIn, constraint('vegetarian')])],
      now: NOW,
    })
    expect(italian.excluded).toBeNull()

    const untagged = scoreOption({
      option: option({ id: 'o1', raw: {} }),
      participants: [P('veg', [rsvpIn, constraint('vegetarian')])],
      now: NOW,
    })
    expect(untagged.excluded).toBeNull()
  })

  it('refuses to act on a negated mention of a term', () => {
    // "no outdoor seating" must not be read as a request FOR outdoor seating.
    const negated = scoreOption({
      option: option({ id: 'o1', raw: { tags: { outdoor_seating: 'no' } } }),
      participants: [P('a', [rsvpIn, constraint('please, no outdoor seating')])],
      now: NOW,
    })
    expect(negated.excluded).toBeNull()

    const asserted = scoreOption({
      option: option({ id: 'o1', raw: { tags: { outdoor_seating: 'no' } } }),
      participants: [P('a', [rsvpIn, constraint('outdoor seating please')])],
      now: NOW,
    })
    expect(asserted.excluded).toContain('outdoor_seating=no')
  })

  it('does not read a bare mention of alcohol as abstinence', () => {
    const bare = scoreOption({
      option: option({ id: 'o1', raw: { tags: { amenity: 'bar' } } }),
      participants: [P('a', [rsvpIn, constraint('somewhere with good alcohol')])],
      now: NOW,
    })
    expect(bare.excluded).toBeNull()

    const sober = scoreOption({
      option: option({ id: 'o1', raw: { tags: { amenity: 'bar' } } }),
      participants: [P('a', [rsvpIn, constraint('no alcohol please')])],
      now: NOW,
    })
    expect(sober.excluded).toContain('amenity=bar')
  })

  it('ignores constraints from people who RSVP’d out', () => {
    const s = scoreOption({
      option: option({ id: 'o1', raw: { tags: { 'diet:vegetarian': 'no' } } }),
      participants: [
        P('a', [rsvpIn]),
        P('gone', [{ kind: 'rsvp', in: false }, constraint('vegetarian')]),
      ],
      now: NOW,
    })
    expect(s.excluded).toBeNull()
  })

  it('reads flat raw tags as well as nested ones', () => {
    const s = scoreOption({
      option: option({ id: 'o1', raw: { wheelchair: 'no' } }),
      participants: [P('a', [rsvpIn, constraint('wheelchair access needed')])],
      now: NOW,
    })
    expect(s.excluded).toContain('wheelchair=no')
  })
})

describe('scoreOption: confidence, per_participant and the arithmetic', () => {
  it('confidence is the fraction of INVITED participants who sent anything', () => {
    const s = scoreOption({
      option: option({ id: 'o1' }),
      participants: [P('a', [rsvpIn]), P('b', [{ kind: 'rsvp', in: false }]), P('quiet', [])],
      now: NOW,
    })
    expect(s.confidence).toBeCloseTo(2 / 3, 3)
  })

  it('per_participant has a row for everybody, including the silent', () => {
    const s = scoreOption({
      option: option({
        id: 'o1',
        when: W('19', '21'),
        place: ORIGIN,
        price: { amount_minor: 3000, currency: 'USD', basis: 'per_person' },
      }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')]), at(northKm(3)), budget(5000), vote('o1', 1)]),
        P('quiet', []),
      ],
      now: NOW,
    })
    expect(s.per_participant).toHaveLength(2)
    expect(s.per_participant[0]).toEqual({
      participant_id: 'a',
      name: 'A',
      time_ok: true,
      travel_km: 3,
      budget_ok: true,
      vote: 1,
    })
    expect(s.per_participant[1]).toEqual({
      participant_id: 'quiet',
      name: 'QUIET',
      time_ok: null,
      travel_km: null,
      budget_ok: null,
      vote: null,
    })
  })

  it('score is exactly the weighted mean of the weighted factors — no hidden term', () => {
    const s = scoreOption({
      option: option({
        id: 'o1',
        when: W('19', '21'),
        place: ORIGIN,
        price: { amount_minor: 3000, currency: 'USD', basis: 'per_person' },
      }),
      participants: [
        P('a', [rsvpIn, avail([W('18', '22')]), at(northKm(5)), budget(5000), vote('o1', 1)]),
        P('b', [rsvpIn, avail([W('09', '12')]), at(northKm(10)), budget(1000), vote('o1', -1)]),
      ],
      now: NOW,
    })
    const num = s.factors.reduce((acc, f) => acc + f.value * f.weight, 0)
    const den = s.factors.reduce((acc, f) => acc + f.weight, 0)
    expect(s.score).toBeCloseTo(num / den, 3)
    expect(den).toBeCloseTo(1, 6) // all five factors scoreable here
  })

  it('score is null when nothing at all could be scored', () => {
    const s = scoreOption({ option: option({ id: 'o1' }), participants: [], now: NOW })
    expect(s.score).toBeNull()
    expect(s.confidence).toBe(0)
    expect(s.factors.every((f) => f.weight === 0)).toBe(true)
  })

  it('weights are overridable, and the override is what the factor reports', () => {
    const s = scoreOption({
      option: option({ id: 'o1', when: W('19', '21') }),
      participants: [P('a', [rsvpIn, avail([W('18', '22')])])],
      now: NOW,
      weights: { time_fit: 9, freshness: 1 },
    })
    expect(factor(s, 'time_fit').weight).toBe(9)
    expect(factor(s, 'freshness').weight).toBe(1)
    expect(s.score).toBeCloseTo((1 * 9 + 1 * 1) / 10, 6)
  })
})

describe('rankOptions', () => {
  const participants = [
    P('a', [rsvpIn, avail([W('18', '22')]), at(northKm(2)), budget(5000)]),
    P('b', [rsvpIn, avail([W('19', '23')]), at(northKm(4)), budget(5000)]),
  ]

  it('orders by score, keeps excluded options visible at the bottom', () => {
    const good = option({
      id: 'good',
      when: W('19', '21'),
      place: ORIGIN,
      price: { amount_minor: 2000, currency: 'USD', basis: 'per_person' },
    })
    const meh = option({
      id: 'meh',
      when: W('09', '11'),
      place: northKm(20),
      price: { amount_minor: 4900, currency: 'USD', basis: 'per_person' },
    })
    const past = option({
      id: 'past',
      when: w('2026-07-30T19:00:00Z', '2026-07-30T21:00:00Z'),
      place: ORIGIN,
      price: { amount_minor: 100, currency: 'USD', basis: 'per_person' },
    })

    const ranked = rankOptions([past, meh, good], participants, { now: NOW })
    expect(ranked.map((r) => r.id)).toEqual(['good', 'meh', 'past'])
    expect(ranked[2]?.score.excluded).toContain('in the past')
    // excluded, but not deleted and not blanked
    expect(ranked[2]?.score.score).not.toBeNull()
    expect(ranked[2]?.score.per_participant).toHaveLength(2)
  })

  it('an option with no time is still scorable while the group has availability', () => {
    // time_fit falls back to the best common slot, so "no showtime yet" is not
    // the same as "we know nothing about this".
    const blank = option({ id: 'blank' })
    const s = rankOptions([blank], participants, { now: NOW })[0]?.score
    expect(s?.score).not.toBeNull()
    expect(factor(s as NonNullable<typeof s>, 'time_fit').weight).toBeGreaterThan(0)
  })

  it('sorts genuinely unscorable options last', () => {
    // Nobody shared availability, so the timeless option has no factor at all.
    const silent = [P('a', [rsvpIn]), P('b', [rsvpIn])]
    const scorable = option({ id: 'scorable', when: W('19', '21') })
    const blank = option({ id: 'blank' })
    const ranked = rankOptions([blank, scorable], silent, { now: NOW })
    expect(ranked.map((r) => r.id)).toEqual(['scorable', 'blank'])
    expect(ranked[1]?.score.score).toBeNull()
    expect(ranked[0]?.score.score).not.toBeNull()
  })

  it('is stable for equal scores', () => {
    const a = option({ id: 'a', when: W('19', '21') })
    const b = option({ id: 'b', when: W('19', '21') })
    expect(rankOptions([a, b], participants, { now: NOW }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(rankOptions([b, a], participants, { now: NOW }).map((r) => r.id)).toEqual(['b', 'a'])
  })
})

// ===========================================================================
// Properties
// ===========================================================================

const windowArb: fc.Arbitrary<TimeWindow> = fc
  .tuple(fc.integer({ min: 0, max: 48 }), fc.integer({ min: 0, max: 12 }))
  .map(([startH, lenH]) => {
    const base = Date.parse('2026-08-08T00:00:00Z')
    return {
      start: new Date(base + startH * HOUR).toISOString(),
      end: new Date(base + (startH + lenH) * HOUR).toISOString(),
    }
  })

const windowsArb = fc.array(windowArb, { maxLength: 8 })

describe('interval properties', () => {
  it('normalise is idempotent', () => {
    fc.assert(
      fc.property(windowsArb, (ws) => {
        const once = normalise(ws)
        expect(normalise(once)).toEqual(once)
      }),
    )
  })

  it('normalise is permutation-invariant and preserves total covered duration', () => {
    fc.assert(
      fc.property(windowsArb, fc.nat(), (ws, seed) => {
        const shuffled = [...ws]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = (seed + i * 7919) % (i + 1)
          const a = shuffled[i] as TimeWindow
          shuffled[i] = shuffled[j] as TimeWindow
          shuffled[j] = a
        }
        expect(normalise(shuffled)).toEqual(normalise(ws))
        expect(totalDurationMs(shuffled)).toBe(totalDurationMs(ws))
      }),
    )
  })

  it('normalise output is sorted, disjoint and non-empty', () => {
    fc.assert(
      fc.property(windowsArb, (ws) => {
        const out = normalise(ws)
        for (let i = 0; i < out.length; i++) {
          const cur = out[i] as TimeWindow
          expect(Date.parse(cur.end)).toBeGreaterThan(Date.parse(cur.start))
          const next = out[i + 1]
          // strictly separated: adjacency would have been merged
          if (next) expect(Date.parse(next.start)).toBeGreaterThan(Date.parse(cur.end))
        }
      }),
    )
  })

  it('intersect is commutative and idempotent', () => {
    fc.assert(
      fc.property(windowsArb, windowsArb, (a, b) => {
        expect(intersect(a, b)).toEqual(intersect(b, a))
        expect(intersect(a, a)).toEqual(normalise(a))
      }),
    )
  })

  it('intersect never exceeds either input, and equals overlapMs piecewise', () => {
    fc.assert(
      fc.property(windowsArb, windowsArb, (a, b) => {
        const both = totalDurationMs(intersect(a, b))
        expect(both).toBeLessThanOrEqual(totalDurationMs(a))
        expect(both).toBeLessThanOrEqual(totalDurationMs(b))
        const viaOverlap = normalise(a).reduce((s, x) => s + overlapMs(x, b), 0)
        expect(viaOverlap).toBe(both)
      }),
    )
  })

  it('bestCommonWindows: every reported window really does suit everyone listed', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(windowsArb, fc.boolean()), { minLength: 1, maxLength: 5 }),
        (people) => {
          const parts = people.map(([windows, anytime], i) => ({ id: `p${i}`, windows, anytime }))
          const out = bestCommonWindows(parts, { minDurationMs: HOUR })
          for (const c of out) {
            expect(c.count).toBe(c.available.length)
            expect(c.available.length + c.unavailable.length).toBe(parts.length)
            for (const id of c.available) {
              const p = parts.find((x) => x.id === id)
              if (!p) throw new Error('unknown id')
              // the whole reported window, not just part of it
              expect(p.anytime || coversWindow(p.windows, c.window)).toBe(true)
            }
          }
          // ranked: never a lower-count window before a higher-count one
          for (let i = 1; i < out.length; i++) {
            expect((out[i - 1] as { count: number }).count).toBeGreaterThanOrEqual(
              (out[i] as { count: number }).count,
            )
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

// --- ranking properties ----------------------------------------------------

const signalsArb: fc.Arbitrary<SignalPayload[]> = fc
  .record({
    rsvp: fc.option(fc.boolean(), { nil: undefined }),
    windows: fc.option(windowsArb, { nil: undefined }),
    anytime: fc.boolean(),
    lat: fc.option(fc.double({ min: -60, max: 60, noNaN: true }), { nil: undefined }),
    lng: fc.option(fc.double({ min: -170, max: 170, noNaN: true }), { nil: undefined }),
    ceiling: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
    currency: fc.constantFrom('USD', 'EUR'),
    v: fc.option(fc.constantFrom<-1 | 0 | 1>(-1, 0, 1), { nil: undefined }),
    text: fc.option(fc.constantFrom('vegetarian', 'no alcohol', 'quiet please'), { nil: undefined }),
  })
  .map((r) => {
    const out: SignalPayload[] = []
    if (r.rsvp !== undefined) out.push({ kind: 'rsvp', in: r.rsvp })
    if (r.windows !== undefined) out.push({ kind: 'availability', windows: r.windows, anytime: r.anytime })
    if (r.lat !== undefined && r.lng !== undefined) out.push({ kind: 'location', place: place('p', r.lat, r.lng) })
    if (r.ceiling !== undefined) out.push({ kind: 'budget', ceiling_minor: r.ceiling, currency: r.currency })
    if (r.v !== undefined) out.push({ kind: 'vote', option_id: 'o1', score: r.v })
    if (r.text !== undefined) out.push({ kind: 'constraint', text: r.text })
    return out
  })

const optionArb: fc.Arbitrary<OptionInput & { id: string }> = fc
  .record({
    hasWhen: fc.boolean(),
    when: windowArb,
    hasPlace: fc.boolean(),
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lng: fc.double({ min: -170, max: 170, noNaN: true }),
    hasPrice: fc.boolean(),
    amount: fc.integer({ min: 0, max: 500_000 }),
    currency: fc.constantFrom('USD', 'EUR'),
    basis: fc.constantFrom<'per_person' | 'total' | 'unknown'>('per_person', 'total', 'unknown'),
    tags: fc.dictionary(fc.constantFrom('amenity', 'cuisine', 'diet:vegetarian'), fc.constantFrom('bar', 'no', 'italian', 'steak_house'), { maxKeys: 3 }),
  })
  .map((r) => ({
    id: 'o1',
    source: 'overpass' as const,
    title: 'opt',
    raw: { tags: r.tags },
    when: r.hasWhen ? r.when : null,
    place: r.hasPlace ? place('venue', r.lat, r.lng) : null,
    price: r.hasPrice
      ? { amount_minor: r.amount, currency: r.currency, basis: r.basis }
      : null,
  }))

describe('scoring properties', () => {
  it('every factor value is in [0,1] and the score is in [0,1] or null', () => {
    fc.assert(
      fc.property(
        optionArb,
        fc.array(signalsArb, { maxLength: 6 }),
        (opt, signalSets) => {
          const s = scoreOption({
            option: opt,
            participants: signalSets.map((sig, i) => P(`p${i}`, sig)),
            now: NOW,
          })
          for (const f of s.factors) {
            expect(f.value).toBeGreaterThanOrEqual(0)
            expect(f.value).toBeLessThanOrEqual(1)
            expect(f.weight).toBeGreaterThanOrEqual(0)
            expect(f.why.length).toBeGreaterThan(0)
          }
          if (s.score !== null) {
            expect(s.score).toBeGreaterThanOrEqual(0)
            expect(s.score).toBeLessThanOrEqual(1)
          }
          expect(s.confidence).toBeGreaterThanOrEqual(0)
          expect(s.confidence).toBeLessThanOrEqual(1)
          expect(s.per_participant).toHaveLength(signalSets.length)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('preference is monotone: another +1 never lowers it (mirrors policy.ts)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<-1 | 0 | 1>(-1, 0, 1), { maxLength: 8 }),
        (votes) => {
          const base = votes.map((v, i) => P(`p${i}`, [rsvpIn, vote('o1', v)]))
          const before = factor(
            scoreOption({ option: option({ id: 'o1' }), participants: base, now: NOW }),
            'preference',
          )
          const after = factor(
            scoreOption({
              option: option({ id: 'o1' }),
              participants: [...base, P('newcomer', [rsvpIn, vote('o1', 1)])],
              now: NOW,
            }),
            'preference',
          )
          expect(after.value).toBeGreaterThanOrEqual(before.value)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('time_fit is monotone: another participant who can make it never lowers it', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 6 }), (canMake) => {
        const slot = W('19', '21')
        const base = canMake.map((ok, i) =>
          P(`p${i}`, [rsvpIn, avail([ok ? W('18', '22') : W('09', '12')])]),
        )
        const before = factor(
          scoreOption({ option: option({ id: 'o1', when: slot }), participants: base, now: NOW }),
          'time_fit',
        )
        const after = factor(
          scoreOption({
            option: option({ id: 'o1', when: slot }),
            participants: [...base, P('extra', [rsvpIn, avail([W('18', '22')])])],
            now: NOW,
          }),
          'time_fit',
        )
        expect(after.value).toBeGreaterThanOrEqual(before.value)
      }),
      { numRuns: 200 },
    )
  })

  it('travel_fit never increases when someone moves further away', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 60, noNaN: true }), { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0, max: 40, noNaN: true }),
        (kms, extra) => {
          const value = (list: number[]) =>
            factor(
              scoreOption({
                option: option({ id: 'o1', place: ORIGIN }),
                participants: list.map((km, i) => P(`p${i}`, [rsvpIn, at(northKm(km))])),
                now: NOW,
              }),
              'travel_fit',
            ).value
          const near = value(kms)
          const far = value(kms.map((k) => k + extra))
          expect(far).toBeLessThanOrEqual(near + 1e-9)
        },
      ),
      { numRuns: 200 },
    )
  })
})
