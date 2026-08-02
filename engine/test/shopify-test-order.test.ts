import { describe, expect, it, vi } from 'vitest'
import { ShopifyTestOrderClient } from '../src/shopify/test-order.js'
import type { Cart, GroupRow, MemberRow } from '../src/types.js'

const cart: Cart = {
  currency: 'INR',
  items: [
    {
      sku: '456789',
      name: 'Demo backpack — Black',
      unit_amount: 60000,
      qty: 1,
      tier: 'core',
      claimants: ['mi_all'],
      contested: false,
    },
  ],
  fees: [],
}

const group = {
  id: 'g_demo',
  title: 'Demo backpack',
  merchant_json: JSON.stringify({ name: 'Sutra Demo', url: 'https://demo.example.com' }),
  cart_json: JSON.stringify(cart),
  cart_hash: 'abc123',
  currency: 'INR',
  policy_json: JSON.stringify({ type: 'all_of' }),
  tolerance_bps: 0,
  straggler_policy: 'halt_partial',
  no_blame: 0,
  deadline_at: new Date(Date.now() + 60_000).toISOString(),
  status: 'committed',
  decision_note: 'all approved',
  webhook_url: null,
  locked_json: null,
  created_by: 'u_owner',
  circle_id: null,
  product_json: null,
  auction_close_at: null,
  fx_json: null,
  rail: 'prava_mandates',
  origin: 'shopify_test',
  version: 1,
  created_at: new Date().toISOString(),
} satisfies GroupRow

function member(id: string, name: string, amount: number): MemberRow {
  return {
    id,
    group_id: group.id,
    display_name: name,
    user_id: null,
    role: 'payer',
    weight: 1,
    share_amount: amount,
    cap_amount: amount,
    backstop_cap: 0,
    sponsor_for: null,
    status: 'charged',
    prava_session_id: `ses_${id}`,
    prava_approval_url: null,
    prava_mandate_id: `mdt_${id}`,
    prava_charge_txn_id: `txn_${id}`,
    backstop_session_id: null,
    backstop_approval_url: null,
    backstop_mandate_id: null,
    backstop_absorbed: 0,
    requote_round: 0,
    failure_reason: null,
    charged_amount: amount,
    on_hold: 0,
    version: 1,
  }
}

describe('Shopify development-store proof', () => {
  it('creates a test order with one visibly labeled test transaction per charged member', async () => {
    let sent: Record<string, unknown> | null = null
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({
        data: {
          orderCreate: {
            userErrors: [],
            order: {
              id: 'gid://shopify/Order/9001',
              legacyResourceId: '9001',
              name: '#1001',
              test: true,
              displayFinancialStatus: 'PAID',
              totalPriceSet: { shopMoney: { amount: '600.00', currencyCode: 'INR' } },
              transactions: [{ id: 't1' }, { id: 't2' }],
            },
          },
        },
      })
    })
    const client = new ShopifyTestOrderClient({
      storeDomain: 'sutra-demo.myshopify.com',
      storefrontDomain: 'demo.example.com',
      accessToken: 'not-a-real-token',
      fetchImpl: fetchImpl as typeof fetch,
    })

    const proof = await client.create({
      group,
      cart,
      members: [member('maya', 'Maya', 30000), member('arjun', 'Arjun', 30000)],
      email: 'demo@example.com',
      shippingAddress: {
        first_name: 'Demo',
        last_name: 'Recipient',
        address1: '1 Test Road',
        city: 'Bengaluru',
        province_code: 'KA',
        country_code: 'IN',
        zip: '560001',
      },
    })

    expect(proof).toMatchObject({ test: true, transaction_count: 2, total_minor: 60000 })
    expect(sent).not.toBeNull()
    const variables = (sent as unknown as { variables: { order: Record<string, unknown> } }).variables
    const order = variables.order as {
      test: boolean
      shippingAddress: { city: string }
      transactions: { test: boolean; gateway: string; authorizationCode: string }[]
      lineItems: { variantId: string; priceSet: unknown }[]
    }
    expect(order.test).toBe(true)
    expect(order.shippingAddress.city).toBe('Bengaluru')
    expect(order.lineItems.at(0)?.variantId).toBe('gid://shopify/ProductVariant/456789')
    expect(order.transactions).toEqual([
      expect.objectContaining({ test: true, gateway: 'Sutra test · Maya', authorizationCode: 'txn_maya' }),
      expect.objectContaining({ test: true, gateway: 'Sutra test · Arjun', authorizationCode: 'txn_arjun' }),
    ])
  })

  it('refuses to manufacture a Shopify proof when test charges do not equal the cart', async () => {
    const client = new ShopifyTestOrderClient({
      storeDomain: 'sutra-demo.myshopify.com',
      accessToken: 'not-a-real-token',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })
    await expect(
      client.create({
        group,
        cart,
        members: [member('maya', 'Maya', 29999), member('arjun', 'Arjun', 30000)],
        email: 'demo@example.com',
        shippingAddress: {
          first_name: 'Demo',
          last_name: 'Recipient',
          address1: '1 Test Road',
          city: 'Bengaluru',
          country_code: 'IN',
          zip: '560001',
        },
      }),
    ).rejects.toThrow('test charges total 59999, but the cart total is 60000')
  })
})
