import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { Social, installSocialSchema, publicUser } from '../src/social.js'

// What one person may learn about another, and what it takes to become their
// friend. Both of these were wrong in a way that only shows up when you read
// the actual HTTP response, so they are pinned here.

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  return new Social(db)
}

describe('what the directory exposes', () => {
  it('never carries an email or a password hash', () => {
    const social = world()
    const u = social.createUser({ handle: 'soham', name: 'Soham', email: 'soham@real.example' })
    const shown = publicUser(u) as Record<string, unknown>

    expect(shown.id).toBe(u.id)
    expect(shown.handle).toBe('soham')
    expect(shown.name).toBe('Soham')
    // The row out of SQLite carries both of these. The projection must not.
    expect('email' in shown).toBe(false)
    expect('password_hash' in shown).toBe(false)
  })

  /**
   * A projection built by deleting keys rots the moment somebody adds a
   * column. This asserts the shape is an allowlist: exactly four fields, no
   * more, whatever the row grows.
   */
  it('is an allowlist, not a blocklist', () => {
    const social = world()
    const u = social.createUser({ handle: 'arsh', name: 'Arsh' })
    expect(Object.keys(publicUser(u)).sort()).toEqual(['accent', 'handle', 'id', 'name'])
  })
})

describe('becoming someone’s friend', () => {
  it('is a request, not a fait accompli', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })

    expect(social.requestFriend(a.id, b.id)).toBe('requested')
    // Nobody is anybody's friend until the other person says so.
    expect(social.friendsOf(a.id)).toHaveLength(0)
    expect(social.friendsOf(b.id)).toHaveLength(0)
    expect(social.incomingRequests(b.id).map((u) => u.id)).toEqual([a.id])
    expect(social.outgoingRequests(a.id).map((u) => u.id)).toEqual([b.id])
  })

  it('accepting makes it mutual and clears the request', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    social.requestFriend(a.id, b.id)

    expect(social.acceptFriend(b.id, a.id)).toBe(true)
    expect(social.friendsOf(a.id).map((u) => u.id)).toEqual([b.id])
    expect(social.friendsOf(b.id).map((u) => u.id)).toEqual([a.id])
    expect(social.incomingRequests(b.id)).toHaveLength(0)
  })

  it('you cannot accept a request nobody sent', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    expect(social.acceptFriend(b.id, a.id)).toBe(false)
    expect(social.friendsOf(b.id)).toHaveLength(0)
  })

  /** Pressing "add" on somebody already waiting on you obviously means yes. */
  it('a crossing request resolves to friendship rather than a deadlock', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    social.requestFriend(a.id, b.id)
    expect(social.requestFriend(b.id, a.id)).toBe('friends')
    expect(social.areFriends(a.id, b.id)).toBe(true)
    expect(social.incomingRequests(a.id)).toHaveLength(0)
    expect(social.incomingRequests(b.id)).toHaveLength(0)
  })

  it('declining removes the ask and creates nothing', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    social.requestFriend(a.id, b.id)
    social.declineFriend(b.id, a.id)
    expect(social.incomingRequests(b.id)).toHaveLength(0)
    expect(social.areFriends(a.id, b.id)).toBe(false)
  })

  it('unfriending is symmetric', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    social.requestFriend(a.id, b.id)
    social.acceptFriend(b.id, a.id)
    social.removeFriend(a.id, b.id)
    expect(social.friendsOf(a.id)).toHaveLength(0)
    expect(social.friendsOf(b.id)).toHaveLength(0)
  })
})
