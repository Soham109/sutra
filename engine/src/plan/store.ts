import { ulid } from '../ids.js'
import type { Db } from '../db.js'
import type {
  PlanOptionRow,
  PlanParticipantRow,
  PlanRow,
  SignalKind,
  SignalRow,
} from './types.js'

// Persistence for the coordination phase.
//
// Signals are append-only for the same reason protocol events are: "when did
// Maya say she was free, and did that change after we picked the 9pm show" is
// a question the board has to answer honestly. Nothing here is ever UPDATEd —
// the latest row per (participant, kind) wins, and the history stays readable.

export const planId = () => `pl_${ulid()}`
export const participantId = () => `pp_${ulid()}`
export const optionId = () => `po_${ulid()}`

export function installPlanSchema(db: Db): void {
  db.sql.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      intent_text TEXT NOT NULL,
      kind TEXT NOT NULL,
      slots_json TEXT NOT NULL DEFAULT '{}',
      ask_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      chosen_option_id TEXT,
      group_id TEXT,
      rail TEXT NOT NULL DEFAULT 'prava_mandates',
      deadline_at TEXT NOT NULL,
      created_by TEXT,
      circle_id TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS plan_participants (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      user_id TEXT,
      display_name TEXT NOT NULL,
      contact TEXT,
      role TEXT NOT NULL DEFAULT 'guest',
      responded_at TEXT,
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pp_plan ON plan_participants(plan_id);
    CREATE INDEX IF NOT EXISTS idx_pp_user ON plan_participants(user_id);

    -- Append-only. The latest row per (participant, kind) is current; the rows
    -- behind it are how "she said 6pm, then changed to 8" stays auditable.
    CREATE TABLE IF NOT EXISTS plan_signals (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_plan ON plan_signals(plan_id, seq);

    CREATE TABLE IF NOT EXISTS plan_options (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      place_json TEXT,
      when_json TEXT,
      price_json TEXT,
      url TEXT,
      image_url TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_options_plan ON plan_options(plan_id);

    -- Plan-scoped timeline, mirroring the protocol's event log so the two
    -- halves of a story ("we decided" then "we paid") render as one thread.
    CREATE TABLE IF NOT EXISTS plan_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL,
      participant_id TEXT,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_events ON plan_events(plan_id, seq);
  `)
}

export class PlanStore {
  constructor(readonly db: Db) {}

  // ---- plans --------------------------------------------------------------

  insertPlan(p: Omit<PlanRow, 'version' | 'created_at'>): void {
    this.db.sql
      .prepare(
        `INSERT INTO plans (id, title, intent_text, kind, slots_json, ask_json, status,
           chosen_option_id, group_id, rail, deadline_at, created_by, circle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id, p.title, p.intent_text, p.kind, p.slots_json, p.ask_json, p.status,
        p.chosen_option_id, p.group_id, p.rail, p.deadline_at, p.created_by, p.circle_id,
      )
  }

  getPlan(id: string): PlanRow | undefined {
    return this.db.sql.prepare(`SELECT * FROM plans WHERE id = ?`).get(id) as PlanRow | undefined
  }

  /** Same compare-and-swap discipline as groups: concurrent responders race. */
  casPlan(id: string, expectedVersion: number, patch: Partial<PlanRow>): boolean {
    const fields = Object.keys(patch) as (keyof PlanRow)[]
    if (fields.length === 0) return true
    const sets = fields.map((f) => `${String(f)} = ?`).join(', ')
    const res = this.db.sql
      .prepare(`UPDATE plans SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`)
      .run(...fields.map((f) => patch[f] as never), id, expectedVersion)
    return res.changes === 1
  }

  nonTerminalPlans(): PlanRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM plans WHERE status NOT IN ('converted','cancelled','expired')`)
      .all() as unknown as PlanRow[]
  }

  /** Plans this user organised or was invited to, newest first. */
  plansFor(userId: string): PlanRow[] {
    return this.db.sql
      .prepare(
        `SELECT DISTINCT p.* FROM plans p
         LEFT JOIN plan_participants pp ON pp.plan_id = p.id
         WHERE p.created_by = ? OR pp.user_id = ?
         ORDER BY p.created_at DESC`,
      )
      .all(userId, userId) as unknown as PlanRow[]
  }

  // ---- participants -------------------------------------------------------

  insertParticipant(p: Omit<PlanParticipantRow, 'version'>): void {
    this.db.sql
      .prepare(
        `INSERT INTO plan_participants (id, plan_id, user_id, display_name, contact, role, responded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.id, p.plan_id, p.user_id, p.display_name, p.contact, p.role, p.responded_at)
  }

  participants(planId: string): PlanParticipantRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM plan_participants WHERE plan_id = ? ORDER BY rowid`)
      .all(planId) as unknown as PlanParticipantRow[]
  }

  participant(id: string): PlanParticipantRow | undefined {
    return this.db.sql.prepare(`SELECT * FROM plan_participants WHERE id = ?`).get(id) as
      | PlanParticipantRow
      | undefined
  }

  /** The seat this user holds in this plan, if any — used to resolve "me". */
  participantForUser(planId: string, userId: string): PlanParticipantRow | undefined {
    return this.db.sql
      .prepare(`SELECT * FROM plan_participants WHERE plan_id = ? AND user_id = ?`)
      .get(planId, userId) as PlanParticipantRow | undefined
  }

  casParticipant(id: string, expectedVersion: number, patch: Partial<PlanParticipantRow>): boolean {
    const fields = Object.keys(patch) as (keyof PlanParticipantRow)[]
    if (fields.length === 0) return true
    const sets = fields.map((f) => `${String(f)} = ?`).join(', ')
    const res = this.db.sql
      .prepare(
        `UPDATE plan_participants SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`,
      )
      .run(...fields.map((f) => patch[f] as never), id, expectedVersion)
    return res.changes === 1
  }

  // ---- signals ------------------------------------------------------------

  appendSignal(planId: string, participantId: string, kind: SignalKind, payload: unknown): SignalRow {
    const res = this.db.sql
      .prepare(
        `INSERT INTO plan_signals (plan_id, participant_id, kind, payload_json) VALUES (?, ?, ?, ?)`,
      )
      .run(planId, participantId, kind, JSON.stringify(payload))
    return this.db.sql
      .prepare(`SELECT * FROM plan_signals WHERE seq = ?`)
      .get(Number(res.lastInsertRowid)) as unknown as SignalRow
  }

  allSignals(planId: string): SignalRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM plan_signals WHERE plan_id = ? ORDER BY seq`)
      .all(planId) as unknown as SignalRow[]
  }

  /**
   * Current signals: the newest row per (participant, kind). Votes are the one
   * exception — a participant holds one vote per option, so they key on the
   * option id inside the payload rather than on kind alone.
   */
  currentSignals(planId: string): SignalRow[] {
    const latest = new Map<string, SignalRow>()
    for (const row of this.allSignals(planId)) {
      let key = `${row.participant_id}:${row.kind}`
      if (row.kind === 'vote') {
        const p = JSON.parse(row.payload_json) as { option_id?: string }
        key += `:${p.option_id ?? ''}`
      }
      latest.set(key, row)
    }
    return [...latest.values()].sort((a, b) => a.seq - b.seq)
  }

  // ---- options ------------------------------------------------------------

  insertOption(o: Omit<PlanOptionRow, 'created_at'>): void {
    this.db.sql
      .prepare(
        `INSERT INTO plan_options (id, plan_id, source, title, subtitle, place_json, when_json,
           price_json, url, image_url, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id, o.plan_id, o.source, o.title, o.subtitle, o.place_json, o.when_json,
        o.price_json, o.url, o.image_url, o.raw_json,
      )
  }

  options(planId: string): PlanOptionRow[] {
    return this.db.sql
      .prepare(`SELECT * FROM plan_options WHERE plan_id = ? ORDER BY rowid`)
      .all(planId) as unknown as PlanOptionRow[]
  }

  option(id: string): PlanOptionRow | undefined {
    return this.db.sql.prepare(`SELECT * FROM plan_options WHERE id = ?`).get(id) as
      | PlanOptionRow
      | undefined
  }

  /** Regenerating the board replaces the previous shortlist wholesale. */
  clearOptions(planId: string): void {
    this.db.sql.prepare(`DELETE FROM plan_options WHERE plan_id = ?`).run(planId)
  }

  // ---- events -------------------------------------------------------------

  appendEvent(planId: string, participantId: string | null, type: string, payload: unknown = {}) {
    const res = this.db.sql
      .prepare(
        `INSERT INTO plan_events (plan_id, participant_id, type, payload_json) VALUES (?, ?, ?, ?)`,
      )
      .run(planId, participantId, type, JSON.stringify(payload ?? {}))
    return this.db.sql
      .prepare(`SELECT * FROM plan_events WHERE seq = ?`)
      .get(Number(res.lastInsertRowid)) as unknown as {
      seq: number
      plan_id: string
      participant_id: string | null
      type: string
      payload_json: string
      created_at: string
    }
  }

  eventsAfter(planId: string, afterSeq: number) {
    return this.db.sql
      .prepare(`SELECT * FROM plan_events WHERE plan_id = ? AND seq > ? ORDER BY seq`)
      .all(planId, afterSeq) as unknown as {
      seq: number
      plan_id: string
      participant_id: string | null
      type: string
      payload_json: string
      created_at: string
    }[]
  }
}
