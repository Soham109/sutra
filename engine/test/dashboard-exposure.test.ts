import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService, UserError } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { Catalog } from '../src/catalog/index.js'
import { PlanStore, installPlanSchema } from '../src/plan/store.js'
import { registerProductRoutes } from '../src/routes-v2.js'
import { CreateGroupSchema } from '../src/types.js'
import type { Rail } from '../src/rails.js'

process.env.GMP_NO_FX = '1'

// The exposure meter's headline band ("Could still be charged — the merchant
// can take it, up to your cap, without asking again") is only true on
// prava_mandates. engine/src/routes-v2.ts's /v1/my/dashboard used to bucket
// ANY `member.approved` status into that band regardless of rail — and
// acceptShare() (service.ts) also lands a non-card-rail member on status
// 'approved', so an at_venue/shopify_pos/checkout_handoff agreement read as
// live card exposure on the very first screen a judge sees. These pin that
// bucketing now follows capabilityOf(rail).charges, never the status alone.

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  installPlanSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const prava = new MockPrava('http://test.local')
  const service = new GroupService(db, prava, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const social = new Social(db)
  const catalog = new Catalog({ shopifyDomains: [] })
  const planStore = new PlanStore(db)

  const app = Fastify()
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UserError) return reply.status(err.statusCode).send({ error: err.message })
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation failed', details: err.issues })
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message })
    return reply.status(500).send({ error: 'internal error' })
  })
  registerProductRoutes(app, service, social, catalog, planStore)
  return { app, social, service, prava, db }
}

function cookieFor(social: Social, userId: string): string {
  return `sutra_session=${social.createSession(userId).token}`
}

/**
 * A two-payer group on `rail` where "me" (userId) accepts/approves their own
 * share and the other payer never answers — so the all_of policy stays
 * unsatisfied and the group is left in `collecting` with "me" parked on
 * `approved`. That is the exact pre-commit state the dashboard has to bucket
 * correctly.
 */
async function pendingApproval(
  w: ReturnType<typeof world>,
  rail: Rail,
  userId: string,
  amount: number,
): Promise<{ shareAmount: number; capAmount: number }> {
  const merchantUrl = rail === 'at_venue' ? 'https://venue.local.test' : 'https://shop.example.com'
  const { members } = w.service.createGroup(
    CreateGroupSchema.parse({
      title: `Test group — ${rail}`,
      merchant: { id: 'm', name: 'Merchant', url: merchantUrl },
      cart: { items: [{ sku: 'x', name: 'Thing', unit_amount: amount * 2, qty: 1 }], currency: 'USD' },
      members: [{ name: 'Me' }, { name: 'Other' }],
      policy: { type: 'all_of' },
      rail,
    }),
  )
  w.db.sql.prepare(`UPDATE members SET user_id = ? WHERE id = ?`).run(userId, members[0]!.id)
  const me = members[0]!

  if (rail === 'prava_mandates') {
    const opened = await w.service.openMember(me.id)
    const session = w.prava.getSession(opened.prava_session_id!)!
    w.prava.approveSession(opened.prava_session_id!)
    await w.service.memberApproved(me.id, session.mandateId)
  } else {
    await w.service.openMember(me.id)
    await w.service.acceptShare(me.id)
  }

  const fresh = w.service.mustMember(me.id)
  expect(fresh.status).toBe('approved') // still pending the OTHER payer — group stays collecting
  expect(w.service.mustGroup(fresh.group_id).status).toBe('collecting')
  return { shareAmount: fresh.share_amount, capAmount: fresh.cap_amount }
}

interface ExposureRow {
  currency: string
  authorized: number
  charging: number
  settled: number
  backstop_armed: number
  owed_at_venue: number
  agreed_not_charged: number
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

describe('GET /v1/my/dashboard — exposure is bucketed by rail capability, not status', () => {
  it('a card-mandate approval is real card exposure', async () => {
    const w = world()
    app = w.app
    const me = w.social.createUser({ handle: 'me', name: 'Me' })
    const { capAmount } = await pendingApproval(w, 'prava_mandates', me.id, 5000)

    const res = await w.app.inject({
      method: 'GET',
      url: '/v1/my/dashboard',
      headers: { cookie: cookieFor(w.social, me.id) },
    })
    expect(res.statusCode).toBe(200)
    const exposure = (res.json() as { exposure: ExposureRow[] }).exposure.find((e) => e.currency === 'USD')!
    expect(exposure.authorized).toBe(capAmount)
    expect(exposure.agreed_not_charged).toBe(0)
    expect(exposure.owed_at_venue).toBe(0)
  })

  it.each([
    ['checkout_handoff', 'agreed_not_charged'],
    ['shopify_pos', 'agreed_not_charged'],
    ['at_venue', 'owed_at_venue'],
  ] as const)(
    'an accepted %s share NEVER appears as card exposure — it lands in %s instead',
    async (rail, band) => {
      const w = world()
      app = w.app
      const me = w.social.createUser({ handle: 'me', name: 'Me' })
      const { shareAmount } = await pendingApproval(w, rail, me.id, 4200)

      const res = await w.app.inject({
        method: 'GET',
        url: '/v1/my/dashboard',
        headers: { cookie: cookieFor(w.social, me.id) },
      })
      expect(res.statusCode).toBe(200)
      const exposure = (res.json() as { exposure: ExposureRow[] }).exposure.find((e) => e.currency === 'USD')!
      // The honesty invariant: an approval on a non-charging rail is never
      // once counted as "could still be charged".
      expect(exposure.authorized).toBe(0)
      expect(exposure[band]).toBe(shareAmount)
    },
  )

  it('one currency, three rails, one user: only the card rail lands in "authorized"', async () => {
    const w = world()
    app = w.app
    const me = w.social.createUser({ handle: 'me', name: 'Me' })
    const card = await pendingApproval(w, 'prava_mandates', me.id, 1000)
    const checkout = await pendingApproval(w, 'checkout_handoff', me.id, 2000)
    const venue = await pendingApproval(w, 'at_venue', me.id, 3000)

    const res = await w.app.inject({
      method: 'GET',
      url: '/v1/my/dashboard',
      headers: { cookie: cookieFor(w.social, me.id) },
    })
    const exposure = (res.json() as { exposure: ExposureRow[] }).exposure.find((e) => e.currency === 'USD')!
    expect(exposure.authorized).toBe(card.capAmount)
    expect(exposure.agreed_not_charged).toBe(checkout.shareAmount)
    expect(exposure.owed_at_venue).toBe(venue.shareAmount)
    // The old bug: authorized would have been card + checkout + venue summed
    // together. It must be exactly the card figure, nothing more.
    expect(exposure.authorized).not.toBe(card.capAmount + checkout.shareAmount + venue.shareAmount)
  })
})
