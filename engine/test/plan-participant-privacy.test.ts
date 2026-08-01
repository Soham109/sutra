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
import { registerPlanRoutes } from '../src/routes-plan.js'
import { currentUserFrom } from '../src/routes-v2.js'

// A live audit reproduced this with zero auth: read another participant's id
// straight out of GET /v1/plans/:id, POST a forged `budget` signal of 999999
// AS them to /v1/participants/:id/signal (no ownership check by design — the
// whole product is a link that needs no account), then GET it back. The
// route's own comment called a budget ceiling something that "stays between
// the member and the ranker"; the plan view broadcast the very id that made
// that promise false for anyone holding the plan link, not just the
// participant it belonged to.
//
// The fix is NOT "require login" — that breaks the pass-the-phone flow the
// product is built around (see /v1/groups/:id/joinable, which deliberately
// hands out member_id for the same reason). The fix is that planView() (and
// the ranked board, and the SSE timeline) must stop broadcasting
// participant_id to anyone who is not the plan's organiser or holding it via
// their own link. These tests pin that redaction against the real routes,
// not a description of them.

const TOKEN = 'test-engine-token'

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  installPlanSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const groups = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const social = new Social(db)
  const catalog = new Catalog({ shopifyDomains: [] })
  const places = new Places()
  const store = new PlanStore(db)
  const plans = new PlanService({ store, groups, places, catalog, social })

  const app = Fastify()
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500
    return reply.status(status).send({ error: (err as Error).message })
  })
  registerPlanRoutes(app, {
    plans,
    store,
    groups,
    places,
    social,
    currentUser: (req) => currentUserFrom(social, req),
    apiToken: TOKEN,
  })
  return { app, plans, store, social }
}

const dinnerPlan = (w: ReturnType<typeof world>, organiserId?: string) =>
  w.plans.createPlan(
    {
      intent_text: 'dinner friday with the crew',
      kind: 'venue',
      slots: {},
      ask: ['rsvp', 'budget'],
      participants: [{ name: 'Priyanka', role: 'guest' }, { name: 'Arsh', role: 'guest' }],
      deadline_minutes: 60,
    },
    organiserId,
  ).plan

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

describe('reading a plan with nothing but the link', () => {
  it('the audit\'s exact vantage point: no cookie, no token, every id redacted', async () => {
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'maya', name: 'Maya' })
    const plan = dinnerPlan(w, organiser.id)

    const res = await w.app.inject({ method: 'GET', url: `/v1/plans/${plan.id}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { participants: { participant_id: string | null; user_id: string | null; name: string }[] }

    expect(body.participants.every((p) => p.participant_id === null)).toBe(true)
    expect(body.participants.every((p) => p.user_id === null)).toBe(true)
    // Redacted, not deleted: the board still has to be readable — names,
    // rsvp state and so on stay, only the credential-shaped id is gone.
    // (Maya, the organiser, is her own participant seat too — see createPlan.)
    expect(body.participants.map((p) => p.name).sort()).toEqual(['Arsh', 'Maya', 'Priyanka'])
  })

  it('the same redaction covers plan creation with no account behind it at all', async () => {
    // Plans do not require login to create (the composer flow works signed
    // out); an anonymous plan still must not spray ids to a later stranger.
    const w = world()
    app = w.app
    const plan = dinnerPlan(w)

    const res = await w.app.inject({ method: 'GET', url: `/v1/plans/${plan.id}` })
    const body = res.json() as { participants: { participant_id: string | null }[] }
    expect(body.participants.every((p) => p.participant_id === null)).toBe(true)
  })

  it("does not regress the organiser's own copy-link flow", async () => {
    // The other failure mode: redact so hard the organiser can no longer
    // distribute the links they just created. Their own session, matched
    // against the plan's created_by, is what earns the full board back.
    const w = world()
    app = w.app
    const organiser = w.social.createUser({ handle: 'maya2', name: 'Maya' })
    const session = w.social.createSession(organiser.id)
    const plan = dinnerPlan(w, organiser.id)

    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/plans/${plan.id}`,
      headers: { cookie: `sutra_session=${session.token}` },
    })
    const body = res.json() as { participants: { participant_id: string | null }[] }
    expect(body.participants.every((p) => p.participant_id !== null)).toBe(true)
  })

  it('lets the engine bearer token through, for server-to-server callers', async () => {
    // Mirrors /v1/groups/:id/cancel's existing holdsToken carve-out — a
    // script running with the real operator secret is not "everyone".
    const w = world()
    app = w.app
    const plan = dinnerPlan(w)

    const res = await w.app.inject({
      method: 'GET',
      url: `/v1/plans/${plan.id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    const body = res.json() as { participants: { participant_id: string | null }[] }
    expect(body.participants.every((p) => p.participant_id !== null)).toBe(true)
  })
})

describe("a participant's own bearer link", () => {
  it("shows their own seat and nobody else's — even though the endpoint takes no other proof", async () => {
    const w = world()
    app = w.app
    const plan = dinnerPlan(w)
    const seats = w.store.participants(plan.id)
    const priyanka = seats.find((s) => s.display_name === 'Priyanka')!
    const arsh = seats.find((s) => s.display_name === 'Arsh')!

    const res = await w.app.inject({ method: 'GET', url: `/v1/participants/${priyanka.id}` })
    const body = res.json() as {
      participant_id: string
      plan: { participants: { participant_id: string | null; name: string }[] }
    }

    // Her own link is allowed to tell her who she is — that id got her here.
    expect(body.participant_id).toBe(priyanka.id)
    const rows = body.plan.participants
    expect(rows.find((r) => r.name === 'Priyanka')?.participant_id).toBe(priyanka.id)
    expect(rows.find((r) => r.name === 'Arsh')?.participant_id).toBeNull()
    // Arsh's real id — known here only because the fixture built the plan
    // directly — must not appear ANYWHERE in Priyanka's response.
    expect(JSON.stringify(body)).not.toContain(arsh.id)
  })

  it('submitting a signal echoes the same redaction, not a full board', async () => {
    // POST .../signal is the other half of the audited chain: it must keep
    // working with no ownership check (that IS the bearer-link design), but
    // its response must not become a second way to learn everyone else's id.
    const w = world()
    app = w.app
    const plan = dinnerPlan(w)
    const seats = w.store.participants(plan.id)
    const priyanka = seats.find((s) => s.display_name === 'Priyanka')!
    const arsh = seats.find((s) => s.display_name === 'Arsh')!

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/participants/${priyanka.id}/signal`,
      payload: { kind: 'rsvp', in: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { participants: { participant_id: string | null; name: string }[] }
    expect(body.participants.find((p) => p.name === 'Priyanka')?.participant_id).toBe(priyanka.id)
    expect(body.participants.find((p) => p.name === 'Arsh')?.participant_id).toBeNull()
    expect(JSON.stringify(body)).not.toContain(arsh.id)
  })
})

describe('the ranked board — a second copy of the same leak, same fix', () => {
  it('redacts participant ids from the per-option fit table for an outsider', async () => {
    // GET /v1/plans/:id/options is a completely different route from
    // planView(), but rank.ts's per_participant carries the exact same
    // participant_id. Fixing planView() alone would have left this open —
    // an attacker would just read ids from the board instead of the plan.
    const w = world()
    app = w.app
    const plan = dinnerPlan(w)
    w.store.insertOption({
      id: 'po_test_venue',
      plan_id: plan.id,
      source: 'manual',
      title: 'Test Trattoria',
      subtitle: null,
      place_json: null,
      when_json: null,
      price_json: null,
      url: null,
      image_url: null,
      raw_json: '{}',
    })

    const res = await w.app.inject({ method: 'GET', url: `/v1/plans/${plan.id}/options` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      options: { score: { per_participant: { participant_id: string | null; name: string }[] } }[]
    }
    expect(body.options).toHaveLength(1)
    const rows = body.options[0]!.score.per_participant
    // Redacted, not dropped: the fit table (free/travel/budget) is still
    // useful to read, just without a usable id attached to each row.
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.participant_id === null)).toBe(true)
    expect(rows.map((r) => r.name).sort()).toEqual(['Arsh', 'Priyanka'])
  })
})
