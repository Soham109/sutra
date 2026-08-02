// Typed client for the engine. Every call goes to /api/* on our own origin,
// which next.config.ts rewrites to the engine — so cookies stay first-party
// and the browser never needs to know where the engine lives.

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message)
  }
}

// Omit rather than intersect: `RequestInit & { body?: unknown }` collapses
// body back to BodyInit, so callers could not pass a plain object.
async function call<T>(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = init
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(rest.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? safeParse(text) : {}
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown }
    let msg = d.error ?? `request failed (${res.status})`
    const issues = d.details as { path?: string[]; message?: string }[] | undefined
    if (Array.isArray(issues) && issues[0]) {
      msg += `: ${(issues[0].path ?? []).join('.')} — ${issues[0].message}`
    }
    throw new ApiError(res.status, msg, d.details)
  }
  return data as T
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return { raw: t }
  }
}

export const api = {
  get: <T,>(path: string) => call<T>(path),
  post: <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body }),
}

// --- shared types (mirror the engine's view models) -------------------------

export interface User {
  id: string
  handle: string
  name: string
  email: string
  accent: string
}

export interface Reliability {
  user_id: string
  groups: number
  approvals: number
  declines: number
  approval_rate: number | null
  median_latency_s: number | null
  charged_total_minor: number
  backstopped_total_minor: number
}

export interface Circle {
  id: string
  name: string
  emoji: string
  owner_id: string
  members: User[]
}

export type MemberStatus =
  | 'invited' | 'viewed' | 'awaiting_approval' | 'approved'
  | 'declined' | 'expired' | 'dropped' | 'charging' | 'charged' | 'settled' | 'failed'

/** Which rail carried a split, and therefore what "settled" is allowed to mean. */
export type Rail = 'prava_mandates' | 'shopify_pos' | 'checkout_handoff' | 'at_venue'

export type GroupStatus =
  | 'draft' | 'collecting' | 'deciding' | 'committing'
  | 'committed' | 'partial' | 'aborted' | 'expired'

export interface GroupMember {
  member_id: string
  name: string
  role: 'payer' | 'sponsor' | 'backstop' | 'observer'
  status: MemberStatus
  share_amount: number
  cap_amount: number
  backstop_cap: number
  backstop_armed: boolean
  backstop_absorbed: number
  charged_amount: number
  requote_round: number
  on_hold: boolean
}

export interface CartItem {
  sku: string
  name: string
  unit_amount: number
  qty: number
  tier: 'core' | 'extra'
  claimants: string[]
  contested: boolean
}

export interface Group {
  group_id: string
  title: string
  status: GroupStatus
  merchant: { id?: string; name: string; url: string; country_code_iso2: string }
  cart: { items: CartItem[]; fees: { name: string; amount: number }[]; currency: string }
  cart_hash: string
  total: number
  currency: string
  policy: Policy
  policy_text: string
  tolerance_bps: number
  straggler_policy: string
  no_blame: boolean
  /**
   * Which rail carries this group, and therefore whether any card is charged
   * at all. The server has always sent both; the client type simply never
   * declared them, so every surface had to guess — and a surface that guesses
   * this wrong tells somebody their card was charged when it was not.
   */
  rail: Rail
  rail_capability: { charges: boolean; mandates: boolean; settled_verb: string }
  /** the organizer — the one viewer no-blame mode does not hide declines from */
  created_by: string | null
  circle_id: string | null
  product: Record<string, unknown> | null
  origin: string | null
  shopify_test_order: ShopifyTestOrderProof | null
  deadline_at: string
  decision_note: string | null
  terminal: boolean
  event_cursor: number
  members: GroupMember[]
  auction: { closes_at: string; open: boolean } | null
  fx: { base: string; rates: Record<string, number>; at: string; source: string } | null
}

export interface ShopifyTestStatus {
  enabled: boolean
  store_domain: string | null
  storefront_domain: string | null
  adapter: 'mock' | 'sandbox' | 'production'
  /** Why `enabled` is what it is, so the UI can explain rather than just hide. */
  reason: 'ready' | 'not_configured' | 'misconfigured' | 'blocked_in_production'
  /** Safe human string — never a secret, never an env var value. */
  reason_detail: string
  disclosure: string
}

export interface ShopifyTestOrderProof {
  order_id: string
  order_name: string
  admin_url: string
  store_domain: string
  test: true
  financial_status: string
  total_minor: number
  currency: string
  transaction_count: number
  group_id: string
  created_at: string
  disclosure: string
}

export type Policy =
  | { type: 'all_of' }
  | { type: 'quorum'; m: number }
  | { type: 'weighted'; threshold: number }
  | { type: 'veto'; member: string; inner: Policy }
  | { type: 'required'; member: string; inner: Policy }
  | { type: 'deadline'; at: string; primary: Policy; fallback: Policy }

export interface GmpEvent {
  seq: number
  group_id: string
  member_id: string | null
  type: string
  payload: Record<string, unknown>
  at: string
}

export interface Money {
  amount_minor: number
  currency: string
}

export interface Product {
  id: string
  title: string
  subtitle?: string
  price: Money
  unit_label: string
  merchant: { name: string; url: string; country_code_iso2: string; domain: string }
  image_url?: string
  product_url: string
  brand?: string
  rating?: { value: number; count: number }
  in_stock: boolean
  source: 'url' | 'shopify' | 'prava' | 'starter'
  attributes?: Record<string, string>
}

export interface ProductDetail extends Product {
  description?: string
  variants: { id: string; name: string; price: Money; available: boolean; options?: Record<string, string> }[]
  images: string[]
  fine_print: string[]
}

// --- the dashboard ----------------------------------------------------------
// Computed by the engine so every client reads identical numbers.

export interface NeedsYouItem {
  kind: 'approval'
  member_id: string
  group_id: string
  title: string
  merchant: { name: string; url: string }
  share_amount: number
  cap_amount: number
  currency: string
  deadline_at: string
  status: MemberStatus
  rail: Rail
  /** 'approve' opens Prava's passkey ceremony; 'accept' is the at_venue rail */
  action: 'approve' | 'accept'
  approval_url: string | null
}

export interface WaitingItem {
  group_id: string
  title: string
  currency: string
  total: number
  deadline_at: string
  status: GroupStatus
  rail: Rail
  you_organized: boolean
  approved_count: number
  paying_count: number
  /** names are null when no-blame hides them from everyone but the organiser */
  waiting: { name: string | null; status: MemberStatus | null }[]
}

export interface PlanSummary {
  plan_id: string
  participant_id: string | null
  title: string
  status: string
  asked: string[]
  deadline_at: string
  responded_count: number
  participant_count: number
  option_count: number
}

/** What your card is currently on the hook for, split by what kind of hook. */
export interface Exposure {
  currency: string
  /** approved but not yet charged — could still leave your card */
  authorized: number
  charging: number
  settled: number
  /** a standing offer to cover someone else's share, not yet used */
  backstop_armed: number
  /** at_venue rail: agreed, owed to the venue, never charged by us */
  owed_at_venue: number
  /** Exact non-charging agreement awaiting Shopify POS or merchant checkout. */
  agreed_not_charged: number
}

export interface Dashboard {
  user: User
  reliability: Reliability
  needs_you: NeedsYouItem[]
  plans_needing_you: PlanSummary[]
  waiting_on_others: WaitingItem[]
  live_plans: PlanSummary[]
  recent: {
    group_id: string
    title: string
    status: GroupStatus
    rail: Rail
    currency: string
    charged: number
    your_amount: number
    amount_kind: 'charged' | 'agreed' | 'not_completed'
    at: string
  }[]
  exposure: Exposure[]
}

// --- chat: a live thread on a plan or a group -------------------------------
// One event type (`message.posted`) on whichever log the plan or group
// already has, so this rides the existing SSE stream rather than opening a
// new one — see useMessages.ts.

export interface ChatMessage {
  seq: number
  message_id: string
  from: 'user' | 'bot'
  /** null for the bot — posting requires a signed-in account, so this is
   *  never null for a human line. */
  author_user_id: string | null
  author_name: string
  text: string
  mentions_sutra: boolean
  /** set only on a bot reply that actually drew on the tagger's standing
   *  rules, e.g. ['budget_ceiling_minor'] — never present otherwise. */
  used_rules?: string[]
  created_at: string
}

export interface SearchResponse {
  products: Product[]
  sources: { kind: string; label: string; count: number; ms: number; error?: string }[]
  query: string
  took_ms: number
  resolved?: boolean
  warnings?: string[]
}
