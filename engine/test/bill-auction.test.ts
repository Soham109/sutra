import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

// A shared plate is not a scarce ticket.
//
// Contested items exist for scarcity: four people want three tickets, a sealed
// bid decides who gets one, the losers drop out. A bill line has exactly the
// same SHAPE — qty 1, two claimants — and inferring an auction from it was
// found live on production doing this:
//
//   two friends share a ₹380 paneer → auction opens → nobody bids, because the
//   bill splitter has no bidding UI → the tie breaks by array order → one
//   friend is awarded the whole plate, the other is DROPPED from the group, and
//   the first is re-billed for the entire cheque after having already accepted
//   half of it.
//
// These tests pin the rule that prevents it.

function world() {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const prava = new MockPrava('http://test.local')
  const service = new GroupService(db, prava, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  return { db, service }
}

/** Exactly the shape /v1/bill/split produces: shared lines, qty 1, two people. */
function sharedBill(w: ReturnType<typeof world>) {
  return w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Toit — the bill',
      merchant: { id: 'bill', name: 'Toit', url: 'https://venue.local.test' },
      cart: {
        items: [
          { sku: 'bill-0', name: 'Paneer Tikka', unit_amount: 38000, qty: 1, claimants: ['Alice', 'Bob'] },
          { sku: 'bill-1', name: 'Margherita', unit_amount: 76000, qty: 1, claimants: ['Alice', 'Bob'] },
        ],
        fees: [],
        currency: 'INR',
      },
      members: [{ name: 'Alice' }, { name: 'Bob' }],
      policy: { type: 'all_of' },
      tolerance_bps: 0,
      rail: 'at_venue',
      origin: 'bill',
    }),
  )
}

describe('a shared bill line never becomes an auction', () => {
  it('does not mark shared lines contested, and opens no bid window', () => {
    const w = world()
    const { group } = sharedBill(w)
    const cart = JSON.parse(w.service.mustGroup(group.id).cart_json) as {
      items: { contested: boolean }[]
    }
    expect(cart.items.every((i) => i.contested === false)).toBe(true)
    expect(w.service.mustGroup(group.id).auction_close_at).toBeNull()
    expect(w.db.countEvents(group.id, 'auction.opened', null)).toBe(0)
  })

  it('both people keep their seat and split the cheque evenly', async () => {
    const w = world()
    const { group, members } = sharedBill(w)
    for (const m of members) {
      await w.service.openMember(m.id)
      await w.service.acceptShare(m.id)
    }

    const final = w.db.membersOf(group.id)
    // Nobody dropped. This was the live failure: Bob vanished.
    expect(final.map((m) => m.status).sort()).toEqual(['settled', 'settled'])
    expect(final.every((m) => m.share_amount === 57000)).toBe(true)
    expect(final.reduce((s, m) => s + m.share_amount, 0)).toBe(114000)
    expect(w.service.mustGroup(group.id).status).toBe('committed')
  })

  it('an accepted share is never silently re-quoted out from under someone', async () => {
    const w = world()
    const { group, members } = sharedBill(w)
    const alice = members.find((m) => m.display_name === 'Alice')!
    await w.service.openMember(alice.id)
    await w.service.acceptShare(alice.id)
    const agreed = w.service.mustMember(alice.id).share_amount

    const bob = members.find((m) => m.display_name === 'Bob')!
    await w.service.openMember(bob.id)
    await w.service.acceptShare(bob.id)

    // Alice agreed to half. She must still owe half, not the whole cheque.
    expect(w.service.mustMember(alice.id).share_amount).toBe(agreed)
    expect(w.service.mustMember(alice.id).requote_round).toBe(0)
    void group
  })
})

describe('scarcity still works where scarcity is real', () => {
  it('four people and three tickets on the card rail still opens a bid window', () => {
    const w = world()
    const { group } = w.service.createGroup(
      CreateGroupSchema.parse({
        title: 'Ratatat — 3 tickets',
        merchant: { id: 'v', name: 'Velvet', url: 'https://velvet.example.com' },
        cart: {
          items: [
            { sku: 'ga', name: 'GA ticket', unit_amount: 4500, qty: 3, claimants: ['A', 'B', 'C', 'D'] },
          ],
          fees: [],
          currency: 'USD',
        },
        members: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
        policy: { type: 'quorum', m: 3 },
        rail: 'prava_mandates',
      }),
    )
    expect(w.service.mustGroup(group.id).auction_close_at).not.toBeNull()
    expect(w.db.countEvents(group.id, 'auction.opened', null)).toBe(1)
  })
})
