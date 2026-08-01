import type { Db } from '../db.js'

// Delivery is its own concern, so it owns its own tables. Nothing here
// references users or groups: a notification outlives the thing it was about,
// and the inbox has to keep working even when the protocol path fails.

export function installNotifySchema(db: Db): void {
  db.sql.exec(`
    -- One row per browser, not per person: a member with a laptop and a phone
    -- is two endpoints, and only one of them may be the phone in their hand.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_ok_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

    -- The in-app inbox, and the only channel that cannot fail. Push is an
    -- optimisation on top of this; the row is written before anything is sent.
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      read_at TEXT
    );
    -- Newest-first reads order by rowid, not by id or created_at: two
    -- notifications written in the same millisecond tie on both, and "Dev
    -- approved" arriving above "Dev declined" would be a lie about causality.
    -- SQLite orders index entries by (user_id, rowid), so this covers it.
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

    -- Append-only attempt log. "Did Maya actually get the push" is the first
    -- thing an organiser asks, and a boolean on the notification cannot answer
    -- it — she has three devices and two of them are asleep.
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL REFERENCES notifications(id),
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_notification ON deliveries(notification_id);
  `)
}

export interface NotificationRow {
  id: string
  user_id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  payload_json: string
  created_at: string
  read_at: string | null
}

export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_ok_at: string | null
  failure_count: number
}

/** `skipped` is not a failure: it is push being honestly unavailable. */
export type DeliveryStatus = 'ok' | 'failed' | 'gone' | 'skipped'

export interface DeliveryRow {
  id: string
  notification_id: string
  channel: 'inbox' | 'push'
  status: DeliveryStatus
  detail: string | null
  attempted_at: string
}
