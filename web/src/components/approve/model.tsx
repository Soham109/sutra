// Types, copy and pure helpers for the member approval surface.
// The approval page is the only screen most people ever see, so the wording
// lives here next to the logic that chooses it — never buried in JSX.

import { ApiError, type CartItem, type GmpEvent, type Group, type GroupStatus, type MemberStatus, type Policy } from '@/lib/api'
import { money, toMinor } from '@/lib/format'

export type Fx = NonNullable<Group['fx']>

export interface ContestedItem {
  sku: string
  name: string
  slots: number
  claimants: number
  my_bid: number | null
}

export interface MemberView {
  member_id: string
  group_id: string
  name: string
  role: 'payer' | 'sponsor' | 'backstop' | 'observer'
  status: MemberStatus
  on_hold: boolean
  share_amount: number
  cap_amount: number
  backstop_cap: number
  backstop_armed: boolean
  backstop_approval_url: string | null
  approval_url: string | null
  requote_round: number
  charged_amount: number
  auction: { open: boolean; closes_at: string; contested_items: ContestedItem[] } | null
  fx: Fx | null
  group: {
    title: string
    status: GroupStatus
    merchant: { name: string; url: string; country_code_iso2: string }
    currency: string
    total: number
    policy_text: string
    deadline_at: string
    no_blame: boolean
    terminal: boolean
  }
  my_items: CartItem[]
}

export interface JoinableMember {
  member_id: string
  name: string
  role: 'payer' | 'sponsor' | 'backstop' | 'observer'
  status: MemberStatus
  claimable: boolean
}

export interface Joinable {
  group_id: string
  title: string
  members: JoinableMember[]
}

const OUT: MemberStatus[] = ['declined', 'dropped', 'expired', 'failed']

/**
 * One screen per phase — every terminal path included, so no member is ever
 * left staring at a page that doesn't say whether they paid.
 */
export type Phase =
  | 'deciding'
  | 'approved'
  | 'hold'
  | 'charging'
  | 'charged'
  | 'out'
  | 'left-behind'
  | 'aborted'
  | 'observer'

export function phaseOf(v: MemberView): Phase {
  if (v.status === 'charged') return 'charged'
  if (v.status === 'charging') return 'charging'
  if (v.group.terminal) {
    return v.group.status === 'committed' || v.group.status === 'partial' ? 'left-behind' : 'aborted'
  }
  if (v.role === 'observer') return 'observer'
  if (v.status === 'approved') return v.on_hold ? 'hold' : 'approved'
  if (OUT.includes(v.status)) return 'out'
  return 'deciding'
}

export function isOut(status: MemberStatus): boolean {
  return OUT.includes(status)
}

// --- money, in two currencies ----------------------------------------------

/**
 * §21.3 dual display. The charge always happens in the merchant's currency;
 * the second number is a courtesy at the rate snapshotted when the group was
 * created, never a live quote.
 */
export function fxConvert(minor: number, from: string, to: string, fx: Fx): string | null {
  if (!to || to === from) return null
  const per = fx.base === from ? 1 : fx.rates[from]
  const target = fx.base === to ? 1 : fx.rates[to]
  if (!per || !target) return null
  const div = toMinor('1', from) || 100
  const value = (minor / div) * (target / per)
  return money(toMinor(value.toFixed(4), to), to)
}

export function fxCurrencies(fx: Fx, groupCurrency: string): string[] {
  const all = new Set<string>([fx.base, ...Object.keys(fx.rates)])
  all.delete(groupCurrency)
  return [...all].sort()
}

export const CCY_KEY = 'sutra-display-currency'

// --- what declining actually does ------------------------------------------

export interface DeclineCopy {
  title: string
  body: string
  confirm: string
}

const GENERIC: DeclineCopy = {
  title: 'Decline your share?',
  body: 'You will not be charged. The group is told immediately and decides what to do without you.',
  confirm: "Decline — I'm out",
}

export function declineCopy(policy: Policy | null, you: string): DeclineCopy {
  if (!policy) return GENERIC
  switch (policy.type) {
    case 'all_of':
      return {
        title: 'This cancels the purchase for everyone',
        body:
          'The policy is all_of: every member has to approve, or nobody pays. If you decline, the whole group is cancelled and no one is charged — including the people who already approved. Their mandates are released.',
        confirm: 'Decline — cancel for everyone',
      }
    case 'quorum':
      return {
        title: 'The group can go ahead without you',
        body: `The policy is quorum(${policy.m}): any ${policy.m} approvals commit the group. You will not be charged, and the others may still pay their shares. If your share is needed to reach the total, someone's backstop covers it.`,
        confirm: "Decline — I'm out",
      }
    case 'weighted':
      return {
        title: 'The group can go ahead without you',
        body: `The policy is weighted(${policy.threshold}): approvals are weighted and the group commits once they clear the threshold. You will not be charged; the others may still pay.`,
        confirm: "Decline — I'm out",
      }
    case 'veto':
      return policy.member === you
        ? {
            title: 'You can stop this on your own',
            body: `You hold the veto. Declining ends the purchase for everyone and nobody is charged.`,
            confirm: 'Decline — stop the purchase',
          }
        : declineCopy(policy.inner, you)
    case 'required':
      return policy.member === you
        ? {
            title: 'Nothing happens without you',
            body: `The policy requires your approval. If you decline, the group cannot commit and no one is charged.`,
            confirm: 'Decline — cancel for everyone',
          }
        : declineCopy(policy.inner, you)
    case 'deadline':
      return declineCopy(policy.primary, you)
  }
}

// --- history ----------------------------------------------------------------

/** Every share this member has been quoted, oldest first. Lets us show old → new. */
export function shareHistory(events: GmpEvent[], memberId: string): number[] {
  const out: number[] = []
  for (const e of events) {
    if (e.member_id !== memberId) continue
    if (e.type === 'member.invited' && typeof e.payload.share === 'number') out.push(e.payload.share)
    if (e.type === 'member.requoted' && typeof e.payload.new_share === 'number') out.push(e.payload.new_share)
  }
  return out
}

export function previousShare(events: GmpEvent[], memberId: string, round: number): number | null {
  if (round <= 0) return null
  const hist = shareHistory(events, memberId)
  return hist.length >= 2 ? hist[hist.length - 2]! : null
}

export function requoteReason(events: GmpEvent[], memberId: string): string | null {
  const last = [...events].reverse().find((e) => e.member_id === memberId && e.type === 'member.requoted')
  const reason = last?.payload.reason
  return typeof reason === 'string' ? reason : null
}

export function lostAuction(events: GmpEvent[], memberId: string): boolean {
  return events.some((e) => e.member_id === memberId && e.type === 'auction.lost')
}

// --- errors, as sentences ---------------------------------------------------

export function humanError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) {
      return "This link doesn't point at a share any more. It was either never valid, or the group it belonged to has been cleared. Ask whoever invited you for a fresh link — nothing has been charged."
    }
    if (e.status === 409 || e.status === 422) return `${e.message}. Nothing has been charged.`
    if (e.status >= 500) {
      return 'The engine is not answering right now. Nothing has been charged and your share is still waiting for you — try again in a moment.'
    }
    return e.message
  }
  if (e instanceof TypeError) {
    return "We couldn't reach the network. Nothing has been charged — check your connection and try again."
  }
  return (e as Error)?.message || 'Something went wrong, and we could not tell what. Nothing has been charged.'
}

export const ROLE_NOTE: Record<MemberView['role'], string | null> = {
  payer: null,
  sponsor: 'You are sponsoring part of this group — your card covers a share that is not your own items.',
  backstop: 'You are the backstop for this group as well as a payer.',
  observer: null,
}
