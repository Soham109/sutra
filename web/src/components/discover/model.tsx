// The draft a person builds before a group exists, plus the arithmetic that
// turns it into money. The split here mirrors the engine exactly — per-item
// equal split among claimants, fees pro-rata on item subtotals, largest
// remainder so the shares sum to the total to the cent. Nobody should have to
// press Create to find out what they are agreeing to.

import type { Policy, Product, ProductDetail, User } from '@/lib/api'

export type Role = 'payer' | 'sponsor' | 'backstop' | 'observer'

export const ROLES: Role[] = ['payer', 'backstop', 'sponsor', 'observer']

export const ROLE_LABEL: Record<Role, string> = {
  payer: 'Payer',
  backstop: 'Backstop',
  sponsor: 'Sponsor',
  observer: 'Observer',
}

/** One sentence, shown wherever the role is chosen. Nobody knows this vocabulary yet. */
export const ROLE_LINE: Record<Role, string> = {
  payer: 'Approves their own share and pays it on their own card.',
  backstop: 'Pays a share too, and covers other people’s shortfalls up to a cap they set.',
  sponsor: 'Claims nothing — pays one named member’s share instead of their own.',
  observer: 'Can watch the group and keep the receipt, but is never charged.',
}

export const STRAGGLER_OPTIONS: { value: StragglerPolicy; label: string; line: string }[] = [
  {
    value: 'retry_once',
    label: 'Retry once',
    line: 'Nudge whoever is missing and give them one more short window before deciding.',
  },
  {
    value: 'drop_and_continue',
    label: 'Drop and continue',
    line: 'Drop the people who never answered, re-split their share, and commit if the policy still passes.',
  },
  {
    value: 'halt_partial',
    label: 'Halt',
    line: 'Stop everything. If anyone is missing at the deadline, nobody is charged.',
  },
]

export type StragglerPolicy = 'retry_once' | 'drop_and_continue' | 'halt_partial'

// --- draft shapes -----------------------------------------------------------

export interface DraftMember {
  key: string
  name: string
  role: Role
  /** Only sent when the policy actually weighs votes. */
  weight: number
  /** Minor units. Only meaningful for backstops. */
  backstopCap: number
  /** Member key (not name) — survives renaming. Mapped to a name on submit. */
  sponsorFor: string
  userId?: string
}

export interface DraftItem {
  key: string
  sku: string
  name: string
  /** Minor units. */
  unitAmount: number
  qty: number
  tier: 'core' | 'extra'
  /** Member keys. */
  claimants: string[]
}

export interface DraftFee {
  key: string
  name: string
  /** Minor units. */
  amount: number
}

let seq = 0
/** Deterministic across server and client render — no hydration surprises. */
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${seq}`
}

// --- the split --------------------------------------------------------------

/**
 * Hand out `total` minor units in proportion to `weights`, largest remainder
 * first, so the parts always sum back to exactly `total`. Equal weights
 * degrade to an even split with the odd cents going to the earliest members —
 * the same tie-break the engine uses, so the preview never drifts.
 */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  const w = sum > 0 ? weights : weights.map(() => 1)
  const wSum = sum > 0 ? sum : n
  const exact = w.map((x) => (total * x) / wSum)
  const out = exact.map((e) => Math.floor(e))
  const rem = total - out.reduce((a, b) => a + b, 0)
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < rem && k < order.length; k++) out[order[k].i] += 1
  return out
}

export interface Share {
  key: string
  name: string
  role: Role
  itemsMinor: number
  feesMinor: number
  /** What this member claimed, before sponsorship moves it. */
  own: number
  /** What this member is actually asked to authorise. */
  payable: number
  /** payable × (1 + tolerance), rounded up — the ceiling on their mandate. */
  cap: number
  coveredBy: string | null
  covering: { name: string; amount: number }[]
}

export interface SplitResult {
  itemsTotal: number
  feesTotal: number
  total: number
  shares: Share[]
  /** Item keys where claimants outnumber units. */
  contested: string[]
  /** How many people can be asked to pay for anything at all. */
  claimantCount: number
  /** Money nobody can be asked for — only non-zero when there are no payers. */
  unassigned: number
}

/** People who can claim a line: payers and backstops. Sponsors pay for someone
 *  else, observers pay nothing. */
export function claimers(members: DraftMember[]): DraftMember[] {
  return members.filter((m) => m.role === 'payer' || m.role === 'backstop')
}

export function itemTotal(it: DraftItem): number {
  return it.unitAmount * Math.max(0, it.qty)
}

export function computeSplit(
  items: DraftItem[],
  fees: DraftFee[],
  members: DraftMember[],
  toleranceBps: number,
): SplitResult {
  const itemsTotal = items.reduce((a, it) => a + itemTotal(it), 0)
  const feesTotal = fees.reduce((a, f) => a + f.amount, 0)
  const total = itemsTotal + feesTotal

  const elig = claimers(members)
  const index = new Map(elig.map((m, i) => [m.key, i]))
  const itemsMinor = elig.map(() => 0)
  const contested: string[] = []

  for (const it of items) {
    const chosen = it.claimants.filter((k) => index.has(k))
    const targets = chosen.length > 0 ? chosen : elig.map((m) => m.key)
    if (targets.length > it.qty) contested.push(it.key)
    if (elig.length === 0) continue
    const parts = allocate(itemTotal(it), targets.map(() => 1))
    targets.forEach((k, i) => {
      const at = index.get(k)
      if (at !== undefined) itemsMinor[at] += parts[i]
    })
  }

  const feesMinor = elig.map(() => 0)
  if (elig.length > 0) {
    for (const f of fees) {
      const parts = allocate(f.amount, itemsMinor)
      parts.forEach((p, i) => {
        feesMinor[i] += p
      })
    }
  }

  const own = new Map<string, number>()
  elig.forEach((m, i) => own.set(m.key, itemsMinor[i] + feesMinor[i]))

  // Sponsorship moves a share; it never creates or destroys one.
  const coveredBy = new Map<string, string>()
  const covering = new Map<string, { name: string; amount: number }[]>()
  for (const s of members) {
    if (s.role !== 'sponsor' || !s.sponsorFor) continue
    const target = members.find((m) => m.key === s.sponsorFor)
    if (!target || target.key === s.key) continue
    if (coveredBy.has(target.key)) continue
    coveredBy.set(target.key, s.name)
    const list = covering.get(s.key) ?? []
    list.push({ name: target.name, amount: own.get(target.key) ?? 0 })
    covering.set(s.key, list)
  }

  const shares: Share[] = members.map((m) => {
    const at = index.get(m.key)
    const mine = own.get(m.key) ?? 0
    const cover = covering.get(m.key) ?? []
    const isCovered = coveredBy.has(m.key)
    const payable = (isCovered ? 0 : mine) + cover.reduce((a, c) => a + c.amount, 0)
    return {
      key: m.key,
      name: m.name,
      role: m.role,
      itemsMinor: at === undefined ? 0 : itemsMinor[at],
      feesMinor: at === undefined ? 0 : feesMinor[at],
      own: mine,
      payable,
      cap: capFor(payable, toleranceBps),
      coveredBy: coveredBy.get(m.key) ?? null,
      covering: cover,
    }
  })

  const assigned = shares.reduce((a, s) => a + s.payable, 0)
  return {
    itemsTotal,
    feesTotal,
    total,
    shares,
    contested: Array.from(new Set(contested)),
    claimantCount: elig.length,
    unassigned: total - assigned,
  }
}

export function capFor(share: number, toleranceBps: number): number {
  return Math.ceil(share * (1 + Math.max(0, toleranceBps) / 10000))
}

// --- policy helpers ---------------------------------------------------------

export type SimplePolicyKind = 'all_of' | 'quorum' | 'weighted'

export function policyUsesWeights(p: Policy): boolean {
  switch (p.type) {
    case 'weighted':
      return true
    case 'veto':
    case 'required':
      return policyUsesWeights(p.inner)
    case 'deadline':
      return policyUsesWeights(p.primary) || policyUsesWeights(p.fallback)
    default:
      return false
  }
}

/** Every member name a policy points at, so we can check they still exist. */
export function policyMembers(p: Policy): string[] {
  switch (p.type) {
    case 'veto':
    case 'required':
      return [p.member, ...policyMembers(p.inner)]
    case 'deadline':
      return [...policyMembers(p.primary), ...policyMembers(p.fallback)]
    default:
      return []
  }
}

// --- datetime-local <-> ISO -------------------------------------------------

export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

// --- seeding the draft from a product ---------------------------------------

/** A search hit is enough to start from if the full page will not resolve. */
export function detailFromProduct(p: Product): ProductDetail {
  return {
    ...p,
    variants: [],
    images: p.image_url ? [p.image_url] : [],
    fine_print: [],
  }
}

export function firstMember(user: User | null): DraftMember {
  return {
    key: uid('m'),
    name: user?.name || 'You',
    role: 'payer',
    weight: 1,
    backstopCap: 0,
    sponsorFor: '',
    userId: user?.id,
  }
}

export function itemFromProduct(
  product: ProductDetail,
  variantId: string,
  claimants: string[],
): DraftItem {
  const variant = product.variants.find((v) => v.id === variantId)
  return {
    key: uid('i'),
    sku: variant?.id ?? product.id,
    name: variant ? `${product.title} — ${variant.name}` : product.title,
    unitAmount: variant?.price.amount_minor ?? product.price.amount_minor,
    qty: 1,
    tier: 'core',
    claimants,
  }
}

export function looksLikeUrl(value: string): boolean {
  const v = value.trim()
  if (/^https?:\/\/\S+$/i.test(v)) return true
  return /^[\w-]+(\.[\w-]+)+(\/\S*)$/.test(v)
}

export function normaliseUrl(value: string): string {
  const v = value.trim()
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/** Domain only, for the "only this store" filter. */
export function domainOf(value: string): string {
  const v = value.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  return v.split('/')[0].split('?')[0]
}
