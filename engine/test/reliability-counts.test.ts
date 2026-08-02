import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

// Social.reliability() (engine/src/social.ts) used to count only
// `member.approved` events — the card-mandate act (service.ts's
// memberApproved). But the equivalent act on every non-card rail is
// acceptShare(), which deliberately emits a DIFFERENT event, `member.
// accepted` — so an account that has honoured five at_venue/shopify_pos/
// checkout_handoff agreements showed 0% approved, right next to its
// declines. The fix counts both events for this one figure, on the theory
// that "did this person honour a commitment" is the same question on every
// rail — while everything else (receipts, exposure bucketing, charged
// amounts) keeps `approved` and `accepted`/`settled` as distinct states.

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const prava = new MockPrava('http://test.local')
  const service = new GroupService(db, prava, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const social = new Social(db)
  return { db, service, social, prava }
}

async function cardApproval(w: ReturnType<typeof world>, userId: string) {
  const { members } = w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Tickets',
      merchant: { id: 'v', name: 'Velvet', url: 'https://velvet.example.com' },
      cart: { items: [{ sku: 'ga', name: 'GA', unit_amount: 4500, qty: 1 }], currency: 'USD' },
      members: [{ name: 'Solo' }],
      policy: { type: 'all_of' },
      rail: 'prava_mandates',
    }),
  )
  w.db.sql.prepare(`UPDATE members SET user_id = ? WHERE id = ?`).run(userId, members[0]!.id)
  const opened = await w.service.openMember(members[0]!.id)
  return { groupId: opened.group_id, memberId: opened.id }
}

describe('Social.reliability — counting non-card commitments', () => {
  it('a bare at_venue accept counts toward approvals, the same as a card approval', async () => {
    const w = world()
    const user = w.social.createUser({ handle: 'reliable', name: 'Reliable' })

    // Five at_venue/checkout_handoff/shopify_pos agreements, all honoured via
    // acceptShare — never a mandate in sight.
    for (const rail of ['at_venue', 'checkout_handoff', 'shopify_pos', 'at_venue', 'checkout_handoff'] as const) {
      const merchantUrl = rail === 'at_venue' ? 'https://venue.local.test' : 'https://shop.example.com'
      const { members } = w.service.createGroup(
        CreateGroupSchema.parse({
          title: `Group on ${rail}`,
          merchant: { id: 'm', name: 'Merchant', url: merchantUrl },
          cart: { items: [{ sku: 'x', name: 'Thing', unit_amount: 5000, qty: 1 }], currency: 'USD' },
          members: [{ name: 'Solo' }],
          policy: { type: 'all_of' },
          rail,
        }),
      )
      w.db.sql.prepare(`UPDATE members SET user_id = ? WHERE id = ?`).run(user.id, members[0]!.id)
      await w.service.openMember(members[0]!.id)
      await w.service.acceptShare(members[0]!.id)
    }

    // Two declines, next to the five honoured commitments.
    for (let i = 0; i < 2; i++) {
      const { members } = w.service.createGroup(
        CreateGroupSchema.parse({
          title: 'Declined group',
          merchant: { id: 'm', name: 'Merchant', url: 'https://venue.local.test' },
          cart: { items: [{ sku: 'x', name: 'Thing', unit_amount: 5000, qty: 1 }], currency: 'USD' },
          members: [{ name: 'Solo' }],
          policy: { type: 'all_of' },
          rail: 'at_venue',
        }),
      )
      w.db.sql.prepare(`UPDATE members SET user_id = ? WHERE id = ?`).run(user.id, members[0]!.id)
      await w.service.openMember(members[0]!.id)
      await w.service.declineMember(members[0]!.id)
    }

    const r = w.social.reliability(user.id)
    expect(r.approvals).toBe(5)
    expect(r.declines).toBe(2)
    expect(r.approval_rate).toBeCloseTo(5 / 7)
    // Never charged anything on any of these — reliability's count of
    // commitments honoured must not be confused with money moved.
    expect(r.charged_total_minor).toBe(0)
  })

  it('a card mandate approval still counts too, unchanged', async () => {
    const w = world()
    const user = w.social.createUser({ handle: 'card', name: 'Card' })
    const { memberId } = await cardApproval(w, user.id)
    const opened = w.service.mustMember(memberId)
    const mandateId = w.prava.getSession(opened.prava_session_id!)!.mandateId
    w.prava.approveSession(opened.prava_session_id!)
    await w.service.memberApproved(memberId, mandateId)

    const r = w.social.reliability(user.id)
    expect(r.approvals).toBe(1)
    expect(r.declines).toBe(0)
  })

  it('does not double count — a member who only ever reaches `accepted` is counted once, not twice', async () => {
    const w = world()
    const user = w.social.createUser({ handle: 'once', name: 'Once' })
    // Two payers, all_of: 'Other' never answers, so the group stays
    // 'collecting' after 'Me' accepts — otherwise a single-member all_of
    // group commits immediately and a second acceptShare call 400s on "no
    // longer collecting" before it can even reach the no-op check this test
    // is pinning.
    const { members } = w.service.createGroup(
      CreateGroupSchema.parse({
        title: 'Once',
        merchant: { id: 'm', name: 'Merchant', url: 'https://venue.local.test' },
        cart: { items: [{ sku: 'x', name: 'Thing', unit_amount: 5000, qty: 1 }], currency: 'USD' },
        members: [{ name: 'Me' }, { name: 'Other' }],
        policy: { type: 'all_of' },
        rail: 'at_venue',
      }),
    )
    w.db.sql.prepare(`UPDATE members SET user_id = ? WHERE id = ?`).run(user.id, members[0]!.id)
    await w.service.openMember(members[0]!.id)
    await w.service.acceptShare(members[0]!.id)
    // Calling accept again once already 'approved' is a documented no-op in
    // service.ts (acceptShare returns early) — it must not re-fire the event
    // and inflate the count.
    await w.service.acceptShare(members[0]!.id)

    expect(w.social.reliability(user.id).approvals).toBe(1)
  })
})
