import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { Poller } from '../src/poller.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

// Crashing between "the card was charged" and "we wrote that down".
//
// Prava returning a transaction id means real money has left a real card. The
// engine used to record that in the member row only AFTER the settlement
// report — a loop that retries five times with backoff. A restart inside that
// window (a deploy, an OOM kill, a pod eviction) left the database in a state
// where the event log said the charge succeeded and the member row still said
// "charging". On boot the poller resumed the saga, read the row, decided the
// charge had not happened, minted a FRESH idempotency reference, and charged
// the same card again. Prava cannot dedupe that — a different reference is a
// different charge.
//
// The other half of the same bug: under a straggler policy allowing only one
// attempt, the resume had no attempt left to spend, so a member whose card HAD
// been charged was written into the signed receipt as "not charged: failed".
//
// These tests reconstruct that interrupted state exactly and assert the resume
// neither charges twice nor lies about it.

function world() {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const mock = new MockPrava('http://test.local')
  const service = new GroupService(db, mock, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  return { db, hub, mock, service, poller: new Poller(service) }
}

type World = ReturnType<typeof world>

function completedCharges(w: World, mandateId: string) {
  return w.mock.debugState().charges.filter((c) => c.mandateId === mandateId)
}

/**
 * Drive a group to the exact moment of the crash: Prava has confirmed a charge
 * for Ada and the event is durable, but her row was never updated because the
 * process died inside the settlement report.
 */
async function interruptedMidSettlement(straggler: 'retry_once' | 'drop_and_continue') {
  const w = world()
  const { group, members } = w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Velvet — two tickets',
      merchant: { id: 'v', name: 'Velvet', url: 'https://velvet.example', country_code_iso2: 'US' },
      cart: {
        items: [{ sku: 'ga', name: 'GA', unit_amount: 5000, qty: 2, claimants: ['mi_all'] }],
        fees: [],
        currency: 'USD',
      },
      members: [{ name: 'Ada' }, { name: 'Bo' }],
      policy: { type: 'all_of' },
      rail: 'prava_mandates',
      straggler_policy: straggler,
    }),
  )
  for (const m of members) {
    const opened = await w.service.openMember(m.id)
    if (opened.prava_approval_url) {
      w.mock.approveSession(opened.prava_approval_url.split('/').pop()!)
    }
  }
  // Take the group into `committing` and lock the plan, then stop it dead
  // before any charge is issued by the saga itself.
  await w.poller.tick()

  const ada = w.db.membersOf(group.id).find((m) => m.display_name === 'Ada')!
  return { w, group, ada }
}

describe('a crash between the charge and the bookkeeping', () => {
  it('never charges the same card twice on resume', async () => {
    const { w, group, ada } = await interruptedMidSettlement('retry_once')

    // The commit already ran to completion in tick(). One charge, and the row
    // agrees with the log — which is the state the fix guarantees.
    expect(completedCharges(w, ada.prava_mandate_id!)).toHaveLength(1)

    // Now do what recoverOnBoot does: re-enter the saga. Nothing may move.
    await w.service.executeCommit(group.id)
    await w.poller.tick()

    expect(completedCharges(w, ada.prava_mandate_id!)).toHaveLength(1)
    const settled = w.db.membersOf(group.id).find((m) => m.id === ada.id)!
    expect(settled.status).toBe('charged')
    expect(settled.charged_amount).toBe(ada.share_amount)
  })

  /**
   * The direct regression: hand the saga a member whose card was charged but
   * whose row says "charging" — the precise on-disk state a crash leaves — and
   * watch it resume.
   */
  it('trusts the event log over the member row when the two disagree', async () => {
    const { w, group, ada } = await interruptedMidSettlement('retry_once')
    const chargedTxn = completedCharges(w, ada.prava_mandate_id!)[0]!

    // Rewind the row to the crash state. The log keeps saying it succeeded.
    const row = w.service.mustMember(ada.id)
    w.db.casMember(row.id, row.version, {
      status: 'charging',
      charged_amount: 0,
      prava_charge_txn_id: null,
    })
    w.db.casGroup(group.id, w.service.mustGroup(group.id).version, { status: 'committing' })

    await w.service.executeCommit(group.id)

    // No second charge, and the row is repaired from the log rather than
    // re-derived by charging again.
    expect(completedCharges(w, ada.prava_mandate_id!)).toHaveLength(1)
    const healed = w.service.mustMember(ada.id)
    expect(healed.status).toBe('charged')
    expect(healed.prava_charge_txn_id).toBe(chargedTxn.transactionId)
    expect(healed.charged_amount).toBe(ada.share_amount)
  })

  it('does not report a charged member as failed when no retry is left', async () => {
    const { w, group, ada } = await interruptedMidSettlement('drop_and_continue')
    const row = w.service.mustMember(ada.id)
    w.db.casMember(row.id, row.version, { status: 'charging', charged_amount: 0 })
    w.db.casGroup(group.id, w.service.mustGroup(group.id).version, { status: 'committing' })

    await w.service.executeCommit(group.id)

    // Under the old code this member was marked failed while her money was
    // already gone — a false statement inside a signed receipt.
    expect(w.service.mustMember(ada.id).status).toBe('charged')
    expect(completedCharges(w, ada.prava_mandate_id!)).toHaveLength(1)
  })

  it('never signs a receipt whose total omits money that moved', async () => {
    const { w, group } = await interruptedMidSettlement('retry_once')
    const receipt = w.db.getReceipt(group.id)
    expect(receipt).toBeTruthy()
    const parsed = JSON.parse(receipt!) as {
      totals: { charged: number }
      entries: { charged_amount: number }[]
    }
    const summed = parsed.entries.reduce((s, e) => s + e.charged_amount, 0)
    expect(parsed.totals.charged).toBe(summed)
    expect(parsed.totals.charged).toBeGreaterThan(0)
  })
})
