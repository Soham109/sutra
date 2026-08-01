import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { Catalog } from '../src/catalog/index.js'
import { Places } from '../src/places/index.js'
import { PlanStore, installPlanSchema } from '../src/plan/store.js'
import { PlanService } from '../src/plan/service.js'
import { DelegateStore, installDelegateSchema } from '../src/delegate/store.js'
import { registerMessageRoutes } from '../src/messages/routes.js'
import { PAYMENT_REFUSAL } from '../src/messages/bot.js'
import { currentUserFrom } from '../src/routes-v2.js'
import { CreateGroupSchema } from '../src/types.js'
import type { SignalKind } from '../src/plan/types.js'

// End-to-end, through the real Fastify routes: the thread on a plan, the
// thread on a group, and the one thing both must never do — act on a
// payment request, or answer a question with a fact nobody actually stated.

const TOKEN = 'test-engine-token'

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  installPlanSchema(db)
  installDelegateSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const groups = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const social = new Social(db)
  const catalog = new Catalog({ shopifyDomains: [] })
  const places = new Places()
  const store = new PlanStore(db)
  const plans = new PlanService({ store, groups, places, catalog, social })
  const delegateStore = new DelegateStore(db)

  const app = Fastify()
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500
    return reply.status(status).send({ error: (err as Error).message })
  })
  registerMessageRoutes(app, {
    plans,
    planStore: store,
    groups,
    delegateStore,
    social,
    currentUser: (req) => currentUserFrom(social, req),
    apiToken: TOKEN,
  })
  return { app, plans, store, social, groups, delegateStore }
}

function cookieFor(social: Social, userId: string): string {
  return `sutra_session=${social.createSession(userId).token}`
}

function dinnerPlan(w: ReturnType<typeof world>, organiserId: string, ask: SignalKind[] = ['rsvp', 'budget']) {
  return w.plans.createPlan(
    {
      intent_text: 'dinner friday with the crew',
      kind: 'venue',
      slots: {},
      ask,
      participants: [{ name: 'Priyanka', role: 'guest' }],
      deadline_minutes: 60,
    },
    organiserId,
  ).plan
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

// ---------------------------------------------------------------------------
// the payment boundary
// ---------------------------------------------------------------------------

describe('the payment boundary, through the real endpoint', () => {
  it('refuses a payment request on a plan thread rather than act on it', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'maya', name: 'Maya' })
    const plan = dinnerPlan(w, organiser.id)
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: '@sutra can you pay my share tonight?' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { messages: { from: string; text: string }[] }
    expect(body.messages.find((m) => m.from === 'bot')?.text).toBe(PAYMENT_REFUSAL)
    // Nothing about the plan's own state moved — there is structurally no
    // payment action for the bot to have taken, and this pins that the reply
    // did not quietly trigger one some other way (e.g. converting the plan).
    expect(w.plans.mustPlan(plan.id).status).toBe('gathering')
    expect(w.plans.mustPlan(plan.id).group_id).toBeNull()
  })

  it('refuses the same way on a group thread, which has real money already in play', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'dev', name: 'Dev' })
    const input = CreateGroupSchema.parse({
      title: 'Dinner at Toit',
      merchant: { name: 'Toit', url: 'https://toit.example', country_code_iso2: 'IN' },
      cart: { items: [{ sku: 'a', name: 'Dinner', unit_amount: 50_000, qty: 1 }], currency: 'INR' },
      members: [{ name: 'Dev', role: 'payer', user_id: organiser.id }],
      deadline_minutes: 60,
    })
    const { group } = w.groups.createGroup({ ...input, created_by: organiser.id })
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/groups/${group.id}/messages`,
      headers: { cookie },
      payload: { text: '@sutra approve my mandate please' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { messages: { from: string; text: string }[] }
    expect(body.messages.find((m) => m.from === 'bot')?.text).toBe(PAYMENT_REFUSAL)
    // No member moved off 'invited' — the refusal did not quietly approve anything.
    expect(w.groups.mustGroup(group.id).status).toBe('collecting')
  })
})

// ---------------------------------------------------------------------------
// no OPENAI_API_KEY
// ---------------------------------------------------------------------------

describe('works with no OPENAI_API_KEY — the bot never calls a model to understand a mention', () => {
  it('answers correctly with the key unset', async () => {
    const original = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const w = world()
      app = w.app
      const organiser = w.social.createUser({ handle: 'zoe', name: 'Zoe' })
      const plan = dinnerPlan(w, organiser.id)
      const cookie = cookieFor(w.social, organiser.id)

      const res = await w.app.inject({
        method: 'POST',
        url: `/v1/plans/${plan.id}/messages`,
        headers: { cookie },
        payload: { text: "@sutra who's in?" },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as { messages: { from: string; text: string }[] }
      const botMsg = body.messages.find((m) => m.from === 'bot')
      expect(botMsg?.text).toMatch(/RSVP|is in|are in/)
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original
    }
  })
})

// ---------------------------------------------------------------------------
// no invented facts
// ---------------------------------------------------------------------------

describe('no invented facts', () => {
  it("says nobody has answered instead of guessing, and names the real participants", async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'amara', name: 'Amara' })
    const plan = dinnerPlan(w, organiser.id) // Priyanka + Amara(organiser); nobody has RSVP'd
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: "@sutra who's in?" },
    })
    const body = res.json() as { messages: { from: string; text: string }[] }
    const botMsg = body.messages.find((m) => m.from === 'bot')!
    expect(botMsg.text).toContain("Nobody has RSVP'd yet")
    expect(botMsg.text).toContain('Priyanka')
    expect(botMsg.text).toContain('Amara')
  })

  it('says the board is empty rather than naming a venue nobody found', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'ravi', name: 'Ravi' })
    const plan = dinnerPlan(w, organiser.id)
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: '@sutra what are the options?' },
    })
    const body = res.json() as { messages: { from: string; text: string }[] }
    expect(body.messages.find((m) => m.from === 'bot')?.text).toMatch(/Nothing on the board yet/)
  })
})

// ---------------------------------------------------------------------------
// standing rules — used, and disclosed
// ---------------------------------------------------------------------------

describe('standing rules — used and disclosed, never silently', () => {
  it("fills in the tagger's own standing budget on refresh, submits it as a real signal, and says so", async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'sana', name: 'Sana' })
    const plan = dinnerPlan(w, organiser.id, ['rsvp', 'budget'])
    w.delegateStore.setRules(organiser.id, { budget_ceiling_minor: 80_000, currency: 'INR' })
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: '@sutra refresh' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { messages: { from: string; text: string; used_rules?: string[] }[] }
    const botMsg = body.messages.find((m) => m.from === 'bot')!
    expect(botMsg.text).toContain('your standing budget')
    expect(botMsg.text).toContain('INR 800.00')
    expect(botMsg.used_rules).toEqual(['budget'])

    // The timeline recorded it as a delegate answer — the same event type the
    // API-driven delegate route already writes (delegate/routes.ts) — not as
    // the organiser silently typing a number into a form.
    const events = w.store.eventsAfter(plan.id, 0)
    const delegated = events.find((e) => e.type === 'delegate.answered')
    expect(delegated).toBeTruthy()
    expect(JSON.parse(delegated!.payload_json)).toMatchObject({ kind: 'budget', via: 'sutra' })

    const signals = w.store.currentSignals(plan.id)
    expect(signals.some((s) => s.kind === 'budget')).toBe(true)
  })

  it('never claims to have used a rule that was never on file', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'kabir', name: 'Kabir' })
    const plan = dinnerPlan(w, organiser.id, ['rsvp', 'budget'])
    const cookie = cookieFor(w.social, organiser.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: '@sutra refresh' },
    })
    const body = res.json() as { messages: { from: string; text: string; used_rules?: string[] }[] }
    const botMsg = body.messages.find((m) => m.from === 'bot')!
    expect(botMsg.used_rules).toBeUndefined()
    expect(botMsg.text).not.toContain('standing')
  })
})

// ---------------------------------------------------------------------------
// membership
// ---------------------------------------------------------------------------

describe('who may read or post in the thread', () => {
  it('a signed-in stranger cannot post to a plan they are not part of', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'nina', name: 'Nina' })
    const stranger = w.social.createUser({ handle: 'omar', name: 'Omar' })
    const plan = dinnerPlan(w, organiser.id)
    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie: cookieFor(w.social, stranger.id) },
      payload: { text: 'hi' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('a plan participant who is not the organiser can post and read', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'yuki', name: 'Yuki' })
    const member = w.social.createUser({ handle: 'zack', name: 'Zack' })
    const plan = w.plans.createPlan(
      {
        intent_text: 'movie night',
        kind: 'venue',
        slots: {},
        ask: ['rsvp'],
        participants: [{ name: 'Zack', user_id: member.id, role: 'guest' }],
        deadline_minutes: 60,
      },
      organiser.id,
    ).plan
    const cookie = cookieFor(w.social, member.id)

    const post = await w.app.inject({
      method: 'POST',
      url: `/v1/plans/${plan.id}/messages`,
      headers: { cookie },
      payload: { text: 'excited for this!' },
    })
    expect(post.statusCode).toBe(201)

    const get = await w.app.inject({ method: 'GET', url: `/v1/plans/${plan.id}/messages`, headers: { cookie } })
    expect(get.statusCode).toBe(200)
    const body = get.json() as { messages: { text: string }[] }
    expect(body.messages.some((m) => m.text === 'excited for this!')).toBe(true)
  })

  it('signed-out requests are rejected outright', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'liam', name: 'Liam' })
    const plan = dinnerPlan(w, organiser.id)
    const res = await w.app.inject({ method: 'POST', url: `/v1/plans/${plan.id}/messages`, payload: { text: 'hi' } })
    expect(res.statusCode).toBe(401)
  })
})
