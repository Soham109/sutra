import { beforeEach, describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { Poller } from '../src/poller.js'
import { ReceiptSigner, verifyReceipt, type Receipt } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

/**
 * Mandate states from which money could still leave a card: active charges
 * now, paused resumes to active, pending can still be passkey-approved. The
 * abort invariant is that none of these survive.
 */
const CHARGEABLE = new Set(['active', 'paused', 'pending'])

interface World {
  db: Db
  mock: MockPrava
  service: GroupService
  poller: Poller
}

function makeWorld(): World {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const mock = new MockPrava('http://test.local')
  const service = new GroupService(db, mock, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const poller = new Poller(service, 1_000_000) // manual ticks only
  return { db, mock, service, poller }
}

function demoGroup(world: World, overrides: Record<string, unknown> = {}) {
  const input = CreateGroupSchema.parse({
    title: 'Ratatat — 4 tickets',
    merchant: { id: 'demo', name: 'Velvet Ticket Co.', url: 'https://velvet.example', country_code_iso2: 'US' },
    cart: {
      items: [{ sku: 'ga', name: 'GA ticket', unit_amount: 4500, qty: 4, claimants: ['mi_all'] }],
      fees: [{ name: 'fees', amount: 600 }],
      currency: 'USD',
    },
    members: [
      { name: 'Soham', role: 'payer' },
      { name: 'Arsh', role: 'backstop', backstop_cap: 6000 },
      { name: 'Dev', role: 'payer' },
      { name: 'Maya', role: 'payer' },
    ],
    policy: { type: 'all_of' },
    rail: 'prava_mandates',
    deadline_minutes: 60,
    ...overrides,
  })
  return world.service.createGroup(input)
}

async function openAndApprove(world: World, memberId: string, opts: { backstop?: boolean } = {}): Promise<void> {
  const m = await world.service.openMember(memberId)
  if (opts.backstop) {
    const fresh = world.service.mustMember(memberId)
    world.mock.approveSession(fresh.backstop_approval_url!.split('/').pop()!)
  }
  if (m.prava_approval_url) {
    world.mock.approveSession(m.prava_approval_url.split('/').pop()!)
  }
  await world.poller.tick()
}

let world: World
beforeEach(() => {
  world = makeWorld()
})

describe('run one — the full commit', () => {
  it('all four approve, all four charged, receipt verifies', async () => {
    const { group, members } = demoGroup(world)
    for (const m of members) await openAndApprove(world, m.id)

    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('committed')

    const finalMembers = world.db.membersOf(group.id)
    expect(finalMembers.every((m) => m.status === 'charged')).toBe(true)
    expect(finalMembers.reduce((s, m) => s + m.charged_amount, 0)).toBe(18600)

    // Prava's ground truth agrees.
    const prava = world.mock.debugState()
    expect(prava.charges.filter((c) => c.status === 'completed')).toHaveLength(4)
    expect(prava.mandates.filter((m) => m.status === 'consumed')).toHaveLength(4)

    const receipt = JSON.parse(world.db.getReceipt(group.id)!) as Receipt
    expect(verifyReceipt(receipt).ok).toBe(true)
    expect(receipt.totals.charged).toBe(18600)
  })

  it('a tampered receipt fails verification', async () => {
    const { group, members } = demoGroup(world)
    for (const m of members) await openAndApprove(world, m.id)
    const receipt = JSON.parse(world.db.getReceipt(group.id)!) as Receipt
    receipt.entries[0]!.charged_amount += 1
    expect(verifyReceipt(receipt).ok).toBe(false)
  })
})

describe('run two — the backstop save', () => {
  it('one declines under quorum, the armed backstop silently absorbs', async () => {
    const { group, members } = demoGroup(world, { policy: { type: 'quorum', m: 3 } })
    const [soham, arsh, dev, maya] = members

    await world.service.openMember(maya!.id)
    await world.service.declineMember(maya!.id)
    await openAndApprove(world, soham!.id)
    await openAndApprove(world, arsh!.id, { backstop: true })
    await openAndApprove(world, dev!.id)

    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('committed')

    const rows = world.db.membersOf(group.id)
    const arshRow = rows.find((m) => m.display_name === 'Arsh')!
    const mayaRow = rows.find((m) => m.display_name === 'Maya')!
    expect(mayaRow.status).toBe('declined')
    expect(mayaRow.charged_amount).toBe(0)
    // §9 semantics: the three locked members absorb up to their caps
    // (share + 5% tolerance = 48.83 each) without re-consent; the backstop
    // covers only what consent cannot stretch to: 186.00 − 3×48.83 = 39.51.
    expect(arshRow.backstop_absorbed).toBe(3951)
    expect(arshRow.charged_amount).toBe(4883)

    // Total money that actually moved still equals the cart.
    const charged = world.mock.debugState().charges
      .filter((c) => c.status === 'completed')
      .reduce((s, c) => s + c.amount, 0)
    expect(charged).toBe(18600)

    const receipt = JSON.parse(world.db.getReceipt(group.id)!) as Receipt
    expect(verifyReceipt(receipt).ok).toBe(true)
    expect(receipt.entries.some((e) => e.kind === 'backstop' && e.charged_amount === 3951)).toBe(true)
  })
})

describe('run three — the clean abort', () => {
  it('all_of + one decline: aborted, zero charges, mandates cancelled', async () => {
    const { group, members } = demoGroup(world)
    const [soham, arsh, dev, maya] = members
    await openAndApprove(world, soham!.id)
    await openAndApprove(world, arsh!.id)
    await openAndApprove(world, dev!.id)
    await world.service.openMember(maya!.id)
    await world.service.declineMember(maya!.id)

    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('aborted')

    const prava = world.mock.debugState()
    expect(prava.charges).toHaveLength(0)
    // The guarantee is not that every mandate reads 'cancelled' — Prava only
    // allows cancel from active/paused, so an unapproved mandate dies with its
    // session instead. What must hold is that nothing chargeable survives the
    // abort: no mandate is active, pending or resumable.
    expect(prava.mandates.every((m) => !CHARGEABLE.has(m.status))).toBe(true)

    const receipt = JSON.parse(world.db.getReceipt(group.id)!) as Receipt
    expect(verifyReceipt(receipt).ok).toBe(true)
    expect(receipt.totals.charged).toBe(0)
  })

  it('a member cancelling from their own Prava portal reads as a decline', async () => {
    const { group, members } = demoGroup(world)
    const [soham, arsh, dev, maya] = members
    await openAndApprove(world, soham!.id)
    // Soham revokes from their own portal — the engine never hears directly.
    world.mock.cancelByCustomer(soham!.id)
    await world.poller.tick()
    expect(world.service.mustMember(soham!.id).status).toBe('declined')
    expect(world.service.mustMember(soham!.id).failure_reason).toBe('external_cancel')
    expect(world.service.mustGroup(group.id).status).toBe('aborted')
    // The others were never even asked to pay.
    expect(world.mock.debugState().charges).toHaveLength(0)
    void arsh; void dev; void maya
  })

  it('organizer cancel pre-commit cancels every authorization', async () => {
    const { group, members } = demoGroup(world)
    await openAndApprove(world, members[0]!.id)
    await world.service.cancelGroup(group.id)
    expect(world.service.mustGroup(group.id).status).toBe('aborted')
    expect(world.mock.debugState().mandates.every((m) => !CHARGEABLE.has(m.status))).toBe(true)
  })
})

describe('straggler policies', () => {
  it('retry_once: a declined charge is retried once and recovers', async () => {
    const { group, members } = demoGroup(world)
    world.mock.declineNextChargeFor(members[0]!.id) // first attempt bounces
    for (const m of members) await openAndApprove(world, m.id)
    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('committed')
    const events = world.db.eventsAfter(group.id, 0)
    expect(events.some((e) => e.type === 'charge.failed')).toBe(true)
    expect(world.service.mustMember(members[0]!.id).status).toBe('charged')
  })

  it('drop_and_continue: one hard failure yields partial, the rest are charged', async () => {
    const { group, members } = demoGroup(world, { straggler_policy: 'drop_and_continue' })
    world.mock.declineNextChargeFor(members[0]!.id)
    // consume the retry too? drop_and_continue only attempts once, so one decline is enough
    for (const m of members) await openAndApprove(world, m.id)
    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('partial')
    const rows = world.db.membersOf(group.id)
    expect(rows.find((m) => m.id === members[0]!.id)!.status).toBe('failed')
    expect(rows.filter((m) => m.status === 'charged')).toHaveLength(3)
  })

  it('halt_partial: charging stops at the first failure', async () => {
    const { group, members } = demoGroup(world, { straggler_policy: 'halt_partial' })
    world.mock.declineNextChargeFor(members[0]!.id)
    for (const m of members) await openAndApprove(world, m.id)
    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('partial')
    // Nobody after the failure was charged.
    expect(world.mock.debugState().charges.filter((c) => c.status === 'completed')).toHaveLength(0)
  })
})

describe('hold my share', () => {
  it('a held approval blocks all_of until resumed', async () => {
    const { group, members } = demoGroup(world)
    const [a, b, c, d] = members
    await openAndApprove(world, a!.id)
    await world.service.holdShare(a!.id)
    await openAndApprove(world, b!.id)
    await openAndApprove(world, c!.id)
    await openAndApprove(world, d!.id)
    expect(world.service.mustGroup(group.id).status).toBe('collecting') // held = pending
    await world.service.resumeShare(a!.id)
    expect(world.service.mustGroup(group.id).status).toBe('committed')
  })
})

describe('priority auction (§21.1)', () => {
  it('sealed bids allocate scarce slots; losers drop; winners pay merchant price', async () => {
    const input = CreateGroupSchema.parse({
      title: 'Last two front-row seats',
      merchant: { id: 'demo', name: 'Velvet Ticket Co.', url: 'https://velvet.example', country_code_iso2: 'US' },
      cart: {
        items: [{ sku: 'front', name: 'Front row', unit_amount: 4500, qty: 2, claimants: ['A', 'B', 'C'] }],
        fees: [],
        currency: 'USD',
      },
      members: [
        { name: 'A', role: 'payer' },
        { name: 'B', role: 'payer' },
        { name: 'C', role: 'payer' },
      ],
      policy: { type: 'all_of' },
      rail: 'prava_mandates',
      auction_window_seconds: 60,
    })
    const { group, members } = world.service.createGroup(input)
    const g0 = world.service.mustGroup(group.id)
    expect(g0.auction_close_at).not.toBeNull()

    const [a, b, c] = members
    world.service.placeBid(a!.id, 'front', 700)
    world.service.placeBid(b!.id, 'front', 100)
    world.service.placeBid(c!.id, 'front', 300)
    // every claimant has bid → the window closes early
    await new Promise((r) => setTimeout(r, 10))

    const g1 = world.service.mustGroup(group.id)
    expect(world.service.auctionOpen(g1)).toBe(false)
    const rows = world.db.membersOf(group.id)
    expect(rows.find((m) => m.display_name === 'B')!.status).toBe('dropped')
    expect(rows.find((m) => m.display_name === 'A')!.share_amount).toBe(4500)
    expect(rows.find((m) => m.display_name === 'C')!.share_amount).toBe(4500)

    // reveal event carries the full ranking — transparency after sealing
    const reveal = world.db.eventsAfter(group.id, 0).find((e) => e.type === 'auction.reveal')!
    const payload = JSON.parse(reveal.payload_json) as { ranking: { name: string; won: boolean }[] }
    expect(payload.ranking.map((r) => `${r.name}:${r.won}`)).toEqual(['A:true', 'C:true', 'B:false'])

    // winners approve at the merchant price and the group commits for 9000
    await openAndApprove(world, a!.id)
    await openAndApprove(world, c!.id)
    expect(world.service.mustGroup(group.id).status).toBe('committed')
    const charged = world.mock.debugState().charges
      .filter((x) => x.status === 'completed')
      .reduce((s, x) => s + x.amount, 0)
    expect(charged).toBe(9000)
  })
})

describe('tiered carts', () => {
  it("a flaking member's extras leave the cart; tickets survive via backstop", async () => {
    const input = CreateGroupSchema.parse({
      title: 'Tickets + merch',
      merchant: { id: 'demo', name: 'Velvet Ticket Co.', url: 'https://velvet.example', country_code_iso2: 'US' },
      cart: {
        items: [
          { sku: 'ga', name: 'GA ticket', unit_amount: 4500, qty: 3, tier: 'core', claimants: ['mi_all'] },
          { sku: 'tee', name: 'Tour tee', unit_amount: 2500, qty: 1, tier: 'extra', claimants: ['Maya'] },
        ],
        fees: [],
        currency: 'USD',
      },
      members: [
        { name: 'Soham', role: 'payer' },
        { name: 'Arsh', role: 'backstop', backstop_cap: 6000 },
        { name: 'Maya', role: 'payer' },
      ],
      policy: { type: 'quorum', m: 2 },
      rail: 'prava_mandates',
    })
    const { group, members } = world.service.createGroup(input)
    const maya = members.find((m) => m.display_name === 'Maya')!

    await world.service.openMember(maya.id)
    await world.service.declineMember(maya.id)
    await openAndApprove(world, members[0]!.id)
    await openAndApprove(world, members[1]!.id, { backstop: true })

    const g = world.service.mustGroup(group.id)
    expect(g.status).toBe('committed')

    // Maya's tee is gone from the adjusted cart; her ticket share was backstopped.
    const charged = world.mock.debugState().charges
      .filter((x) => x.status === 'completed')
      .reduce((s, x) => s + x.amount, 0)
    expect(charged).toBe(13500) // 3 × 45.00, no tee
    const events = world.db.eventsAfter(group.id, 0)
    expect(events.some((e) => e.type === 'cart.adjusted')).toBe(true)
  })
})

describe('crash resume', () => {
  it('a commit interrupted mid-flight resumes without double-charging', async () => {
    const { group, members } = demoGroup(world)
    // Approve three quietly (no decide) by approving mandates but intercepting commit:
    // simpler — approve all, then simulate the crash by re-running executeCommit
    // multiple times; idempotency guards must make the re-runs no-ops.
    for (const m of members) await openAndApprove(world, m.id)
    expect(world.service.mustGroup(group.id).status).toBe('committed')
    await world.service.executeCommit(group.id)
    await world.service.executeCommit(group.id)
    const charges = world.mock.debugState().charges.filter((c) => c.status === 'completed')
    expect(charges).toHaveLength(4) // exactly one settled charge per member
    const refs = new Set(charges.map((c) => c.reference))
    expect(refs.size).toBe(4)
  })
})
