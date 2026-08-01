import { ulid } from '../ids.js'
import { installNotifySchema } from './schema.js'
import { webPush } from './push.js'
import type { Db } from '../db.js'
import type {
  DeliveryRow,
  DeliveryStatus,
  NotificationRow,
  PushSubscriptionRow,
} from './schema.js'
import type { PushStatus, PushSubscriptionInfo, PushTransport } from './push.js'

// The delivery layer. Four people, four phones, one decision that only works
// if everybody hears about it within the minute — but a notification is still
// the least important thing in the process. Nothing here is allowed to block,
// slow or break the protocol path, so the inbox write is synchronous and
// everything after it is fire-and-forget, exactly like EventHub's webhooks.

export * from './schema.js'
export {
  encryptPayload,
  generateVapidKeys,
  pushStatus,
  sendPush,
  webPush,
  type PushResult,
  type PushStatus,
  type PushSubscriptionInfo,
  type PushTransport,
} from './push.js'

export interface NotifyInput {
  /** dotted, mirroring the protocol event that caused it: `member.approved` */
  kind: string
  title: string
  body?: string
  /** deep link the notification opens — the whole point of sending it */
  url?: string
  payload?: Record<string, unknown>
}

export interface NotificationView {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
  unread: boolean
}

export interface InboxOptions {
  unreadOnly?: boolean
  limit?: number
}

const MAX_LIMIT = 200

export class Notifier {
  private readonly pending = new Set<Promise<void>>()
  private readonly push: PushTransport

  constructor(
    private readonly db: Db,
    opts: { push?: PushTransport } = {},
  ) {
    // Self-installing: the schema is CREATE IF NOT EXISTS, and a notifier that
    // silently has no tables is a worse failure than an extra idempotent call.
    installNotifySchema(db)
    this.push = opts.push ?? webPush
  }

  // ---- sending ------------------------------------------------------------

  /**
   * Writes the inbox row and returns immediately; push happens behind the
   * caller's back. Returns the row rather than a promise so a caller on the
   * protocol path physically cannot await delivery.
   */
  notify(userId: string, input: NotifyInput): NotificationRow {
    const id = `nt_${ulid()}`
    this.db.sql
      .prepare(
        `INSERT INTO notifications (id, user_id, kind, title, body, url, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        input.kind,
        input.title,
        input.body ?? null,
        input.url ?? null,
        JSON.stringify(input.payload ?? {}),
      )
    const row = this.get(id)!

    // Fire and forget: a push that fails, hangs or 500s must not surface as a
    // rejection anywhere near the caller. flush() exists for tests and for a
    // clean shutdown, and is the only way to observe these.
    const p = this.fanOut(row)
      .catch(() => undefined)
      .finally(() => this.pending.delete(p))
    this.pending.add(p)
    return row
  }

  /** Await every in-flight delivery. Tests and shutdown only. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }

  private async fanOut(n: NotificationRow): Promise<void> {
    // The inbox is the channel that cannot fail — record it so `deliveries`
    // tells the whole story of a notification, not just its push half.
    this.record(n.id, 'inbox', 'ok', null)

    const status = this.push.status()
    if (!status.push_available) {
      this.record(n.id, 'push', 'skipped', status.reason ?? 'push unavailable')
      return
    }
    const subs = this.subscriptionsFor(n.user_id)
    if (subs.length === 0) {
      this.record(n.id, 'push', 'skipped', 'no push subscriptions for this user')
      return
    }
    await Promise.all(subs.map((s) => this.deliver(n, s)))
  }

  private async deliver(n: NotificationRow, sub: PushSubscriptionRow): Promise<void> {
    const info: PushSubscriptionInfo = {
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    }
    const res = await this.push.send(info, {
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url,
      payload: JSON.parse(n.payload_json) as Record<string, unknown>,
      created_at: n.created_at,
    })

    if (res.ok) {
      this.db.sql
        .prepare(
          `UPDATE push_subscriptions
             SET last_ok_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failure_count = 0
           WHERE id = ?`,
        )
        .run(sub.id)
      this.record(n.id, 'push', 'ok', `${res.status} ${short(sub.endpoint)}`)
      return
    }

    if (res.gone) {
      // 404/410 is the push service telling us the browser already dropped
      // this subscription. Keeping it means retrying a dead phone forever.
      this.db.sql.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(sub.id)
      this.record(n.id, 'push', 'gone', `${res.reason} — subscription deleted`)
      return
    }

    this.db.sql
      .prepare(`UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?`)
      .run(sub.id)
    this.record(n.id, 'push', 'failed', `${res.reason} ${short(sub.endpoint)}`)
  }

  private record(
    notificationId: string,
    channel: 'inbox' | 'push',
    status: DeliveryStatus,
    detail: string | null,
  ): void {
    this.db.sql
      .prepare(
        `INSERT INTO deliveries (id, notification_id, channel, status, detail)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(`dl_${ulid()}`, notificationId, channel, status, detail)
  }

  // ---- subscriptions ------------------------------------------------------

  /**
   * Upsert on endpoint, not on user: the endpoint IS the device. The same
   * browser re-subscribing after a key rotation, or after someone else signs
   * in on the shared demo laptop, must move rather than duplicate.
   */
  subscribe(
    userId: string,
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ): PushSubscriptionRow {
    this.db.sql
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           failure_count = 0`,
      )
      .run(`ps_${ulid()}`, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null)
    return this.subscriptionByEndpoint(sub.endpoint)!
  }

  /** Endpoint-keyed, because a browser revoking permission knows nothing else. */
  unsubscribe(endpoint: string): boolean {
    const res = this.db.sql
      .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
      .run(endpoint)
    return Number(res.changes) > 0
  }

  subscriptionsFor(userId: string): PushSubscriptionRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at`)
      .all(userId) as unknown as PushSubscriptionRow[]
  }

  subscriptionByEndpoint(endpoint: string): PushSubscriptionRow | undefined {
    return this.db.sql
      .prepare(`SELECT * FROM push_subscriptions WHERE endpoint = ?`)
      .get(endpoint) as PushSubscriptionRow | undefined
  }

  // ---- inbox --------------------------------------------------------------

  inbox(userId: string, opts: InboxOptions = {}): NotificationView[] {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), MAX_LIMIT)
    const rows = this.db.sql
      .prepare(
        `SELECT * FROM notifications
          WHERE user_id = ? ${opts.unreadOnly ? 'AND read_at IS NULL' : ''}
          ORDER BY rowid DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as NotificationRow[]
    return rows.map(view)
  }

  get(id: string): NotificationRow | undefined {
    return this.db.sql.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id) as
      | NotificationRow
      | undefined
  }

  unreadCount(userId: string): number {
    const row = this.db.sql
      .prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
      .get(userId) as { c: number }
    return Number(row.c)
  }

  /** Idempotent: re-reading a read notification keeps the original timestamp. */
  markRead(id: string): boolean {
    const res = this.db.sql
      .prepare(
        `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ? AND read_at IS NULL`,
      )
      .run(id)
    return Number(res.changes) > 0
  }

  markAllRead(userId: string): number {
    const res = this.db.sql
      .prepare(
        `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE user_id = ? AND read_at IS NULL`,
      )
      .run(userId)
    return Number(res.changes)
  }

  // ---- introspection ------------------------------------------------------

  /** So the UI can say "push is off because we have no keys" instead of lying. */
  status(): PushStatus {
    return this.push.status()
  }

  deliveriesFor(notificationId: string): DeliveryRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM deliveries WHERE notification_id = ? ORDER BY rowid`)
      .all(notificationId) as unknown as DeliveryRow[]
  }
}

function view(r: NotificationRow): NotificationView {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    url: r.url,
    payload: safeJson(r.payload_json),
    created_at: r.created_at,
    read_at: r.read_at,
    unread: r.read_at === null,
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Endpoints are 200+ chars of push-service opaqueness; only the tail identifies. */
function short(endpoint: string): string {
  return `…${endpoint.slice(-12)}`
}
