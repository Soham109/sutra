import type {
  OptionInput,
  OptionScore,
  Place,
  ScoreFactor,
  SignalPayload,
  TimeWindow,
} from './types.js'
import { travelCost } from './geo.js'
import { bestCommonWindows, coversWindow, type ParticipantAvailability } from './time.js'
import { isOpenDuring } from './opening-hours.js'

// ---------------------------------------------------------------------------
// The explainable scorer.
//
// The UI renders `factors` verbatim, so every number in here has to be
// arithmetic a human can re-derive from the data in front of them. That
// constraint drives three rules the rest of this file obeys without exception:
//
//  1. NO HIDDEN TERMS. `score` is exactly the weighted mean of the factors
//     that carry weight. If a factor could not be scored its weight is set to
//     0 and its `why` says why — a factor that quietly contributes a guessed
//     0.5 would be a lie the UI cannot catch.
//  2. EVERY CURVE IS LINEAR AND STATED. "12.5 km of a 25 km ceiling scores
//     0.5" is checkable in your head. A logistic would be smoother and
//     unverifiable, so it is not here.
//  3. SILENCE IS NEVER AGREEMENT. A participant who sent no signal is never
//     counted as a yes. Each factor's treatment of a missing signal is
//     documented on the factor itself; the shared rule is that the silent are
//     dropped from that factor's DENOMINATOR (so they neither approve nor
//     veto an option they said nothing about) and their absence is stated in
//     the `why` sentence, while overall `confidence` — a separate number —
//     carries the "we have barely heard from anyone" warning.
//
// Rule 3's alternative (counting the silent as a `no`) was rejected on
// purpose: it penalises every option identically, so it changes no ordering
// while making every displayed fraction misleading.
//
// Pure. No I/O, no clock reads — `now` is passed in.
// ---------------------------------------------------------------------------

export type FactorKey = ScoreFactor['key']

/**
 * Default weights. They sum to 1.00 so a factor's weight reads directly as
 * "this is N% of the score".
 *
 *  time_fit   0.35  If people cannot make it, nothing else matters. Highest
 *                   weight because it is the only factor that can be a hard
 *                   no for a whole group.
 *  travel_fit 0.25  The most common reason a plan quietly dies.
 *  budget_fit 0.25  Equal to travel: money and distance are the two real
 *                   costs and neither should dominate the other.
 *  preference 0.10  Votes are a deliberately coarse nudge (the signal type is
 *                   only -1/0/+1), so they break ties rather than decide.
 *  freshness  0.05  A tie-breaker. Its real job is the hard exclusion of past
 *                   options, which does not run through the weight at all.
 */
export const DEFAULT_WEIGHTS: Record<FactorKey, number> = {
  time_fit: 0.35,
  travel_fit: 0.25,
  budget_fit: 0.25,
  preference: 0.1,
  freshness: 0.05,
}

/**
 * Distance at which travel_fit hits 0. 25 km is roughly "across a large city"
 * — far enough that most people stop treating a trip as casual. Overridable
 * per plan; a road trip and a lunch have different ceilings.
 */
export const DEFAULT_MAX_ACCEPTABLE_KM = 25

/**
 * How much of the worst individual trip (as opposed to the average trip)
 * travel_fit reflects. See `travel_fit` below for why this is 0.5.
 */
export const TRAVEL_WORST_WEIGHT = 0.5

/** Minimum length of a proposed meeting slot when the option has no time. */
export const DEFAULT_MIN_DURATION_MS = 60 * 60 * 1000

export interface RankParticipant {
  id: string
  name: string
  signals: SignalPayload[]
}

export interface RankInput {
  option: OptionInput & { id: string }
  participants: RankParticipant[]
  /** weights are explicit and overridable so the UI can show them */
  weights?: Partial<Record<FactorKey, number>>
  now: Date
  /** distance at which travel_fit reaches 0; default 25 km */
  maxAcceptableKm?: number
  /** slot length to look for when the option carries no `when`; default 1h */
  minDurationMs?: number
}

export type RankOptionsOpts = Omit<RankInput, 'option' | 'participants'>

// ---------------------------------------------------------------------------
// Small formatting helpers. These exist so `why` sentences quote the same
// numbers the UI shows elsewhere.
// ---------------------------------------------------------------------------

/** ISO 4217 currencies with no minor unit. Everything else assumes 2 dp. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF', 'UGX', 'RWF'])

function money(minor: number, currency: string): string {
  const cur = currency.toUpperCase()
  return ZERO_DECIMAL.has(cur) ? `${cur} ${minor}` : `${cur} ${(minor / 100).toFixed(2)}`
}

function fmtWindow(w: TimeWindow): string {
  const s = new Date(w.start)
  const e = new Date(w.end)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const hm = (d: Date) => d.toISOString().slice(11, 16)
  return day(s) === day(e)
    ? `${day(s)} ${hm(s)}–${hm(e)} UTC`
    : `${day(s)} ${hm(s)} → ${day(e)} ${hm(e)} UTC`
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function list(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
const round3 = (n: number): number => Math.round(n * 1000) / 1000

// ---------------------------------------------------------------------------
// Reading signals.
// ---------------------------------------------------------------------------

/**
 * Signals are an append-only log, so a participant may have changed their
 * mind. The LAST signal of a kind wins; earlier ones are history, not votes.
 */
function latest<K extends SignalPayload['kind']>(
  signals: SignalPayload[],
  kind: K,
): Extract<SignalPayload, { kind: K }> | null {
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i]
    if (s && s.kind === kind) return s as Extract<SignalPayload, { kind: K }>
  }
  return null
}

interface View {
  id: string
  name: string
  /** null = never answered. Distinct from `false` = said no. */
  rsvp: boolean | null
  /** null = never shared times. An empty non-anytime signal counts as null. */
  avail: { windows: TimeWindow[]; anytime: boolean } | null
  place: Place | null
  budget: { ceiling_minor: number; currency: string } | null
  vote: number | null
  constraints: string[]
  sentAny: boolean
}

function viewOf(p: RankParticipant, optionId: string): View {
  const rsvp = latest(p.signals, 'rsvp')
  const availSignal = latest(p.signals, 'availability')
  const loc = latest(p.signals, 'location')
  const budget = latest(p.signals, 'budget')
  const votes = p.signals.filter(
    (s): s is Extract<SignalPayload, { kind: 'vote' }> =>
      s.kind === 'vote' && s.option_id === optionId,
  )
  const constraints = p.signals
    .filter((s): s is Extract<SignalPayload, { kind: 'constraint' }> => s.kind === 'constraint')
    .map((s) => s.text)

  // An availability signal carrying neither `anytime` nor any window tells us
  // nothing — treat it as unanswered rather than as "free never".
  const avail =
    availSignal && (availSignal.anytime || availSignal.windows.length > 0)
      ? { windows: availSignal.windows, anytime: availSignal.anytime }
      : null

  return {
    id: p.id,
    name: p.name,
    rsvp: rsvp ? rsvp.in : null,
    avail,
    place: loc ? loc.place : null,
    budget: budget ? { ceiling_minor: budget.ceiling_minor, currency: budget.currency } : null,
    vote: votes.length > 0 ? (votes[votes.length - 1] as { score: number }).score : null,
    constraints,
    sentAny: p.signals.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Conservative constraint matching.
//
// A constraint is free text ("vegetarian", "no alcohol please"), and an
// option's `raw` is whatever its source returned — for Overpass, OSM tags.
// We only exclude on an EXPLICIT contradiction: a tag that is present and
// carries a value that flatly rules the constraint out.
//
// This is deliberately timid, and the asymmetry is the reason: a wrongly
// excluded option disappears from the group's board and nobody ever learns it
// existed, while a wrongly included one is merely voted down in ten seconds.
// So we never infer from a tag's ABSENCE (an untagged restaurant is not
// assumed to be meat-only), never guess from the title, and never act on a
// negated mention of a term ("no outdoor seating" must not be read as a
// request for outdoor seating).
// ---------------------------------------------------------------------------

interface ConstraintRule {
  /** lowercase phrases that select this rule when found in the constraint text */
  terms: string[]
  /** tag key → values that explicitly contradict the constraint */
  contradicts: { key: string; values: string[] }[]
}

const CONSTRAINT_RULES: ConstraintRule[] = [
  {
    terms: ['vegetarian', 'veggie', 'no meat', 'meat free', 'meat-free'],
    contradicts: [
      { key: 'diet:vegetarian', values: ['no'] },
      { key: 'cuisine', values: ['steak_house', 'barbecue', 'bbq', 'seafood'] },
    ],
  },
  { terms: ['vegan'], contradicts: [{ key: 'diet:vegan', values: ['no'] }] },
  { terms: ['halal'], contradicts: [{ key: 'diet:halal', values: ['no'] }] },
  { terms: ['kosher'], contradicts: [{ key: 'diet:kosher', values: ['no'] }] },
  {
    terms: ['gluten', 'coeliac', 'celiac'],
    contradicts: [{ key: 'diet:gluten_free', values: ['no'] }],
  },
  {
    // Note: no bare 'alcohol' term — "alcohol" alone may well be a request FOR
    // it. Only unambiguous abstinence phrasings select this rule.
    terms: ['no alcohol', 'alcohol free', 'alcohol-free', 'sober', 'teetotal', 'non-alcoholic'],
    contradicts: [
      { key: 'amenity', values: ['bar', 'pub', 'nightclub', 'biergarten'] },
      { key: 'alcohol', values: ['only'] },
    ],
  },
  {
    terms: ['wheelchair', 'step free', 'step-free', 'accessible', 'accessibility'],
    contradicts: [{ key: 'wheelchair', values: ['no'] }],
  },
  {
    // 'smoking=dedicated' means a separate smoking room exists, which does not
    // contradict "no smoking" for our participant. Only 'yes' (permitted
    // throughout) does.
    terms: ['no smoking', 'non smoking', 'non-smoking', 'smoke free', 'smoke-free'],
    contradicts: [{ key: 'smoking', values: ['yes'] }],
  },
  {
    terms: ['outdoor', 'outside', 'patio', 'terrace', 'al fresco'],
    contradicts: [{ key: 'outdoor_seating', values: ['no'] }],
  },
]

const NEGATOR = /\b(no|not|non|without|isn't|dont|don't|doesn't|avoid|except)\s+$/

/**
 * Does `text` assert `term`? A term preceded by a negator is refused rather
 * than matched: "without outdoor seating" contains "outdoor" but means the
 * opposite, and acting on it would exclude exactly the wrong venues.
 */
function mentions(text: string, term: string): boolean {
  const i = text.indexOf(term)
  if (i < 0) return false
  if (term.startsWith('no ') || term.startsWith('non')) return true
  return !NEGATOR.test(text.slice(Math.max(0, i - 14), i))
}

/**
 * Flatten an option's `raw` into lowercase tag key → values. Sources put OSM
 * tags either under `raw.tags` (Overpass elements) or flat at the top level,
 * so we read both. Semicolons are OSM's list separator (`cuisine=pizza;italian`).
 */
function rawTags(raw: Record<string, unknown>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const absorb = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') continue
      const key = k.toLowerCase()
      const values = v
        .toLowerCase()
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
      out.set(key, [...(out.get(key) ?? []), ...values])
    }
  }
  absorb(raw)
  const nested = raw['tags']
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    absorb(nested as Record<string, unknown>)
  }
  return out
}

/**
 * A venue's `opening_hours`, wherever the source put it. Overpass venues
 * carry it both flattened onto the option (`raw.opening_hours`, already
 * trimmed by places/overpass.ts) and inside the untouched tag dump
 * (`raw.tags.opening_hours`); either is read, top-level first.
 */
function openingHoursSpecOf(raw: Record<string, unknown>): string | undefined {
  const top = raw['opening_hours']
  if (typeof top === 'string' && top.trim()) return top
  const tags = raw['tags']
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    const nested = (tags as Record<string, unknown>)['opening_hours']
    if (typeof nested === 'string' && nested.trim()) return nested
  }
  return undefined
}

interface ConstraintViolation {
  participant: string
  constraint: string
  tag: string
  value: string
}

function findConstraintViolation(
  views: View[],
  raw: Record<string, unknown>,
): ConstraintViolation | null {
  const tags = rawTags(raw)
  if (tags.size === 0) return null
  for (const v of views) {
    for (const text of v.constraints) {
      const lower = text.toLowerCase()
      for (const rule of CONSTRAINT_RULES) {
        if (!rule.terms.some((t) => mentions(lower, t))) continue
        for (const c of rule.contradicts) {
          const present = tags.get(c.key)
          if (!present) continue
          const hit = present.find((val) => c.values.includes(val))
          if (hit) return { participant: v.name, constraint: text, tag: c.key, value: hit }
        }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// scoreOption
// ---------------------------------------------------------------------------

/** A factor that could not be computed: neutral value, ZERO weight, stated why. */
function unscored(key: FactorKey, why: string): ScoreFactor {
  return { key, value: 0.5, weight: 0, why }
}

export function scoreOption(input: RankInput): OptionScore {
  const { option, now } = input
  const nowMs = now.getTime()
  const maxKm = input.maxAcceptableKm ?? DEFAULT_MAX_ACCEPTABLE_KM
  const minDurationMs = input.minDurationMs ?? DEFAULT_MIN_DURATION_MS
  const W: Record<FactorKey, number> = { ...DEFAULT_WEIGHTS }
  for (const [k, v] of Object.entries(input.weights ?? {})) {
    if (typeof v === 'number' && Number.isFinite(v)) W[k as FactorKey] = Math.max(0, v)
  }

  const views = input.participants.map((p) => viewOf(p, option.id))

  // Who the score is about. Anyone who said "out" is excluded from every
  // denominator — their availability and budget are no longer the group's
  // problem. If NOBODY has RSVP'd in yet we score against everyone still in
  // play rather than against an empty set, and say so.
  const accepted = views.filter((v) => v.rsvp === true)
  const attending = accepted.length > 0 ? accepted : views.filter((v) => v.rsvp !== false)
  const rsvpAssumed = accepted.length === 0
  const whoSuffix = rsvpAssumed ? ' (nobody has RSVP’d yet, so everyone is counted)' : ''

  // ---- time_fit ----------------------------------------------------------
  // Missing signal: a participant with no availability is dropped from both
  // sides of the fraction and named in `why` as still-unheard-from.
  const timed = attending.filter((v) => v.avail !== null)
  const timeSilent = attending.length - timed.length
  const silentNote =
    timeSilent > 0 ? `; ${timeSilent} of ${attending.length} have not shared times` : ''

  const availabilityOf = (v: View): ParticipantAvailability => ({
    id: v.id,
    windows: v.avail?.windows ?? [],
    anytime: v.avail?.anytime ?? false,
  })

  const canMake = (v: View, w: TimeWindow): boolean =>
    v.avail !== null && (v.avail.anytime || coversWindow(v.avail.windows, w))

  let timeFactor: ScoreFactor
  /** the window per-participant `time_ok` is measured against */
  let referenceWindow: TimeWindow | null = option.when ?? null

  if (option.when) {
    if (timed.length === 0) {
      timeFactor = unscored(
        'time_fit',
        `Nobody has shared availability yet, so we cannot tell who can make ${fmtWindow(option.when)}.`,
      )
    } else {
      const ok = timed.filter((v) => canMake(v, option.when as TimeWindow))
      timeFactor = {
        key: 'time_fit',
        value: clamp01(ok.length / timed.length),
        weight: W.time_fit,
        why: `${ok.length} of ${timed.length} who shared availability can make ${fmtWindow(option.when)}${silentNote}${whoSuffix}.`,
      }
    }
  } else {
    // No fixed time on this option: score it against the best slot the group
    // could actually agree on, and say plainly that that is what happened.
    const candidates = bestCommonWindows(attending.map(availabilityOf), {
      minDurationMs,
      limit: 1,
    })
    const top = candidates[0]
    if (!top || timed.length === 0) {
      timeFactor = unscored(
        'time_fit',
        'This option has no fixed time, and there is not enough shared availability to propose one.',
      )
    } else {
      referenceWindow = top.window
      timeFactor = {
        key: 'time_fit',
        value: clamp01(top.count / timed.length),
        weight: W.time_fit,
        why: `No fixed time on this option, so it is scored against the best common slot instead: ${fmtWindow(top.window)} (${fmtDuration(Date.parse(top.window.end) - Date.parse(top.window.start))}) suits ${top.count} of ${timed.length} who shared availability${silentNote}${whoSuffix}.`,
      }
    }
  }

  // ---- opening hours -------------------------------------------------------
  // Not a weighted factor of its own — see the module doc on opening-hours.ts
  // for why silence about a venue's hours must not become a guess. Instead it
  // does two honest things with whatever it can determine: appends a checkable
  // note to time_fit when the venue is only partly open across the proposed
  // window, and — below, in hard exclusions — refuses to let an option win
  // when it is provably closed for the WHOLE of that window. A recommendation
  // for somewhere shut is the most common way this kind of feature loses trust.
  const openingHoursSpec = openingHoursSpecOf(option.raw)
  const openingCheck =
    referenceWindow && openingHoursSpec ? isOpenDuring(openingHoursSpec, referenceWindow) : null
  if (openingCheck?.known && !openingCheck.fullyOpen) {
    const note = openingCheck.fullyClosed
      ? ` This place looks closed the whole of that window — its listed hours are "${openingHoursSpec}".`
      : ` It is only open ${fmtDuration(openingCheck.openMs)} of that ${fmtDuration(openingCheck.totalMs)} window — its listed hours are "${openingHoursSpec}".`
    timeFactor = { ...timeFactor, why: timeFactor.why + note }
  }

  // ---- travel_fit --------------------------------------------------------
  // Curve: fit(km) = clamp(1 - km / maxAcceptableKm, 0, 1). Linear, so 0 km
  // scores 1.0, half the ceiling scores 0.5, and anything at or beyond the
  // ceiling scores 0 — all re-derivable from the kilometre figures printed
  // next to it.
  //
  // Blend: value = 0.5 * (mean of each person's fit) + 0.5 * (worst person's
  // fit). The mean alone hides the outlier — four people at 1 km and one at
  // 40 km average to 8.8 km, which reads "nearby" while one person crosses
  // the city. An even split means that one bad trip can cost at most half the
  // factor, and can never be averaged away entirely.
  //
  // Note we average the FITS, not the distances: past the ceiling the clamp
  // bites, and averaging distances first would let a 100 km outlier drag
  // everyone's score below zero-clamped truth.
  //
  // Missing signal: participants with no location signal are simply not
  // travelling anywhere as far as we know, so they are left out of the
  // calculation and counted in `why`.
  const fit = (km: number): number => clamp01(1 - km / maxKm)
  const travellers = attending.filter((v) => v.place !== null)
  const optionPlace = option.place ?? null

  let travelFactor: ScoreFactor
  let travelKm = new Map<string, number>()
  if (!optionPlace) {
    travelFactor = unscored('travel_fit', 'This option has no location, so there is nothing to travel to.')
  } else if (travellers.length === 0) {
    travelFactor = unscored(
      'travel_fit',
      `Nobody has shared where they are travelling from, so the distance to ${optionPlace.label} is unknown.`,
    )
  } else {
    const cost = travelCost(
      travellers.map((v) => v.place as Place),
      optionPlace,
    )
    travelKm = new Map(travellers.map((v, i) => [v.id, cost.per_point[i]?.km ?? 0]))
    const meanFit = cost.per_point.reduce((s, p) => s + fit(p.km), 0) / cost.per_point.length
    const worstIdx = cost.per_point.findIndex((p) => p.km === cost.max_km)
    const worstName = travellers[worstIdx]?.name ?? 'someone'
    const value = (1 - TRAVEL_WORST_WEIGHT) * meanFit + TRAVEL_WORST_WEIGHT * fit(cost.max_km)
    const missing = attending.length - travellers.length
    travelFactor = {
      key: 'travel_fit',
      value: clamp01(value),
      weight: W.travel_fit,
      why: `Average trip ${cost.mean_km} km, longest ${cost.max_km} km (${worstName}), over ${travellers.length} who shared a location${missing > 0 ? ` (${missing} did not)` : ''}. Scored against a ${maxKm} km ceiling, half on the average trip and half on the longest one.`,
    }
  }

  // ---- budget_fit --------------------------------------------------------
  // Missing signal: no budget = not counted. The fraction is over the people
  // who actually named a ceiling, and `why` prints that denominator so a 1/1
  // is never mistaken for unanimity.
  //
  // Currency is NEVER coerced. A EUR ceiling and a USD price are not
  // comparable without a rate we do not have, so mismatched signals are
  // dropped from the arithmetic and named explicitly in `why`.
  const price = option.price ?? null
  const headcount = Math.max(1, attending.length)
  const budgetsGiven = attending.filter((v) => v.budget !== null)
  let comparable: View[] = []
  let mismatched: View[] = []
  let withinBudget: View[] = []
  let perPersonMinor: number | null = null
  let budgetFactor: ScoreFactor

  if (!price) {
    budgetFactor = unscored('budget_fit', 'This option has no price, so there is nothing to compare.')
  } else if (price.basis === 'unknown') {
    budgetFactor = unscored(
      'budget_fit',
      `${money(price.amount_minor, price.currency)} is listed without a basis — we do not know whether that is per person or for the whole group — so it is not compared with anyone’s ceiling.`,
    )
  } else {
    perPersonMinor =
      price.basis === 'total' ? Math.ceil(price.amount_minor / headcount) : price.amount_minor
    comparable = budgetsGiven.filter(
      (v) => (v.budget as { currency: string }).currency.toUpperCase() === price.currency.toUpperCase(),
    )
    mismatched = budgetsGiven.filter((v) => !comparable.includes(v))
    withinBudget = comparable.filter(
      (v) => (v.budget as { ceiling_minor: number }).ceiling_minor >= (perPersonMinor as number),
    )

    const basisNote =
      price.basis === 'total'
        ? `${money(price.amount_minor, price.currency)} total ÷ ${headcount} ${headcount === 1 ? 'person' : 'people'} = ${money(perPersonMinor, price.currency)} each`
        : `${money(price.amount_minor, price.currency)} per person`
    const mismatchNote =
      mismatched.length > 0
        ? ` ${mismatched.length} budget${mismatched.length === 1 ? '' : 's'} in ${list([...new Set(mismatched.map((v) => (v.budget as { currency: string }).currency.toUpperCase()))])} could not be compared with a ${price.currency.toUpperCase()} price and were left out.`
        : ''

    if (comparable.length === 0) {
      budgetFactor = unscored(
        'budget_fit',
        `${basisNote}, but no comparable budget was shared.${mismatchNote}`,
      )
    } else {
      budgetFactor = {
        key: 'budget_fit',
        value: clamp01(withinBudget.length / comparable.length),
        weight: W.budget_fit,
        why: `${basisNote}; within ${withinBudget.length} of ${comparable.length} shared budget${comparable.length === 1 ? '' : 's'}${budgetsGiven.length < attending.length ? ` (${attending.length - budgetsGiven.length} of ${attending.length} shared no budget)` : ''}.${mismatchNote}`,
      }
    }
  }

  // ---- preference --------------------------------------------------------
  // Mapping: value = (mean vote + 1) / 2, so all -1 → 0, all neutral → 0.5,
  // all +1 → 1. Monotone: a mean can never exceed +1, so adding another +1
  // never lowers it.
  //
  // Missing signal: a non-voter is not a neutral vote. Neutral (0) is
  // something a person chose; silence is not, and folding the two together
  // would let one enthusiastic +1 be diluted by six people who never opened
  // the link.
  const voters = attending.filter((v) => v.vote !== null)
  let preferenceFactor: ScoreFactor
  if (voters.length === 0) {
    preferenceFactor = unscored('preference', 'Nobody has voted on this option yet.')
  } else {
    const mean = voters.reduce((s, v) => s + (v.vote as number), 0) / voters.length
    const up = voters.filter((v) => v.vote === 1)
    const down = voters.filter((v) => v.vote === -1)
    const neutral = voters.length - up.length - down.length
    const blockNote =
      down.length > 0
        ? ` ${list(down.map((v) => v.name))} ${down.length === 1 ? 'has' : 'have'} blocked it — a −1 is somebody saying no, not just a point off the total.`
        : ''
    preferenceFactor = {
      key: 'preference',
      value: clamp01((mean + 1) / 2),
      weight: W.preference,
      why: `${up.length} for, ${down.length} against, ${neutral} neutral out of ${voters.length} ${voters.length === 1 ? 'vote' : 'votes'}.${blockNote}`,
    }
  }

  // ---- freshness ---------------------------------------------------------
  // Curve, in full: an option starting in the future scores 1; one already
  // under way scores the fraction of it that is left; one wholly in the past
  // scores 0 AND is hard-excluded below, because a low score would still let
  // it outrank a live option on the other factors.
  //
  // Missing signal: no `when` means there is nothing to age, so weight 0
  // rather than a fabricated penalty — options without times are not stale,
  // they are unscheduled.
  const when = option.when ?? null
  let freshnessFactor: ScoreFactor
  const endMs = when ? Date.parse(when.end) : NaN
  const startMs = when ? Date.parse(when.start) : NaN
  const isPast = Number.isFinite(endMs) && endMs <= nowMs

  if (!when || !Number.isFinite(endMs) || !Number.isFinite(startMs)) {
    freshnessFactor = unscored('freshness', 'This option has no fixed time, so it cannot be stale.')
  } else if (isPast) {
    freshnessFactor = {
      key: 'freshness',
      value: 0,
      weight: W.freshness,
      why: `Ended ${fmtDuration(nowMs - endMs)} ago (${fmtWindow(when)}).`,
    }
  } else if (startMs <= nowMs) {
    const total = endMs - startMs
    freshnessFactor = {
      key: 'freshness',
      value: clamp01((endMs - nowMs) / total),
      weight: W.freshness,
      why: `Already under way: ${fmtDuration(endMs - nowMs)} left of ${fmtDuration(total)}.`,
    }
  } else {
    freshnessFactor = {
      key: 'freshness',
      value: 1,
      weight: W.freshness,
      why: `Starts in ${fmtDuration(startMs - nowMs)}.`,
    }
  }

  // ---- hard exclusions ---------------------------------------------------
  // An excluded option keeps its score and stays on the board, greyed. The
  // group is told what ruled it out; it does not silently vanish.
  let excluded: string | null = null
  if (when && isPast) {
    excluded = `This is in the past — it ended ${fmtDuration(nowMs - endMs)} ago, at ${fmtWindow(when)}.`
  }
  if (!excluded && price && perPersonMinor !== null && comparable.length > 0 && withinBudget.length === 0) {
    // The price itself is public — it is the option's own listed number, the
    // same one budget_fit's `why` already prints. The highest CEILING and
    // whose it was are not: summarySignal keeps a budget off the timeline as
    // "never the number", and an excluded reason that named "the highest is
    // USD 40.00, from B" would leak exactly that number, attributed, through
    // a channel nobody thought to check. Say what happened in aggregate only.
    excluded = `${money(perPersonMinor, price.currency)} per person is above every budget shared so far — none of the ${comparable.length} shared budget${comparable.length === 1 ? '' : 's'} covers it.`
  }
  // Closed the WHOLE proposed window, per its own listed hours — not "might
  // be shut", a confident zero-overlap read of a tag OSM actually published.
  // Partial closure (open for some of the window) is a note on time_fit
  // above, not an exclusion: the group can still meet in the part that's open.
  if (!excluded && openingCheck?.known && openingCheck.fullyClosed && referenceWindow) {
    excluded = `This is closed during ${fmtWindow(referenceWindow)} — its listed hours are "${openingHoursSpec}".`
  }
  if (!excluded) {
    const violation = findConstraintViolation(attending, option.raw)
    if (violation) {
      excluded = `${violation.participant} asked for “${violation.constraint}”, and this option is tagged ${violation.tag}=${violation.value}.`
    }
  }

  // ---- assembly ----------------------------------------------------------
  const factors: ScoreFactor[] = [
    timeFactor,
    travelFactor,
    budgetFactor,
    preferenceFactor,
    freshnessFactor,
  ].map((f) => ({ ...f, value: round3(clamp01(f.value)) }))

  const weightSum = factors.reduce((s, f) => s + f.weight, 0)
  const score =
    weightSum > 0
      ? round3(clamp01(factors.reduce((s, f) => s + f.value * f.weight, 0) / weightSum))
      : null

  const per_participant = views.map((v) => ({
    participant_id: v.id,
    name: v.name,
    time_ok: referenceWindow === null || v.avail === null ? null : canMake(v, referenceWindow),
    travel_km: travelKm.has(v.id) ? (travelKm.get(v.id) as number) : null,
    budget_ok:
      price === null ||
      price.basis === 'unknown' ||
      perPersonMinor === null ||
      v.budget === null ||
      v.budget.currency.toUpperCase() !== price.currency.toUpperCase()
        ? null
        : v.budget.ceiling_minor >= perPersonMinor,
    vote: v.vote,
  }))

  // Confidence is over INVITED participants, not attending ones: it is the
  // "how much of this group have we actually heard from" number, and someone
  // who RSVP'd out has still told us something.
  const confidence =
    views.length === 0 ? 0 : round3(views.filter((v) => v.sentAny).length / views.length)

  return { score, factors, excluded, confidence, per_participant }
}

// ---------------------------------------------------------------------------
// rankOptions
// ---------------------------------------------------------------------------

/**
 * Score every option and order them: live options before excluded ones, then
 * by score descending, then by input order. Unscorable options (score null)
 * sort after scored ones — "we know nothing about this" is not a good result.
 *
 * Excluded options are RETURNED, never dropped. The group gets to see that
 * the cheap place was ruled out by somebody's dietary constraint.
 */
export function rankOptions(
  options: (OptionInput & { id: string })[],
  participants: RankParticipant[],
  opts: RankOptionsOpts,
): { id: string; score: OptionScore }[] {
  const scored = options.map((option, index) => ({
    id: option.id,
    score: scoreOption({ ...opts, option, participants }),
    index,
  }))

  scored.sort((a, b) => {
    const aEx = a.score.excluded !== null ? 1 : 0
    const bEx = b.score.excluded !== null ? 1 : 0
    if (aEx !== bEx) return aEx - bEx
    const aS = a.score.score
    const bS = b.score.score
    if (aS === null && bS === null) return a.index - b.index
    if (aS === null) return 1
    if (bS === null) return -1
    return bS - aS || a.index - b.index
  })

  return scored.map(({ id, score }) => ({ id, score }))
}

// ---------------------------------------------------------------------------
// Ties and near-misses.
//
// A ranked list always has a first row, whether or not the arithmetic behind
// it is decisive. Two options within noise of each other should say so rather
// than let one arbitrarily-earlier option in the input read as a clear
// winner, and an option that lost only to a hard exclusion — not to being a
// worse fit — deserves to be named rather than buried at the bottom of the
// board next to options nobody would have picked anyway.
// ---------------------------------------------------------------------------

/**
 * How close two scores have to be to call them a tie rather than a winner.
 * Most factors are fractions over a handful of people — one more or fewer
 * RSVP can swing a factor by 0.1–0.33 — so anything within 0.05 of the best
 * live score is well inside the noise of a single participant's next answer,
 * and presenting a definite rank order there overstates the arithmetic's
 * precision.
 */
export const NEAR_TIE_EPSILON = 0.05

export interface RankSummary {
  /** ids of live options within NEAR_TIE_EPSILON of the best live score — length 0 or ≥2 */
  near_ties: string[]
  /** the best-scoring option that got hard-excluded, if any, and the one reason it lost */
  strongest_rejected: { id: string; score: number; reason: string } | null
}

/** Pure post-processing over rankOptions' output — adds nothing rankOptions itself must compute. */
export function summariseRanking(scored: { id: string; score: OptionScore }[]): RankSummary {
  const live = scored.filter(
    (s): s is { id: string; score: OptionScore & { score: number } } =>
      s.score.excluded === null && s.score.score !== null,
  )
  let near_ties: string[] = []
  if (live.length >= 2) {
    const best = Math.max(...live.map((s) => s.score.score))
    const tied = live.filter((s) => best - s.score.score <= NEAR_TIE_EPSILON)
    if (tied.length >= 2) near_ties = tied.map((s) => s.id)
  }

  const excludedScored = scored.filter(
    (s): s is { id: string; score: OptionScore & { score: number; excluded: string } } =>
      s.score.excluded !== null && s.score.score !== null,
  )
  let strongest_rejected: RankSummary['strongest_rejected'] = null
  if (excludedScored.length > 0) {
    const top = excludedScored.reduce((a, b) => (b.score.score > a.score.score ? b : a))
    strongest_rejected = { id: top.id, score: top.score.score, reason: top.score.excluded }
  }

  return { near_ties, strongest_rejected }
}

// ---------------------------------------------------------------------------
// Explaining a re-rank.
//
// ranked() recomputes from scratch on every read, so the board is always
// correct — but "correct" and "explained" are different things. A group that
// refreshes the page to find Sablewood has quietly climbed from 3rd to 1st
// has no way to know whether that is a bug or Maya just became free. This
// section is the diff that turns a silent reshuffle into a sentence:
// diffRankings compares a snapshot taken before a signal against one taken
// after, and reasonForMove tries to name the SPECIFIC thing that changed for
// the participant who just answered before falling back to a generic,
// still-honest description of what kind of signal arrived.
//
// Pure. Both inputs are ordinary rankOptions() output; nothing here reads a
// clock or touches storage — the caller (plan/service.ts) owns the snapshots.
// ---------------------------------------------------------------------------

export interface RankSnapshotEntry {
  id: string
  title: string
  score: OptionScore
}

export interface RankMove {
  option_id: string
  title: string
  /** 1-based board position, matching what a person actually sees */
  from_rank: number
  to_rank: number
  reason: string
}

/** How far into the board a move has to touch before it is worth narrating. */
const HEADLINE_RANK = 3
/** A burst of small shuffles from one signal is noise, not news. */
const MAX_MOVES_REPORTED = 3

/**
 * Did this participant's answer to THIS option flip in a way that explains
 * the move? Checked against the concrete per_participant row rather than the
 * aggregate score, so the sentence names a fact ("Maya can now make it") a
 * person can check, not a guess about which factor moved the needle.
 */
function reasonForMove(
  participantId: string,
  participantName: string,
  kind: SignalPayload['kind'],
  before: OptionScore,
  after: OptionScore,
): string {
  const b = before.per_participant.find((p) => p.participant_id === participantId)
  const a = after.per_participant.find((p) => p.participant_id === participantId)
  if (b && a) {
    if (b.time_ok !== true && a.time_ok === true) return `${participantName} can now make it`
    if (b.time_ok === true && a.time_ok !== true) return `${participantName} can no longer make it`
    if (b.budget_ok !== true && a.budget_ok === true) return `${participantName}’s budget now covers this`
    if (b.budget_ok === true && a.budget_ok !== true) return `${participantName}’s budget no longer covers this`
    if (b.vote !== a.vote && a.vote === 1) return `${participantName} voted for it`
    if (b.vote !== a.vote && a.vote === -1) return `${participantName} voted against it`
  }
  // No specific flip explains it (the move is a side effect on a factor this
  // participant doesn't have a per-participant row for, e.g. travel when
  // someone else's location changed) — fall back to the honest, generic
  // description of what actually arrived rather than inventing a cause.
  switch (kind) {
    case 'availability':
      return `${participantName} shared when they can make it`
    case 'rsvp':
      return `${participantName} responded`
    case 'budget':
      return `${participantName} set a budget`
    case 'location':
      return `${participantName} shared where they’re coming from`
    case 'vote':
      return `${participantName} voted`
    case 'constraint':
      return `${participantName} added a constraint`
    default:
      return `${participantName} updated their answer`
  }
}

/**
 * Compare two ordered boards and report the moves worth telling the group
 * about. An option that exists in only one snapshot (the board was
 * regenerated, not reordered) is not a "move" — that case already gets its
 * own `options.generated` event. An option that was unranked (`score: null`)
 * on either side is skipped for the same reason `rankOptions` sorts
 * unscorable options last instead of first: jumping out of "we know nothing
 * yet" is the INITIAL ranking, not something that moved.
 */
export function diffRankings(
  before: RankSnapshotEntry[],
  after: RankSnapshotEntry[],
  who: { participantId: string; participantName: string; kind: SignalPayload['kind'] },
): RankMove[] {
  const beforeRank = new Map(before.map((o, i) => [o.id, i + 1]))
  const beforeById = new Map(before.map((o) => [o.id, o]))

  const moves: RankMove[] = []
  after.forEach((o, i) => {
    const fromRank = beforeRank.get(o.id)
    if (fromRank === undefined) return
    const toRank = i + 1
    if (fromRank === toRank) return
    const b = beforeById.get(o.id)!
    if (b.score.score === null || o.score.score === null) return
    if (fromRank > HEADLINE_RANK && toRank > HEADLINE_RANK) return

    moves.push({
      option_id: o.id,
      title: o.title,
      from_rank: fromRank,
      to_rank: toRank,
      reason: reasonForMove(who.participantId, who.participantName, who.kind, b.score, o.score),
    })
  })

  // Biggest jumps first — the headline move, not whatever happened to be
  // first in the input order.
  moves.sort((x, y) => Math.abs(y.from_rank - y.to_rank) - Math.abs(x.from_rank - x.to_rank))
  return moves.slice(0, MAX_MOVES_REPORTED)
}

const ORDINAL_SUFFIX = (n: number): string => {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/** "Sablewood moved from 3rd to 1st — Maya can now make it." Ready to render verbatim. */
export function describeMove(m: RankMove): string {
  const ord = (n: number) => `${n}${ORDINAL_SUFFIX(n)}`
  return `${m.title} moved from ${ord(m.from_rank)} to ${ord(m.to_rank)} — ${m.reason}.`
}
