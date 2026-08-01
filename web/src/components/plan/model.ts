// Shapes the coordination surfaces render. Mirrors the engine's plan views.

export interface Place {
  label: string
  lat: number
  lng: number
  address?: string
  country_code?: string
  source: 'nominatim' | 'overpass' | 'device' | 'manual' | 'merchant'
}

export interface TimeWindow {
  start: string
  end: string
}

export type SignalPayload =
  | { kind: 'rsvp'; in: boolean }
  | { kind: 'availability'; windows: TimeWindow[]; anytime: boolean }
  | { kind: 'location'; place: Place }
  | { kind: 'budget'; ceiling_minor: number; currency: string }
  | { kind: 'vote'; option_id: string; score: -1 | 0 | 1; note?: string }
  | { kind: 'constraint'; text: string }

export interface PlanParticipant {
  /**
   * Redacted to `null` unless you are the plan's organiser (or this is your
   * own seat) — the engine no longer broadcasts every participant's id to
   * anyone who can read the plan. See engine/src/routes-plan.ts's Viewer.
   */
  participant_id: string | null
  name: string
  user_id: string | null
  role: 'organizer' | 'guest'
  responded_at: string | null
  /** which questions they answered — never the answers themselves */
  answered: string[]
  rsvp: boolean | null
  location_label: string | null
}

export interface PlanOption {
  option_id: string
  source: 'overpass' | 'shopify' | 'url' | 'manual'
  title: string
  subtitle: string | null
  place: Place | null
  when: TimeWindow | null
  price: { amount_minor: number; currency: string; basis: string } | null
  url: string | null
  image_url: string | null
}

export interface PlanView {
  plan_id: string
  title: string
  intent_text: string
  kind: 'venue' | 'product' | 'bill' | 'open'
  status: 'gathering' | 'options' | 'deciding' | 'converted' | 'cancelled' | 'expired'
  slots: {
    category?: string
    currency?: string
    budget_ceiling_minor?: number
    when?: { earliest?: string; latest?: string; hint?: string }
    where?: Place | null
    radius_m?: number
  }
  ask: string[]
  rail: 'prava_mandates' | 'at_venue'
  chosen_option_id: string | null
  group_id: string | null
  deadline_at: string
  created_by: string | null
  terminal: boolean
  event_cursor: number
  participants: PlanParticipant[]
  options: PlanOption[]
  option_count: number
  responded_count: number
}

export interface ParticipantView {
  /** always your own id — this response is only ever reached via your own link */
  participant_id: string
  name: string
  role: 'organizer' | 'guest'
  responded_at: string | null
  /** what this plan still wants from them */
  asked: string[]
  my_signals: SignalPayload[]
  plan: PlanView
}

/** The arithmetic behind an option's position, rendered verbatim. */
export interface ScoreFactor {
  key: 'time_fit' | 'travel_fit' | 'budget_fit' | 'preference' | 'freshness'
  value: number
  weight: number
  why: string
}

export interface OptionScore {
  score: number | null
  factors: ScoreFactor[]
  excluded: string | null
  confidence: number
  per_participant: {
    /** redacted to `null` for everyone except your own row — see PlanParticipant */
    participant_id: string | null
    name: string
    time_ok: boolean | null
    travel_km: number | null
    budget_ok: boolean | null
    vote: number | null
  }[]
}

export interface RankedOptions {
  plan_id: string
  best_windows: {
    window: TimeWindow
    available: string[]
    unavailable: string[]
    count: number
  }[]
  options: { option: PlanOption; score: OptionScore }[]
  /** Last Overpass/catalog search note, when present */
  note?: string | null
}

export const FACTOR_LABEL: Record<ScoreFactor['key'], string> = {
  time_fit: 'Time',
  travel_fit: 'Travel',
  budget_fit: 'Budget',
  preference: 'Votes',
  freshness: 'Timing',
}
