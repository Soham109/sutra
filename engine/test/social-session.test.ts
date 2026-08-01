import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { installSocialSchema, Social } from '../src/social.js'

describe('companion sessions', () => {
  it('registers a password account without storing the plaintext password', () => {
    const db = new Db(':memory:')
    installSocialSchema(db)
    const social = new Social(db)
    const user = social.registerUser({ handle: 'cleo', name: 'Cleo', email: 'cleo@example.com', password: 'correct horse battery' })
    expect(social.authenticate('CLEO@example.com', 'correct horse battery')?.id).toBe(user.id)
    expect(social.authenticate('cleo@example.com', 'wrong password')).toBeUndefined()
    const row = db.sql.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string }
    expect(row.password_hash).toMatch(/^scrypt\$/)
    expect(row.password_hash).not.toContain('correct horse battery')
  })

  it('stores only a hash, resolves the account, and can be revoked', () => {
    const db = new Db(':memory:')
    installSocialSchema(db)
    const social = new Social(db)
    const user = social.createUser({ handle: 'ada', name: 'Ada' })
    const session = social.createSession(user.id, 'browser extension')

    expect(session.token).toMatch(/^sutra_session_/)
    expect(social.userForSession(session.token)?.id).toBe(user.id)
    const stored = db.sql.prepare('SELECT token_hash FROM user_sessions').get() as { token_hash: string }
    expect(stored.token_hash).not.toContain(session.token)
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/)

    expect(social.revokeSessions(user.id, 'browser extension')).toBe(1)
    expect(social.userForSession(session.token)).toBeUndefined()
  })
})
