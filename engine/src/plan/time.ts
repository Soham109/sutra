import type { TimeWindow } from './types.js'

// ---------------------------------------------------------------------------
// Interval algebra over TimeWindow.
//
// Every window is half-open [start, end): the instant `end` is NOT in the
// window. That choice is what makes "18:00–20:00" and "20:00–22:00" two
// adjacent slots rather than two slots that both own 20:00, and it is why
// merging touches (`next.start <= cur.end`) is correct rather than sloppy.
//
// Internally everything is epoch milliseconds. ISO-8601 strings are parsed
// once on the way in and formatted once on the way out; no comparison in this
// file is ever done on strings, because "2026-08-01T12:00:00Z" and
// "2026-08-01T14:00:00+02:00" are the same instant with different bytes.
//
// Pure. No I/O, no clock reads — `now` is always passed in by the caller.
// ---------------------------------------------------------------------------

/** Epoch-millisecond form of a TimeWindow. Internal only. */
interface Span {
  start: number
  end: number
}

function toSpan(w: TimeWindow): Span {
  return { start: Date.parse(w.start), end: Date.parse(w.end) }
}

function toWindow(s: Span): TimeWindow {
  return { start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() }
}

/**
 * Sort, merge overlapping/adjacent, drop empty. Also drops unparseable spans:
 * a window we cannot read is not a window we may guess at.
 */
function normaliseSpans(spans: Span[]): Span[] {
  const clean = spans
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const out: Span[] = []
  for (const s of clean) {
    const last = out[out.length - 1]
    // `<=` merges touching intervals: with half-open windows [a,b) ∪ [b,c) is
    // exactly [a,c) with no gap and no double-counted instant.
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end
    } else {
      out.push({ start: s.start, end: s.end })
    }
  }
  return out
}

/** Sort, merge overlapping and adjacent windows, drop zero-length ones. */
export function normalise(windows: TimeWindow[]): TimeWindow[] {
  return normaliseSpans(windows.map(toSpan)).map(toWindow)
}

/**
 * Two-pointer intersection of two normalised span lists. Both inputs are
 * sorted and disjoint, so each pointer only ever moves forward: O(n+m).
 */
function intersectSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a[i] as Span
    const y = b[j] as Span
    const start = Math.max(x.start, y.start)
    const end = Math.min(x.end, y.end)
    if (end > start) out.push({ start, end })
    // Retire whichever interval ends first; the other may still meet the next.
    if (x.end < y.end) i++
    else j++
  }
  return out
}

/** Windows present in both sets. Inputs need not be normalised; output is. */
export function intersect(a: TimeWindow[], b: TimeWindow[]): TimeWindow[] {
  return intersectSpans(normaliseSpans(a.map(toSpan)), normaliseSpans(b.map(toSpan))).map(toWindow)
}

/** Length of a single window in milliseconds; 0 if unparseable or inverted. */
export function windowDurationMs(w: TimeWindow): number {
  const s = toSpan(w)
  if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return 0
  return Math.max(0, s.end - s.start)
}

/** Total covered time across a set of windows, counting overlaps once. */
export function totalDurationMs(windows: TimeWindow[]): number {
  return normaliseSpans(windows.map(toSpan)).reduce((sum, s) => sum + (s.end - s.start), 0)
}

/** How much of `w` is covered by `windows`, in milliseconds. */
export function overlapMs(w: TimeWindow, windows: TimeWindow[]): number {
  const span = toSpan(w)
  if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) return 0
  return intersectSpans([span], normaliseSpans(windows.map(toSpan))).reduce(
    (sum, s) => sum + (s.end - s.start),
    0,
  )
}

/** Is the instant inside any window? Half-open: `end` itself is not covered. */
export function coversInstant(windows: TimeWindow[], iso: string): boolean {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  return normaliseSpans(windows.map(toSpan)).some((s) => s.start <= t && t < s.end)
}

/** Is every instant of `w` covered by `windows`? A zero-length `w` is not. */
export function coversWindow(windows: TimeWindow[], w: TimeWindow): boolean {
  const need = windowDurationMs(w)
  if (need === 0) return false
  return overlapMs(w, windows) === need
}

// ---------------------------------------------------------------------------
// bestCommonWindows — the coordination primitive.
// ---------------------------------------------------------------------------

export interface ParticipantAvailability {
  id: string
  windows: TimeWindow[]
  /** "any time works" — categorically different from "I sent no windows" */
  anytime: boolean
}

export interface CommonWindow {
  window: TimeWindow
  /** participants who can make the WHOLE window, in input order */
  available: string[]
  /** everyone else, including participants who never answered */
  unavailable: string[]
  count: number
}

export interface BestCommonOptions {
  minDurationMs: number
  limit?: number
}

/** How many candidates we hand back when the caller does not say. */
export const DEFAULT_COMMON_WINDOW_LIMIT = 5

const subsetOf = (sub: bigint, sup: bigint): boolean => (sub & sup) === sub

/**
 * Candidate meeting windows, ranked by how many participants can make them.
 *
 * ## Why a boundary sweep is correct
 *
 * Availability only ever changes at an instant where somebody's window starts
 * or ends. Take every such instant, sort them, and the timeline is cut into
 * "elementary segments" between consecutive boundaries. Inside a segment no
 * window begins or ends, so the set of available participants is constant
 * throughout it — testing the segment's start instant answers for the whole
 * segment. That is the entire correctness argument, and it is why we do not
 * need to intersect participants pairwise: the sweep computes the availability
 * of ALL n participants over the whole timeline in one pass, O(W log W) for W
 * total windows (the sort), instead of O(n²) list intersections that still
 * would not tell you who is in each resulting slot.
 *
 * ## From segments to candidates
 *
 * A candidate is a maximal window over which some exact set S of participants
 * is available end-to-end. For a segment with availability mask m we grow left
 * and right while the neighbouring segment's mask is a superset of m — every
 * member of S is still free there. Growth stops at the first segment missing
 * somebody in S, and gaps stop it too (an empty segment is a superset of no
 * non-empty set), so the result is contiguous by construction.
 *
 * The set available across the grown window [lo,hi] is the intersection of all
 * masks in it. That intersection is exactly m: it contains m (we only crossed
 * supersets) and it is contained in mask[i] = m (segment i is in the range).
 * So `available` is honest — everybody listed can make the whole window — and
 * (lo,hi) determines its mask, which is why deduping on the range is safe.
 *
 * ## Who counts
 *
 * - `anytime: true` participants are available for every candidate. They are
 *   deliberately kept out of the sweep so they contribute no boundaries — a
 *   person who is free always must not be able to invent a meeting slot.
 * - Participants who sent nothing (no windows, not anytime) are NEVER counted
 *   as available. Silence is not agreement. They are reported in
 *   `unavailable` so the caller can see whom it is still waiting on.
 * - If nobody sent a concrete window we return [] rather than inventing one:
 *   with only "anytime" answers there is no evidence about when to meet.
 */
export function bestCommonWindows(
  participants: ParticipantAvailability[],
  opts: BestCommonOptions,
): CommonWindow[] {
  const limit = opts.limit ?? DEFAULT_COMMON_WINDOW_LIMIT
  const minDuration = Math.max(0, opts.minDurationMs)

  const timed: { id: string; spans: Span[] }[] = []
  const anytimeIds = new Set<string>()
  for (const p of participants) {
    if (p.anytime) {
      anytimeIds.add(p.id)
      continue
    }
    const spans = normaliseSpans(p.windows.map(toSpan))
    if (spans.length > 0) timed.push({ id: p.id, spans })
    // else: silent. Not added anywhere — they fall out as `unavailable`.
  }
  if (timed.length === 0) return []

  // --- sweep: collect and sort every boundary instant -----------------------
  const boundarySet = new Set<number>()
  for (const p of timed) {
    for (const s of p.spans) {
      boundarySet.add(s.start)
      boundarySet.add(s.end)
    }
  }
  const bounds = [...boundarySet].sort((a, b) => a - b)
  const segCount = bounds.length - 1
  if (segCount < 1) return []

  // --- paint each elementary segment with the mask of who covers it --------
  const masks = new Array<bigint>(segCount).fill(0n)
  timed.forEach((p, pi) => {
    const bit = 1n << BigInt(pi)
    let seg = 0
    // p.spans is sorted and disjoint, and `bounds` is sorted, so the segment
    // cursor only moves forward across the participant's whole window list.
    for (const s of p.spans) {
      while (seg < segCount && (bounds[seg] as number) < s.start) seg++
      while (seg < segCount && (bounds[seg + 1] as number) <= s.end) {
        masks[seg] = (masks[seg] as bigint) | bit
        seg++
      }
    }
  })

  // --- grow each segment into the maximal window for its exact set ---------
  const seen = new Set<string>()
  const candidates: { lo: number; hi: number; mask: bigint }[] = []
  for (let i = 0; i < segCount; i++) {
    const mask = masks[i] as bigint
    if (mask === 0n) continue
    let lo = i
    let hi = i
    while (lo > 0 && subsetOf(mask, masks[lo - 1] as bigint)) lo--
    while (hi + 1 < segCount && subsetOf(mask, masks[hi + 1] as bigint)) hi++
    const key = `${lo}:${hi}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ lo, hi, mask })
  }

  const order = new Map(participants.map((p, idx) => [p.id, idx]))
  const results: (CommonWindow & { _duration: number; _start: number })[] = []
  for (const c of candidates) {
    const start = bounds[c.lo] as number
    const end = bounds[c.hi + 1] as number
    const duration = end - start
    if (duration < minDuration) continue

    const availableTimed = new Set<string>()
    timed.forEach((p, pi) => {
      if ((c.mask >> BigInt(pi)) & 1n) availableTimed.add(p.id)
    })

    const available: string[] = []
    const unavailable: string[] = []
    for (const p of participants) {
      if (anytimeIds.has(p.id) || availableTimed.has(p.id)) available.push(p.id)
      else unavailable.push(p.id)
    }

    results.push({
      window: toWindow({ start, end }),
      available,
      unavailable,
      count: available.length,
      _duration: duration,
      _start: start,
    })
  }

  // Most people first; then the longest slot; then the earliest. The final
  // tiebreak on id order keeps the output deterministic for identical slots.
  results.sort(
    (a, b) =>
      b.count - a.count ||
      b._duration - a._duration ||
      a._start - b._start ||
      (order.get(a.available[0] ?? '') ?? 0) - (order.get(b.available[0] ?? '') ?? 0),
  )

  return results.slice(0, limit).map(({ window, available, unavailable, count }) => ({
    window,
    available,
    unavailable,
    count,
  }))
}
