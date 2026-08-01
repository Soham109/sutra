import type { Db } from '../db.js'
import type { StandingRules } from './rules.js'

// Persistence for the coordination layer's delegate rules.
//
// One human, one rule set — keyed by user id, the same identity every other
// signed-in surface in this engine uses (`currentUserFrom`, `social.ts`).
// There is deliberately no per-plan or per-participant override: a standing
// rule is a fact about the human, not about any one plan they happen to be
// in, so it travels with them from plan to plan the same way their name does.

export function installDelegateSchema(db: Db): void {
  db.sql.exec(`
    CREATE TABLE IF NOT EXISTS delegate_rules (
      user_id TEXT PRIMARY KEY,
      rules_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `)
}

export class DelegateStore {
  constructor(private readonly db: Db) {}

  setRules(userId: string, rules: StandingRules): void {
    // REPLACE rather than an UPDATE-then-INSERT dance: a standing rule set is
    // a single current snapshot, not a history — unlike plan signals, there is
    // no "she said X, then changed to Y" story anyone needs to read later.
    this.db.sql
      .prepare(`INSERT OR REPLACE INTO delegate_rules (user_id, rules_json) VALUES (?, ?)`)
      .run(userId, JSON.stringify(rules))
  }

  getRules(userId: string): StandingRules | undefined {
    const row = this.db.sql.prepare(`SELECT rules_json FROM delegate_rules WHERE user_id = ?`).get(userId) as
      | { rules_json: string }
      | undefined
    return row ? (JSON.parse(row.rules_json) as StandingRules) : undefined
  }
}
