import { z } from 'zod'
import { RailSchema } from './rails.js'

// ---------------------------------------------------------------------------
// Money. Integer minor units everywhere inside the engine. Decimal strings
// only at the Prava boundary.
// ---------------------------------------------------------------------------

export type Minor = number

export function toDecimalString(minor: Minor): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function formatMoney(minor: Minor, currency: string): string {
  return `${currency === 'USD' ? '$' : currency + ' '}${toDecimalString(minor)}`
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const CartItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit_amount: z.number().int().nonnegative(), // minor units
  qty: z.number().int().positive(),
  tier: z.enum(['core', 'extra']).default('core'),
  // member names (as given at group creation) or the wildcard 'mi_all'
  claimants: z.array(z.string()).min(1).default(['mi_all']),
  // §21.1 — more claimants than slots: sealed priority bids decide who gets
  // one. Bids allocate, they never price; winners pay the merchant price.
  contested: z.boolean().default(false),
})
export type CartItem = z.infer<typeof CartItemSchema>

export const CartSchema = z.object({
  items: z.array(CartItemSchema).min(1),
  fees: z.array(z.object({ name: z.string(), amount: z.number().int().nonnegative() })).default([]),
  currency: z.string().length(3).default('USD'),
})
export type Cart = z.infer<typeof CartSchema>

export function cartTotal(cart: Cart): Minor {
  const items = cart.items.reduce((s, i) => s + i.unit_amount * i.qty, 0)
  const fees = cart.fees.reduce((s, f) => s + f.amount, 0)
  return items + fees
}

// ---------------------------------------------------------------------------
// Policy algebra (GMP/1 §3)
// ---------------------------------------------------------------------------

export type Policy =
  | { type: 'all_of' }
  | { type: 'quorum'; m: number }
  | { type: 'weighted'; threshold: number }
  | { type: 'veto'; member: string; inner: Policy }
  | { type: 'required'; member: string; inner: Policy }
  | { type: 'deadline'; at: string; primary: Policy; fallback: Policy }

export const PolicySchema: z.ZodType<Policy> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('all_of') }),
    z.object({ type: z.literal('quorum'), m: z.number().int().positive() }),
    z.object({ type: z.literal('weighted'), threshold: z.number().positive() }),
    z.object({ type: z.literal('veto'), member: z.string(), inner: PolicySchema }),
    z.object({ type: z.literal('required'), member: z.string(), inner: PolicySchema }),
    z.object({
      type: z.literal('deadline'),
      at: z.string(),
      primary: PolicySchema,
      fallback: PolicySchema,
    }),
  ]) as z.ZodType<Policy>,
)

export function describePolicy(p: Policy): string {
  switch (p.type) {
    case 'all_of': return 'everyone approves'
    case 'quorum': return `at least ${p.m} approve`
    case 'weighted': return `approver weight ≥ ${p.threshold}`
    case 'veto': return `${describePolicy(p.inner)}, but ${p.member} can veto`
    case 'required': return `${describePolicy(p.inner)}, and ${p.member} must approve`
    case 'deadline': return `${describePolicy(p.primary)} until ${new Date(p.at).toLocaleTimeString()}, then ${describePolicy(p.fallback)}`
  }
}

// ---------------------------------------------------------------------------
// Members & groups
// ---------------------------------------------------------------------------

export const MemberRoleSchema = z.enum(['payer', 'sponsor', 'backstop', 'observer'])
export type MemberRole = z.infer<typeof MemberRoleSchema>

export type MemberStatus =
  | 'invited'
  | 'viewed'
  | 'awaiting_approval'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'dropped'
  | 'charging'
  | 'charged'
  /** at_venue rail only: they agreed their amount and owe the venue directly.
   *  Deliberately NOT 'charged' — no card was charged through this engine. */
  | 'settled'
  | 'failed'

export const MEMBER_TERMINAL: ReadonlySet<MemberStatus> = new Set([
  'declined', 'expired', 'dropped', 'charged', 'settled', 'failed',
])

/** A member whose obligation is discharged, on whichever rail carried it. */
export function isSettled(status: MemberStatus): boolean {
  return status === 'charged' || status === 'settled'
}

export type GroupStatus =
  | 'draft'
  | 'collecting'
  | 'deciding'
  | 'committing'
  | 'committed'
  | 'partial'
  | 'aborted'
  | 'expired'

export const GROUP_TERMINAL: ReadonlySet<GroupStatus> = new Set([
  'committed', 'partial', 'aborted', 'expired',
])

export const StragglerPolicySchema = z.enum(['retry_once', 'drop_and_continue', 'halt_partial'])
export type StragglerPolicy = z.infer<typeof StragglerPolicySchema>

export const MemberInputSchema = z.object({
  name: z.string().min(1).max(60),
  email: z.string().email().optional(),
  role: MemberRoleSchema.default('payer'),
  weight: z.number().int().positive().default(1),
  backstop_cap: z.number().int().nonnegative().optional(), // minor units; required for role=backstop
  sponsor_for: z.string().optional(), // name of the member whose share this sponsor covers
  /** links this seat to a sutra account, so it shows up in their groups */
  user_id: z.string().optional(),
})
export type MemberInput = z.infer<typeof MemberInputSchema>

export const CreateGroupSchema = z.object({
  title: z.string().min(1).max(140),
  merchant: z.object({
    id: z.string().default(''),
    name: z.string().min(1),
    url: z.string().url().default('https://example-merchant.test'),
    country_code_iso2: z.string().length(2).default('US'),
  }),
  cart: CartSchema,
  members: z.array(MemberInputSchema).min(1).max(20),
  policy: PolicySchema.default({ type: 'all_of' }),
  tolerance_bps: z.number().int().min(0).max(5000).default(500),
  straggler_policy: StragglerPolicySchema.default('retry_once'),
  no_blame: z.boolean().default(false),
  deadline_minutes: z.number().int().positive().max(7 * 24 * 60).default(60),
  webhook_url: z.string().url().optional(),
  /** who organized this, and which circle it came from */
  created_by: z.string().optional(),
  circle_id: z.string().optional(),
  /** the resolved marketplace product this cart came from, for provenance */
  product: z.record(z.unknown()).optional(),
  /** sealed-bid window for contested items (§21.1) */
  auction_window_seconds: z.number().int().positive().max(3600).default(60),
  /** ISO 4217 codes to snapshot for per-member display currency (§21.3) */
  display_currencies: z.array(z.string().length(3)).default(['INR', 'EUR', 'GBP']),
  /**
   * Settlement rail. Omitted merchant URLs default to checkout handoff; a URL
   * never self-asserts a charging integration. Bills without a merchant adapter
   * land at_venue. Only trusted/operator paths may select prava_mandates.
   */
  rail: RailSchema.optional(),
  /** Free-text provenance for the cart: 'bill', 'widget', 'plan', 'agent'… */
  origin: z.string().max(40).optional(),
})
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>

export interface MemberRow {
  id: string
  group_id: string
  display_name: string
  /** the sutra account holding this seat, when one is linked */
  user_id: string | null
  role: MemberRole
  weight: number
  share_amount: Minor
  cap_amount: Minor
  backstop_cap: Minor
  sponsor_for: string | null
  status: MemberStatus
  prava_session_id: string | null
  prava_approval_url: string | null
  prava_mandate_id: string | null
  prava_charge_txn_id: string | null
  backstop_session_id: string | null
  backstop_approval_url: string | null
  backstop_mandate_id: string | null
  backstop_absorbed: Minor
  requote_round: number
  failure_reason: string | null
  charged_amount: Minor
  /** §hold-my-share: approved but paused — counts as pending at decision time */
  on_hold: number
  version: number
}

export interface GroupRow {
  id: string
  title: string
  merchant_json: string
  cart_json: string
  cart_hash: string
  currency: string
  policy_json: string
  tolerance_bps: number
  straggler_policy: StragglerPolicy
  no_blame: number
  deadline_at: string
  status: GroupStatus
  decision_note: string | null
  webhook_url: string | null
  locked_json: string | null
  created_by: string | null
  circle_id: string | null
  product_json: string | null
  /** sealed-bid window close for contested items; null = no auction */
  auction_close_at: string | null
  /** FX rate snapshot for display currencies: {base, rates, at, source} */
  fx_json: string | null
  /** Settlement capability selected for this group — see rails.ts. */
  rail: string
  /** where this cart came from: 'bill' | 'widget' | 'plan' | 'agent' | 'api' */
  origin: string | null
  version: number
  created_at: string
}

export interface BidRow {
  seq: number
  group_id: string
  member_id: string
  sku: string
  amount: Minor
  created_at: string
}

export interface EventRow {
  seq: number
  group_id: string
  member_id: string | null
  type: string
  payload_json: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Canonical JSON + hashing helpers
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}
