import { afterEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { Poller } from '../src/poller.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { Catalog } from '../src/catalog/index.js'
import { PlanStore, installPlanSchema } from '../src/plan/store.js'
import { registerRoutes } from '../src/routes.js'
import { registerProductRoutes } from '../src/routes-v2.js'
import { installMalformedJsonGuard } from '../src/server.js'

// A live audit posted malformed JSON to POST /v1/auth/register three times,
// live and locally, and got a bare 500 "internal error" every time. Root
// cause: routes.ts swaps in a JSON parser that tolerates the empty bodies
// action endpoints like /open and /decline send, but on genuinely malformed
// JSON it hands the shared error handler a plain SyntaxError with no
// `statusCode` — which the handler only classifies as 4xx when a statusCode
// is already present, so it fell through to 500. PowerShell 5.1's default
// quoting mangles JSON on the way out, so any judge exercising the REST API
// from a Windows terminal hits this immediately.
//
// The fix (installMalformedJsonGuard, engine/src/server.ts) re-registers the
// content-type parser after registerRoutes so a parse failure now carries
// statusCode 400. It is wired centrally in server.ts, not per-route, so
// these tests exercise it against a routes-v2.ts route (the one actually
// reported) AND a routes.ts route (/v1/groups), to pin that the fix covers
// the whole app rather than one handler.

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
  const poller = new Poller(service, 1_000_000) // manual ticks only — nothing here needs it to fire

  const app = Fastify()
  registerRoutes(app, service, poller, {
    apiToken: 'test-token',
    appBaseUrl: 'http://test.local',
  })
  // The fix under test: production wires this in server.ts right after
  // registerRoutes, for exactly this reason.
  installMalformedJsonGuard(app)
  registerProductRoutes(app, service, social, catalog, planStore)
  return app
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

describe('malformed JSON is a 400, not a 500', () => {
  it('POST /v1/auth/register with truncated JSON gets a 400 naming the actual parse problem', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": "a@b.com", "password":',
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload) as { error: string }
    expect(body.error).toMatch(/malformed json body/i)
    expect(body.error.toLowerCase()).not.toContain('internal error')
  })

  it('POST /v1/auth/login with a body that is not JSON at all also 400s', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: 'definitely not json {{{',
    })
    expect(res.statusCode).toBe(400)
    expect((JSON.parse(res.payload) as { error: string }).error).toMatch(/malformed json body/i)
  })

  it('the fix is central: a routes.ts route (POST /v1/groups) gets the same 400, not just routes-v2.ts', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      payload: '{"title": "broken',
    })
    expect(res.statusCode).toBe(400)
    expect((JSON.parse(res.payload) as { error: string }).error).toMatch(/malformed json body/i)
  })
})

describe('adjacent input-validation failures stay a sane 4xx, never a 500', () => {
  it('an empty body on a JSON route still fails schema validation with a 400', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '',
    })
    expect(res.statusCode).toBe(400)
  })

  it('an unsupported content-type is rejected with a 4xx, not a 500', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/xml' },
      payload: '<register/>',
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
  })

  it('a body over the size limit is rejected with a 4xx, not a 500', async () => {
    app = world()
    await app.ready()
    const oversized = JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(2 * 1024 * 1024), handle: 'x', name: 'x' })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: oversized,
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.statusCode).toBeLessThan(500)
  })

  it('valid JSON of the wrong shape is a clean 400 with validation details, not a 500', async () => {
    app = world()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ unrelated: 'shape' }),
    })
    expect(res.statusCode).toBe(400)
    expect((JSON.parse(res.payload) as { error: string }).error).toBe('validation failed')
  })
})
