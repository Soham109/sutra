import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { Catalog } from '../src/catalog/index.js'
import { PlanStore, installPlanSchema } from '../src/plan/store.js'
import { registerProductRoutes } from '../src/routes-v2.js'
import { registerRateLimiting } from '../src/rate-limit.js'

// A live probe fired 20 back-to-back POST /v1/auth/login attempts in 16
// seconds and got 20 clean 401s — no 429, no backoff, no @fastify/rate-limit
// anywhere in engine/package.json. These tests hit the REAL /v1/auth/login
// route (not a stand-in) to pin that the same script now gets cut off.
//
// The constraint that matters just as much: the demo runs off one
// conference-wifi router, several phones and a laptop deep, plus an SSE
// stream per person and a poller. A limiter that cannot tell those devices
// apart would lock the whole table out of its own product — a failure mode
// worse than the vulnerability it closes. rate-limit.ts keys on IP+User-Agent
// for exactly this reason; the second block below pins that a shared IP does
// NOT mean a shared bucket.

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
    const status = (err as { statusCode?: number }).statusCode ?? 500
    return reply.status(status).send({ error: (err as Error).message })
  })
  return { app, service, social, catalog, planStore }
}

async function ready(w: ReturnType<typeof world>) {
  await registerRateLimiting(w.app)
  registerProductRoutes(w.app, w.service, w.social, w.catalog, w.planStore)
  // A stand-in for /health — that route is wired in server.ts's main(),
  // which these tests deliberately do not boot (no DB file, no listen()).
  // Exercising the SAME allowList predicate through a route defined here
  // still pins the real logic in rate-limit.ts, just not server.ts's wiring
  // of the literal path.
  w.app.get('/health', async () => ({ ok: true }))
  w.app.get('/stream-test', async () => ({ ok: true }))
  await w.app.ready()
  return w.app
}

const login = (app: FastifyInstance, opts: { ip?: string; ua?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    remoteAddress: opts.ip ?? '203.0.113.10',
    headers: { 'content-type': 'application/json', 'user-agent': opts.ua ?? 'test-agent/1' },
    payload: { email: 'nobody@example.com', password: 'wrong-password' },
  })

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

describe('brute-forcing the real login route', () => {
  it('cuts off repeated failed attempts from one device with 429, where it used to be 401 forever', async () => {
    const w = world()
    app = await ready(w)

    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const res = await login(app, { ip: '198.51.100.1', ua: 'attacker-script/1' })
      statuses.push(res.statusCode)
    }

    // Every one of these was a WRONG password (401) before the max was hit —
    // the route's own logic never changes. What changes is that a 429
    // appears at all, cutting the guessable range short.
    expect(statuses).toContain(401)
    expect(statuses).toContain(429)
    // And it holds the line rather than degrading into more 401s once
    // tripped — the live probe's 20-in-16s pattern would die here, not
    // finish clean.
    const first429 = statuses.indexOf(429)
    expect(statuses.slice(first429).every((s) => s === 429)).toBe(true)
  })

  it('does not lock out a real login just because a wrong password preceded it', async () => {
    const w = world()
    app = await ready(w)
    await w.social.registerUser({ email: 'real@example.com', password: 'correct horse battery', handle: 'real', name: 'Real' })

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '198.51.100.2',
      headers: { 'content-type': 'application/json', 'user-agent': 'phone/1' },
      payload: { email: 'real@example.com', password: 'nope' },
    })
    expect(wrong.statusCode).toBe(401)

    const right = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: '198.51.100.2',
      headers: { 'content-type': 'application/json', 'user-agent': 'phone/1' },
      payload: { email: 'real@example.com', password: 'correct horse battery' },
    })
    expect(right.statusCode).toBe(200)
  })
})

describe('one conference-wifi NAT IP, several devices', () => {
  it('one phone hitting the login ceiling does not block the phone next to it', async () => {
    const w = world()
    app = await ready(w)
    const SHARED_IP = '203.0.113.55' // the whole table, behind one router

    // Device A exhausts its own bucket.
    let lastA = 200
    for (let i = 0; i < 12; i++) {
      lastA = (await login(app, { ip: SHARED_IP, ua: 'iphone-safari/A' })).statusCode
    }
    expect(lastA).toBe(429)

    // Device B, same IP, different browser — untouched.
    const b = await login(app, { ip: SHARED_IP, ua: 'android-chrome/B' })
    expect(b.statusCode).toBe(401) // wrong password, NOT rate limited
  })
})

describe('everything else stays generous — the demo must not trip it by existing', () => {
  it('the global default absorbs realistic polling load from one device untouched', async () => {
    const w = world()
    app = await ready(w)
    // Five people watching one plan poll roughly every 5-6s — on the order of
    // a dozen requests/minute each. 60 rapid requests from ONE device, well
    // above that, should still all clear the 300/minute global ceiling.
    const results = await Promise.all(
      Array.from({ length: 60 }, () =>
        app!.inject({
          method: 'GET',
          url: '/v1/people',
          remoteAddress: '203.0.113.77',
          headers: { 'user-agent': 'demo-laptop/1' },
        }),
      ),
    )
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
  })

  it('never gates health or an SSE-flavoured request, no matter how many came before', async () => {
    const w = world()
    app = await ready(w)
    const SHARED_IP = '203.0.113.99'
    for (let i = 0; i < 12; i++) await login(app, { ip: SHARED_IP, ua: 'flood/1' })

    const health = await app.inject({ method: 'GET', url: '/health', remoteAddress: SHARED_IP, headers: { 'user-agent': 'flood/1' } })
    expect(health.statusCode).toBe(200)

    const stream = await app.inject({
      method: 'GET',
      url: '/stream-test',
      remoteAddress: SHARED_IP,
      headers: { 'user-agent': 'flood/1', accept: 'text/event-stream' },
    })
    expect(stream.statusCode).toBe(200)
  })
})
