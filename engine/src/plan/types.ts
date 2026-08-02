import { z } from 'zod'

// ---------------------------------------------------------------------------
// The coordination phase.
//
// GMP/1 begins when a group already knows what it is buying. Real groups do
// not start there — they start at "movie this weekend?" and spend an hour in
// a chat deciding when, where, and whether anyone can actually make it.
//
// A Plan is that hour, made into an object. It collects typed signals from
// each participant, ranks real options against those signals with arithmetic
// rather than vibes, and — only once a concrete option is chosen — produces a
// cart and hands it to the protocol engine unchanged.
//
// Deliberately vertical-neutral. "Movie with friends", "dinner Saturday",
// "four tickets at this URL" and "split this restaurant bill" are the same
// object with different slots filled and a different option source. There is
// no movie code path. Adding a vertical means adding an OptionSource, not a
// branch.
// ---------------------------------------------------------------------------

/** How a plan's options are sourced. Drives which rail answers, nothing else. */
export const PlanKindSchema = z.enum([
  'venue', // somewhere to go: cinema, restaurant, bar, anything OSM knows about
  'product', // something to buy: a merchant catalogue or a pasted product URL
  'bill', // something already consumed: a receipt to allocate and settle
  'open', // undecided; the agent picks a source once the intent is clear
])
export type PlanKind = z.infer<typeof PlanKindSchema>

export const PlanStatusSchema = z.enum([
  'gathering', // invitations out, signals coming in
  'options', // enough signal to rank; options are on the board
  'deciding', // an option is proposed and being confirmed
  'converted', // became a GroupSession; the protocol owns it now
  'cancelled',
  'expired',
])
export type PlanStatus = z.infer<typeof PlanStatusSchema>

export const PLAN_TERMINAL: ReadonlySet<PlanStatus> = new Set(['converted', 'cancelled', 'expired'])

// ---------------------------------------------------------------------------
// Geography. Real coordinates only — every lat/lng in this system comes from a
// named source (a geocoder, a device, or a human dropping a pin), never from a
// model's guess. `label` is what a human recognises; `source` is how we got it.
// ---------------------------------------------------------------------------

export const PlaceSchema = z.object({
  label: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
  /** ISO 3166-1 alpha-2, when the geocoder reported one */
  country_code: z.string().length(2).optional(),
  /** provenance, so the UI can say where a coordinate came from */
  source: z.enum(['nominatim', 'overpass', 'device', 'manual', 'merchant']).default('manual'),
})
export type Place = z.infer<typeof PlaceSchema>

/** A half-open interval [start, end). ISO-8601 UTC instants. */
export const WindowSchema = z
  .object({ start: z.string().datetime(), end: z.string().datetime() })
  .refine((w) => new Date(w.start) < new Date(w.end), { message: 'window end must be after start' })
export type TimeWindow = z.infer<typeof WindowSchema>

// ---------------------------------------------------------------------------
// Slots — the structured reading of what the human asked for.
//
// Every slot is optional and every slot is editable in the UI. An extractor
// (LLM or deterministic) only ever *proposes* these; nothing is committed to
// on the strength of a model's parse alone.
// ---------------------------------------------------------------------------

export const SlotsSchema = z.object({
  /** Free-text category. For venue plans this maps to OSM tags via places/taxonomy. */
  category: z.string().max(80).optional(),
  /** The rough time envelope the group is aiming at. */
  when: z
    .object({
      earliest: z.string().datetime().optional(),
      latest: z.string().datetime().optional(),
      /** what the human actually said: "saturday evening", "after work" */
      hint: z.string().max(120).optional(),
    })
    .default({}),
  /** Anchor location for the search, if the organiser named one. */
  where: PlaceSchema.nullish(),
  /** Radius to search around the anchor / participant centroid. */
  radius_m: z.number().int().min(200).max(50_000).default(8_000),
  party_size: z.number().int().min(1).max(50).optional(),
  /** Organiser's ceiling, per person, minor units. Participants set their own. */
  budget_ceiling_minor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default('USD'),
  /** A product/merchant URL, when the intent already names the thing. */
  url: z.string().url().optional(),
  notes: z.string().max(500).optional(),
})
export type Slots = z.infer<typeof SlotsSchema>

// ---------------------------------------------------------------------------
// Signals — what we ask each participant for, and what they send back.
//
// One generic mechanism. "When are you free" is not a movie feature, it is an
// `availability` signal; adding "what's your dietary constraint" is a
// `constraint` signal, not a new subsystem.
// ---------------------------------------------------------------------------

export const SignalKindSchema = z.enum([
  'rsvp', // in or out
  'availability', // the windows they can make
  'location', // where they would travel from
  'budget', // the most they will pay for their share
  'vote', // an opinion on a specific option
  'constraint', // anything the ranking must respect but cannot score
])
export type SignalKind = z.infer<typeof SignalKindSchema>

export const RsvpSignalSchema = z.object({ kind: z.literal('rsvp'), in: z.boolean() })
export const AvailabilitySignalSchema = z.object({
  kind: z.literal('availability'),
  windows: z.array(WindowSchema).max(20),
  /** true = "any time works", which is different from "I sent no windows" */
  anytime: z.boolean().default(false),
})
export const LocationSignalSchema = z.object({ kind: z.literal('location'), place: PlaceSchema })
export const BudgetSignalSchema = z.object({
  kind: z.literal('budget'),
  ceiling_minor: z.number().int().nonnegative(),
  currency: z.string().length(3),
})
export const VoteSignalSchema = z.object({
  kind: z.literal('vote'),
  option_id: z.string().min(1),
  /** -1 blocks, 0 neutral, +1 wants it. Deliberately coarse: this is a nudge. */
  score: z.number().int().min(-1).max(1),
  note: z.string().max(200).optional(),
})
export const ConstraintSignalSchema = z.object({
  kind: z.literal('constraint'),
  text: z.string().min(1).max(200),
})

export const SignalPayloadSchema = z.discriminatedUnion('kind', [
  RsvpSignalSchema,
  AvailabilitySignalSchema,
  LocationSignalSchema,
  BudgetSignalSchema,
  VoteSignalSchema,
  ConstraintSignalSchema,
])
export type SignalPayload = z.infer<typeof SignalPayloadSchema>

// ---------------------------------------------------------------------------
// Options — concrete, sourced, verifiable candidates.
//
// `source` and `raw_json` exist so every option on the board can be traced to
// the exact response that produced it. An option with no traceable source is a
// bug, not a suggestion.
// ---------------------------------------------------------------------------

export const OptionSourceSchema = z.enum([
  'overpass', // a real place from OpenStreetMap, with real coordinates
  'shopify', // a real product from a storefront's own search
  'url', // a real merchant page we read directly
  'manual', // typed in by a human, who owns the numbers
])
export type OptionSource = z.infer<typeof OptionSourceSchema>

export const PriceBasisSchema = z.enum(['per_person', 'total', 'unknown'])

export const OptionInputSchema = z.object({
  source: OptionSourceSchema,
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  place: PlaceSchema.nullish(),
  /** A concrete slot, when the source knows one (a showtime, a booking window). */
  when: WindowSchema.nullish(),
  price: z
    .object({
      amount_minor: z.number().int().nonnegative(),
      currency: z.string().length(3),
      basis: PriceBasisSchema.default('unknown'),
    })
    .nullish(),
  url: z.string().url().nullish(),
  image_url: z.string().url().nullish(),
  /** Exactly what the source returned, for provenance and debugging. */
  raw: z.record(z.unknown()).default({}),
})
export type OptionInput = z.infer<typeof OptionInputSchema>

// ---------------------------------------------------------------------------
// Scoring. Every option carries the arithmetic that ranked it.
//
// The contract that keeps this honest: `score` is a pure function of
// (option, signals) and the UI renders `factors` verbatim. There is no hidden
// term, and no model gets a vote in the ordering.
// ---------------------------------------------------------------------------

export interface ScoreFactor {
  key: 'time_fit' | 'travel_fit' | 'budget_fit' | 'preference' | 'freshness'
  /** normalised to [0,1] */
  value: number
  weight: number
  /** a sentence a human can check against the data, e.g. "4 of 5 can make it" */
  why: string
}

export interface OptionScore {
  /** weighted mean of factors, [0,1]. Null when nothing could be scored yet. */
  score: number | null
  factors: ScoreFactor[]
  /** set when a hard constraint rules the option out; it stays visible, greyed */
  excluded: string | null
  /** fraction of invited participants whose signals fed this score */
  confidence: number
  /** per-participant detail, so "why am I not going" has an answer */
  per_participant: {
    participant_id: string
    name: string
    time_ok: boolean | null
    travel_km: number | null
    budget_ok: boolean | null
    vote: number | null
  }[]
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface PlanRow {
  id: string
  title: string
  intent_text: string
  kind: PlanKind
  slots_json: string
  /** SignalKind[] — what this plan is asking each participant for */
  ask_json: string
  status: PlanStatus
  chosen_option_id: string | null
  group_id: string | null
  /** Concrete settlement rail, chosen only when a priced option is converted. */
  rail: string
  deadline_at: string
  created_by: string | null
  circle_id: string | null
  version: number
  created_at: string
}

export interface PlanParticipantRow {
  id: string
  plan_id: string
  user_id: string | null
  display_name: string
  /** email or phone; null when they only ever get a link */
  contact: string | null
  role: 'organizer' | 'guest'
  responded_at: string | null
  version: number
}

export interface SignalRow {
  seq: number
  plan_id: string
  participant_id: string
  kind: SignalKind
  payload_json: string
  created_at: string
}

export interface PlanOptionRow {
  id: string
  plan_id: string
  source: OptionSource
  title: string
  subtitle: string | null
  place_json: string | null
  when_json: string | null
  price_json: string | null
  url: string | null
  image_url: string | null
  raw_json: string
  created_at: string
}

// ---------------------------------------------------------------------------
// API input
// ---------------------------------------------------------------------------

export const CreatePlanSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  intent_text: z.string().min(1).max(2000),
  kind: PlanKindSchema.default('open'),
  slots: SlotsSchema.partial().default({}),
  ask: z.array(SignalKindSchema).default(['rsvp', 'availability', 'location']),
  participants: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        user_id: z.string().optional(),
        contact: z.string().max(200).optional(),
        role: z.enum(['organizer', 'guest']).default('guest'),
      }),
    )
    .max(50)
    .default([]),
  circle_id: z.string().optional(),
  deadline_minutes: z.number().int().positive().max(20_160).default(1440),
})
export type CreatePlanInput = z.infer<typeof CreatePlanSchema>
