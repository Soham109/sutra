import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner, verifyReceipt, type Receipt } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { CreateGroupSchema } from '../src/types.js'

process.env.GMP_NO_FX = '1'

// `gmp verify` (cli/src/gmp.ts) used to pin against whichever engine answered
// at GMP_API, which defaults to localhost:4100 — so a judge verifying a
// downloaded PRODUCTION receipt with an unrelated local dev engine running
// would get "VERIFICATION FAILED" on a completely genuine receipt, with
// nothing to say that the receipt itself was fine and the CLI had simply
// been pointed at the wrong engine. `verifyReceipt`'s `wrongEngineOnly` flag
// is the fix: it is true exactly when the receipt is otherwise sound — chain
// intact, totals consistent, rail-honest, signature valid — and the ONLY
// finding is a public_key that does not match what the caller expected.
// These pin that flag directly, independent of how the CLI presents it.

function world() {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const prava = new MockPrava('http://test.local')
  const signer = new ReceiptSigner('11'.repeat(32))
  const service = new GroupService(db, prava, hub, signer, {
    appBaseUrl: 'http://test.local',
  })
  return { db, prava, service, signer }
}

async function genuineReceipt(w: ReturnType<typeof world>): Promise<Receipt> {
  const { group, members } = w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Shopify group purchase',
      merchant: { id: 'shop', name: 'Example Shop', url: 'https://shop.example.com' },
      cart: { items: [{ sku: 'gift', name: 'Gift', unit_amount: 12000, qty: 1 }], currency: 'USD' },
      members: [{ name: 'Soham' }, { name: 'Arsh' }],
      rail: 'shopify_pos',
      origin: 'discover',
    }),
  )
  for (const member of members) {
    await w.service.openMember(member.id)
    await w.service.acceptShare(member.id)
  }
  return JSON.parse(w.db.getReceipt(group.id)!) as Receipt
}

describe('verifyReceipt — wrongEngineOnly', () => {
  it('is false, and the receipt verifies clean, when no key is pinned', async () => {
    const w = world()
    const receipt = await genuineReceipt(w)
    const result = verifyReceipt(receipt)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.wrongEngineOnly).toBe(false)
  })

  it('is false, and the receipt verifies clean, when pinned to the RIGHT key', async () => {
    const w = world()
    const receipt = await genuineReceipt(w)
    const result = verifyReceipt(receipt, { expectedPublicKey: w.signer.publicKeyHex })
    expect(result.ok).toBe(true)
    expect(result.wrongEngineOnly).toBe(false)
  })

  /** The exact scenario that used to read as "VERIFICATION FAILED". */
  it('is true — not a generic failure — when the receipt is genuine but pinned to a DIFFERENT engine', async () => {
    const w = world()
    const receipt = await genuineReceipt(w)
    const otherEngine = new ReceiptSigner('22'.repeat(32))

    const result = verifyReceipt(receipt, { expectedPublicKey: otherEngine.publicKeyHex })
    expect(result.ok).toBe(false)
    expect(result.wrongEngineOnly).toBe(true)
    expect(result.errors).toEqual(['public_key does not match the known engine signing key'])
  })

  /**
   * A receipt that is BOTH tampered AND checked against the wrong key must
   * never collapse into the same "just the wrong engine" verdict — that
   * would let a real forgery hide behind an unrelated key mismatch.
   */
  it('stays false when the receipt is actually broken, even alongside a key mismatch', async () => {
    const w = world()
    const receipt = await genuineReceipt(w)
    const otherEngine = new ReceiptSigner('22'.repeat(32))

    const tampered: Receipt = structuredClone(receipt)
    tampered.entries[0]!.charged_amount = 999_999
    tampered.totals.charged = 999_999

    const result = verifyReceipt(tampered, { expectedPublicKey: otherEngine.publicKeyHex })
    expect(result.ok).toBe(false)
    expect(result.wrongEngineOnly).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })

  it('a bare forgery with no key pinned is a normal failure, not a wrong-engine finding', async () => {
    const w = world()
    const receipt = await genuineReceipt(w)
    const tampered: Receipt = structuredClone(receipt)
    tampered.chain_head = 'not-the-real-head'

    const result = verifyReceipt(tampered)
    expect(result.ok).toBe(false)
    expect(result.wrongEngineOnly).toBe(false)
  })
})
