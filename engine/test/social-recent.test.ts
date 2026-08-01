import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { Social, installSocialSchema } from '../src/social.js'

// "Recently split with" only means something if it is read off groups that
// actually happened. This pins that recentCollaborators() walks a user's own
// groups newest-first and returns real co-members — never a stranger, never
// yourself, never a seat nobody linked to an account.

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  return { db, social: new Social(db) }
}

/** Minimal group + member rows — just enough for the walk to find. */
function seedGroup(db: Db, id: string, createdAt: string, memberUserIds: (string | null)[]) {
  db.sql
    .prepare(
      `INSERT INTO groups (id, title, merchant_json, cart_json, cart_hash, currency, policy_json,
        tolerance_bps, straggler_policy, deadline_at, status, created_at)
       VALUES (?, 'g', '{}', '{}', 'h', 'USD', '{}', 0, 'retry_once', '2099-01-01T00:00:00Z', 'draft', ?)`,
    )
    .run(id, createdAt)
  memberUserIds.forEach((uid, i) => {
    db.sql
      .prepare(
        `INSERT INTO members (id, group_id, display_name, role, status, user_id)
         VALUES (?, ?, 'seat', 'payer', 'invited', ?)`,
      )
      .run(`${id}_m${i}`, id, uid)
  })
}

describe('recentCollaborators', () => {
  it('ranks the most recently shared group first', () => {
    const { db, social } = world()
    const me = social.createUser({ handle: 'me', name: 'Me' })
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })

    seedGroup(db, 'g1', '2026-01-01T00:00:00Z', [me.id, a.id])
    seedGroup(db, 'g2', '2026-02-01T00:00:00Z', [me.id, b.id])

    expect(social.recentCollaborators(me.id)).toEqual([b.id, a.id])
  })

  it('a later group bumps someone you already saw back to the front', () => {
    const { db, social } = world()
    const me = social.createUser({ handle: 'me', name: 'Me' })
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })

    seedGroup(db, 'g1', '2026-01-01T00:00:00Z', [me.id, a.id])
    seedGroup(db, 'g2', '2026-02-01T00:00:00Z', [me.id, b.id])
    seedGroup(db, 'g3', '2026-03-01T00:00:00Z', [me.id, a.id])

    // a's most recent shared group (g3) is newer than b's (g2).
    expect(social.recentCollaborators(me.id)).toEqual([a.id, b.id])
  })

  it('never lists yourself or a seat with no linked account', () => {
    const { db, social } = world()
    const me = social.createUser({ handle: 'me', name: 'Me' })
    seedGroup(db, 'g1', '2026-01-01T00:00:00Z', [me.id, null])
    expect(social.recentCollaborators(me.id)).toEqual([])
  })

  it('a group you are not in contributes nobody', () => {
    const { db, social } = world()
    const me = social.createUser({ handle: 'me', name: 'Me' })
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    seedGroup(db, 'g1', '2026-01-01T00:00:00Z', [a.id, b.id])
    expect(social.recentCollaborators(me.id)).toEqual([])
  })
})
