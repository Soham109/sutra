import { ulid } from './ids.js'
import type { Db } from './db.js'
import type { Policy } from './types.js'

// People, and the groups they keep buying with. Everything here is derived
// from the same append-only event log the protocol already writes, so a
// member's reliability record is evidence rather than a rating anyone assigns.

export interface User {
  id: string
  handle: string
  name: string
  email: string
  accent: string
  created_at: string
}

export interface Circle {
  id: string
  owner_id: string
  name: string
  emoji: string
  policy_json: string | null
  created_at: string
}

export interface Reliability {
  user_id: string
  groups: number
  approvals: number
  declines: number
  /** approvals ÷ decisions, null until they have decided anything */
  approval_rate: number | null
  /** median seconds from link issued to approval */
  median_latency_s: number | null
  charged_total_minor: number
  backstopped_total_minor: number
}

const ACCENTS = ['#2E2AD8', '#B7410E', '#1A7F5A', '#7A2E8E', '#0F6C8C', '#A4231F', '#8A6D0B', '#3E5C2A']

export function installSocialSchema(db: Db): void {
  db.sql.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      accent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- Friendship is stored as two rows so lookups never need an OR.
    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (user_id, friend_id)
    );

    -- A circle is a group you keep re-forming: default people, default policy.
    CREATE TABLE IF NOT EXISTS circles (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '🧵',
      policy_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS circle_members (
      circle_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (circle_id, user_id)
    );
  `)

  // Group/member ownership columns, added defensively so an existing db upgrades.
  addColumn(db, 'groups', 'created_by', 'TEXT')
  addColumn(db, 'groups', 'circle_id', 'TEXT')
  addColumn(db, 'groups', 'product_json', 'TEXT')
  addColumn(db, 'members', 'user_id', 'TEXT')
}

function addColumn(db: Db, table: string, column: string, type: string): void {
  const cols = db.sql.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  if (cols.some((c) => c.name === column)) return
  db.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export class Social {
  constructor(private readonly db: Db) {}

  // ---- users --------------------------------------------------------------

  createUser(input: { handle: string; name: string; email?: string }): User {
    const handle = input.handle.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')
    if (!handle) throw new Error('handle cannot be empty')
    const existing = this.byHandle(handle)
    if (existing) return existing

    const id = `us_${ulid()}`
    const accent = ACCENTS[Math.abs(hash(handle)) % ACCENTS.length]!
    this.db.sql
      .prepare(`INSERT INTO users (id, handle, name, email, accent) VALUES (?, ?, ?, ?, ?)`)
      .run(id, handle, input.name.trim() || handle, input.email ?? `${handle}@sutra.local`, accent)
    return this.byId(id)!
  }

  byId(id: string): User | undefined {
    return this.db.sql.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined
  }

  byHandle(handle: string): User | undefined {
    return this.db.sql.prepare(`SELECT * FROM users WHERE handle = ?`).get(handle.toLowerCase()) as
      | User
      | undefined
  }

  allUsers(): User[] {
    return this.db.sql.prepare(`SELECT * FROM users ORDER BY created_at`).all() as unknown as User[]
  }

  // ---- friends ------------------------------------------------------------

  addFriend(userId: string, friendId: string): void {
    if (userId === friendId) throw new Error('you are already yourself')
    const stmt = this.db.sql.prepare(
      `INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)`,
    )
    stmt.run(userId, friendId)
    stmt.run(friendId, userId)
  }

  removeFriend(userId: string, friendId: string): void {
    const stmt = this.db.sql.prepare(`DELETE FROM friendships WHERE user_id = ? AND friend_id = ?`)
    stmt.run(userId, friendId)
    stmt.run(friendId, userId)
  }

  friendsOf(userId: string): User[] {
    return this.db.sql
      .prepare(
        `SELECT u.* FROM users u JOIN friendships f ON f.friend_id = u.id
         WHERE f.user_id = ? ORDER BY u.name`,
      )
      .all(userId) as unknown as User[]
  }

  // ---- circles ------------------------------------------------------------

  createCircle(input: { ownerId: string; name: string; emoji?: string; policy?: Policy; memberIds: string[] }): Circle {
    const id = `cr_${ulid()}`
    this.db.sql
      .prepare(`INSERT INTO circles (id, owner_id, name, emoji, policy_json) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.ownerId, input.name.trim(), input.emoji ?? '🧵', input.policy ? JSON.stringify(input.policy) : null)
    const add = this.db.sql.prepare(`INSERT OR IGNORE INTO circle_members (circle_id, user_id) VALUES (?, ?)`)
    for (const uid of new Set([input.ownerId, ...input.memberIds])) add.run(id, uid)
    return this.circle(id)!
  }

  circle(id: string): Circle | undefined {
    return this.db.sql.prepare(`SELECT * FROM circles WHERE id = ?`).get(id) as Circle | undefined
  }

  circlesFor(userId: string): (Circle & { members: User[] })[] {
    const circles = this.db.sql
      .prepare(
        `SELECT c.* FROM circles c JOIN circle_members m ON m.circle_id = c.id
         WHERE m.user_id = ? ORDER BY c.created_at DESC`,
      )
      .all(userId) as unknown as Circle[]
    return circles.map((c) => ({ ...c, members: this.circleMembers(c.id) }))
  }

  circleMembers(circleId: string): User[] {
    return this.db.sql
      .prepare(
        `SELECT u.* FROM users u JOIN circle_members m ON m.user_id = u.id
         WHERE m.circle_id = ? ORDER BY u.name`,
      )
      .all(circleId) as unknown as User[]
  }

  deleteCircle(id: string, ownerId: string): void {
    this.db.sql.prepare(`DELETE FROM circles WHERE id = ? AND owner_id = ?`).run(id, ownerId)
    this.db.sql.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(id)
  }

  // ---- reliability, computed from the event log ---------------------------

  /**
   * Reliability is evidence, not reputation: every number here is recomputed
   * from append-only events, so it cannot be edited, only earned.
   */
  reliability(userId: string): Reliability {
    const rows = this.db.sql
      .prepare(
        `SELECT m.id, m.group_id, m.status, m.charged_amount, m.backstop_absorbed
         FROM members m WHERE m.user_id = ?`,
      )
      .all(userId) as unknown as {
      id: string
      group_id: string
      status: string
      charged_amount: number
      backstop_absorbed: number
    }[]

    let approvals = 0
    let declines = 0
    let charged = 0
    let backstopped = 0
    const latencies: number[] = []

    for (const r of rows) {
      charged += r.charged_amount
      backstopped += r.backstop_absorbed
      const events = this.db
        .eventsAfter(r.group_id, 0)
        .filter((e) => e.member_id === r.id)

      const invited = events.find((e) => e.type === 'member.invited')
      const approved = events.find((e) => e.type === 'member.approved')
      const declined = events.find((e) => e.type === 'member.declined')

      if (approved) {
        approvals++
        if (invited) {
          const dt = (new Date(approved.created_at).getTime() - new Date(invited.created_at).getTime()) / 1000
          if (dt >= 0 && dt < 86400) latencies.push(dt)
        }
      } else if (declined) {
        declines++
      }
    }

    const decisions = approvals + declines
    latencies.sort((a, b) => a - b)
    const mid = Math.floor(latencies.length / 2)
    const median =
      latencies.length === 0
        ? null
        : latencies.length % 2
          ? latencies[mid]!
          : Math.round(((latencies[mid - 1] ?? 0) + (latencies[mid] ?? 0)) / 2)

    return {
      user_id: userId,
      groups: new Set(rows.map((r) => r.group_id)).size,
      approvals,
      declines,
      approval_rate: decisions === 0 ? null : approvals / decisions,
      median_latency_s: median,
      charged_total_minor: charged,
      backstopped_total_minor: backstopped,
    }
  }

  /** Groups this user is in — as organizer or member. */
  groupsFor(userId: string): string[] {
    const rows = this.db.sql
      .prepare(
        `SELECT DISTINCT g.id AS id, g.created_at AS created_at FROM groups g
         LEFT JOIN members m ON m.group_id = g.id
         WHERE g.created_by = ? OR m.user_id = ?
         ORDER BY g.created_at DESC`,
      )
      .all(userId, userId) as unknown as { id: string }[]
    return rows.map((r) => r.id)
  }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
