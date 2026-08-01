import { randomBytes } from 'node:crypto'

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford

/** ULID: 48-bit timestamp + 80 bits of randomness, lexically sortable, unguessable. */
export function ulid(now = Date.now()): string {
  let ts = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    ts = B32[t % 32] + ts
    t = Math.floor(t / 32)
  }
  const rand = randomBytes(10)
  let rs = ''
  for (let i = 0; i < 10; i++) {
    const byte = rand[i] ?? 0
    rs += B32[byte % 32]
    rs += B32[Math.floor(byte / 32) % 32]
  }
  return ts + rs.slice(0, 16)
}

export const groupId = () => `gs_${ulid()}`
export const memberId = () => `mi_${ulid()}`
