import { describe, expect, it, afterEach } from 'vitest'
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

// Who may agree to owe money.
//
// On the at_venue rail, accepting a share is a person saying "yes, that is my
// number" — and the output is a signed, hash-chained receipt recording exactly
// that. So a consent nobody gave is not a small bug: it is a tamper-evident
// document asserting something false, which is the one thing this codebase is
// built to make impossible.
//
// The route used to take a member id and nothing else. A member id is a bearer
// capability on purpose — you get a personal link, you need no account — but
// GET /v1/groups/:id hands every member's id to anyone who can read the board,
// so knowing one proves nothing about who you are. Anyone with the group link
// could record somebody else's agreement.
//
// The line drawn here: a seat backed by an ACCOUNT may only be accepted by that
// account. A seat with nobody behind it stays link-only, because that is the
// pass-the-phone design and tightening it would delete the product's commonest
// case rather than protect it.

const TOKEN = 'test-operator-token'

function world() {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const service = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const app = Fastify()
  registerRoutes(app, service, new Poller(service), {
    apiToken: TOKEN,
    appBaseUrl: 'http://test.local',
    social: {
      userFor: (req) => {
        const m = /probe_user=([^;]+)/.exec(String(req.headers['cookie'] ?? ''))
        return m?.[1] ? { id: m[1] } : undefined
      },
    },
  })
  return { db, service, app }
}

/** A bill split: at_venue rail, one seat linked to an account, one not. */
function bill(w: ReturnType<typeof world>) {
  return w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Toit — the bill',
      merchant: { id: 'bill', name: 'Toit', url: 'https://venue.local.test' },
      cart: {
        items: [{ sku: 'b0', name: 'Dinner', unit_amount: 80000, qty: 1, claimants: ['mi_all'] }],
        fees: [],
        currency: 'INR',
      },
      members: [
        { name: 'Ada', user_id: 'us_ada' },
        { name: 'Whoever was at the table' },
      ],
      policy: { type: 'all_of' },
      rail: 'at_venue',
      origin: 'bill',
    }),
  )
}

let app: FastifyInstance | null = null
afterEach(async () => {
  await app?.close()
  app = null
})

const accept = (a: FastifyInstance, memberId: string, cookie?: string) =>
  a.inject({
    method: 'POST',
    url: `/v1/members/${memberId}/accept`,
    headers: cookie ? { cookie } : {},
    payload: {},
  })

describe('agreeing to a share you own', () => {
  it('refuses a stranger holding the board link', async () => {
    const w = world()
    app = w.app
    const ada = bill(w).members.find((m) => m.display_name === 'Ada')!
    await w.service.openMember(ada.id)

    const res = await accept(w.app, ada.id)
    expect(res.statusCode).toBe(403)
    // And it really did not happen.
    expect(w.service.mustMember(ada.id).status).not.toBe('settled')
  })

  it('refuses a different signed-in account', async () => {
    const w = world()
    app = w.app
    const ada = bill(w).members.find((m) => m.display_name === 'Ada')!
    await w.service.openMember(ada.id)

    const res = await accept(w.app, ada.id, 'probe_user=us_someone_else')
    expect(res.statusCode).toBe(403)
    expect(w.service.mustMember(ada.id).status).not.toBe('settled')
  })

  it('lets the person whose seat it is agree', async () => {
    const w = world()
    app = w.app
    const ada = bill(w).members.find((m) => m.display_name === 'Ada')!
    await w.service.openMember(ada.id)

    const res = await accept(w.app, ada.id, 'probe_user=us_ada')
    expect(res.statusCode).toBe(200)
    // Her own seat is agreed. The GROUP only settles once everybody has, which
    // is the all_of policy doing its job, not this route failing.
    expect(w.service.mustMember(ada.id).status).toBe('approved')
  })

  /**
   * The case that must NOT be tightened. Somebody at the table with no account
   * has only their link, and that link has to keep working — otherwise the
   * bill splitter stops working for the situation it exists for.
   */
  it('still lets a link-only seat agree with nothing but the link', async () => {
    const w = world()
    app = w.app
    const guest = bill(w).members.find((m) => m.display_name !== 'Ada')!
    await w.service.openMember(guest.id)

    const res = await accept(w.app, guest.id)
    expect(res.statusCode).toBe(200)
    expect(w.service.mustMember(guest.id).status).toBe('approved')
  })

  it('lets the operator token through, for server-to-server callers', async () => {
    const w = world()
    app = w.app
    const ada = bill(w).members.find((m) => m.display_name === 'Ada')!
    await w.service.openMember(ada.id)

    const res = await w.app.inject({
      method: 'POST',
      url: `/v1/members/${ada.id}/accept`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
  })
})
