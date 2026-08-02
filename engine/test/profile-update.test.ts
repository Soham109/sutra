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

// The demo account seeded as "test" had no way to become anything else:
// POST /v1/me (handle-only sign-in) only ever creates or logs into a handle,
// never renames an existing one. These pin the fix — Social.updateProfile and
// POST /v1/me/profile — both directly and through the real HTTP route, with
// particular attention to the one rule that must never bend: a user may only
// ever edit their own profile.

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  installPlanSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const service = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
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
  return { app, social }
}

function cookieFor(social: Social, userId: string): string {
  return `sutra_session=${social.createSession(userId).token}`
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

describe('Social.updateProfile', () => {
  it('changes the display name and handle', () => {
    const { social } = world()
    const u = social.createUser({ handle: 'test', name: 'test' })
    const updated = social.updateProfile(u.id, { name: 'Soham Aggarwal', handle: 'soham' })
    expect(updated.name).toBe('Soham Aggarwal')
    expect(updated.handle).toBe('soham')
    // Persisted, not just returned — a fresh read agrees.
    expect(social.byId(u.id)).toMatchObject({ name: 'Soham Aggarwal', handle: 'soham' })
  })

  it('leaves the field untouched when it is not part of the input', () => {
    const { social } = world()
    const u = social.createUser({ handle: 'kept', name: 'Kept Name' })
    const updated = social.updateProfile(u.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
    expect(updated.handle).toBe('kept')
  })

  it('refuses a handle somebody else already holds', () => {
    const { social } = world()
    const a = social.createUser({ handle: 'alice', name: 'Alice' })
    social.createUser({ handle: 'bob', name: 'Bob' })
    expect(() => social.updateProfile(a.id, { handle: 'bob' })).toThrow(/already taken/)
    expect(social.byId(a.id)?.handle).toBe('alice')
  })

  it('renaming to your own current handle is a no-op, not a conflict', () => {
    const { social } = world()
    const a = social.createUser({ handle: 'alice', name: 'Alice' })
    expect(() => social.updateProfile(a.id, { handle: 'alice', name: 'Alice II' })).not.toThrow()
    expect(social.byId(a.id)).toMatchObject({ handle: 'alice', name: 'Alice II' })
  })

  it('rejects an empty display name', () => {
    const { social } = world()
    const a = social.createUser({ handle: 'alice', name: 'Alice' })
    expect(() => social.updateProfile(a.id, { name: '   ' })).toThrow(/cannot be empty/)
    expect(social.byId(a.id)?.name).toBe('Alice')
  })
})

describe('POST /v1/me/profile — the real HTTP route', () => {
  it('renames the caller and the change is reflected on /v1/me', async () => {
    const w = world()
    app = w.app
    const user = w.social.createUser({ handle: 'test', name: 'test' })
    const cookie = cookieFor(w.social, user.id)

    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { name: 'Real Name', handle: 'realname' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { user: { name: string; handle: string } }
    expect(body.user.name).toBe('Real Name')
    expect(body.user.handle).toBe('realname')

    const me = await w.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })
    expect((me.json() as { user: { name: string } }).user.name).toBe('Real Name')
  })

  it('validates the display name the same way registration does — 1..60 chars', async () => {
    const w = world()
    app = w.app
    const user = w.social.createUser({ handle: 'test', name: 'test' })
    const cookie = cookieFor(w.social, user.id)

    const tooLong = await w.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { name: 'x'.repeat(61) },
    })
    expect(tooLong.statusCode).toBe(400)

    const empty = await w.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      payload: { name: '' },
    })
    expect(empty.statusCode).toBe(400)

    // Neither invalid attempt touched the row.
    expect(w.social.byId(user.id)?.name).toBe('test')
  })

  it('refuses a signed-out caller', async () => {
    const w = world()
    app = w.app
    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      payload: { name: 'Nobody' },
    })
    expect(res.statusCode).toBe(401)
  })

  /**
   * The rule that matters most: nothing about this route lets caller A edit
   * caller B's profile. The handler never reads an id out of the request —
   * it always resolves `me` from the session — so even a payload that TRIES
   * to name another account only ever acts on the signed-in caller's own row.
   */
  it('cannot be steered onto someone else’s profile, even by naming their id in the body', async () => {
    const w = world()
    app = w.app
    const alice = w.social.createUser({ handle: 'alice', name: 'Alice' })
    const bob = w.social.createUser({ handle: 'bob', name: 'Bob' })
    const cookie = cookieFor(w.social, alice.id)

    const res = await w.app.inject({
      method: 'POST',
      url: '/v1/me/profile',
      headers: { cookie },
      // `id` is not a field this route's schema accepts — it is silently
      // stripped, not honoured.
      payload: { id: bob.id, name: 'Hijacked' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { user: { id: string; name: string } }
    // The edit landed on the caller (Alice), never on Bob.
    expect(body.user.id).toBe(alice.id)
    expect(body.user.name).toBe('Hijacked')
    expect(w.social.byId(bob.id)?.name).toBe('Bob')
  })

  it('there is no route that takes a target id to edit another profile', async () => {
    const w = world()
    app = w.app
    const alice = w.social.createUser({ handle: 'alice', name: 'Alice' })
    const bob = w.social.createUser({ handle: 'bob', name: 'Bob' })
    const cookie = cookieFor(w.social, alice.id)

    // The only plausible shapes such a route could take — neither exists.
    const attempts = [
      { method: 'POST' as const, url: `/v1/people/${bob.id}/profile` },
      { method: 'POST' as const, url: `/v1/me/profile/${bob.id}` },
    ]
    for (const a of attempts) {
      const res = await w.app.inject({ ...a, headers: { cookie }, payload: { name: 'Hijacked' } })
      expect(res.statusCode).toBe(404)
    }
    expect(w.social.byId(bob.id)?.name).toBe('Bob')
  })
})
