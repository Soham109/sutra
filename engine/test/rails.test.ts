import { beforeEach, describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner, verifyReceipt, type Receipt } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { CreateGroupSchema, isSettled } from '../src/types.js'
import { capabilityOf, railFor } from '../src/rails.js'

process.env.GMP_NO_FX = '1'

// The at_venue rail exists so that a restaurant bill — which has no merchant
// Prava can charge — can still be allocated and agreed honestly. The whole
// point is that it must be IMPOSSIBLE for this path to produce an artifact
// claiming money moved. These tests are that guarantee.

function world() {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'test-secret')
  const prava = new MockPrava('http://test.local')
  const service = new GroupService(db, prava, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  return { db, prava, service }
}

function billGroup(w: ReturnType<typeof world>) {
  return w.service.createGroup(
    CreateGroupSchema.parse({
      title: 'Toit — the bill',
      merchant: { id: 'bill', name: 'Toit, Indiranagar', url: 'https://venue.local.test' },
      cart: {
        items: [
          { sku: 'b-0', name: 'Margherita', unit_amount: 38000, qty: 2, claimants: ['mi_all'] },
          { sku: 'b-1', name: 'Paneer Tikka', unit_amount: 38000, qty: 1, claimants: ['Arsh'] },
        ],
        fees: [{ name: 'GST', amount: 5700 }],
        currency: 'INR',
      },
      members: [{ name: 'Soham' }, { name: 'Arsh' }],
      policy: { type: 'all_of' },
      tolerance_bps: 0,
      rail: 'at_venue',
      origin: 'bill',
    }),
  )
}

describe('rail selection', () => {
  it('a real merchant URL proves discovery, not a payment adapter', () => {
    expect(railFor({ merchantUrl: 'https://velvet.example.com' })).toBe('checkout_handoff')
  })

  it('no merchant, a .test placeholder, or localhost cannot be charged', () => {
    expect(railFor({ merchantUrl: '' })).toBe('at_venue')
    expect(railFor({ merchantUrl: 'https://venue.local.test' })).toBe('at_venue')
    expect(railFor({ merchantUrl: 'http://localhost:3000' })).toBe('at_venue')
    expect(railFor({ merchantUrl: 'not a url' })).toBe('at_venue')
  })

  it('an explicit request always wins over inference', () => {
    expect(railFor({ merchantUrl: 'https://velvet.example.com', requested: 'at_venue' })).toBe('at_venue')
    expect(railFor({ merchantUrl: 'https://shop.example.com', requested: 'shopify_pos' })).toBe('shopify_pos')
    expect(railFor({ merchantUrl: 'https://shop.example.com', requested: 'checkout_handoff' })).toBe('checkout_handoff')
  })

  it('the two rails never share a verb', () => {
    expect(capabilityOf('prava_mandates').settled_verb).not.toBe(capabilityOf('at_venue').settled_verb)
    expect(capabilityOf('at_venue').charges).toBe(false)
    expect(capabilityOf('at_venue').mandates).toBe(false)
  })

  it('POS and checkout handoff are explicitly non-charging capabilities', () => {
    expect(capabilityOf('shopify_pos')).toMatchObject({ charges: false, mandates: false })
    expect(capabilityOf('checkout_handoff')).toMatchObject({ charges: false, mandates: false })
    expect(capabilityOf('shopify_pos').settled_verb).not.toBe(capabilityOf('checkout_handoff').settled_verb)
  })
})

describe.each([
  ['shopify_pos', 'ready_for_shopify_pos'],
  ['checkout_handoff', 'approved_for_checkout'],
] as const)('%s agreement', (rail, outcome) => {
  it('creates no mandate, moves no money, and signs the honest next step', async () => {
    const w = world()
    const { group, members } = w.service.createGroup(
      CreateGroupSchema.parse({
        title: 'Shopify group purchase',
        merchant: { id: 'shop', name: 'Example Shop', url: 'https://shop.example.com' },
        cart: { items: [{ sku: 'gift', name: 'Gift', unit_amount: 12000, qty: 1 }], currency: 'USD' },
        members: [{ name: 'Soham' }, { name: 'Arsh' }],
        rail,
        origin: 'discover',
      }),
    )
    for (const member of members) {
      await w.service.openMember(member.id)
      await w.service.acceptShare(member.id)
    }
    const receipt = JSON.parse(w.db.getReceipt(group.id)!) as Receipt
    expect(w.prava.debugState().mandates).toHaveLength(0)
    expect(w.prava.debugState().charges).toHaveLength(0)
    expect(receipt.totals.charged).toBe(0)
    expect(receipt.entries.every((entry) => entry.outcome === outcome)).toBe(true)
    expect(verifyReceipt(receipt).ok).toBe(true)
  })
})

describe('at_venue settlement', () => {
  let w: ReturnType<typeof world>
  beforeEach(() => {
    w = world()
  })

  it('mints no Prava session, because there is nothing to scope a mandate to', async () => {
    const { members } = billGroup(w)
    const m = await w.service.openMember(members[0]!.id)
    expect(m.status).toBe('awaiting_approval')
    expect(m.prava_session_id).toBeNull()
    expect(m.prava_approval_url).toBeNull()
    expect(w.prava.debugState().mandates).toHaveLength(0)
  })

  it('accepting every share commits the group and charges nobody', async () => {
    const { group, members } = billGroup(w)
    for (const m of members) {
      await w.service.openMember(m.id)
      await w.service.acceptShare(m.id)
    }
    expect(w.service.mustGroup(group.id).status).toBe('committed')
    for (const m of w.db.membersOf(group.id)) {
      expect(m.status).toBe('settled')
      expect(isSettled(m.status)).toBe(true)
      expect(m.charged_amount).toBe(0)
    }
    // The engine never spoke to Prava at all on this rail.
    expect(w.prava.debugState().charges).toHaveLength(0)
  })

  it('refuses an accept on the card rail — the two acts are not interchangeable', async () => {
    const { members } = w.service.createGroup(
      CreateGroupSchema.parse({
        title: 'Tickets',
        merchant: { id: 'v', name: 'Velvet', url: 'https://velvet.example.com' },
        cart: { items: [{ sku: 'ga', name: 'GA', unit_amount: 4500, qty: 2 }], currency: 'USD' },
        members: [{ name: 'Soham' }, { name: 'Arsh' }],
        rail: 'prava_mandates',
      }),
    )
    await w.service.openMember(members[0]!.id)
    await expect(w.service.acceptShare(members[0]!.id)).rejects.toThrow(/card mandate/i)
  })

  it('the receipt says settled_at_venue, owes the full amount, and charges nothing', async () => {
    const { group, members } = billGroup(w)
    for (const m of members) {
      await w.service.openMember(m.id)
      await w.service.acceptShare(m.id)
    }
    const receipt = JSON.parse(w.db.getReceipt(group.id)!) as Receipt

    expect(receipt.rail).toBe('at_venue')
    expect(receipt.totals.charged).toBe(0)
    expect(receipt.totals.owed).toBe(119700)
    expect(receipt.entries.every((e) => e.outcome === 'settled_at_venue')).toBe(true)
    expect(receipt.entries.every((e) => e.charged_amount === 0)).toBe(true)
    expect(receipt.settlement_disclosure).toMatch(/no card is charged/i)
    expect(verifyReceipt(receipt).ok).toBe(true)
  })

  it('shares still sum exactly to the bill', async () => {
    const { group, members } = billGroup(w)
    for (const m of members) {
      await w.service.openMember(m.id)
      await w.service.acceptShare(m.id)
    }
    const total = w.db.membersOf(group.id).reduce((s, m) => s + m.share_amount, 0)
    expect(total).toBe(38000 * 2 + 38000 + 5700)
  })

  /**
   * The forgery this whole design exists to make detectable: an at_venue
   * receipt doctored to claim a card was charged. The signature would already
   * catch a tampered document, but the rule is checked independently so that
   * even a receipt signed by a compromised engine cannot assert a charge on a
   * rail that structurally cannot make one.
   */
  it('rejects an at_venue receipt that claims money moved', async () => {
    const { group, members } = billGroup(w)
    for (const m of members) {
      await w.service.openMember(m.id)
      await w.service.acceptShare(m.id)
    }
    const receipt = JSON.parse(w.db.getReceipt(group.id)!) as Receipt

    const forged: Receipt = structuredClone(receipt)
    forged.entries[0]!.charged_amount = 59850
    forged.totals.charged = 59850

    const result = verifyReceipt(forged)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /at_venue receipt reports a charged amount/i.test(e))).toBe(true)
  })

  it('rejects a receipt signed with a different key when pinned', () => {
    const signer = new ReceiptSigner('11'.repeat(32))
    const other = new ReceiptSigner('22'.repeat(32))
    const forged = other.sign({
      gmp_version: 'GMP/1',
      group_id: 'grp_test',
      title: 'Test',
      merchant: { id: 'm', name: 'Test', url: 'https://example-merchant.test', country_code_iso2: 'IN' },
      currency: 'INR',
      cart_hash: 'abc',
      policy: { type: 'all_of' },
      decision_narrative: 'test',
      status: 'committed',
      rail: 'at_venue',
      settlement_disclosure: 'owed at venue',
      totals: { quoted: 0, charged: 0, owed: 0 },
      entries: [],
      chain_head: 'GENESIS',
      issued_at: new Date().toISOString(),
    })
    const result = verifyReceipt(forged, { expectedPublicKey: signer.publicKeyHex })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => /does not match the known engine/i.test(e))).toBe(true)
  })
})
