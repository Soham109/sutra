import { overlapMs, windowDurationMs } from './time.js'
import type { TimeWindow } from './types.js'

// ---------------------------------------------------------------------------
// OSM opening_hours → whether a venue is open during a proposed window.
//
// A venue that is provably closed for the whole time a group is proposing to
// meet must not win a ranking. That is the single most common way a "great
// recommendation" turns out to be useless, and OSM publishes exactly the tag
// that would have caught it (`opening_hours`) on most venues that have any
// hours at all.
//
// The full OSM opening_hours grammar (osm.wiki/Key:opening_hours) covers
// public holidays, month/week ranges, sunrise/sunset, comments in quotes and
// a fallback-rule operator. Supporting all of it is not worth the risk of
// getting the uncommon 5% subtly wrong in a way nobody would catch. This
// parser covers the pattern that accounts for the overwhelming majority of
// real tags — day selectors, time ranges, "24/7", and "off"/"closed" — and
// for anything else it says so (`known: false`) rather than guessing. Silence
// about a venue's hours is honest; a wrong guess about them is not.
//
// **Timezone**: OSM's opening_hours is wall-clock time at the venue, with no
// timezone of its own. This module (like the rest of the plan/ layer — see
// time.ts's header) works entirely in UTC instants, so the UTC clock time of
// the reference window is read AS the venue's local time. That is exactly
// right when the group and the venue share a timezone (the overwhelmingly
// common case: nobody is planning dinner across a timezone boundary) and
// silently wrong by the UTC offset otherwise. Nothing in this codebase tracks
// a per-place timezone today, so this is a documented limitation inherited
// from the rest of the system, not a new one introduced here.
//
// Pure. No I/O, no clock reads.
// ---------------------------------------------------------------------------

/** One `;`-separated rule group, expanded to the days and minute-of-day ranges it covers. */
export interface DayRule {
  /** 0 = Monday … 6 = Sunday */
  days: Set<number>
  /** minutes since that day's midnight; `endMin` may exceed 1440 for a span that crosses midnight */
  times: { startMin: number; endMin: number }[]
  /** an explicit "off"/"closed" rule — clears any hours a prior rule gave these days */
  off: boolean
}

const DAY_TOKENS: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 }
const DAY_TOKEN_RE = /^(mo|tu|we|th|fr|sa|su)$/i
const DAY_SELECTOR_RE =
  /^(mo|tu|we|th|fr|sa|su)(-(mo|tu|we|th|fr|sa|su))?(,(mo|tu|we|th|fr|sa|su)(-(mo|tu|we|th|fr|sa|su))?)*$/i

/**
 * Free OSM `opening_hours` text → structured rules, or `null` when the text
 * uses anything this parser does not confidently understand. `null` is a real
 * answer, the same way `resolveCategory` returning `null` is in taxonomy.ts:
 * the caller falls back to "we don't know" rather than acting on a guess.
 */
export function parseOpeningHours(raw: string): DayRule[] | null {
  const spec = raw.trim()
  if (!spec) return null
  if (/^24\/7$/i.test(spec)) {
    return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), times: [{ startMin: 0, endMin: 1440 }], off: false }]
  }

  const groups = spec.split(';').map((g) => g.trim()).filter(Boolean)
  if (groups.length === 0) return null

  const rules: DayRule[] = []
  for (const group of groups) {
    const rule = parseGroup(group)
    // One unparseable group makes the whole spec unknown rather than
    // partially trusted — a schedule that is half-understood is not
    // meaningfully different from one that is not understood at all, and
    // silently dropping the confusing half would be a guess wearing the
    // clothes of a fact.
    if (!rule) return null
    rules.push(rule)
  }
  return rules
}

function parseGroup(group: string): DayRule | null {
  const parts = group.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null

  let days: Set<number>
  let rest: string[]
  if (DAY_SELECTOR_RE.test(parts[0]!)) {
    const expanded = expandDaySelector(parts[0]!)
    if (!expanded) return null
    days = expanded
    rest = parts.slice(1)
  } else {
    // No day selector: OSM's own reading is "every day".
    days = new Set([0, 1, 2, 3, 4, 5, 6])
    rest = parts
  }

  if (rest.length === 0) return null // a day selector with nothing after it is not a schedule we can use
  const tail = rest.join(' ')

  if (/^(off|closed)$/i.test(tail)) return { days, times: [], off: true }

  const times = parseTimeRanges(tail)
  if (!times) return null
  return { days, times, off: false }
}

function expandDaySelector(token: string): Set<number> | null {
  const out = new Set<number>()
  for (const piece of token.split(',')) {
    const [a, b] = piece.split('-')
    if (!a || !DAY_TOKEN_RE.test(a)) return null
    const ai = DAY_TOKENS[a.toLowerCase()]!
    if (!b) {
      out.add(ai)
      continue
    }
    if (!DAY_TOKEN_RE.test(b)) return null
    const bi = DAY_TOKENS[b.toLowerCase()]!
    // A range may wrap the week, e.g. "Fr-Mo" meaning Fri, Sat, Sun, Mon.
    let i = ai
    out.add(i)
    while (i !== bi) {
      i = (i + 1) % 7
      out.add(i)
    }
  }
  return out
}

/** `,`-separated `HH:MM-HH:MM` ranges. A range ending at or before its start crosses midnight. */
function parseTimeRanges(text: string): { startMin: number; endMin: number }[] | null {
  const out: { startMin: number; endMin: number }[] = []
  for (const token of text.split(',')) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(token.trim())
    if (!m) return null
    const sh = Number(m[1])
    const sm = Number(m[2])
    const eh = Number(m[3])
    const em = Number(m[4])
    // OSM permits times up to 24:00 (end of day) and slightly beyond for a
    // late-night carry-over notation (e.g. 25:00 = 01:00 next day); bounded
    // generously rather than exactly, since a value outside this is almost
    // certainly a typo we should not pretend to understand.
    if (sh < 0 || sh > 27 || eh < 0 || eh > 27 || sm > 59 || em > 59) return null
    let startMin = sh * 60 + sm
    let endMin = eh * 60 + em
    if (endMin <= startMin) endMin += 1440
    out.push({ startMin, endMin })
  }
  return out.length > 0 ? out : null
}

/**
 * Rules applied in order, later rules overriding earlier ones for the days
 * they name — the common real-world idiom this exists for is a general rule
 * plus a closed day, e.g. `Mo-Su 09:00-18:00; Su off`. Rules that add
 * different hours to the same days (a lunch rule and a separate dinner rule)
 * legitimately accumulate rather than override, which is what happens here
 * whenever the later rule is not an explicit "off".
 */
function evaluate(rules: DayRule[]): Map<number, { startMin: number; endMin: number }[]> {
  const byDay = new Map<number, { startMin: number; endMin: number }[]>()
  for (let d = 0; d < 7; d++) byDay.set(d, [])
  for (const rule of rules) {
    for (const day of rule.days) {
      if (rule.off) byDay.set(day, [])
      else byDay.set(day, [...(byDay.get(day) ?? []), ...rule.times])
    }
  }
  return byDay
}

export interface OpeningCheck {
  /** false when the spec could not be parsed, or the window itself is unusable */
  known: boolean
  /** how much of the window falls inside the venue's stated hours */
  openMs: number
  totalMs: number
  fullyOpen: boolean
  /** true only when NONE of the window is open — the case that must exclude an option */
  fullyClosed: boolean
}

const UNKNOWN = (totalMs: number): OpeningCheck => ({
  known: false,
  openMs: 0,
  totalMs,
  fullyOpen: false,
  fullyClosed: false,
})

/** How many calendar days a single check will expand across, how ever long the window. */
const MAX_DAYS_SPANNED = 8
const DAY_MS = 86_400_000

/**
 * Is a venue open during `window`? Expands the parsed weekly schedule across
 * the calendar days the window touches (as concrete UTC instants) and reuses
 * time.ts's own interval arithmetic (`overlapMs`) to measure the overlap —
 * the same algebra `bestCommonWindows` and the rest of this layer already
 * trust, rather than a second, independent implementation of interval math.
 */
export function isOpenDuring(spec: string | undefined | null, window: TimeWindow): OpeningCheck {
  const totalMs = windowDurationMs(window)
  if (!spec || totalMs === 0) return UNKNOWN(totalMs)

  const rules = parseOpeningHours(spec)
  if (!rules) return UNKNOWN(totalMs)

  const startMs = Date.parse(window.start)
  const endMs = Date.parse(window.end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return UNKNOWN(totalMs)

  const byDay = evaluate(rules)
  const openWindows: TimeWindow[] = []
  // Start one calendar day EARLY. A rule's own interval is anchored to ITS
  // day's midnight, so an overnight rule like "Fr 18:00-02:00" is stored
  // against Friday and only extends past Friday's midnight when expanded —
  // a window that starts at 00:30 Saturday would miss it entirely if the
  // sweep began on Saturday, because Saturday itself carries no rule of its
  // own. Going back one day catches any single midnight crossing; the parser
  // never produces a span longer than 24h, so one day of lookback is enough.
  const firstDay = Math.floor(startMs / DAY_MS) * DAY_MS - DAY_MS
  const lastDay = Math.floor(endMs / DAY_MS) * DAY_MS
  for (let d = firstDay, i = 0; d <= lastDay && i < MAX_DAYS_SPANNED; d += DAY_MS, i++) {
    const jsDay = new Date(d).getUTCDay() // 0 = Sunday .. 6 = Saturday
    const dayIndex = (jsDay + 6) % 7 // 0 = Monday .. 6 = Sunday
    for (const iv of byDay.get(dayIndex) ?? []) {
      openWindows.push({
        start: new Date(d + iv.startMin * 60_000).toISOString(),
        end: new Date(d + iv.endMin * 60_000).toISOString(),
      })
    }
  }

  const openMs = overlapMs(window, openWindows)
  return { known: true, openMs, totalMs, fullyOpen: openMs >= totalMs, fullyClosed: openMs === 0 }
}
