import { ulid } from './ids.js'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
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

/**
 * What one person may see about another.
 *
 * The row that comes out of SQLite carries `email` and `password_hash`, and
 * `/v1/people` was returning it verbatim to every signed-in user — so anyone
 * could enumerate every address on the service, and would have seen the hashes
 * too once real accounts existed.
 *
 * Directory listings are public by design here: you need to find a friend by
 * name to add them. What is public is a display identity — nothing that could
 * be used to contact, impersonate, or attack the account.
 */
export interface PublicUser {
  id: string
  handle: string
  name: string
  accent: string
}

export function publicUser(u: User): PublicUser {
  return { id: u.id, handle: u.handle, name: u.name, accent: u.accent }
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

    -- One row while an ask is outstanding; deleted when accepted or declined.
    -- A friendship is two rows in the friendships table; a request is one row
    -- here, and the direction is the whole point.
    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (from_id, to_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_req_to ON friend_requests(to_id);

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

    -- Opaque, revocable credentials for companion clients such as the browser
    -- extension. Only the hash is persisted; losing the database cannot reveal
    -- a usable token.
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id);
  `)

  // Group/member ownership columns, added defensively so an existing db upgrades.
  addColumn(db, 'groups', 'created_by', 'TEXT')
  addColumn(db, 'groups', 'circle_id', 'TEXT')
  addColumn(db, 'groups', 'product_json', 'TEXT')
  addColumn(db, 'members', 'user_id', 'TEXT')
  addColumn(db, 'users', 'password_hash', 'TEXT')
  db.sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(lower(email))`)
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

  registerUser(input: { handle: string; name: string; email: string; password: string }): User {
    const email = input.email.trim().toLowerCase()
    if (this.byEmail(email)) throw new Error('an account with that email already exists')
    if (this.byHandle(input.handle.trim().toLowerCase())) throw new Error('that handle is already taken')
    const user = this.createUser({ ...input, email })
    this.db.sql.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash(input.password), user.id)
    return user
  }

  authenticate(email: string, password: string): User | undefined {
    const row = this.db.sql.prepare(`SELECT * FROM users WHERE lower(email) = ?`).get(email.trim().toLowerCase()) as (User & { password_hash: string | null }) | undefined
    if (!row?.password_hash || !verifyPassword(password, row.password_hash)) return undefined
    const { password_hash: _secret, ...user } = row
    return user
  }

  byEmail(email: string): User | undefined {
    return this.db.sql.prepare(`SELECT id, handle, name, email, accent, created_at FROM users WHERE lower(email) = ?`)
      .get(email.trim().toLowerCase()) as User | undefined
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

  createSession(userId: string, label = 'companion client'): { token: string; expires_at: string } {
    if (!this.byId(userId)) throw new Error('no such user')
    const token = `sutra_session_${randomBytes(32).toString('base64url')}`
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    this.db.sql.prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, label, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(`ses_${ulid()}`, userId, hashToken(token), label.slice(0, 80), expiresAt)
    return { token, expires_at: expiresAt }
  }

  userForSession(token: string): User | undefined {
    if (!token.startsWith('sutra_session_')) return undefined
    const row = this.db.sql.prepare(
      `SELECT id, user_id FROM user_sessions WHERE token_hash = ? AND expires_at > ?`,
    ).get(hashToken(token), new Date().toISOString()) as { id: string; user_id: string } | undefined
    if (!row) return undefined
    this.db.sql.prepare(`UPDATE user_sessions SET last_used_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id)
    return this.byId(row.user_id)
  }

  revokeSessions(userId: string, label?: string): number {
    const result = label
      ? this.db.sql.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND label = ?`).run(userId, label)
      : this.db.sql.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).run(userId)
    return Number(result.changes)
  }

  // ---- friends ------------------------------------------------------------

  /**
   * Ask. Do not assume.
   *
   * This used to write both rows immediately, so pressing a button added YOU to
   * a stranger's friend list without them ever hearing about it. In a product
   * where a friend can be dropped into a group that asks them for money, being
   * added to someone's list has to be something you agreed to.
   *
   * If they already asked you, this accepts instead — pressing "add" on someone
   * who is waiting on you should obviously mean yes.
   */
  requestFriend(userId: string, friendId: string): 'friends' | 'requested' | 'already' {
    if (userId === friendId) throw new Error('you are already yourself')
    if (this.areFriends(userId, friendId)) return 'already'

    const theyAsked = this.db.sql
      .prepare(`SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?`)
      .get(friendId, userId)
    if (theyAsked) {
      this.acceptFriend(userId, friendId)
      return 'friends'
    }

    this.db.sql
      .prepare(`INSERT OR IGNORE INTO friend_requests (from_id, to_id) VALUES (?, ?)`)
      .run(userId, friendId)
    return 'requested'
  }

  /** `userId` accepts the request `friendId` sent them. */
  acceptFriend(userId: string, friendId: string): boolean {
    const pending = this.db.sql
      .prepare(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`)
      .run(friendId, userId)
    if (pending.changes === 0) return false
    // Stored as two rows so a lookup never needs an OR.
    const stmt = this.db.sql.prepare(
      `INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)`,
    )
    stmt.run(userId, friendId)
    stmt.run(friendId, userId)
    // Any request in the other direction is now moot.
    this.db.sql.prepare(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`).run(userId, friendId)
    return true
  }

  declineFriend(userId: string, friendId: string): void {
    this.db.sql.prepare(`DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?`).run(friendId, userId)
  }

  areFriends(a: string, b: string): boolean {
    return !!this.db.sql
      .prepare(`SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?`)
      .get(a, b)
  }

  /** People waiting on this user to answer. */
  incomingRequests(userId: string): User[] {
    return this.db.sql
      .prepare(
        `SELECT u.* FROM users u JOIN friend_requests r ON r.from_id = u.id
         WHERE r.to_id = ? ORDER BY r.created_at DESC`,
      )
      .all(userId) as unknown as User[]
  }

  /** People this user has asked, who have not answered yet. */
  outgoingRequests(userId: string): User[] {
    return this.db.sql
      .prepare(
        `SELECT u.* FROM users u JOIN friend_requests r ON r.to_id = u.id
         WHERE r.from_id = ? ORDER BY r.created_at DESC`,
      )
      .all(userId) as unknown as User[]
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function passwordHash(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltText, hashText] = encoded.split('$')
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64url')
  const actual = scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
