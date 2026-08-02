import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BidRow, EventRow, GroupRow, MemberRow } from './types.js'

// process.getBuiltinModule keeps bundlers (vite/vitest) from trying to
// resolve node:sqlite themselves — it is a Node builtin, not a package.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')
type DatabaseSync = import('node:sqlite').DatabaseSync

export class Db {
  readonly sql: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.sql = new DatabaseSync(path)
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        merchant_json TEXT NOT NULL,
        cart_json TEXT NOT NULL,
        cart_hash TEXT NOT NULL,
        currency TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        tolerance_bps INTEGER NOT NULL,
        straggler_policy TEXT NOT NULL,
        no_blame INTEGER NOT NULL DEFAULT 0,
        deadline_at TEXT NOT NULL,
        status TEXT NOT NULL,
        decision_note TEXT,
        webhook_url TEXT,
        locked_json TEXT,
        created_by TEXT,
        circle_id TEXT,
        product_json TEXT,
        auction_close_at TEXT,
        fx_json TEXT,
        rail TEXT NOT NULL DEFAULT 'prava_mandates',
        origin TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id),
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 1,
        share_amount INTEGER NOT NULL DEFAULT 0,
        cap_amount INTEGER NOT NULL DEFAULT 0,
        backstop_cap INTEGER NOT NULL DEFAULT 0,
        sponsor_for TEXT,
        user_id TEXT,
        status TEXT NOT NULL,
        prava_session_id TEXT,
        prava_approval_url TEXT,
        prava_mandate_id TEXT,
        prava_charge_txn_id TEXT,
        backstop_session_id TEXT,
        backstop_approval_url TEXT,
        backstop_mandate_id TEXT,
        backstop_absorbed INTEGER NOT NULL DEFAULT 0,
        requote_round INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT,
        charged_amount INTEGER NOT NULL DEFAULT 0,
        on_hold INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);

      -- Sealed bids for contested items (§21.1). Amounts stay here until the
      -- reveal event — the event stream only carries "a sealed bid landed".
      CREATE TABLE IF NOT EXISTS auction_bids (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bids ON auction_bids(group_id, sku, seq);

      -- Append-only. Never UPDATE, never DELETE. The log is the source of
      -- truth for SSE, the board, replay, receipts and crash recovery.
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL,
        member_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_group ON events(group_id, seq);

      CREATE TABLE IF NOT EXISTS receipts (
        group_id TEXT PRIMARY KEY REFERENCES groups(id),
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- Demo-only merchant proof. The address is deliberately never stored
      -- here; only Shopify's non-sensitive order reference and verification
      -- summary survive the request.
      CREATE TABLE IF NOT EXISTS shopify_test_orders (
        group_id TEXT PRIMARY KEY REFERENCES groups(id),
        proof_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `)

    // Columns added after the first release. CREATE TABLE above covers fresh
    // databases; these keep an existing data/gmp.db working across an upgrade.
    this.addColumn('groups', 'rail', `TEXT NOT NULL DEFAULT 'prava_mandates'`)
    this.addColumn('groups', 'origin', 'TEXT')
  }

  /** Idempotent ALTER — SQLite has no ADD COLUMN IF NOT EXISTS. */
  addColumn(table: string, column: string, definition: string): void {
    const cols = this.sql.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
    if (cols.some((c) => c.name === column)) return
    this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  // ---- groups -------------------------------------------------------------

  insertGroup(g: Omit<GroupRow, 'version' | 'created_at'>): void {
    this.sql
      .prepare(
        `INSERT INTO groups (id, title, merchant_json, cart_json, cart_hash, currency, policy_json,
          tolerance_bps, straggler_policy, no_blame, deadline_at, status, decision_note, webhook_url,
          locked_json, created_by, circle_id, product_json, auction_close_at, fx_json, rail, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        g.id, g.title, g.merchant_json, g.cart_json, g.cart_hash, g.currency, g.policy_json,
        g.tolerance_bps, g.straggler_policy, g.no_blame, g.deadline_at, g.status,
        g.decision_note, g.webhook_url, g.locked_json, g.created_by, g.circle_id,
        g.product_json, g.auction_close_at, g.fx_json, g.rail, g.origin,
      )
  }

  getGroup(id: string): GroupRow | undefined {
    return this.sql.prepare(`SELECT * FROM groups WHERE id = ?`).get(id) as GroupRow | undefined
  }

  listGroups(): GroupRow[] {
    return this.sql.prepare(`SELECT * FROM groups ORDER BY created_at DESC`).all() as unknown as GroupRow[]
  }

  nonTerminalGroups(): GroupRow[] {
    return this.sql
      .prepare(`SELECT * FROM groups WHERE status NOT IN ('committed','partial','aborted','expired')`)
      .all() as unknown as GroupRow[]
  }

  /**
   * Compare-and-swap group transition. Returns true when this caller won the
   * race; false means someone else moved the group first — re-read and retry.
   */
  casGroup(id: string, expectedVersion: number, patch: Partial<GroupRow>): boolean {
    const fields = Object.keys(patch) as (keyof GroupRow)[]
    if (fields.length === 0) return true
    const sets = fields.map((f) => `${String(f)} = ?`).join(', ')
    const res = this.sql
      .prepare(`UPDATE groups SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`)
      .run(...fields.map((f) => patch[f] as never), id, expectedVersion)
    return res.changes === 1
  }

  // ---- members ------------------------------------------------------------

  insertMember(m: Omit<MemberRow, 'version'>): void {
    this.sql
      .prepare(
        `INSERT INTO members (id, group_id, display_name, user_id, role, weight, share_amount, cap_amount,
           backstop_cap, sponsor_for, status, prava_session_id, prava_approval_url, prava_mandate_id,
           prava_charge_txn_id, backstop_session_id, backstop_approval_url, backstop_mandate_id,
           backstop_absorbed, requote_round, failure_reason, charged_amount, on_hold)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id, m.group_id, m.display_name, m.user_id, m.role, m.weight, m.share_amount, m.cap_amount,
        m.backstop_cap, m.sponsor_for, m.status, m.prava_session_id, m.prava_approval_url,
        m.prava_mandate_id, m.prava_charge_txn_id, m.backstop_session_id, m.backstop_approval_url,
        m.backstop_mandate_id, m.backstop_absorbed, m.requote_round, m.failure_reason,
        m.charged_amount, m.on_hold,
      )
  }

  getMember(id: string): MemberRow | undefined {
    return this.sql.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as MemberRow | undefined
  }

  membersOf(groupId: string): MemberRow[] {
    return this.sql
      .prepare(`SELECT * FROM members WHERE group_id = ? ORDER BY rowid`)
      .all(groupId) as unknown as MemberRow[]
  }

  casMember(id: string, expectedVersion: number, patch: Partial<MemberRow>): boolean {
    const fields = Object.keys(patch) as (keyof MemberRow)[]
    if (fields.length === 0) return true
    const sets = fields.map((f) => `${String(f)} = ?`).join(', ')
    const res = this.sql
      .prepare(`UPDATE members SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`)
      .run(...fields.map((f) => patch[f] as never), id, expectedVersion)
    return res.changes === 1
  }

  // ---- events -------------------------------------------------------------

  appendEvent(groupId: string, memberId: string | null, type: string, payload: unknown): EventRow {
    const res = this.sql
      .prepare(`INSERT INTO events (group_id, member_id, type, payload_json) VALUES (?, ?, ?, ?)`)
      .run(groupId, memberId, type, JSON.stringify(payload ?? {}))
    return this.sql
      .prepare(`SELECT * FROM events WHERE seq = ?`)
      .get(Number(res.lastInsertRowid)) as unknown as EventRow
  }

  eventsAfter(groupId: string, afterSeq: number): EventRow[] {
    return this.sql
      .prepare(`SELECT * FROM events WHERE group_id = ? AND seq > ? ORDER BY seq`)
      .all(groupId, afterSeq) as unknown as EventRow[]
  }

  countEvents(groupId: string, type: string, memberId: string | null): number {
    const row = memberId
      ? this.sql.prepare(`SELECT COUNT(*) c FROM events WHERE group_id = ? AND type = ? AND member_id = ?`).get(groupId, type, memberId)
      : this.sql.prepare(`SELECT COUNT(*) c FROM events WHERE group_id = ? AND type = ?`).get(groupId, type)
    return Number((row as { c: number }).c)
  }

  // ---- auction bids -------------------------------------------------------

  upsertBid(groupId: string, memberId: string, sku: string, amount: number): void {
    // A sealed bid can be revised until the window closes; only the latest counts.
    this.sql
      .prepare(`INSERT INTO auction_bids (group_id, member_id, sku, amount) VALUES (?, ?, ?, ?)`)
      .run(groupId, memberId, sku, amount)
  }

  bidsFor(groupId: string, sku: string): BidRow[] {
    return this.sql
      .prepare(`SELECT * FROM auction_bids WHERE group_id = ? AND sku = ? ORDER BY seq`)
      .all(groupId, sku) as unknown as BidRow[]
  }

  myBids(groupId: string, memberId: string): BidRow[] {
    return this.sql
      .prepare(`SELECT * FROM auction_bids WHERE group_id = ? AND member_id = ? ORDER BY seq`)
      .all(groupId, memberId) as unknown as BidRow[]
  }

  // ---- receipts -----------------------------------------------------------

  saveReceipt(groupId: string, receiptJson: string): void {
    this.sql
      .prepare(`INSERT OR REPLACE INTO receipts (group_id, receipt_json) VALUES (?, ?)`)
      .run(groupId, receiptJson)
  }

  getReceipt(groupId: string): string | undefined {
    const row = this.sql.prepare(`SELECT receipt_json FROM receipts WHERE group_id = ?`).get(groupId) as
      | { receipt_json: string }
      | undefined
    return row?.receipt_json
  }

  // ---- Shopify development-store proof ----------------------------------

  saveShopifyTestOrder(groupId: string, proofJson: string): void {
    this.sql
      .prepare(`INSERT OR REPLACE INTO shopify_test_orders (group_id, proof_json) VALUES (?, ?)`)
      .run(groupId, proofJson)
  }

  getShopifyTestOrder(groupId: string): string | undefined {
    const row = this.sql
      .prepare(`SELECT proof_json FROM shopify_test_orders WHERE group_id = ?`)
      .get(groupId) as { proof_json: string } | undefined
    return row?.proof_json
  }

  close(): void {
    this.sql.close()
  }
}
