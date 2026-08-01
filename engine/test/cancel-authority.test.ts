import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { Poller } from '../src/poller.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { registerRoutes } from '../src/routes.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

// Who is allowed to call the whole thing off.
//
// This route used to trust the URL and nothing else. A security probe cancelled
// a real group on production with no cookie and no token — every member
// dropped — and the event log recorded it as "organizer cancelled", which was
// untrue: the caller was anonymous. Group links are shown on a screen at a
// table and encoded in a QR anyone can photograph, so holding one cannot mean
// being allowed to destroy it.
//
// The opposite failure matters just as much. A group made from the bookmarklet
// has no account behind it, so an ownership check alone would leave nobody at
// all able to cancel it. These tests pin both edges.

const TOKEN = 'test-operator-token'

function makeApp(opts: { owner?: string } = {}) {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const service = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const app = Fastify()
  registerRoutes(app, service, new Poller(service), {
    apiToken: TOKEN,
    appBaseUrl: 'http://test.local',
    // Stand in for the session layer: one known cookie means one known user.
    social: {
      userFor: (req) => {
        const raw = String(req.headers['cookie'] ?? '')
        const m = /probe_user=([^;]+)/.exec(raw)
        return m?.[1] ? { id: m[1] } : undefined
      },
    },
  })
  const { group, members } = service.createGroup(
    CreateGroupSchema.parse({
      title: 'Two tickets',
      merchant: { id: 'v', name: 'Velvet', url: 'https://velvet.example.com' },
      cart: {
        items: [{ sku: 'ga', name: 'GA', unit_amount: 5000, qty: 2, claimants: ['mi_all'] }],
        fees: [],
        currency: 'USD',
      },
      members: [{ name: 'Ada' }, { name: 'Bo' }],
      policy: { type: 'all_of' },
      ...(opts.owner ? { created_by: opts.owner } : {}),
    }),
  )

  return { app, service, group, members }
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

const cancel = (a: FastifyInstance, id: string, opts: { headers?: Record<string, string>; payload?: unknown } = {}) =>
  a.inject({
    method: 'POST',
    url: `/v1/groups/${id}/cancel`,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    payload: (opts.payload ?? {}) as object,
  })

describe('a group with an account behind it', () => {
  let world: ReturnType<typeof makeApp>
  beforeEach(() => {
    world = makeApp({ owner: 'u_owner' })
    app = world.app
  })

  it('refuses a stranger holding nothing but the link', async () => {
    const res = await cancel(world.app, world.group.id)
    expect(res.statusCode).toBe(403)
    // And it really did not happen — the 403 is not cosmetic.
    expect(world.service.mustGroup(world.group.id).status).not.toBe('aborted')
  })

  it('refuses a different signed-in account', async () => {
    const res = await cancel(world.app, world.group.id, { headers: { cookie: 'probe_user=u_someone_else' } })
    expect(res.statusCode).toBe(403)
    expect(world.service.mustGroup(world.group.id).status).not.toBe('aborted')
  })

  it('refuses a member of the group who did not start it', async () => {
    const bo = world.members[1]!
    const res = await cancel(world.app, world.group.id, { payload: { as_member: bo.id } })
    expect(res.statusCode).toBe(403)
  })

  it('lets the organiser through', async () => {
    const res = await cancel(world.app, world.group.id, { headers: { cookie: 'probe_user=u_owner' } })
    expect(res.statusCode).toBe(200)
    expect(world.service.mustGroup(world.group.id).status).toBe('aborted')
  })

  it('lets the operator token through, for server-to-server callers', async () => {
    const res = await cancel(world.app, world.group.id, { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(res.statusCode).toBe(200)
  })
})

describe('a group made from the widget, with no account behind it', () => {
  let world: ReturnType<typeof makeApp>
  beforeEach(() => {
    world = makeApp()
    app = world.app
  })

  it('still refuses a stranger holding only the group link', async () => {
    const res = await cancel(world.app, world.group.id)
    expect(res.statusCode).toBe(403)
  })

  it('lets whoever set it up cancel it, proven by their own member link', async () => {
    const ada = world.members[0]!
    const res = await cancel(world.app, world.group.id, { payload: { as_member: ada.id } })
    expect(res.statusCode).toBe(200)
    expect(world.service.mustGroup(world.group.id).status).toBe('aborted')
  })

  it('does not accept a member link from some other group', async () => {
    const other = makeApp()
    const res = await cancel(world.app, world.group.id, { payload: { as_member: other.members[0]!.id } })
    expect(res.statusCode).toBe(403)
    await other.app.close()
  })
})
