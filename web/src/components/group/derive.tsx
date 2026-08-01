'use client'

import type { GmpEvent, Group, GroupMember, GroupStatus } from '@/lib/api'

// The log is append-only and complete, so every screen in this app can be
// re-derived from it. That is what makes replay free: fold the events up to a
// seq and you have exactly the state the engine had at that moment.

export type Payload = Record<string, unknown>

export function pStr(p: Payload, k: string): string | null {
  const v = p[k]
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function pNum(p: Payload, k: string): number | null {
  const v = p[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function pArr(p: Payload, k: string): Payload[] {
  const v = p[k]
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Payload => typeof x === 'object' && x !== null && !Array.isArray(x))
}

export function pRates(p: Payload, k: string): Record<string, number> {
  const v = p[k]
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const out: Record<string, number> = {}
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val
  }
  return out
}

export interface AuctionItemView {
  sku: string
  name: string
  slots: number
  claimants: number
}

export interface AuctionRevealView {
  sku: string
  item: string
  slots: number
  ranking: { name: string; amount: number; won: boolean }[]
}

export interface Derived {
  members: GroupMember[]
  status: GroupStatus
  decisionNote: string | null
  narrative: string | null
  planCount: number
  /** member_id → the shortfall their backstop was asked to cover. */
  allocations: Record<string, { amount: number; shortfall: number }>
  bids: Record<string, string[]>
  auctionItems: AuctionItemView[]
  auctionClosesAt: string | null
  auctionClosed: boolean
  reveals: AuctionRevealView[]
  cartHash: string | null
  chainHead: string | null
  haltedAfter: string | null
  deadlineReached: boolean
}

function blank(group: Group): Derived {
  return {
    members: [],
    status: group.status,
    decisionNote: null,
    narrative: null,
    planCount: 0,
    allocations: {},
    bids: {},
    auctionItems: [],
    auctionClosesAt: group.auction?.closes_at ?? null,
    auctionClosed: group.auction ? !group.auction.open : false,
    reveals: [],
    cartHash: null,
    chainHead: null,
    haltedAfter: null,
    deadlineReached: false,
  }
}

/** The live view, straight from the engine — used before any event has landed. */
export function fromGroup(group: Group): Derived {
  return { ...blank(group), members: group.members, cartHash: group.cart_hash }
}

const GROUP_STATE: Record<string, GroupStatus> = {
  'group.created': 'collecting',
  'auction.opened': 'collecting',
  'group.decision': 'deciding',
  'group.committing': 'committing',
  'group.committed': 'committed',
  'group.partial': 'partial',
  'group.aborted': 'aborted',
  'group.expired': 'expired',
}

/**
 * Fold the first `upto` events into the state the engine held at that point.
 * Member identity comes from the group view (names never change); everything
 * that moves comes from the log.
 */
export function deriveAt(group: Group, events: GmpEvent[], upto: number = events.length): Derived {
  const d = blank(group)
  d.status = 'draft'
  d.auctionClosesAt = null
  d.auctionClosed = false

  const byId = new Map<string, GroupMember>()
  const order: string[] = []
  for (const m of group.members) {
    byId.set(m.member_id, {
      ...m,
      status: 'invited',
      cap_amount: 0,
      backstop_armed: false,
      backstop_absorbed: 0,
      charged_amount: 0,
      requote_round: 0,
      on_hold: false,
    })
    order.push(m.member_id)
  }

  const ensure = (id: string | null, name: string | null): GroupMember | null => {
    if (!id) return null
    const found = byId.get(id)
    if (found) return found
    const made: GroupMember = {
      member_id: id,
      name: name ?? 'A member',
      role: 'payer',
      status: 'invited',
      share_amount: 0,
      cap_amount: 0,
      backstop_cap: 0,
      backstop_armed: false,
      backstop_absorbed: 0,
      charged_amount: 0,
      requote_round: 0,
      on_hold: false,
    }
    byId.set(id, made)
    order.push(id)
    return made
  }

  for (let i = 0; i < Math.min(upto, events.length); i++) {
    const e = events[i]
    const p: Payload = e.payload ?? {}
    const m = ensure(e.member_id, pStr(p, 'name'))
    const next = GROUP_STATE[e.type]
    if (next) d.status = next

    switch (e.type) {
      case 'member.invited': {
        if (!m) break
        const role = pStr(p, 'role')
        if (role === 'payer' || role === 'sponsor' || role === 'backstop' || role === 'observer') m.role = role
        m.share_amount = pNum(p, 'share') ?? m.share_amount
        m.status = 'invited'
        break
      }
      case 'member.viewed':
        if (m && m.status === 'invited') m.status = 'viewed'
        break
      case 'member.session_created':
        if (m) {
          m.status = 'awaiting_approval'
          m.cap_amount = pNum(p, 'cap') ?? m.cap_amount
        }
        break
      case 'member.approved':
        if (m) {
          m.status = 'approved'
          m.share_amount = pNum(p, 'share') ?? m.share_amount
          m.cap_amount = pNum(p, 'cap') ?? m.cap_amount
        }
        break
      case 'member.declined':
        if (m) m.status = 'declined'
        break
      case 'member.dropped':
        if (m) m.status = 'dropped'
        break
      case 'member.requoted':
        if (m) {
          m.share_amount = pNum(p, 'new_share') ?? m.share_amount
          m.requote_round = pNum(p, 'round') ?? m.requote_round + 1
          if (m.status === 'approved') m.status = 'awaiting_approval'
        }
        break
      case 'member.held':
        if (m) m.on_hold = true
        break
      case 'member.resumed':
        if (m) m.on_hold = false
        break
      case 'member.charging':
        if (m) m.status = 'charging'
        break
      case 'member.charged':
        if (m) {
          m.status = 'charged'
          m.charged_amount = pNum(p, 'amount') ?? m.charged_amount
        }
        break
      case 'member.failed':
        if (m) m.status = 'failed'
        break
      case 'backstop.armed':
        if (m) {
          m.backstop_armed = true
          m.backstop_cap = pNum(p, 'cap') ?? m.backstop_cap
        }
        break
      case 'backstop.allocated':
        if (m) {
          d.allocations[m.member_id] = {
            amount: pNum(p, 'amount') ?? 0,
            shortfall: pNum(p, 'shortfall') ?? 0,
          }
        }
        break
      case 'backstop.absorbed':
        if (m) m.backstop_absorbed += pNum(p, 'amount') ?? 0
        break
      case 'group.decision':
        d.narrative = pStr(p, 'narrative')
        d.planCount = pArr(p, 'plan').length
        break
      case 'group.halted':
        d.haltedAfter = pStr(p, 'after')
        break
      case 'group.deadline':
        d.deadlineReached = true
        break
      case 'group.aborted':
      case 'group.expired':
        d.decisionNote = pStr(p, 'reason')
        break
      case 'cart.adjusted':
        d.cartHash = pStr(p, 'new_hash') ?? d.cartHash
        break
      case 'auction.opened':
        d.auctionClosesAt = pStr(p, 'closes_at')
        d.auctionClosed = false
        d.auctionItems = pArr(p, 'items').map((it) => ({
          sku: pStr(it, 'sku') ?? '—',
          name: pStr(it, 'name') ?? 'Item',
          slots: pNum(it, 'slots') ?? 1,
          claimants: pNum(it, 'claimants') ?? 0,
        }))
        break
      case 'auction.bid': {
        const sku = pStr(p, 'sku')
        const who = pStr(p, 'name') ?? m?.name ?? 'A member'
        if (sku) d.bids[sku] = [...(d.bids[sku] ?? []), who]
        break
      }
      case 'auction.reveal':
        d.reveals = [
          ...d.reveals,
          {
            sku: pStr(p, 'sku') ?? '—',
            item: pStr(p, 'item') ?? 'Item',
            slots: pNum(p, 'slots') ?? 1,
            ranking: pArr(p, 'ranking').map((r) => ({
              name: pStr(r, 'name') ?? 'A member',
              amount: pNum(r, 'amount') ?? 0,
              won: r.won === true,
            })),
          },
        ]
        break
      case 'auction.closed':
        d.auctionClosed = true
        d.cartHash = pStr(p, 'new_cart_hash') ?? d.cartHash
        break
      case 'receipt.issued':
        d.chainHead = pStr(p, 'chain_head')
        break
      default:
        break
    }
  }

  d.members = order.map((id) => byId.get(id)).filter((x): x is GroupMember => Boolean(x))
  return d
}

export const BACKSTOP_MOMENTS = new Set(['backstop.allocated', 'backstop.absorbed'])
