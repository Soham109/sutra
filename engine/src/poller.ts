// Prava offers no webhooks (verified 2026-08-01) — the poller is the engine's
// only inbound signal. It detects passkey approvals, external mandate
// cancellations (a member revoking from their own Prava portal reads as a
// decline, §6.2), enforces deadlines, and resumes interrupted commits on boot.
import type { GroupService } from './service.js'

export class Poller {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly service: GroupService,
    private readonly intervalMs = 1500,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Crash recovery (§9): reconcile every non-terminal group, resume commits. */
  async recoverOnBoot(): Promise<void> {
    for (const g of this.service.db.nonTerminalGroups()) {
      if (g.status === 'committing') {
        await this.service.executeCommit(g.id).catch(() => undefined)
      } else if (g.status === 'collecting') {
        await this.tickGroup(g.id).catch(() => undefined)
      }
    }
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const g of this.service.db.nonTerminalGroups()) {
        await this.tickGroup(g.id).catch(() => undefined)
      }
    } finally {
      this.running = false
    }
  }

  private async tickGroup(groupId: string): Promise<void> {
    const g = this.service.db.getGroup(groupId)
    if (!g) return

    if (g.status === 'committing') {
      // A commit left behind by a crash or a lost async chain.
      await this.service.executeCommit(g.id)
      return
    }
    if (g.status !== 'collecting' && g.status !== 'deciding') return

    // Sealed-bid window over? Reveal, allocate, recompute shares.
    if (g.auction_close_at && this.service.auctionOpen(g) && new Date() >= new Date(g.auction_close_at)) {
      await this.service.closeAuctions(g.id)
    }

    for (const m of this.service.db.membersOf(groupId)) {
      // Backstop mandates arm FIRST: a member's own approval can complete the
      // quorum and trigger the decision in this very tick, and the decision
      // must already see their standing offer.
      if (m.backstop_session_id && !m.backstop_mandate_id) {
        const mandates = await this.service.prava.listMandates(`${m.id}:bs`)
        const active = mandates.find((x) => x.status === 'active')
        if (active) this.service.backstopArmed(m.id, active.id)
      }

      // Share mandate: pending → active means the member approved.
      if (m.status === 'awaiting_approval' && m.prava_session_id) {
        const mandates = await this.service.prava.listMandates(m.id)
        const active = mandates.find((x) => x.status === 'active')
        if (active) {
          await this.service.memberApproved(m.id, active.id)
        } else if (mandates.length > 0 && mandates.every((x) => x.status === 'cancelled' || x.status === 'expired')) {
          await this.service.declineMember(m.id, 'external_cancel')
        }
      }

      // Approved members can still cancel from their own Prava portal (§10.13).
      if (m.status === 'approved' && m.prava_mandate_id) {
        const mandate = await this.service.prava.getMandate(m.prava_mandate_id)
        if (mandate && (mandate.status === 'cancelled' || mandate.status === 'expired')) {
          await this.service.declineMember(m.id, 'external_cancel')
        }
      }
    }

    await this.service.handleDeadline(groupId)
  }
}
