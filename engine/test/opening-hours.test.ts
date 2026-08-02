import { describe, expect, it } from 'vitest'
import { isOpenDuring, parseOpeningHours } from '../src/plan/opening-hours.js'
import type { TimeWindow } from '../src/plan/types.js'

// Sat 2026-08-08 is used throughout plan-math.test.ts too; kept consistent so
// a failure here is easy to cross-reference against the ranker's own tests.
const w = (start: string, end: string): TimeWindow => ({
  start: `2026-08-08T${start}:00Z`,
  end: `2026-08-08T${end}:00Z`,
})
// The Sunday after, for weekday-selector coverage.
const sun = (start: string, end: string): TimeWindow => ({
  start: `2026-08-09T${start}:00Z`,
  end: `2026-08-09T${end}:00Z`,
})

describe('parseOpeningHours', () => {
  it('parses a genuine multi-group OSM string', () => {
    const rules = parseOpeningHours('Mo-Fr 09:00-22:00; Sa-Su 10:00-23:00')
    expect(rules).not.toBeNull()
    expect(rules).toHaveLength(2)
    expect(rules![0]).toEqual({ days: new Set([0, 1, 2, 3, 4]), times: [{ startMin: 540, endMin: 1320 }], off: false })
    expect(rules![1]).toEqual({ days: new Set([5, 6]), times: [{ startMin: 600, endMin: 1380 }], off: false })
  })

  it('parses 24/7', () => {
    const rules = parseOpeningHours('24/7')
    expect(rules).toEqual([{ days: new Set([0, 1, 2, 3, 4, 5, 6]), times: [{ startMin: 0, endMin: 1440 }], off: false }])
  })

  it('parses comma-separated split-shift hours applied to every day', () => {
    const rules = parseOpeningHours('Mo-Su 11:00-15:00,19:00-23:00')
    expect(rules).toHaveLength(1)
    expect(rules![0]!.days).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
    expect(rules![0]!.times).toEqual([
      { startMin: 660, endMin: 900 },
      { startMin: 1140, endMin: 1380 },
    ])
  })

  it('treats bare hours with no day selector as every day', () => {
    const rules = parseOpeningHours('09:00-18:00')
    expect(rules).toEqual([{ days: new Set([0, 1, 2, 3, 4, 5, 6]), times: [{ startMin: 540, endMin: 1080 }], off: false }])
  })

  it('reads an overnight span as crossing midnight', () => {
    const rules = parseOpeningHours('Fr-Sa 18:00-02:00')
    expect(rules![0]!.times).toEqual([{ startMin: 1080, endMin: 1560 }]) // 18:00 .. 26:00
  })

  it('reads a single closed day layered over general hours', () => {
    const rules = parseOpeningHours('Mo-Su 09:00-18:00; Su off')
    expect(rules).toHaveLength(2)
    expect(rules![1]).toEqual({ days: new Set([6]), times: [], off: true })
  })

  it('is null for an empty string', () => {
    expect(parseOpeningHours('')).toBeNull()
    expect(parseOpeningHours('   ')).toBeNull()
  })

  it('is null for unparseable garbage rather than guessing', () => {
    expect(parseOpeningHours('banana')).toBeNull()
  })

  it('is null for a time missing its colon/leading zero (not a format we understand)', () => {
    expect(parseOpeningHours('Mo-Fr 9-22')).toBeNull()
  })

  it('is null when real hours are followed by unrecognised trailing text', () => {
    expect(parseOpeningHours('Mo-Fr 09:00-22:00 open all day please')).toBeNull()
  })

  it('is null for unsupported selectors (public holidays) rather than half-understanding them', () => {
    expect(parseOpeningHours('PH off')).toBeNull()
    expect(parseOpeningHours('Mo-Fr 09:00-17:00; PH off')).toBeNull()
  })

  it('is null for a day selector with nothing after it', () => {
    expect(parseOpeningHours('Mo-Fr')).toBeNull()
  })
})

describe('isOpenDuring', () => {
  it('24/7 is open for any window', () => {
    const r = isOpenDuring('24/7', w('02', '04'))
    expect(r).toEqual({ known: true, openMs: 2 * 3_600_000, totalMs: 2 * 3_600_000, fullyOpen: true, fullyClosed: false })
  })

  it('fully open: the window sits entirely inside the stated hours', () => {
    const r = isOpenDuring('Mo-Fr 09:00-22:00; Sa-Su 10:00-23:00', w('19', '21')) // Saturday
    expect(r.known).toBe(true)
    expect(r.fullyOpen).toBe(true)
    expect(r.fullyClosed).toBe(false)
  })

  it('fully closed: zero overlap with the stated hours', () => {
    // Saturday 03:00-05:00 is nowhere near 10:00-23:00.
    const r = isOpenDuring('Mo-Fr 09:00-22:00; Sa-Su 10:00-23:00', w('03', '05'))
    expect(r.known).toBe(true)
    expect(r.fullyClosed).toBe(true)
    expect(r.fullyOpen).toBe(false)
  })

  it('partially open: reports exactly how much of the window is covered', () => {
    // Open until 22:00; the window runs 21:00-23:00 on a weekday (Saturday
    // here is 10-23 though, so use the weekday rule via Friday-equivalent
    // Saturday hours would be fully open — use a weekday window instead.
    const r = isOpenDuring('Mo-Fr 09:00-22:00; Sa-Su 10:00-23:00', w('21', '23'))
    // Saturday hours are 10:00-23:00, so 21:00-23:00 is fully open — assert
    // that directly instead, and separately check a genuine partial case.
    expect(r.fullyOpen).toBe(true)

    const partial = isOpenDuring('Mo-Fr 09:00-22:00', sun('21', '23')) // Sunday: not in Mo-Fr at all
    expect(partial.fullyClosed).toBe(true)

    // A real partial case: open 19:00-22:00 on Saturday, window 21:00-23:00.
    const trulyPartial = isOpenDuring('Sa 19:00-22:00', w('21', '23'))
    expect(trulyPartial.known).toBe(true)
    expect(trulyPartial.fullyOpen).toBe(false)
    expect(trulyPartial.fullyClosed).toBe(false)
    expect(trulyPartial.openMs).toBe(1 * 3_600_000) // only 21:00-22:00 overlaps
    expect(trulyPartial.totalMs).toBe(2 * 3_600_000)
  })

  it('an overnight span correctly covers the following morning', () => {
    // Bar open Friday 18:00 through Saturday 02:00. A Saturday 00:30-01:30
    // window should be covered even though "Saturday" itself has no rule.
    const r = isOpenDuring('Fr 18:00-02:00', {
      start: '2026-08-08T00:30:00Z', // Saturday
      end: '2026-08-08T01:30:00Z',
    })
    expect(r.known).toBe(true)
    expect(r.fullyOpen).toBe(true)
  })

  it('the closed weekday rule wins over general hours for that day', () => {
    const r = isOpenDuring('Mo-Su 09:00-18:00; Su off', sun('10', '12'))
    expect(r.known).toBe(true)
    expect(r.fullyClosed).toBe(true)
  })

  it('is unknown, not falsely open or closed, when the spec cannot be parsed', () => {
    const r = isOpenDuring('banana', w('19', '21'))
    expect(r.known).toBe(false)
    expect(r.fullyOpen).toBe(false)
    expect(r.fullyClosed).toBe(false)
  })

  it('is unknown when there is no spec at all', () => {
    expect(isOpenDuring(undefined, w('19', '21')).known).toBe(false)
    expect(isOpenDuring(null, w('19', '21')).known).toBe(false)
    expect(isOpenDuring('', w('19', '21')).known).toBe(false)
  })

  it('timezone-agnostic instant comparison still applies: an equivalent offset window matches', () => {
    const offsetWindow: TimeWindow = { start: '2026-08-08T22:30:00+02:00', end: '2026-08-09T00:30:00+02:00' } // 20:30-22:30Z
    const r = isOpenDuring('Sa 19:00-23:00', offsetWindow)
    expect(r.known).toBe(true)
    expect(r.fullyOpen).toBe(true)
  })
})
