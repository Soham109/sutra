import { z } from 'zod'
import { UserError } from '../service.js'
import { currentUserFrom } from '../routes-v2.js'
import type { FastifyInstance } from 'fastify'
import type { Notifier } from './index.js'
import type { Social, User } from '../social.js'

// The notification surface. Everything is scoped to the signed-in user —
// there is no route that lets one member read another's inbox, and no route
// that lets anyone push to someone else.

type Req = { headers: Record<string, unknown> }
type CurrentUser = (req: Req) => User | undefined

/** The browser hands back exactly what PushSubscription.toJSON() produced. */
const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  /** present in the browser's JSON, always null in practice — ignored */
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
})

const UnsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2000) })

const TestSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  body: z.string().max(400).optional(),
  url: z.string().max(500).optional(),
})

export function registerNotifyRoutes(
  app: FastifyInstance,
  notifier: Notifier,
  // Accepts the Social store directly so wiring is one line; a resolver is
  // still allowed for tests and for anywhere identity is already resolved.
  currentUser: CurrentUser | Social,
): void {
  const resolve: CurrentUser =
    typeof currentUser === 'function' ? currentUser : (req) => currentUserFrom(currentUser, req)

  const requireUser = (req: Req): User => {
    const u = resolve(req)
    if (!u) throw new UserError('sign in to continue', 401)
    return u
  }

  // ---- capability ---------------------------------------------------------

  /**
   * Honest by design: the UI reads this before offering a "turn on
   * notifications" button, so nobody is ever asked for a permission that the
   * server could not act on anyway.
   */
  app.get('/v1/notify/status', async (req) => {
    const me = resolve(req)
    const st = notifier.status()
    return {
      ...st,
      signed_in: Boolean(me),
      subscriptions: me ? notifier.subscriptionsFor(me.id).length : 0,
      unread: me ? notifier.unreadCount(me.id) : 0,
    }
  })

  // ---- subscriptions ------------------------------------------------------

  app.post('/v1/notify/subscribe', async (req) => {
    const me = requireUser(req)
    const body = SubscribeSchema.parse(req.body)
    const sub = notifier.subscribe(me.id, body, String(req.headers['user-agent'] ?? '') || undefined)
    return {
      ok: true,
      subscription_id: sub.id,
      endpoint: sub.endpoint,
      subscriptions: notifier.subscriptionsFor(me.id).length,
    }
  })

  /**
   * Not user-scoped on purpose: a browser revoking permission knows only its
   * endpoint, and an endpoint is unguessable — knowing one is the proof.
   */
  app.post('/v1/notify/unsubscribe', async (req) => {
    const body = UnsubscribeSchema.parse(req.body)
    return { ok: true, removed: notifier.unsubscribe(body.endpoint) }
  })

  // ---- inbox --------------------------------------------------------------

  app.get('/v1/notify/inbox', async (req) => {
    const me = requireUser(req)
    const q = req.query as { unread_only?: string; limit?: string }
    const unreadOnly = q.unread_only === '1' || q.unread_only === 'true'
    const limit = q.limit ? Number(q.limit) : undefined
    if (limit !== undefined && !Number.isFinite(limit)) throw new UserError('limit must be a number')
    return {
      notifications: notifier.inbox(me.id, { unreadOnly, limit }),
      unread: notifier.unreadCount(me.id),
    }
  })

  app.post('/v1/notify/read/:id', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    const n = notifier.get(id)
    if (!n || n.user_id !== me.id) throw new UserError('no such notification', 404)
    notifier.markRead(id)
    return { ok: true, unread: notifier.unreadCount(me.id) }
  })

  app.post('/v1/notify/read-all', async (req) => {
    const me = requireUser(req)
    return { ok: true, marked: notifier.markAllRead(me.id), unread: 0 }
  })

  // ---- demo-day debugging -------------------------------------------------

  /**
   * Send yourself one and wait for the fan-out, so the response says exactly
   * what happened on every channel. This is the only route that awaits
   * delivery — worth it when four phones are on a table and one is silent.
   */
  app.post('/v1/notify/test', async (req) => {
    const me = requireUser(req)
    const body = TestSchema.parse(req.body ?? {})
    const n = notifier.notify(me.id, {
      kind: 'notify.test',
      title: body.title ?? 'Sutra test notification',
      body: body.body ?? `If you can see this, ${me.name} can be reached.`,
      url: body.url ?? '/',
      payload: { test: true },
    })
    await notifier.flush()
    return {
      ok: true,
      notification_id: n.id,
      status: notifier.status(),
      deliveries: notifier.deliveriesFor(n.id).map((d) => ({
        channel: d.channel,
        status: d.status,
        detail: d.detail,
        at: d.attempted_at,
      })),
    }
  })
}
