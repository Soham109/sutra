import { z } from 'zod'
import { PlaceSchema, WindowSchema, type SignalKind, type SignalPayload, type Slots, type TimeWindow } from '../plan/types.js'

// ---------------------------------------------------------------------------
// Standing rules — a human's answers, set in advance, to the coordination
// questions a delegate agent will be asked on their behalf.
//
// decideSignals is the load-bearing function in this whole feature and it is
// deliberately narrow: pure, synchronous, no I/O, no clock read of its own —
// the plan is passed in exactly as the caller sees it. That is what makes a
// delegate's refusals trustworthy. It cannot reach out and guess, and there
// is nothing here it could reach out and guess WITH.
//
// The one thing this file will never produce is an approval to pay. Standing
// rules can commit a human to attending, to a spending ceiling, to a dietary
// constraint — all coordination, all reversible, none of it money leaving an
// account. `SignalPayload` (../plan/types.ts) has no payment-shaped variant,
// so there is structurally nothing for this function to emit even if it
// wanted to. The actual mandate approval stays a passkey ceremony on the
// human's own device — see docs/AGENT-MESH.md for why that boundary is
// deliberate rather than a gap.
// ---------------------------------------------------------------------------

export const WeekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
])
export type Weekday = z.infer<typeof WeekdaySchema>

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * A recurring free window — "Mon–Fri, 18:00–23:00" — not tied to a date.
 * Times are plain 24h clock. This function does no timezone conversion: the
 * hours are read as UTC, same as every other instant in this codebase
 * (`plan/types.ts`'s `WindowSchema` is UTC throughout). A rule that means
 * "6pm my local time" has to be set as the UTC hour that actually is —
 * inventing a timezone lookup here would be exactly the kind of confident
 * fabrication the rest of the plan layer refuses to do.
 */
export const RecurringWindowSchema = z.object({
  days: z.array(WeekdaySchema).min(1),
  from: z.string().regex(HHMM, 'HH:MM, 24h clock'),
  to: z.string().regex(HHMM, 'HH:MM, 24h clock'),
})
export type RecurringWindow = z.infer<typeof RecurringWindowSchema>

export const StandingRulesSchema = z.object({
  /** Governs whether the delegate accepts an invitation at all. */
  auto_rsvp: z
    .object({
      /** the most this human will let their own share of one plan cost */
      max_share_minor: z.number().int().nonnegative().optional(),
      /** categories this human is willing to be auto-RSVP'd into, e.g. 'restaurant' */
      categories: z.array(z.string().min(1)).optional(),
      /** days this human never says yes to, regardless of anything else */
      not_on: z.array(WeekdaySchema).optional(),
    })
    .optional(),
  /** When this human is free, as a recurring weekly pattern — never a guess at a specific date. */
  availability: z
    .object({
      /** shorthand for {days: mon..fri, from: '18:00', to: '23:00'} */
      weekday_evenings: z.boolean().optional(),
      windows: z.array(RecurringWindowSchema).optional(),
    })
    .optional(),
  /** Where this human would travel from. Never invented if unset. */
  home: PlaceSchema.optional(),
  /** The ceiling this human states as their budget signal. */
  budget_ceiling_minor: z.number().int().nonnegative().optional(),
  /** One currency for this whole rule set — a standing rule belongs to one human, who has one wallet. */
  currency: z.string().length(3).optional(),
  /** Standing constraints, e.g. ['vegetarian']. Each becomes one constraint signal. */
  constraints: z.array(z.string().min(1)).optional(),
})
export type StandingRules = z.infer<typeof StandingRulesSchema>

/** The subset of a plan decideSignals actually needs — deliberately not the whole PlanRow. */
export interface PlanSituation {
  /** which signal kinds this plan is still asking for */
  ask: SignalKind[]
  slots: Slots
}

export interface SkippedSignal {
  kind: SignalKind
  why: string
}

export interface DecideResult {
  signals: SignalPayload[]
  skipped: SkippedSignal[]
}

// ---------------------------------------------------------------------------
// Small, local helpers. Kept here rather than imported from plan/rank.ts on
// purpose — this file has exactly one job and no dependency on the scorer.
// ---------------------------------------------------------------------------

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND'])
function money(minor: number, currency: string): string {
  const cur = currency.toUpperCase()
  return ZERO_DECIMAL.has(cur) ? `${cur} ${minor}` : `${cur} ${(minor / 100).toFixed(2)}`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const WEEKDAY_BY_UTC_INDEX: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

function utcWeekday(iso: string): Weekday {
  return WEEKDAY_BY_UTC_INDEX[new Date(iso).getUTCDay()]!
}

/** The calendar day(s), UTC, the plan's stated window actually spans. */
function planDays(slots: Slots): Weekday[] {
  const earliest = slots.when?.earliest
  if (!earliest) return []
  const start = utcWeekday(earliest)
  const latest = slots.when?.latest
  if (!latest) return [start]
  const end = utcWeekday(latest)
  return start === end ? [start] : [start, end]
}

const WEEKDAY_EVENING: RecurringWindow = {
  days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  from: '18:00',
  to: '23:00',
}

function recurringWindows(a: NonNullable<StandingRules['availability']>): RecurringWindow[] {
  const out = [...(a.windows ?? [])]
  if (a.weekday_evenings) out.push(WEEKDAY_EVENING)
  return out
}

function hhmmToMs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h! * 60 + m!) * 60_000
}

/** A concrete ISO window on the same UTC calendar date as `onDateIso`. */
function windowFor(onDateIso: string, rw: RecurringWindow): TimeWindow {
  const date = onDateIso.slice(0, 10) // yyyy-mm-dd, UTC
  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime()
  return WindowSchema.parse({
    start: new Date(dayStart + hhmmToMs(rw.from)).toISOString(),
    end: new Date(dayStart + hhmmToMs(rw.to)).toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Per-kind decisions
// ---------------------------------------------------------------------------

type Decision<T> = { outcome: 'decide'; value: T; why: string } | { outcome: 'skip'; why: string }

/**
 * Decline (`in: false`) requires a DEFINITE reason: a stated category that
 * isn't on the list, a stated cost above the ceiling, a day the rule
 * blacklists. Anything the rule cannot evaluate — no category on the plan
 * yet, no date yet, a currency it cannot compare — is a skip, never a guess
 * in either direction.
 */
function decideRsvp(rules: StandingRules, slots: Slots): Decision<boolean> {
  const r = rules.auto_rsvp
  if (!r) return { outcome: 'skip', why: 'no standing rule for RSVP decisions is on file' }

  const reasons: string[] = []
  const unknowns: string[] = []

  if (r.categories && r.categories.length > 0) {
    if (slots.category) {
      const wanted = slots.category.toLowerCase()
      const ok = r.categories.some((c) => {
        const lc = c.toLowerCase()
        return lc === wanted || wanted.includes(lc) || lc.includes(wanted)
      })
      if (!ok) {
        reasons.push(
          `the category (“${slots.category}”) is not one of the standing categories (${r.categories.join(', ')})`,
        )
      }
    } else {
      unknowns.push(
        `the plan has not stated a category yet, and the standing rule only auto-answers for ${r.categories.join(', ')}`,
      )
    }
  }

  if (r.max_share_minor !== undefined) {
    if (slots.budget_ceiling_minor === undefined) {
      unknowns.push('the plan has not stated a per-person budget yet, and the standing rule caps spending')
    } else if (!rules.currency) {
      unknowns.push('a spending limit is set but no currency is on file, so it cannot be compared safely')
    } else if (rules.currency.toUpperCase() !== slots.currency.toUpperCase()) {
      unknowns.push(
        `the plan is priced in ${slots.currency.toUpperCase()} and the standing limit is in ${rules.currency.toUpperCase()} — refusing to guess an exchange rate`,
      )
    } else if (slots.budget_ceiling_minor > r.max_share_minor) {
      reasons.push(
        `the plan's per-person ceiling (${money(slots.budget_ceiling_minor, slots.currency)}) is above the standing limit of ${money(r.max_share_minor, rules.currency)}`,
      )
    }
  }

  if (r.not_on && r.not_on.length > 0) {
    const days = planDays(slots)
    if (days.length === 0) {
      unknowns.push('the plan has no concrete date yet, and the standing rule blacks out certain days')
    } else {
      const hit = days.find((d) => r.not_on!.includes(d))
      if (hit) {
        reasons.push(`the plan falls on ${cap(hit)}, and the standing rule says never on ${r.not_on.map(cap).join(', ')}`)
      }
    }
  }

  if (reasons.length > 0) return { outcome: 'decide', value: false, why: reasons.join('; ') }
  if (unknowns.length > 0) return { outcome: 'skip', why: unknowns.join('; ') }
  return { outcome: 'decide', value: true, why: 'within every standing rule that applies' }
}

function decideAvailability(rules: StandingRules, slots: Slots): Decision<TimeWindow> {
  const a = rules.availability
  if (!a) return { outcome: 'skip', why: 'no standing availability is on file' }
  const windows = recurringWindows(a)
  if (windows.length === 0) return { outcome: 'skip', why: 'availability rules are set but name no actual windows' }

  const earliest = slots.when?.earliest
  if (!earliest) {
    return {
      outcome: 'skip',
      why: 'the plan has no concrete date yet, so there is nothing to check standing availability against',
    }
  }
  const day = utcWeekday(earliest)
  const match = windows.find((w) => w.days.includes(day))
  if (!match) return { outcome: 'skip', why: `no standing availability covers ${cap(day)}` }

  return {
    outcome: 'decide',
    value: windowFor(earliest, match),
    why: `free ${match.from}–${match.to} UTC on ${cap(day)}s per standing availability`,
  }
}

// ---------------------------------------------------------------------------
// decideSignals
// ---------------------------------------------------------------------------

/**
 * Turn {rules, plan} into the signals a delegate would actually send.
 *
 * Only `plan.ask` kinds are considered — a delegate answers what it was
 * asked, not everything it happens to know. Every kind gets exactly one of:
 * a signal in `signals`, or an entry in `skipped` with a human-readable
 * `why`. Nothing is ever half-answered.
 */
export function decideSignals(rules: StandingRules, plan: PlanSituation): DecideResult {
  const signals: SignalPayload[] = []
  const skipped: SkippedSignal[] = []

  for (const kind of plan.ask) {
    switch (kind) {
      case 'rsvp': {
        const d = decideRsvp(rules, plan.slots)
        if (d.outcome === 'skip') skipped.push({ kind, why: d.why })
        else signals.push({ kind: 'rsvp', in: d.value })
        break
      }
      case 'availability': {
        const d = decideAvailability(rules, plan.slots)
        if (d.outcome === 'skip') skipped.push({ kind, why: d.why })
        else signals.push({ kind: 'availability', windows: [d.value], anytime: false })
        break
      }
      case 'location': {
        if (!rules.home) {
          skipped.push({ kind, why: 'no home location is set in these standing rules — refusing to invent one' })
          break
        }
        signals.push({ kind: 'location', place: rules.home })
        break
      }
      case 'budget': {
        if (rules.budget_ceiling_minor === undefined || !rules.currency) {
          skipped.push({ kind, why: 'no budget ceiling (with a currency) is set in these standing rules' })
          break
        }
        signals.push({ kind: 'budget', ceiling_minor: rules.budget_ceiling_minor, currency: rules.currency })
        break
      }
      case 'constraint': {
        if (!rules.constraints || rules.constraints.length === 0) {
          skipped.push({ kind, why: 'no standing constraints are set' })
          break
        }
        for (const text of rules.constraints) signals.push({ kind: 'constraint', text })
        break
      }
      case 'vote': {
        // A vote is an opinion on a SPECIFIC option on the board. Standing
        // rules are set before any option exists, so there is structurally
        // nothing they could have anticipated here — always a skip.
        skipped.push({
          kind,
          why: 'a vote is about a specific option on the board — standing rules set in advance cannot cover that',
        })
        break
      }
    }
  }

  return { signals, skipped }
}
