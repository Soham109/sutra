import type { Db } from './db.js'
import type { EventHub } from './events.js'
import type { PravaAdapter } from './prava/adapter.js'
import { ReceiptSigner, sha256, type Receipt, type ReceiptEntry } from './receipt.js'
import { allocateBackstops } from './protocol/backstop.js'
import { allocateAuction, type SealedBid } from './protocol/auction.js'
import { capFor, computeShares } from './protocol/money.js'
import { evaluatePolicy, referencedMembers, type Participant } from './protocol/policy.js'
import { groupId as newGroupId, memberId as newMemberId } from './ids.js'
import { capabilityOf, railFor } from './rails.js'
import {
  canonicalJson,
  cartTotal,
  describePolicy,
  toDecimalString,
  GROUP_TERMINAL,
  type Cart,
  type CreateGroupInput,
  type CartItem,
  type GroupRow,
  type MemberInput,
  type MemberRow,
  type Minor,
  type Policy,
  isSettled,
} from './types.js'

export interface ServiceConfig {
  appBaseUrl: string
  /** injectable clock so tests and replay stay deterministic */
  now?: () => Date
}

interface ChargePlanEntry {
  member_id: string
  source: 'share' | 'backstop'
  amount: Minor
}

const PAYING_ROLES = new Set(['payer', 'sponsor', 'backstop'])

export class GroupService {
  private readonly now: () => Date
  /** in-process re-entrancy guard for executeCommit */
  private readonly committing = new Set<string>()

  constructor(
    readonly db: Db,
    readonly prava: PravaAdapter,
    readonly hub: EventHub,
    readonly signer: ReceiptSigner,
    readonly cfg: ServiceConfig,
  ) {
    this.now = cfg.now ?? (() => new Date())
  }

  // -------------------------------------------------------------------------
  // Group creation
  // -------------------------------------------------------------------------

  createGroup(input: CreateGroupInput): { group: GroupRow; members: MemberRow[] } {
    // Sponsors must point at an existing member; the sponsored member observes.
    for (const m of input.members) {
      if (m.role === 'sponsor') {
        if (!m.sponsor_for) throw new UserError(`sponsor ${m.name} needs sponsor_for`)
        const target = input.members.find((x) => x.name === m.sponsor_for)
        if (!target) throw new UserError(`sponsor_for "${m.sponsor_for}" is not a member`)
        target.role = 'observer'
      }
      if (m.role === 'backstop' && !m.backstop_cap) {
        throw new UserError(`backstop ${m.name} needs backstop_cap`)
      }
    }
    const names = new Set(input.members.map((m) => m.name))
    if (names.size !== input.members.length) throw new UserError('member names must be unique')
    for (const ref of referencedMembers(input.policy)) {
      if (!names.has(ref)) throw new UserError(`policy references unknown member "${ref}"`)
    }

    // Which rail can carry this. A bill photographed in a restaurant has no
    // merchant Prava can charge, and the engine says so rather than inventing
    // one — see rails.ts.
    const rail = railFor({ merchantUrl: input.merchant.url, requested: input.rail })

    // Contested items (§21.1) are for SCARCITY: four people want three tickets,
    // so a sealed bid decides who gets one and the losers drop out.
    //
    // That is catastrophically wrong for a bill. Two friends sharing one plate
    // of paneer is a line with qty 1 and two claimants — the same shape — and
    // inferring an auction from it opened a bid window nobody could see, closed
    // it with zero bids, awarded the whole plate to whoever sorted first, and
    // DROPPED the other person from the group while re-billing the first for
    // the entire cheque. On a real bill that was already eaten, "compete for
    // it" is never what a shared line means.
    //
    // So scarcity is only inferred where a slot can genuinely be scarce: a
    // chargeable cart of things still being bought. A bill, or anything on a
    // rail that settles at a venue, splits shared lines and never auctions
    // them. An explicit `contested: true` from the caller is still honoured on
    // the card rail, because there the caller means it.
    const canContest = rail === 'prava_mandates' && input.origin !== 'bill'
    for (const item of input.cart.items) {
      if (!canContest || item.claimants.includes('mi_all')) {
        item.contested = false
        continue
      }
      item.contested = item.claimants.length > item.qty
    }
    const hasAuction = input.cart.items.some((i) => i.contested)

    const { shares } = computeShares(input.cart, input.members)
    const gid = newGroupId()
    const deadline = new Date(this.now().getTime() + input.deadline_minutes * 60_000)
    const auctionClose = hasAuction
      ? new Date(this.now().getTime() + input.auction_window_seconds * 1000)
      : null

    this.db.insertGroup({
      id: gid,
      title: input.title,
      merchant_json: JSON.stringify(input.merchant),
      cart_json: JSON.stringify(input.cart),
      cart_hash: sha256(canonicalJson(input.cart)),
      currency: input.cart.currency,
      policy_json: JSON.stringify(input.policy),
      tolerance_bps: input.tolerance_bps,
      straggler_policy: input.straggler_policy,
      no_blame: input.no_blame ? 1 : 0,
      deadline_at: deadline.toISOString(),
      status: 'collecting',
      decision_note: null,
      webhook_url: input.webhook_url ?? null,
      locked_json: null,
      created_by: input.created_by ?? null,
      circle_id: input.circle_id ?? null,
      product_json: input.product ? JSON.stringify(input.product) : null,
      auction_close_at: auctionClose ? auctionClose.toISOString() : null,
      fx_json: null,
      rail,
      origin: input.origin ?? null,
    })

    // §21.3 — display-currency snapshot, best-effort and non-blocking. The
    // charge currency is always the merchant's; this is honest dual display.
    void this.snapshotFx(gid, input.cart.currency, input.display_currencies)

    for (const m of input.members) {
      const share = shares.get(m.name) ?? 0
      this.db.insertMember({
        id: newMemberId(),
        group_id: gid,
        display_name: m.name,
        user_id: m.user_id ?? null,
        role: m.role,
        weight: m.weight,
        share_amount: share,
        cap_amount: capFor(share, input.tolerance_bps),
        backstop_cap: m.backstop_cap ?? 0,
        sponsor_for: m.sponsor_for ?? null,
        status: 'invited',
        prava_session_id: null,
        prava_approval_url: null,
        prava_mandate_id: null,
        prava_charge_txn_id: null,
        backstop_session_id: null,
        backstop_approval_url: null,
        backstop_mandate_id: null,
        backstop_absorbed: 0,
        requote_round: 0,
        failure_reason: null,
        charged_amount: 0,
        on_hold: 0,
      })
    }

    const members = this.db.membersOf(gid)
    this.hub.emit(gid, null, 'group.created', {
      title: input.title,
      policy: describePolicy(input.policy),
      total: cartTotal(input.cart),
      currency: input.cart.currency,
      deadline_at: deadline.toISOString(),
      auction_close_at: auctionClose ? auctionClose.toISOString() : null,
    })
    if (hasAuction) {
      this.hub.emit(gid, null, 'auction.opened', {
        items: input.cart.items.filter((i) => i.contested).map((i) => ({ sku: i.sku, name: i.name, slots: i.qty, claimants: i.claimants.length })),
        closes_at: auctionClose!.toISOString(),
      })
    }
    for (const m of members) {
      this.hub.emit(gid, m.id, 'member.invited', { name: m.display_name, role: m.role, share: m.share_amount })
    }
    return { group: this.db.getGroup(gid)!, members }
  }

  // -------------------------------------------------------------------------
  // Member lifecycle
  // -------------------------------------------------------------------------

  /**
   * First open of the approval page. Lazily creates the Prava session(s) so
   * the 15-minute session clock starts only when the human is present.
   */
  async openMember(memberId: string): Promise<MemberRow> {
    let m = this.mustMember(memberId)
    const g = this.mustGroup(m.group_id)

    if (m.status === 'invited') {
      if (this.db.casMember(m.id, m.version, { status: 'viewed' })) {
        this.hub.emit(g.id, m.id, 'member.viewed', { name: m.display_name })
      }
      m = this.mustMember(memberId)
    }

    if (GROUP_TERMINAL.has(g.status) || g.status === 'committing') return m
    if (!PAYING_ROLES.has(m.role)) return m

    // On the at_venue rail there is no merchant to scope a mandate to, so
    // there is nothing to mint. The member's consent is an explicit
    // acknowledgement of their exact amount (acceptShare) and nothing more —
    // no approval URL, because there is no card ceremony to send them to.
    if (!capabilityOf(g.rail).mandates) {
      if (m.status === 'viewed' && m.share_amount > 0) {
        const fresh = this.mustMember(memberId)
        if (this.db.casMember(fresh.id, fresh.version, { status: 'awaiting_approval' })) {
          this.hub.emit(g.id, m.id, 'member.awaiting_acceptance', {
            name: m.display_name,
            amount: m.share_amount,
          })
        }
      }
      return this.mustMember(memberId)
    }

    const merchant = JSON.parse(g.merchant_json) as { name: string; url: string; country_code_iso2: string }
    const cart = JSON.parse(g.cart_json) as Cart

    if (m.status === 'viewed' && m.share_amount > 0 && !m.prava_session_id) {
      const session = await this.prava.createMandateSession({
        userId: m.id,
        userEmail: `${m.id}@members.gmp.local`,
        totalAmount: toDecimalString(m.cap_amount),
        currency: g.currency,
        merchant,
        products: cart.items.map((i) => ({
          description: i.name,
          unit_price: toDecimalString(i.unit_amount),
          quantity: i.qty,
        })),
        description: `${g.title} — ${m.display_name}'s share (cap ${toDecimalString(m.cap_amount)})`,
        callbackUrl: `${this.cfg.appBaseUrl}/a/${m.id}`,
        effectiveUntilMinutes: 60,
      })
      const fresh = this.mustMember(memberId)
      if (this.db.casMember(fresh.id, fresh.version, {
        status: 'awaiting_approval',
        prava_session_id: session.sessionId,
        prava_approval_url: session.approvalUrl,
      })) {
        this.hub.emit(g.id, m.id, 'member.session_created', {
          name: m.display_name,
          cap: m.cap_amount,
          requote_round: m.requote_round,
        })
      }
    }

    // A backstop's standing offer is its own one-time mandate, sized to the cap.
    m = this.mustMember(memberId)
    if (m.backstop_cap > 0 && !m.backstop_session_id) {
      const session = await this.prava.createMandateSession({
        userId: `${m.id}:bs`,
        userEmail: `${m.id}@members.gmp.local`,
        totalAmount: toDecimalString(m.backstop_cap),
        currency: g.currency,
        merchant,
        products: [{ description: `Backstop offer for "${g.title}"`, unit_price: toDecimalString(m.backstop_cap), quantity: 1 }],
        description: `${g.title} — ${m.display_name}'s backstop offer (up to ${toDecimalString(m.backstop_cap)})`,
        callbackUrl: `${this.cfg.appBaseUrl}/a/${m.id}`,
        effectiveUntilMinutes: 60,
      })
      const fresh = this.mustMember(memberId)
      this.db.casMember(fresh.id, fresh.version, {
        backstop_session_id: session.sessionId,
        backstop_approval_url: session.approvalUrl,
      })
    }

    return this.mustMember(memberId)
  }

  /** Poller found this member's mandate active. */
  async memberApproved(memberId: string, mandateId: string): Promise<void> {
    const m = this.mustMember(memberId)
    if (m.status !== 'awaiting_approval') return
    if (this.db.casMember(m.id, m.version, { status: 'approved', prava_mandate_id: mandateId })) {
      this.hub.emit(m.group_id, m.id, 'member.approved', {
        name: m.display_name,
        share: m.share_amount,
        cap: m.cap_amount,
        mandate_id: mandateId,
      })
      await this.decide(m.group_id)
    }
  }

  /**
   * at_venue rail: the member reads their exact amount and accepts it. This is
   * the whole of their consent on this rail — deliberately a different act from
   * a passkey mandate, and recorded as such so the receipt can never blur them.
   */
  async acceptShare(memberId: string): Promise<void> {
    const m = this.mustMember(memberId)
    const g = this.mustGroup(m.group_id)
    if (capabilityOf(g.rail).mandates) {
      throw new UserError('this split is paid by card mandate — approve on Prava instead')
    }
    if (g.status !== 'collecting') throw new UserError('this split is no longer collecting')
    if (m.status === 'approved') return
    if (!['viewed', 'awaiting_approval', 'invited'].includes(m.status)) {
      throw new UserError(`cannot accept from ${m.status}`)
    }
    if (this.db.casMember(m.id, m.version, { status: 'approved' })) {
      this.hub.emit(g.id, m.id, 'member.accepted', {
        name: m.display_name,
        amount: m.share_amount,
      })
      await this.decide(g.id)
    }
  }

  /** Poller found this member's backstop mandate active — the offer is armed. */
  backstopArmed(memberId: string, mandateId: string): void {
    const m = this.mustMember(memberId)
    if (m.backstop_mandate_id) return
    if (this.db.casMember(m.id, m.version, { backstop_mandate_id: mandateId })) {
      this.hub.emit(m.group_id, m.id, 'backstop.armed', { name: m.display_name, cap: m.backstop_cap })
    }
  }

  /** Explicit decline from our page, or external mandate cancellation (§10.13). */
  async declineMember(memberId: string, reason: 'declined' | 'external_cancel' = 'declined'): Promise<void> {
    const m = this.mustMember(memberId)
    if (!['invited', 'viewed', 'awaiting_approval', 'approved'].includes(m.status)) return
    const g = this.mustGroup(m.group_id)
    if (GROUP_TERMINAL.has(g.status) || g.status === 'committing') return

    if (this.db.casMember(m.id, m.version, { status: 'declined', failure_reason: reason })) {
      this.hub.emit(g.id, m.id, 'member.declined', { name: m.display_name, reason })
      await this.cleanupMemberAuthorizations(m)
      await this.decide(g.id)
    }
  }

  /**
   * Kill every standing authorization this member holds.
   *
   * Session revocation and mandate cancellation are both attempted, not one or
   * the other: cancel is only documented from active/paused, so a mandate still
   * pending needs the session revoked, while an already-active mandate needs
   * the explicit cancel. Prava does not document what revoking a session does
   * to its pending mandate, so we never rely on the side effect.
   */
  private async cleanupMemberAuthorizations(m: MemberRow): Promise<void> {
    if (m.prava_session_id) await swallow(this.prava.revokeSession(m.prava_session_id))
    if (m.prava_mandate_id) await swallow(this.prava.cancelMandate(m.prava_mandate_id))
    if (m.backstop_session_id) await swallow(this.prava.revokeSession(m.backstop_session_id))
    if (m.backstop_mandate_id) await swallow(this.prava.cancelMandate(m.backstop_mandate_id))
  }

  // -------------------------------------------------------------------------
  // Decision point (GMP/1 §9 decide)
  // -------------------------------------------------------------------------

  async decide(groupId: string, opts: { deadlineForced?: boolean } = {}): Promise<void> {
    let g = this.mustGroup(groupId)
    if (g.status !== 'collecting') return

    // A live auction defers every decision: slots must be allocated before
    // shares — and therefore consent — are final.
    if (this.auctionOpen(g)) {
      if (!opts.deadlineForced) return
      await this.closeAuctions(groupId)
      g = this.mustGroup(groupId)
      if (g.status !== 'collecting') return
    }

    const members = this.db.membersOf(groupId)
    const participants: Participant[] = members
      .filter((m) => PAYING_ROLES.has(m.role) && m.share_amount > 0)
      .map((m) => ({
        id: m.id,
        name: m.display_name,
        weight: m.weight,
        decision:
          m.status === 'approved' ? (m.on_hold ? 'pending' : 'approved')
          : ['declined', 'expired', 'dropped', 'failed'].includes(m.status) ? 'declined'
          : 'pending',
      }))

    const policy = JSON.parse(g.policy_json) as Policy
    const result = evaluatePolicy(policy, participants, this.now())

    if (result.status === 'satisfied') {
      await this.lockAndCommit(g, result.locked, result.reason)
      return
    }
    if (result.status === 'unsatisfiable') {
      await this.abort(g.id, `policy unsatisfiable — ${result.reason}`, 'aborted')
      return
    }
    if (opts.deadlineForced) {
      await this.abort(g.id, `deadline passed with policy open — ${result.reason}`, 'expired')
    }
  }

  private async lockAndCommit(g: GroupRow, lockedIds: string[], reason: string): Promise<void> {
    const members = this.db.membersOf(g.id)
    const locked = members.filter((m) => lockedIds.includes(m.id))

    // Everyone paying who is not locked and not already terminal gets dropped.
    for (const m of members) {
      if (!PAYING_ROLES.has(m.role) || m.share_amount === 0) continue
      if (lockedIds.includes(m.id)) continue
      if (['declined', 'expired', 'dropped', 'failed'].includes(m.status)) continue
      const fresh = this.mustMember(m.id)
      if (this.db.casMember(fresh.id, fresh.version, { status: 'dropped' })) {
        this.hub.emit(g.id, m.id, 'member.dropped', { name: m.display_name })
        await this.cleanupMemberAuthorizations(fresh)
      }
    }

    // Tiered carts (§3): extras claimed only by people who are out leave the
    // cart, so one person flaking on merch never kills the tickets. Core
    // items stay whole — that is what the backstop exists for.
    const cart = JSON.parse(g.cart_json) as Cart
    const lockedNames = new Set(locked.map((m) => m.display_name))
    const adjusted = adjustCartForLocked(cart, lockedNames)
    const adjustedHash = sha256(canonicalJson(adjusted))
    if (adjustedHash !== g.cart_hash) {
      if (this.db.casGroup(g.id, g.version, { cart_json: JSON.stringify(adjusted), cart_hash: adjustedHash })) {
        this.hub.emit(g.id, null, 'cart.adjusted', {
          reason: 'extras of non-locked members removed',
          old_hash: g.cart_hash,
          new_hash: adjustedHash,
        })
      }
      g = this.mustGroup(g.id)
    }

    // Target shares over the adjusted cart. Every member is charged at most
    // what they passkey-approved (their cap); the gap between the cart total
    // and the sum of capped charges is the shortfall.
    const targets = computeShares(adjusted, locked.map(toMemberInput)).shares
    const chargeable = new Map<string, Minor>()
    for (const m of locked) {
      const target = targets.get(m.display_name) ?? m.share_amount
      chargeable.set(m.id, Math.min(target, m.cap_amount))
    }
    const adjustedTotal = cartTotal(adjusted)
    const shortfall = adjustedTotal - [...chargeable.values()].reduce((a, b) => a + b, 0)

    const plan: ChargePlanEntry[] = locked.map((m) => ({
      member_id: m.id,
      source: 'share',
      amount: chargeable.get(m.id) ?? m.share_amount,
    }))
    let narrative = `${reason}; locked ${locked.length} member(s)`

    if (shortfall > 0) {
      // First line of defense: armed backstop offers among the locked set.
      const offers = locked
        .filter((m) => m.backstop_mandate_id && m.backstop_cap > 0)
        .map((m) => ({ memberId: m.id, cap: m.backstop_cap }))
      const allocation = allocateBackstops(shortfall, offers)

      if (allocation) {
        for (const a of allocation) {
          plan.push({ member_id: a.memberId, source: 'backstop', amount: a.amount })
          const bm = locked.find((m) => m.id === a.memberId)!
          this.hub.emit(g.id, a.memberId, 'backstop.allocated', {
            name: bm.display_name,
            amount: a.amount,
            shortfall,
          })
        }
        narrative += `; shortfall ${toDecimalString(shortfall)} absorbed by ${allocation.length} backstop(s)`
      } else {
        // Requote cascade (§9): consent cannot stretch, so anyone whose
        // target exceeds their cap must re-approve at the new share.
        await this.requoteCascade(g, locked, targets)
        return
      }
    }

    // Persist the final charge amounts so every surface shows the truth.
    for (const m of locked) {
      const amt = chargeable.get(m.id) ?? m.share_amount
      if (amt !== m.share_amount) {
        const fresh = this.mustMember(m.id)
        this.db.casMember(fresh.id, fresh.version, { share_amount: amt })
      }
    }

    if (!this.db.casGroup(g.id, g.version, {
      status: 'committing',
      decision_note: narrative,
      locked_json: JSON.stringify(plan),
    })) {
      return // lost the race; the winning decision path proceeds
    }
    this.hub.emit(g.id, null, 'group.decision', { narrative, plan })
    this.hub.emit(g.id, null, 'group.committing', {})

    await this.executeCommit(g.id)
  }

  private async requoteCascade(g: GroupRow, locked: MemberRow[], targets: Map<string, Minor>): Promise<void> {
    const overCap: { m: MemberRow; newShare: Minor }[] = []

    for (const m of locked) {
      const newShare = targets.get(m.display_name) ?? m.share_amount
      if (newShare > m.cap_amount) {
        if (m.requote_round >= 2) {
          await this.abort(g.id, `requote round cap exceeded for ${m.display_name}`, 'aborted')
          return
        }
        overCap.push({ m, newShare })
      } else if (newShare !== m.share_amount) {
        const fresh = this.mustMember(m.id)
        this.db.casMember(fresh.id, fresh.version, { share_amount: newShare })
      }
    }

    for (const { m, newShare } of overCap) {
      const fresh = this.mustMember(m.id)
      if (fresh.prava_mandate_id) await swallow(this.prava.cancelMandate(fresh.prava_mandate_id))
      else if (fresh.prava_session_id) await swallow(this.prava.revokeSession(fresh.prava_session_id))
      if (this.db.casMember(fresh.id, fresh.version, {
        status: 'viewed', // openMember() mints the fresh session at the new cap
        share_amount: newShare,
        cap_amount: capFor(newShare, g.tolerance_bps),
        prava_session_id: null,
        prava_approval_url: null,
        prava_mandate_id: null,
        requote_round: fresh.requote_round + 1,
      })) {
        this.hub.emit(g.id, m.id, 'member.requoted', {
          name: m.display_name,
          new_share: newShare,
          round: fresh.requote_round + 1,
        })
      }
    }
    // Group stays in collecting; re-approvals re-enter decide().
  }

  // -------------------------------------------------------------------------
  // Commit (GMP/1 §9 commit) — the point of no return is the first charge.
  // Sequential, idempotent, resumable.
  // -------------------------------------------------------------------------

  async executeCommit(groupId: string): Promise<void> {
    if (this.committing.has(groupId)) return
    this.committing.add(groupId)
    try {
      await this.runCommit(groupId)
    } finally {
      this.committing.delete(groupId)
    }
  }

  private async runCommit(groupId: string): Promise<void> {
    const g = this.mustGroup(groupId)
    if (g.status !== 'committing' || !g.locked_json) return
    const plan = JSON.parse(g.locked_json) as ChargePlanEntry[]

    // On a rail that does not charge, committing means the allocation is final
    // and everyone has agreed their number. No card is touched, so there is no
    // saga to run — and the receipt will say `settled_at_venue`, never
    // `charged`.
    if (!capabilityOf(g.rail).charges) {
      await this.settleAtVenue(g, plan)
      return
    }

    let halted = false

    for (const entry of plan) {
      if (halted) break
      const m = this.mustMember(entry.member_id)
      if (this.entrySettled(m, entry)) continue

      const result = await this.chargeEntry(g, entry)
      if (result === 'unknown') {
        // §10.10 — unknown is never failed. Leave the group in committing;
        // the poller re-enters this commit and the shared idempotency
        // reference makes the redo safe.
        return
      }
      if (result === 'failed' && g.straggler_policy === 'halt_partial') {
        halted = true
        this.hub.emit(g.id, null, 'group.halted', { after: entry.member_id })
      }
    }

    // Post-commit cleanup: cancel every authorization that was never charged.
    for (const m of this.db.membersOf(g.id)) {
      const chargedBackstop = plan.some(
        (e) => e.source === 'backstop' && e.member_id === m.id && this.entrySettled(m, e),
      )
      if (!['charged', 'charging'].includes(m.status) && m.prava_mandate_id) {
        await swallow(this.prava.cancelMandate(m.prava_mandate_id))
      }
      if (m.backstop_mandate_id && !chargedBackstop) {
        await swallow(this.prava.cancelMandate(m.backstop_mandate_id))
      }
    }

    const finalMembers = this.db.membersOf(g.id)
    const shareEntries = plan.filter((e) => e.source === 'share')
    const allCharged = shareEntries.every(
      (e) => finalMembers.find((m) => m.id === e.member_id)?.status === 'charged',
    )
    const backstopOk = plan
      .filter((e) => e.source === 'backstop')
      .every((e) => (finalMembers.find((m) => m.id === e.member_id)?.backstop_absorbed ?? 0) > 0)

    const status = allCharged && backstopOk && !halted ? 'committed' : 'partial'
    const fresh = this.mustGroup(g.id)
    if (fresh.status === 'committing' && this.db.casGroup(fresh.id, fresh.version, { status })) {
      this.hub.emit(g.id, null, `group.${status}`, {})
      this.issueReceipt(this.mustGroup(g.id))
    }
  }

  /**
   * at_venue commit. Locks each member's obligation at the agreed amount and
   * closes the group. `settled` is a distinct status from `charged` on purpose:
   * every surface, and the signed receipt, must be able to tell a judge which
   * of the two actually happened.
   */
  private async settleAtVenue(g: GroupRow, plan: ChargePlanEntry[]): Promise<void> {
    for (const entry of plan) {
      if (entry.source !== 'share') continue
      const m = this.mustMember(entry.member_id)
      if (isSettled(m.status)) continue
      if (this.db.casMember(m.id, m.version, { status: 'settled', charged_amount: 0 })) {
        this.hub.emit(g.id, m.id, 'member.settled', {
          name: m.display_name,
          owed: entry.amount,
          rail: g.rail,
        })
      }
    }
    const fresh = this.mustGroup(g.id)
    if (fresh.status === 'committing' && this.db.casGroup(fresh.id, fresh.version, { status: 'committed' })) {
      this.hub.emit(g.id, null, 'group.committed', { rail: g.rail, charged: false })
      this.issueReceipt(this.mustGroup(g.id))
    }
  }

  private entrySettled(m: MemberRow, entry: ChargePlanEntry): boolean {
    if (entry.source === 'share') return m.status === 'charged' || m.status === 'failed'
    return this.db.countEvents(m.group_id, 'backstop.absorbed', m.id) > 0
      || this.db.countEvents(m.group_id, 'backstop.failed', m.id) > 0
  }

  private async chargeEntry(
    g: GroupRow,
    entry: ChargePlanEntry,
  ): Promise<'charged' | 'failed' | 'unknown'> {
    const member = this.mustMember(entry.member_id)
    const mandateId = entry.source === 'share' ? member.prava_mandate_id : member.backstop_mandate_id
    if (!mandateId) {
      this.failEntry(g, member, entry, 'no mandate at commit time')
      return 'failed'
    }

    if (entry.source === 'share' && member.status === 'approved') {
      const fresh = this.mustMember(member.id)
      if (fresh.status === 'approved') {
        this.db.casMember(fresh.id, fresh.version, { status: 'charging' })
        this.hub.emit(g.id, member.id, 'member.charging', { name: member.display_name })
      }
    }

    const maxAttempts = g.straggler_policy === 'retry_once' ? 2 : 1
    let attempt = this.lastAttempt(g.id, member.id, entry.source)

    while (attempt < maxAttempts) {
      attempt += 1
      const reference = `gmp:${g.id}:${member.id}:${entry.source}:${attempt}`
      this.hub.emit(g.id, member.id, 'charge.attempted', {
        name: member.display_name,
        source: entry.source,
        amount: entry.amount,
        attempt,
        reference,
      })

      const outcome = await this.chargeWithReconciliation(mandateId, entry.amount, reference)

      if (outcome.status === 'awaiting_result' && outcome.transactionId) {
        this.hub.emit(g.id, member.id, 'charge.succeeded', {
          name: member.display_name,
          source: entry.source,
          attempt,
          txn_id: outcome.transactionId,
          amount: entry.amount,
        })
        await this.settle(g, member, entry, mandateId, outcome.transactionId)
        return 'charged'
      }

      if (outcome.errorCode === 'CHARGE_STATE_UNKNOWN') {
        // No outcome event on purpose: lastAttempt() must see this attempt as
        // unresolved so the resume reuses the same idempotency reference.
        this.hub.emit(g.id, member.id, 'charge.unknown', {
          name: member.display_name,
          source: entry.source,
          attempt,
          message: outcome.errorMessage ?? '',
        })
        return 'unknown'
      }

      this.hub.emit(g.id, member.id, 'charge.failed', {
        name: member.display_name,
        source: entry.source,
        attempt,
        error: outcome.errorCode ?? 'UNKNOWN',
        message: outcome.errorMessage ?? '',
      })
    }

    this.failEntry(g, this.mustMember(member.id), entry, 'charge declined')
    return 'failed'
  }

  /**
   * Charge with unknown-state reconciliation (§10.10).
   *
   * Three distinct outcomes, and conflating any two of them is how a group
   * gets double-charged or wedged:
   *
   *  - A 4xx error envelope is Prava's definitive answer (wrong merchant,
   *    mandate not active, validation). No charge exists. Fail immediately;
   *    retrying a refusal only burns the commit window.
   *  - A transport failure leaves the charge genuinely in doubt. Before
   *    retrying we ASK: the mandate carries its own charges[], each stamped
   *    with the reference we sent. If ours is there, the charge landed and
   *    must never be reissued — we adopt its transaction id and move on.
   *  - Only when the retries are spent AND reconciliation finds nothing do we
   *    return unknown, which halts this member rather than guessing.
   *
   * Note that Prava clears the idempotency key of a FAILED charge, so
   * reference-replay protects the in-flight case, not the post-failure retry.
   * That is precisely why a failure must be classified, never retried blindly.
   */
  private async chargeWithReconciliation(mandateId: string, amount: Minor, reference: string) {
    let lastError: unknown

    for (let i = 0; i < 5; i++) {
      try {
        return await this.prava.chargeMandate(mandateId, toDecimalString(amount), reference)
      } catch (e) {
        lastError = e
        if ((e as { terminal?: boolean }).terminal) {
          return {
            status: 'failed' as const,
            transactionId: null,
            errorCode: (e as { code?: string }).code ?? 'CHARGE_REFUSED',
            errorMessage: (e as Error).message,
            terminal: true,
          }
        }
        // The response may have been lost after Prava already booked it.
        const landed = await this.findChargeByReference(mandateId, reference)
        if (landed) {
          return {
            status: 'awaiting_result' as const,
            transactionId: landed.transactionId,
            deduplicated: true,
          }
        }
        await sleep(Math.min(200 * 2 ** i, 2000))
      }
    }

    // One last reconciliation before declaring the state unknown.
    const landed = await this.findChargeByReference(mandateId, reference)
    if (landed) {
      return {
        status: 'awaiting_result' as const,
        transactionId: landed.transactionId,
        deduplicated: true,
      }
    }
    return {
      status: 'failed' as const,
      transactionId: null,
      errorCode: 'CHARGE_STATE_UNKNOWN',
      errorMessage: String((lastError as Error)?.message ?? lastError),
    }
  }

  /** Did a charge carrying our idempotency reference already land? */
  private async findChargeByReference(mandateId: string, reference: string) {
    try {
      const charges = await this.prava.getMandateCharges(mandateId)
      return charges.find((c) => c.reference === reference && c.status !== 'failed') ?? null
    } catch {
      // Reconciliation is best-effort; failing it just means we stay unsure.
      return null
    }
  }

  private async settle(
    g: GroupRow,
    member: MemberRow,
    entry: ChargePlanEntry,
    mandateId: string,
    txnId: string,
  ): Promise<void> {
    // Settlement report failure is retried, never re-charged (§10.9). A 200 is
    // not enough: the report can come back status "failed" or with the network
    // saying visaConfirmation FAILURE, and treating either as settled would
    // put a lie in the receipt.
    let settled = false
    let lastReport: string | null = null
    for (let i = 0; i < 5 && !settled; i++) {
      try {
        const outcome = await this.prava.reportCharge(
          mandateId, txnId, 'APPROVED', toDecimalString(entry.amount),
        )
        settled = outcome.settled
        lastReport = `${outcome.status}/${outcome.visaConfirmation ?? 'n/a'}`
        if (!settled) await sleep(Math.min(200 * 2 ** i, 2000))
      } catch (e) {
        lastReport = (e as Error).message
        await sleep(Math.min(200 * 2 ** i, 2000))
      }
    }
    if (!settled) {
      // The charge stands; only its settlement report is outstanding. The
      // receipt says exactly that rather than claiming a clean close.
      this.hub.emit(g.id, member.id, 'charge.settlement_pending', {
        txn_id: txnId,
        last_report: lastReport,
      })
    }

    const fresh = this.mustMember(member.id)
    if (entry.source === 'share') {
      this.db.casMember(fresh.id, fresh.version, {
        status: 'charged',
        prava_charge_txn_id: txnId,
        charged_amount: entry.amount,
      })
      this.hub.emit(g.id, member.id, 'member.charged', {
        name: member.display_name,
        amount: entry.amount,
        txn_id: txnId,
      })
    } else {
      this.db.casMember(fresh.id, fresh.version, {
        backstop_absorbed: entry.amount,
      })
      this.hub.emit(g.id, member.id, 'backstop.absorbed', {
        name: member.display_name,
        amount: entry.amount,
        txn_id: txnId,
      })
    }
  }

  private failEntry(g: GroupRow, member: MemberRow, entry: ChargePlanEntry, reason: string): void {
    if (entry.source === 'share') {
      if (member.status !== 'failed') {
        this.db.casMember(member.id, member.version, { status: 'failed', failure_reason: reason })
        this.hub.emit(g.id, member.id, 'member.failed', { name: member.display_name, reason })
      }
    } else {
      this.hub.emit(g.id, member.id, 'backstop.failed', { name: member.display_name, reason })
    }
  }

  private lastAttempt(groupId: string, memberId: string, source: 'share' | 'backstop'): number {
    const events = this.db.eventsAfter(groupId, 0)
    let last = 0
    let lastRef = ''
    for (const e of events) {
      if (e.member_id !== memberId || e.type !== 'charge.attempted') continue
      const p = JSON.parse(e.payload_json) as { source: string; attempt: number; reference: string }
      if (p.source === source && p.attempt > last) {
        last = p.attempt
        lastRef = p.reference
      }
    }
    if (last === 0) return 0
    // If THE LAST attempt has a recorded outcome, the next call starts a new
    // attempt; if not (crash or lost response mid-charge), redo the SAME
    // attempt — the shared reference makes the retry idempotent at Prava.
    const outcome = events.some((e) => {
      if (e.member_id !== memberId) return false
      if (e.type !== 'charge.succeeded' && e.type !== 'charge.failed') return false
      const p = JSON.parse(e.payload_json) as { source: string; attempt?: number }
      return p.source === source && p.attempt === last
    })
    return outcome ? last : last - 1
  }

  // -------------------------------------------------------------------------
  // Abort / expiry / cancellation
  // -------------------------------------------------------------------------

  async cancelGroup(groupId: string): Promise<void> {
    const g = this.mustGroup(groupId)
    if (GROUP_TERMINAL.has(g.status)) return
    if (g.status === 'committing') throw new UserError('cannot cancel past the point of no return')
    await this.abort(groupId, 'organizer cancelled', 'aborted')
  }

  private async abort(groupId: string, reason: string, kind: 'aborted' | 'expired'): Promise<void> {
    const g = this.mustGroup(groupId)
    if (GROUP_TERMINAL.has(g.status) || g.status === 'committing') return
    if (!this.db.casGroup(g.id, g.version, { status: kind, decision_note: reason })) return

    for (const m of this.db.membersOf(groupId)) {
      if (!PAYING_ROLES.has(m.role)) continue
      if (['declined', 'expired', 'dropped', 'failed'].includes(m.status)) continue
      const newStatus = kind === 'expired' && m.status !== 'approved' ? 'expired' : 'dropped'
      const fresh = this.mustMember(m.id)
      this.db.casMember(fresh.id, fresh.version, { status: newStatus })
      await this.cleanupMemberAuthorizations(fresh)
    }
    this.hub.emit(groupId, null, `group.${kind}`, { reason })
    this.issueReceipt(this.mustGroup(groupId))
  }

  /** Poller tick: enforce the group deadline. */
  async handleDeadline(groupId: string): Promise<void> {
    const g = this.mustGroup(groupId)
    if (g.status !== 'collecting') return
    if (this.now() < new Date(g.deadline_at)) return
    if (this.db.countEvents(groupId, 'group.deadline', null) === 0) {
      this.hub.emit(groupId, null, 'group.deadline', { at: g.deadline_at })
    }
    await this.decide(groupId, { deadlineForced: true })
  }

  // -------------------------------------------------------------------------
  // Priority auctions (§21.1) — allocation-only sealed bids
  // -------------------------------------------------------------------------

  auctionOpen(g: GroupRow): boolean {
    return !!g.auction_close_at && this.db.countEvents(g.id, 'auction.closed', null) === 0
  }

  placeBid(memberId: string, sku: string, amount: Minor): void {
    const m = this.mustMember(memberId)
    const g = this.mustGroup(m.group_id)
    if (g.status !== 'collecting') throw new UserError('group is not collecting')
    if (!this.auctionOpen(g)) throw new UserError('the sealed-bid window is closed')
    if (this.now() >= new Date(g.auction_close_at!)) throw new UserError('the sealed-bid window is closed')
    const cart = JSON.parse(g.cart_json) as Cart
    const item = cart.items.find((i) => i.sku === sku)
    if (!item?.contested) throw new UserError(`item ${sku} is not contested`)
    if (!item.claimants.includes(m.display_name)) throw new UserError('you are not a claimant of this item')
    if (amount < 0) throw new UserError('bids cannot be negative')

    this.db.upsertBid(g.id, m.id, sku, amount)
    // Sealed: the stream says a bid landed, never how much.
    this.hub.emit(g.id, m.id, 'auction.bid', { name: m.display_name, sku })

    // Early close once every claimant of every contested item has bid.
    const allBid = cart.items
      .filter((i) => i.contested)
      .every((i) => {
        const memberIdsByName = new Map(this.db.membersOf(g.id).map((x) => [x.display_name, x.id]))
        return i.claimants.every((c) => {
          const cid = memberIdsByName.get(c)
          return cid ? this.db.myBids(g.id, cid).some((b) => b.sku === i.sku) : true
        })
      })
    if (allBid) void this.closeAuctions(g.id)
  }

  /**
   * Close every contested item: rank sealed bids, allocate slots, rewrite the
   * cart (winners become the claimants), recompute shares, requote anyone
   * whose consent no longer covers their share. Reveal everything — the
   * transparency after sealing is what makes this a mechanism, not a dark
   * pattern. Bids allocate; they never price.
   */
  async closeAuctions(groupId: string): Promise<void> {
    const g = this.mustGroup(groupId)
    if (!this.auctionOpen(g) || g.status !== 'collecting') return
    const members = this.db.membersOf(groupId)
    const idByName = new Map(members.map((m) => [m.display_name, m.id]))
    const nameById = new Map(members.map((m) => [m.id, m.display_name]))
    const cart = JSON.parse(g.cart_json) as Cart

    for (const item of cart.items) {
      if (!item.contested) continue
      const claimantIds = item.claimants.map((c) => idByName.get(c)).filter(Boolean) as string[]
      const bids: SealedBid[] = claimantIds.flatMap((cid) =>
        this.db.bidsFor(groupId, item.sku)
          .filter((b) => b.member_id === cid)
          .map((b) => ({ memberId: cid, amount: b.amount, seq: b.seq })),
      )
      const result = allocateAuction(item.qty, claimantIds, bids)
      const winnerNames = result.winners.map((w) => nameById.get(w)!)
      this.hub.emit(groupId, null, 'auction.reveal', {
        sku: item.sku,
        item: item.name,
        slots: item.qty,
        ranking: result.ranking.map((r) => ({
          name: nameById.get(r.memberId),
          amount: r.amount,
          won: r.won,
        })),
      })
      for (const loser of result.losers) {
        this.hub.emit(groupId, loser, 'auction.lost', { name: nameById.get(loser), sku: item.sku })
      }
      item.claimants = winnerNames
      item.qty = winnerNames.length || item.qty
      item.contested = false
      if (winnerNames.length === 0) item.qty = 0
    }
    cart.items = cart.items.filter((i) => i.qty > 0)

    const newHash = sha256(canonicalJson(cart))
    if (!this.db.casGroup(g.id, g.version, { cart_json: JSON.stringify(cart), cart_hash: newHash })) return
    this.hub.emit(groupId, null, 'auction.closed', { new_cart_hash: newHash })

    // Re-derive every share; consent binding decides who must re-approve.
    const paying = members.filter((m) => PAYING_ROLES.has(m.role))
    const { shares } = computeShares(cart, paying.map(toMemberInput))
    for (const m of paying) {
      const newShare = shares.get(m.display_name) ?? 0
      if (newShare === m.share_amount) continue
      const fresh = this.mustMember(m.id)

      if (newShare === 0) {
        // Lost every claim: out of the purchase, authorizations cancelled.
        if (this.db.casMember(fresh.id, fresh.version, { status: 'dropped', share_amount: 0 })) {
          this.hub.emit(groupId, m.id, 'member.dropped', { name: m.display_name, reason: 'auction' })
          await this.cleanupMemberAuthorizations(fresh)
        }
        continue
      }
      if (newShare <= fresh.cap_amount) {
        // Existing consent covers it — just move the number.
        this.db.casMember(fresh.id, fresh.version, { share_amount: newShare })
        continue
      }
      // Consent cannot stretch: cancel the stale authorization and requote.
      if (fresh.prava_mandate_id) await swallow(this.prava.cancelMandate(fresh.prava_mandate_id))
      else if (fresh.prava_session_id) await swallow(this.prava.revokeSession(fresh.prava_session_id))
      if (this.db.casMember(fresh.id, fresh.version, {
        status: fresh.status === 'invited' ? 'invited' : 'viewed',
        share_amount: newShare,
        cap_amount: capFor(newShare, g.tolerance_bps),
        prava_session_id: null,
        prava_approval_url: null,
        prava_mandate_id: null,
        requote_round: fresh.requote_round + 1,
      })) {
        this.hub.emit(groupId, m.id, 'member.requoted', {
          name: m.display_name,
          new_share: newShare,
          round: fresh.requote_round + 1,
          reason: 'auction settlement',
        })
      }
    }

    await this.decide(groupId)
  }

  // -------------------------------------------------------------------------
  // Hold my share (mandate pause — approved but not committable)
  // -------------------------------------------------------------------------

  async holdShare(memberId: string): Promise<void> {
    const m = this.mustMember(memberId)
    if (m.status !== 'approved' || m.on_hold) throw new UserError('only an active approval can be held')
    const g = this.mustGroup(m.group_id)
    if (g.status !== 'collecting') throw new UserError('too late to hold')
    if (m.prava_mandate_id) await this.prava.pauseMandate(m.prava_mandate_id)
    if (this.db.casMember(m.id, m.version, { on_hold: 1 })) {
      this.hub.emit(g.id, m.id, 'member.held', { name: m.display_name })
    }
  }

  async resumeShare(memberId: string): Promise<void> {
    const m = this.mustMember(memberId)
    if (!m.on_hold) return
    if (m.prava_mandate_id) await this.prava.resumeMandate(m.prava_mandate_id)
    if (this.db.casMember(m.id, m.version, { on_hold: 0 })) {
      this.hub.emit(m.group_id, m.id, 'member.resumed', { name: m.display_name })
      await this.decide(m.group_id)
    }
  }

  // -------------------------------------------------------------------------
  // Display currency snapshot (§21.3)
  // -------------------------------------------------------------------------

  private async snapshotFx(groupId: string, base: string, symbols: string[]): Promise<void> {
    if (process.env.GMP_NO_FX) return // tests & chaos stay fully offline
    const targets = symbols.filter((s) => s !== base)
    if (targets.length === 0) return
    try {
      const res = await fetch(
        `https://api.frankfurter.app/latest?from=${base}&to=${targets.join(',')}`,
        { signal: AbortSignal.timeout(4000) },
      )
      if (!res.ok) return
      const data = (await res.json()) as { rates: Record<string, number> }
      const g = this.db.getGroup(groupId)
      if (!g) return
      this.db.casGroup(g.id, g.version, {
        fx_json: JSON.stringify({
          base,
          rates: data.rates,
          at: this.now().toISOString(),
          source: 'frankfurter.app',
        }),
      })
      this.hub.emit(groupId, null, 'fx.snapshot', { base, rates: data.rates })
    } catch {
      // no FX, no problem — surfaces simply render single-currency
    }
  }

  // -------------------------------------------------------------------------
  // Receipt
  // -------------------------------------------------------------------------

  private issueReceipt(g: GroupRow): void {
    const members = this.db.membersOf(g.id).filter((m) => PAYING_ROLES.has(m.role))
    const rail = capabilityOf(g.rail)
    const bare: Omit<ReceiptEntry, 'prev_hash' | 'hash'>[] = []

    for (const m of members) {
      const done = isSettled(m.status)
      bare.push({
        kind: 'consent',
        member_id: m.id,
        name: m.display_name,
        role: m.role,
        cart_hash: g.cart_hash,
        cap_amount: m.cap_amount,
        quoted_share: m.share_amount,
        // charged_amount is reserved for money this engine actually moved.
        charged_amount: m.status === 'charged' ? m.charged_amount : 0,
        owed_amount: done ? m.share_amount : 0,
        mandate_id: m.prava_mandate_id,
        charge_txn_id: m.prava_charge_txn_id,
        outcome:
          m.status === 'charged' ? 'charged'
          : m.status === 'settled' ? 'settled_at_venue'
          : `not_charged:${m.status}`,
      })
      if (m.backstop_absorbed > 0) {
        bare.push({
          kind: 'backstop',
          member_id: m.id,
          name: m.display_name,
          role: 'backstop',
          cart_hash: g.cart_hash,
          cap_amount: m.backstop_cap,
          quoted_share: 0,
          charged_amount: m.backstop_absorbed,
          owed_amount: m.backstop_absorbed,
          mandate_id: m.backstop_mandate_id,
          charge_txn_id: null,
          outcome: 'absorbed',
        })
      }
    }

    const { entries, head } = this.signer.chain(bare)
    const receipt: Receipt = this.signer.sign({
      gmp_version: 'GMP/1',
      group_id: g.id,
      title: g.title,
      merchant: JSON.parse(g.merchant_json),
      currency: g.currency,
      cart_hash: g.cart_hash,
      policy: JSON.parse(g.policy_json),
      decision_narrative: g.decision_note ?? '',
      status: g.status,
      rail: g.rail,
      settlement_disclosure: rail.disclosure,
      totals: {
        quoted: cartTotal(JSON.parse(g.cart_json) as Cart),
        charged: entries.reduce((s, e) => s + e.charged_amount, 0),
        owed: entries.reduce((s, e) => s + e.owed_amount, 0),
      },
      entries,
      chain_head: head,
      issued_at: this.now().toISOString(),
    })
    this.db.saveReceipt(g.id, JSON.stringify(receipt))
    this.hub.emit(g.id, null, 'receipt.issued', { chain_head: head })
  }

  // -------------------------------------------------------------------------

  mustGroup(id: string): GroupRow {
    const g = this.db.getGroup(id)
    if (!g) throw new UserError(`group ${id} not found`, 404)
    return g
  }

  mustMember(id: string): MemberRow {
    const m = this.db.getMember(id)
    if (!m) throw new UserError(`member ${id} not found`, 404)
    return m
  }
}

export class UserError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

function toMemberInput(m: MemberRow): MemberInput {
  return {
    name: m.display_name,
    role: m.role,
    weight: m.weight,
    backstop_cap: m.backstop_cap || undefined,
    sponsor_for: m.sponsor_for ?? undefined,
  }
}

/**
 * Tiered carts: extra-tier items keep only the claims of locked members —
 * quantity scales with the surviving claimants. Core items are untouched;
 * covering a dropped member's core share is the backstop's job.
 */
export function adjustCartForLocked(cart: Cart, lockedNames: Set<string>): Cart {
  const items: CartItem[] = []
  for (const item of cart.items) {
    if (item.tier !== 'extra' || item.claimants.includes('mi_all')) {
      items.push(item)
      continue
    }
    const surviving = item.claimants.filter((c) => lockedNames.has(c))
    if (surviving.length === 0) continue
    if (surviving.length === item.claimants.length) {
      items.push(item)
      continue
    }
    const qty = Math.max(1, Math.round((item.qty * surviving.length) / item.claimants.length))
    items.push({ ...item, claimants: surviving, qty })
  }
  return { ...cart, items }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function swallow(p: Promise<unknown>): Promise<void> {
  try {
    await p
  } catch {
    // best-effort cleanup; the poller reconciles stragglers
  }
}
