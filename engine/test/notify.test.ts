import { beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import { Db } from '../src/db.js'
import { Social, installSocialSchema } from '../src/social.js'
import { UserError } from '../src/service.js'
import { Notifier } from '../src/notify/index.js'
import { registerNotifyRoutes } from '../src/notify/routes.js'
import {
  encryptPayload,
  generateVapidKeys,
  pushStatus,
  sendPush,
  vapidConfig,
} from '../src/notify/push.js'
import type { PushResult, PushSubscriptionInfo, PushTransport } from '../src/notify/push.js'

// No network anywhere in this file. The default transport cannot reach one
// either: with no VAPID keys configured it refuses before it would fetch.

function clearVapid(): void {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.VAPID_SUBJECT
}

beforeEach(clearVapid)

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123def456',
  keys: {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
}

/** Records every send and answers with whatever the test asked for. */
function fakeTransport(reply: PushResult | ((s: PushSubscriptionInfo) => PushResult)): PushTransport & {
  sent: { sub: PushSubscriptionInfo; payload: unknown }[]
} {
  const sent: { sub: PushSubscriptionInfo; payload: unknown }[] = []
  return {
    sent,
    status: () => ({ push_available: true, public_key: 'test-public-key' }),
    send: async (sub, payload) => {
      sent.push({ sub, payload })
      return typeof reply === 'function' ? reply(sub) : reply
    },
  }
}

describe('RFC 8291 aes128gcm', () => {
  /**
   * The published example from RFC 8291 §5. Pinned because this is the one
   * piece of the stack whose failure is invisible: a subtly wrong key
   * derivation still produces a well-formed body that every phone drops.
   */
  it('reproduces the RFC 8291 §5 example byte for byte', () => {
    const body = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon', 'utf8'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
        serverPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
      },
    )
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLoc' +
        'InmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLV' +
        'WGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('emits the aes128gcm header the browser needs to decrypt', () => {
    const body = encryptPayload(Buffer.from('hi'), SUB.keys)
    expect(body.readUInt32BE(16)).toBe(4096) // record size
    expect(body.readUInt8(20)).toBe(65) // key id length
    expect(body.readUInt8(21)).toBe(0x04) // uncompressed point
    // header + ephemeral key + 'hi' + delimiter + GCM tag
    expect(body.length).toBe(21 + 65 + 2 + 1 + 16)
  })

  it('is non-deterministic across calls — fresh salt and ephemeral key', () => {
    const a = encryptPayload(Buffer.from('hi'), SUB.keys)
    const b = encryptPayload(Buffer.from('hi'), SUB.keys)
    expect(a.equals(b)).toBe(false)
  })

  it('rejects malformed subscription keys rather than sending garbage', () => {
    expect(() => encryptPayload(Buffer.from('hi'), { ...SUB.keys, p256dh: 'AAAA' })).toThrow(
      /65-byte/,
    )
    expect(() => encryptPayload(Buffer.from('hi'), { ...SUB.keys, auth: 'AAAA' })).toThrow(
      /16 bytes/,
    )
  })

  it('refuses a payload that will not fit one record', () => {
    expect(() => encryptPayload(Buffer.alloc(4080), SUB.keys)).toThrow(/too large/)
  })
})

describe('VAPID configuration', () => {
  it('reports unavailable, with a reason, when no keys are set', () => {
    const st = pushStatus()
    expect(st.push_available).toBe(false)
    expect(st.reason).toMatch(/VAPID_PUBLIC_KEY/)
    expect(st.public_key).toBeUndefined()
  })

  it('accepts a generated pair and publishes the public key', () => {
    const keys = generateVapidKeys()
    expect(Buffer.from(keys.publicKey, 'base64url').length).toBe(65)
    expect(Buffer.from(keys.privateKey, 'base64url').length).toBe(32)

    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    process.env.VAPID_SUBJECT = 'mailto:ops@sutra.local'
    const st = pushStatus()
    expect(st.push_available).toBe(true)
    expect(st.public_key).toBe(keys.publicKey)
  })

  it('catches a mismatched pair at config time, not on the first real push', () => {
    process.env.VAPID_PUBLIC_KEY = generateVapidKeys().publicKey
    process.env.VAPID_PRIVATE_KEY = generateVapidKeys().privateKey
    const v = vapidConfig()
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.reason).toMatch(/not a pair/)
  })

  it('rejects a subject that is not a contact anyone can reach', () => {
    const keys = generateVapidKeys()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    process.env.VAPID_SUBJECT = 'soham'
    expect(pushStatus().reason).toMatch(/mailto:/)
  })
})

describe('sendPush without keys', () => {
  it('returns a reason instead of throwing, and never touches the network', async () => {
    const res = await sendPush(
      { endpoint: SUB.endpoint, p256dh: SUB.keys.p256dh, auth: SUB.keys.auth },
      { hello: 'world' },
    )
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.gone).toBe(false)
    expect(res.ok === false && res.reason).toMatch(/VAPID/)
  })
})

describe('Notifier inbox', () => {
  let db: Db
  let n: Notifier

  beforeEach(() => {
    db = new Db(':memory:')
    n = new Notifier(db)
  })

  it('writes an inbox row that is immediately readable', async () => {
    const row = n.notify('us_maya', {
      kind: 'member.approved',
      title: 'Dev approved',
      body: '£46.50 held',
      url: '/g/gs_1',
      payload: { group_id: 'gs_1' },
    })
    await n.flush()

    expect(row.id).toMatch(/^nt_/)
    const inbox = n.inbox('us_maya')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({
      id: row.id,
      kind: 'member.approved',
      title: 'Dev approved',
      url: '/g/gs_1',
      unread: true,
      payload: { group_id: 'gs_1' },
    })
  })

  it('scopes the inbox to one user', async () => {
    n.notify('us_maya', { kind: 'k', title: 'hers' })
    n.notify('us_dev', { kind: 'k', title: 'his' })
    await n.flush()
    expect(n.inbox('us_maya').map((x) => x.title)).toEqual(['hers'])
    expect(n.inbox('us_dev').map((x) => x.title)).toEqual(['his'])
  })

  it('returns newest first and honours the limit', async () => {
    for (const t of ['one', 'two', 'three']) n.notify('us_maya', { kind: 'k', title: t })
    await n.flush()
    expect(n.inbox('us_maya').map((x) => x.title)).toEqual(['three', 'two', 'one'])
    expect(n.inbox('us_maya', { limit: 2 }).map((x) => x.title)).toEqual(['three', 'two'])
  })

  it('marks one read, idempotently, and filters unread', async () => {
    const a = n.notify('us_maya', { kind: 'k', title: 'a' })
    n.notify('us_maya', { kind: 'k', title: 'b' })
    await n.flush()
    expect(n.unreadCount('us_maya')).toBe(2)

    expect(n.markRead(a.id)).toBe(true)
    expect(n.markRead(a.id)).toBe(false) // already read — no second timestamp
    expect(n.unreadCount('us_maya')).toBe(1)
    expect(n.inbox('us_maya', { unreadOnly: true }).map((x) => x.title)).toEqual(['b'])
    expect(n.get(a.id)?.read_at).toBeTruthy()
  })

  it('marks all read for one user only', async () => {
    n.notify('us_maya', { kind: 'k', title: 'a' })
    n.notify('us_maya', { kind: 'k', title: 'b' })
    n.notify('us_dev', { kind: 'k', title: 'c' })
    await n.flush()

    expect(n.markAllRead('us_maya')).toBe(2)
    expect(n.unreadCount('us_maya')).toBe(0)
    expect(n.unreadCount('us_dev')).toBe(1)
    expect(n.markAllRead('us_maya')).toBe(0)
  })
})

describe('Notifier with push unconfigured', () => {
  let db: Db
  let n: Notifier

  beforeEach(() => {
    db = new Db(':memory:')
    n = new Notifier(db) // real transport, no keys — the shipping default
  })

  it('never throws, and the inbox still works', async () => {
    n.subscribe('us_maya', SUB, 'iPhone')
    expect(() => n.notify('us_maya', { kind: 'k', title: 'still delivered' })).not.toThrow()
    await expect(n.flush()).resolves.toBeUndefined()
    expect(n.inbox('us_maya')).toHaveLength(1)
  })

  it('records why push did not happen instead of pretending it did', async () => {
    n.subscribe('us_maya', SUB)
    const row = n.notify('us_maya', { kind: 'k', title: 'hi' })
    await n.flush()

    const d = n.deliveriesFor(row.id)
    expect(d.map((x) => [x.channel, x.status])).toEqual([
      ['inbox', 'ok'],
      ['push', 'skipped'],
    ])
    expect(d[1]?.detail).toMatch(/VAPID/)
  })

  it('reports its own unavailability', () => {
    expect(n.status().push_available).toBe(false)
  })
})

describe('Notifier delivery accounting', () => {
  let db: Db

  beforeEach(() => {
    db = new Db(':memory:')
  })

  it('records one delivery row per subscription attempted', async () => {
    const t = fakeTransport({ ok: true, status: 201 })
    const n = new Notifier(db, { push: t })
    n.subscribe('us_maya', SUB, 'iPhone')
    n.subscribe('us_maya', { ...SUB, endpoint: `${SUB.endpoint}-laptop` }, 'MacBook')

    const row = n.notify('us_maya', { kind: 'plan.created', title: 'Dinner?', url: '/p/pl_1' })
    await n.flush()

    expect(t.sent).toHaveLength(2)
    expect(t.sent[0]?.payload).toMatchObject({ title: 'Dinner?', url: '/p/pl_1', kind: 'plan.created' })

    const d = n.deliveriesFor(row.id)
    expect(d.filter((x) => x.channel === 'push').map((x) => x.status)).toEqual(['ok', 'ok'])
    expect(d.filter((x) => x.channel === 'inbox')).toHaveLength(1)
    for (const s of n.subscriptionsFor('us_maya')) expect(s.last_ok_at).toBeTruthy()
  })

  it('records a skip when the user has no devices at all', async () => {
    const n = new Notifier(db, { push: fakeTransport({ ok: true, status: 201 }) })
    const row = n.notify('us_nobody', { kind: 'k', title: 'hi' })
    await n.flush()
    const push = n.deliveriesFor(row.id).find((x) => x.channel === 'push')
    expect(push?.status).toBe('skipped')
    expect(push?.detail).toMatch(/no push subscriptions/)
  })

  it('counts failures without deleting a subscription that may recover', async () => {
    const n = new Notifier(db, {
      push: fakeTransport({ ok: false, status: 500, gone: false, reason: '500 Internal' }),
    })
    n.subscribe('us_maya', SUB)
    const row = n.notify('us_maya', { kind: 'k', title: 'hi' })
    await n.flush()

    expect(n.deliveriesFor(row.id).find((x) => x.channel === 'push')?.status).toBe('failed')
    expect(n.subscriptionsFor('us_maya')[0]?.failure_count).toBe(1)
  })

  it('survives a transport that throws', async () => {
    const n = new Notifier(db, {
      push: {
        status: () => ({ push_available: true }),
        send: async () => {
          throw new Error('socket hang up')
        },
      },
    })
    n.subscribe('us_maya', SUB)
    expect(() => n.notify('us_maya', { kind: 'k', title: 'hi' })).not.toThrow()
    await expect(n.flush()).resolves.toBeUndefined()
    expect(n.inbox('us_maya')).toHaveLength(1)
  })
})

describe('dead subscriptions', () => {
  let db: Db

  beforeEach(() => {
    db = new Db(':memory:')
  })

  it('deletes a subscription the push service reports as 410 Gone', async () => {
    const n = new Notifier(db, {
      push: fakeTransport({ ok: false, status: 410, gone: true, reason: '410 Gone' }),
    })
    n.subscribe('us_maya', SUB)
    expect(n.subscriptionsFor('us_maya')).toHaveLength(1)

    const row = n.notify('us_maya', { kind: 'k', title: 'hi' })
    await n.flush()

    expect(n.subscriptionsFor('us_maya')).toHaveLength(0)
    const push = n.deliveriesFor(row.id).find((x) => x.channel === 'push')
    expect(push?.status).toBe('gone')
    expect(push?.detail).toMatch(/deleted/)
  })

  it('drops only the dead device, never the healthy one', async () => {
    const dead = `${SUB.endpoint}-dead`
    const n = new Notifier(db, {
      push: fakeTransport((s) =>
        s.endpoint === dead
          ? { ok: false, status: 404, gone: true, reason: '404 Not Found' }
          : { ok: true, status: 201 },
      ),
    })
    n.subscribe('us_maya', { ...SUB, endpoint: dead }, 'old phone')
    n.subscribe('us_maya', SUB, 'new phone')

    n.notify('us_maya', { kind: 'k', title: 'hi' })
    await n.flush()

    const left = n.subscriptionsFor('us_maya')
    expect(left).toHaveLength(1)
    expect(left[0]?.endpoint).toBe(SUB.endpoint)
  })
})

describe('subscriptions', () => {
  let db: Db
  let n: Notifier

  beforeEach(() => {
    db = new Db(':memory:')
    n = new Notifier(db)
  })

  it('moves an endpoint rather than duplicating it when someone else signs in', () => {
    n.subscribe('us_maya', SUB, 'shared laptop')
    n.subscribe('us_dev', SUB, 'shared laptop')
    expect(n.subscriptionsFor('us_maya')).toHaveLength(0)
    expect(n.subscriptionsFor('us_dev')).toHaveLength(1)
  })

  it('resets the failure count when a device re-subscribes', async () => {
    const bad = new Notifier(db, {
      push: fakeTransport({ ok: false, status: 500, gone: false, reason: 'boom' }),
    })
    bad.subscribe('us_maya', SUB)
    bad.notify('us_maya', { kind: 'k', title: 'hi' })
    await bad.flush()
    expect(bad.subscriptionsFor('us_maya')[0]?.failure_count).toBe(1)

    bad.subscribe('us_maya', SUB)
    expect(bad.subscriptionsFor('us_maya')[0]?.failure_count).toBe(0)
  })

  it('unsubscribes by endpoint and says whether anything was there', () => {
    n.subscribe('us_maya', SUB)
    expect(n.unsubscribe(SUB.endpoint)).toBe(true)
    expect(n.unsubscribe(SUB.endpoint)).toBe(false)
    expect(n.subscriptionsFor('us_maya')).toHaveLength(0)
  })
})

describe('notify routes', () => {
  // app.inject() is in-process: no port, no socket, and with no VAPID keys the
  // notifier never reaches for fetch either.
  function world(transport?: PushTransport) {
    const db = new Db(':memory:')
    installSocialSchema(db)
    const social = new Social(db)
    const maya = social.createUser({ handle: 'maya', name: 'Maya' })
    const dev = social.createUser({ handle: 'dev', name: 'Dev' })
    const notifier = new Notifier(db, transport ? { push: transport } : {})

    const app = Fastify({ logger: false })
    // The real server installs this in registerRoutes before we are reached.
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof UserError) return reply.status(err.statusCode).send({ error: err.message })
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'validation failed' })
      return reply.status(500).send({ error: String(err) })
    })
    // Wired with the Social store directly — the one-line integration path.
    registerNotifyRoutes(app, notifier, social)
    return { app, notifier, maya, dev }
  }

  /** currentUserFrom reads this header, so no cookie plumbing is needed. */
  const as = (u: { id: string }) => ({ 'x-sutra-user': u.id })

  const SUBSCRIBE_BODY = { endpoint: SUB.endpoint, expirationTime: null, keys: SUB.keys }

  it('reports push status to anyone, signed in or not', async () => {
    const { app, maya } = world()
    const anon = await app.inject({ method: 'GET', url: '/v1/notify/status' })
    expect(anon.statusCode).toBe(200)
    expect(anon.json()).toMatchObject({ push_available: false, signed_in: false, subscriptions: 0 })
    expect(anon.json().reason).toMatch(/VAPID/)

    const mine = await app.inject({ method: 'GET', url: '/v1/notify/status', headers: as(maya) })
    expect(mine.json()).toMatchObject({ signed_in: true, unread: 0 })
    await app.close()
  })

  it('401s the inbox when nobody is signed in', async () => {
    const { app } = world()
    const res = await app.inject({ method: 'GET', url: '/v1/notify/inbox' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('rejects a subscription body the browser could not have produced', async () => {
    const { app, maya } = world()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notify/subscribe',
      headers: as(maya),
      payload: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('subscribes, sends a test, and reports every channel', async () => {
    const { app, maya } = world()
    const sub = await app.inject({
      method: 'POST',
      url: '/v1/notify/subscribe',
      headers: as(maya),
      payload: SUBSCRIBE_BODY,
    })
    expect(sub.statusCode).toBe(200)
    expect(sub.json()).toMatchObject({ ok: true, subscriptions: 1 })

    const test = await app.inject({ method: 'POST', url: '/v1/notify/test', headers: as(maya) })
    expect(test.statusCode).toBe(200)
    // The whole point of this route: it says what happened, not just "sent".
    expect(test.json().deliveries).toEqual([
      expect.objectContaining({ channel: 'inbox', status: 'ok' }),
      expect.objectContaining({ channel: 'push', status: 'skipped' }),
    ])

    const inbox = await app.inject({ method: 'GET', url: '/v1/notify/inbox', headers: as(maya) })
    expect(inbox.json().unread).toBe(1)
    expect(inbox.json().notifications[0]).toMatchObject({ kind: 'notify.test', unread: true })
    await app.close()
  })

  it('never lets one member read or clear another inbox', async () => {
    const { app, notifier, maya, dev } = world()
    const n = notifier.notify(maya.id, { kind: 'k', title: 'hers' })
    await notifier.flush()

    const stolen = await app.inject({
      method: 'POST',
      url: `/v1/notify/read/${n.id}`,
      headers: as(dev),
    })
    expect(stolen.statusCode).toBe(404)
    expect(notifier.unreadCount(maya.id)).toBe(1)

    const devInbox = await app.inject({ method: 'GET', url: '/v1/notify/inbox', headers: as(dev) })
    expect(devInbox.json().notifications).toEqual([])

    const mine = await app.inject({
      method: 'POST',
      url: `/v1/notify/read/${n.id}`,
      headers: as(maya),
    })
    expect(mine.json()).toMatchObject({ ok: true, unread: 0 })
    await app.close()
  })

  it('marks all read and unsubscribes by endpoint', async () => {
    const { app, notifier, maya } = world()
    notifier.notify(maya.id, { kind: 'k', title: 'a' })
    notifier.notify(maya.id, { kind: 'k', title: 'b' })
    await notifier.flush()

    const all = await app.inject({ method: 'POST', url: '/v1/notify/read-all', headers: as(maya) })
    expect(all.json()).toMatchObject({ marked: 2, unread: 0 })

    await app.inject({
      method: 'POST',
      url: '/v1/notify/subscribe',
      headers: as(maya),
      payload: SUBSCRIBE_BODY,
    })
    const off = await app.inject({
      method: 'POST',
      url: '/v1/notify/unsubscribe',
      payload: { endpoint: SUB.endpoint },
    })
    expect(off.json()).toMatchObject({ ok: true, removed: true })
    expect(notifier.subscriptionsFor(maya.id)).toHaveLength(0)
    await app.close()
  })
})
