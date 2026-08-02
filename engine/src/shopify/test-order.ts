import type { Cart, GroupRow, MemberRow } from '../types.js'
import { cartTotal, toDecimalString } from '../types.js'

/**
 * A deliberately test-only Shopify bridge.
 *
 * This does not pretend that Shopify Checkout accepted several cards. It
 * mirrors already-completed Sutra/Prava *test* charges into one genuine
 * Shopify development-store order, with `test: true` on both the order and
 * every transaction. The artifact is useful demo evidence because Shopify
 * can independently display the order, line item, address and transaction
 * breakdown without a cent moving.
 */

export interface ShopifyTestAddress {
  first_name: string
  last_name: string
  address1: string
  address2?: string
  city: string
  province_code?: string
  country_code: string
  zip: string
  phone?: string
}

export interface ShopifyTestOrderProof {
  order_id: string
  order_name: string
  admin_url: string
  store_domain: string
  test: true
  financial_status: string
  total_minor: number
  currency: string
  transaction_count: number
  group_id: string
  created_at: string
  disclosure: string
}

interface ShopifyTestOrderConfig {
  storeDomain: string
  storefrontDomain?: string
  accessToken: string
  apiVersion?: string
  fetchImpl?: typeof fetch
}

interface CreateInput {
  group: GroupRow
  cart: Cart
  members: MemberRow[]
  email: string
  shippingAddress: ShopifyTestAddress
}

interface GraphQlEnvelope {
  data?: {
    orderCreate?: {
      userErrors: { field?: string[]; message: string }[]
      order: {
        id: string
        legacyResourceId: string
        name: string
        test: boolean
        displayFinancialStatus: string
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } }
        transactions: { id: string }[]
      } | null
    }
  }
  errors?: { message: string }[]
}

const ORDER_CREATE = `
  mutation SutraCreateTestOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      userErrors { field message }
      order {
        id
        legacyResourceId
        name
        test
        displayFinancialStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        transactions { id }
      }
    }
  }
`

export class ShopifyTestOrderClient {
  readonly storeDomain: string
  readonly storefrontDomain: string
  private readonly accessToken: string
  private readonly apiVersion: string
  private readonly fetchImpl: typeof fetch

  constructor(config: ShopifyTestOrderConfig) {
    this.storeDomain = normaliseHost(config.storeDomain)
    this.storefrontDomain = normaliseHost(config.storefrontDomain || config.storeDomain)
    this.accessToken = config.accessToken
    this.apiVersion = config.apiVersion ?? '2026-07'
    this.fetchImpl = config.fetchImpl ?? fetch
    if (!this.storeDomain.endsWith('.myshopify.com')) {
      throw new Error('SHOPIFY_TEST_STORE must be the store\'s *.myshopify.com domain')
    }
  }

  matchesMerchant(merchant: { url: string }): boolean {
    try {
      return normaliseHost(new URL(merchant.url).hostname) === this.storefrontDomain
    } catch {
      return false
    }
  }

  async create(input: CreateInput): Promise<ShopifyTestOrderProof> {
    const { group, cart, members } = input
    const charged = members.filter((member) => member.charged_amount > 0)
    const expected = cartTotal(cart)
    const chargedTotal = charged.reduce((sum, member) => sum + member.charged_amount, 0)
    if (charged.length === 0 || chargedTotal !== expected) {
      throw new Error(`test charges total ${chargedTotal}, but the cart total is ${expected}`)
    }

    const money = (minor: number) => ({
      shopMoney: { amount: toDecimalString(minor), currencyCode: group.currency },
    })
    const lineItems = cart.items.map((item) => ({
      ...(allDigits(item.sku) ? { variantId: `gid://shopify/ProductVariant/${item.sku}` } : {}),
      title: item.name,
      sku: item.sku,
      quantity: item.qty,
      priceSet: money(item.unit_amount),
      requiresShipping: true,
      taxable: false,
      properties: [{ name: 'Sutra group', value: group.id }],
    }))
    const feeLines = cart.fees.map((fee, index) => ({
      title: fee.name,
      sku: `sutra-fee-${index + 1}`,
      quantity: 1,
      priceSet: money(fee.amount),
      requiresShipping: false,
      taxable: false,
      properties: [{ name: 'Sutra group', value: group.id }],
    }))
    const address = {
      firstName: input.shippingAddress.first_name,
      lastName: input.shippingAddress.last_name,
      address1: input.shippingAddress.address1,
      ...(input.shippingAddress.address2 ? { address2: input.shippingAddress.address2 } : {}),
      city: input.shippingAddress.city,
      ...(input.shippingAddress.province_code ? { provinceCode: input.shippingAddress.province_code } : {}),
      countryCode: input.shippingAddress.country_code.toUpperCase(),
      zip: input.shippingAddress.zip,
      ...(input.shippingAddress.phone ? { phone: input.shippingAddress.phone } : {}),
    }

    const variables = {
      order: {
        test: true,
        currency: group.currency,
        email: input.email,
        shippingAddress: address,
        billingAddress: address,
        lineItems: [...lineItems, ...feeLines],
        transactions: charged.map((member) => ({
          kind: 'SALE',
          status: 'SUCCESS',
          test: true,
          // Shopify Admin renders the gateway on each transaction, so the
          // independently visible proof names whose capped test share this is.
          gateway: `Sutra test · ${member.display_name}`,
          authorizationCode: member.prava_charge_txn_id ?? `sutra-${member.id}`,
          amountSet: money(member.charged_amount),
          receiptJson: {
            sutra_group_id: group.id,
            sutra_member_id: member.id,
            sutra_participant: member.display_name,
            sutra_cart_hash: group.cart_hash,
            test_only: true,
          },
        })),
        note:
          `Sutra development-store proof for ${group.id}. TEST ONLY: these transaction records mirror ` +
          'Sutra/Prava test outcomes; they are not Shopify Checkout card captures.',
        sourceIdentifier: group.id,
        sourceName: 'sutra-test-proof',
        customAttributes: [
          { key: 'sutra_group_id', value: group.id },
          { key: 'sutra_cart_hash', value: group.cart_hash },
          { key: 'test_only', value: 'true' },
        ],
      },
      options: { sendReceipt: false, inventoryBehaviour: 'BYPASS' },
    }

    const response = await this.fetchImpl(
      `https://${this.storeDomain}/admin/api/${this.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': this.accessToken,
        },
        body: JSON.stringify({ query: ORDER_CREATE, variables }),
        signal: AbortSignal.timeout(20_000),
      },
    )
    if (!response.ok) throw new Error(`Shopify Admin API returned HTTP ${response.status}`)
    const envelope = (await response.json()) as GraphQlEnvelope
    if (envelope.errors?.length) throw new Error(envelope.errors.map((error) => error.message).join('; '))
    const payload = envelope.data?.orderCreate
    if (payload?.userErrors.length) {
      throw new Error(payload.userErrors.map((error) => error.message).join('; '))
    }
    const order = payload?.order
    if (!order) throw new Error('Shopify did not return the created order')
    if (!order.test) throw new Error('Shopify created an order without the required test flag')

    const returnedTotal = Math.round(Number(order.totalPriceSet.shopMoney.amount) * 100)
    if (returnedTotal !== expected) {
      throw new Error(`Shopify order ${order.name} totals ${returnedTotal}; Sutra approved ${expected}`)
    }
    if (order.transactions.length !== charged.length) {
      throw new Error(
        `Shopify order ${order.name} has ${order.transactions.length} test transactions; expected ${charged.length}`,
      )
    }

    return {
      order_id: order.id,
      order_name: order.name,
      admin_url: `https://${this.storeDomain}/admin/orders/${order.legacyResourceId}`,
      store_domain: this.storeDomain,
      test: true,
      financial_status: order.displayFinancialStatus,
      total_minor: returnedTotal,
      currency: order.totalPriceSet.shopMoney.currencyCode,
      transaction_count: order.transactions.length,
      group_id: group.id,
      created_at: new Date().toISOString(),
      disclosure:
        'Valid Shopify test order with test transaction records. No real money moved, and this is not evidence that Shopify Checkout accepted several cards.',
    }
  }
}

function normaliseHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

function allDigits(value: string): boolean {
  return /^\d+$/.test(value)
}
