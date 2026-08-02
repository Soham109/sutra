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
    const shown = publicUser(u) as unknown as Record<string, unknown>

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

  /**
   * The line this guard has to draw, and the line it must NOT draw.
   *
   * Attaching somebody's real account to your group without their consent is an
   * abuse vector: it would put your group in their dashboard and their name on
   * your split. That is refused.
   *
   * Seating a bare name is a completely different act and is allowed. It makes
   * a link-only participant — a URL, opened on a phone, no account, ever. That
   * is the pass-the-phone design, and it is the only reason splitting a
   * restaurant bill with somebody you met that evening works at all. An earlier
   * version of this check rejected bare names too, which read as a tightened
   * security rule and was actually deleting the product's commonest case.
   */
  it('refuses somebody else’s account, but never refuses a plain name', () => {
    const social = world()
    const me = social.createUser({ handle: 'a', name: 'A' })
    const friend = social.createUser({ handle: 'b', name: 'B' })
    const stranger = social.createUser({ handle: 'c', name: 'C' })
    social.requestFriend(me.id, friend.id)
    social.acceptFriend(friend.id, me.id)

    // A stranger's account cannot be dragged in.
    expect(() => social.assertSeatable(me.id, [{ name: 'C', user_id: stranger.id }])).toThrow(
      /aren’t friends yet/,
    )
    // Nor an id that does not exist at all.
    expect(() => social.assertSeatable(me.id, [{ name: 'X', user_id: 'us_nope' }])).toThrow(/no such person/)

    // You, and your friends, by account.
    expect(() =>
      social.assertSeatable(me.id, [
        { name: 'A', user_id: me.id },
        { name: 'B', user_id: friend.id },
      ]),
    ).not.toThrow()

    // And the person at the table with no account and no id at all.
    expect(() => social.assertSeatable(me.id, [{ name: 'Whoever was at dinner' }])).not.toThrow()
    expect(() =>
      social.assertSeatable(me.id, [{ name: 'Guest', user_id: null }, { name: 'B', user_id: friend.id }]),
    ).not.toThrow()
  })

  it('circles refuse non-friend members', () => {
    const social = world()
    const a = social.createUser({ handle: 'a', name: 'A' })
    const b = social.createUser({ handle: 'b', name: 'B' })
    expect(() => social.createCircle({ ownerId: a.id, name: 'crew', memberIds: [b.id] })).toThrow(
      /aren’t friends yet/,
    )
    social.requestFriend(a.id, b.id)
    social.acceptFriend(b.id, a.id)
    const circle = social.createCircle({ ownerId: a.id, name: 'crew', memberIds: [b.id] })
    expect(social.circleMembers(circle.id).map((u) => u.id).sort()).toEqual([a.id, b.id].sort())
  })
})
