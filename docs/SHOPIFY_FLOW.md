# Shopify flow, test proof and production boundary

## Capability map

Shopify, Prava and Sutra are separate layers. A capability in one does not silently grant a
capability in another.

| Surface | Built now | Boundary |
|---|---|---|
| Public Shopify shelf | Searches configured storefronts and resolves public title, variant, price, currency, image and stock signals | Best-effort public data; not an authenticated cart or universal Shopify search |
| Browser extension | After a click, imports the active product/cart facts using page markup and Shopify cart data when available | Load-unpacked; cannot inherit login, enter checkout, address or payment, or place an order |
| Sutra group | Exact item/fee allocation, roles, policies, individual consent and signed evidence | A product URL is not proof that the merchant supports group payment |
| Shopify POS handoff | Prepares exact agreed amounts for a cashier who uses Shopify's split-payment UI | No terminal connection, payment observation or Shopify receipt in Sutra |
| Online handoff | Returns the group to authenticated merchant checkout | The merchant owns address, shipping, tax, payment, order and fulfilment; one card may still front the total |
| Development-store proof | Mirrors completed Sutra **test** outcomes into one valid Shopify Admin order with `test: true`, a labeled test transaction per participant and a delivery address | Test-only Admin API artifact; no real money and not Shopify multi-card Checkout |
| Future production adapter | Stable quote, N real captures and one reconciled merchant order | Designed path, not a shipped production Shopify integration |

## One-person purchases still work

GMP/1 does not require two people. With one payer, the extension can import one product or a full cart and Sutra creates a one-person decision. On an ordinary store this remains a checkout handoff. On the configured development store it becomes one valid Shopify test order with one labeled test transaction. On a verified Prava merchant rail it becomes one capped credential. The extension itself never presses checkout or inherits payment authority.

## Discovery and extension flow

### In-app shelf

The catalog queries a configured list of public Shopify storefronts. A result retains merchant,
product URL, variant, price, currency, stock signal, source strategy and confidence. The user must
still verify the final variant and amount.

The development store is automatically placed on this shelf when its adapter is configured.
`SHOPIFY_DOMAINS` can override the complete shelf.

### Active-page import

The load-unpacked Chrome extension gets page access only after the user invokes it. The shared
detector tries Shopify cart data, JSON-LD, Shopify metadata, microdata, selected text, OpenGraph
and visible totals. It can therefore bring the current product/cart into Sutra even when that
merchant is not on the in-app shelf.

That broader **detection** coverage is not broader **ordering** coverage. The extension stores no
merchant password, receives no Prava or engine master key, and cannot perform the merchant's
authenticated checkout.

## Participant consent before any Shopify handoff

1. The organizer verifies product, variant, quantity and displayed price.
2. They assign line items and enter known fees. Fees are allocated in minor units, pro-rata to
   claimed item value.
3. They choose payer, sponsor, backstop or observer roles and a group policy such as `all_of`,
   quorum, weighted threshold, required member or veto.
4. Every participant sees their own items, share, cap, cart hash, policy and rail disclosure.
5. Planning signals never authorize payment. Consent occurs only on the participant approval
   surface.
6. If tax, shipping, inventory or price changes, the old approval is not permission for the new
   amount. Correct the cart and collect fresh consent.

## Path A — cashier-operated Shopify POS

Use this only when the group will visit a physical location and that specific location confirms
that Shopify POS split payments are enabled.

1. Choose **Split at Shopify POS** in Sutra and collect confirmations.
2. The Sutra receipt closes as **ready for Shopify POS**, with `charged_amount = 0`.
3. The cashier builds the real cart and confirms the final total.
4. For carry-out, no delivery address is needed. For shipping, the cashier selects/adds the
   customer, enters the address and chooses the shipping method in Shopify POS.
5. The cashier selects split payment, enters each amount and takes each person's payment method.
6. The Shopify order/receipt—not the Sutra agreement—is the evidence that payment completed.

Sutra does not connect to the terminal, transmit a cart, present a Prava credential or observe
the POS transaction. Refund, exchange, inventory and fulfilment remain merchant operations.

Shopify documents [multiple payments in Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/payment-management/multiple-partial-payments)
and [ship-to-customer orders from POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/add-shipping).
Ship-to-customer currently depends on Shopify POS Pro, permissions and configured shipping.

## Path B — ordinary online checkout handoff

1. Sutra records the proposed split and issues an **approved for checkout** receipt with zero
   charged.
2. The organizer returns to the merchant's authenticated checkout.
3. The chosen recipient enters delivery address and fulfilment choice.
4. Shopify computes final shipping, tax and discounts, then accepts payment and places the order.

Sutra neither supplies nor stores the delivery address on this path. Equal contribution does not
choose the recipient, legal owner, return contact or delivery destination; the group must decide
those explicitly.

A one-card online form does not become multi-payer because Sutra calculated several shares. One
person may still have to front the total unless a compatible production merchant adapter exists.

## Path C — Shopify development-store proof

This bridge exists to prove the proposed order mapping in a real merchant system without making
a false payment claim. It uses Shopify's [`orderCreate` Admin GraphQL mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreate),
whose input supports test orders, addresses and transaction records. Shopify separately defines
the transaction-level [`test` flag](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/OrderCreateOrderTransactionInput).

### What the bridge writes

- one Shopify order with `test: true`;
- the approved cart lines and explicit Sutra fee lines;
- the supplied shipping and billing address;
- one `SALE` / `SUCCESS` transaction per charged **test** participant, each with `test: true`;
- a test gateway label, authorization reference, Sutra group/member IDs, cart hash and
  `test_only: true` receipt metadata;
- order note, source and custom attributes that say it is a Sutra development-store proof.

The adapter disables customer receipts and bypasses inventory behavior. It does not run Shopify
Checkout, calculate merchant shipping/tax/discount rules, capture a card, fulfil inventory or
send a customer email. A Shopify **Paid / Test** presentation is test-ledger state, not real
settlement.

### Server gates

The proof endpoint refuses to run unless all of these are true:

- `SHOPIFY_TEST_ORDER_ENABLED=true` and the store/token are configured;
- Prava is `mock` or sandbox, never production;
- the group uses `origin = shopify_test` and `rail = prava_mandates`;
- the product merchant exactly matches the configured development storefront;
- the group is committed and its test charged total exactly equals the cart total;
- the caller is the organizer or holds the engine operator token.

After Shopify responds, Sutra verifies that the returned order is test-only, its total matches and
its transaction count equals the number of test-charged participants. Sutra persists only the
non-sensitive proof summary; the submitted address is sent to Shopify but is not stored in the
Sutra database.

The saved proof makes normal retries return the same order reference, and an in-process lock
blocks concurrent creation. It is still a demo adapter: a process crash after Shopify creates the
order but before Sutra saves the proof could create a duplicate on retry. Do not claim production
order idempotency from this bridge.

### Configure the development store

1. Create a Shopify development store and a product with at least one active variant.
2. Create/install a custom app with an **offline Admin API token** and `write_orders` scope.
   Enable the protected customer-data access required to write a shipping address in the store.
3. Use a fictional demo recipient and address. Never put a real participant's address on screen.
4. Add these values to the root `.env` and restart the engine:

```dotenv
PRAVA_ENV=mock
SHOPIFY_TEST_ORDER_ENABLED=true
SHOPIFY_TEST_STORE=your-store.myshopify.com
SHOPIFY_STOREFRONT_DOMAIN=your-public-storefront.example
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_redacted
SHOPIFY_API_VERSION=2026-07
SHOPIFY_DOMAINS=your-public-storefront.example,allbirds.com,gymshark.com
```

`SHOPIFY_STOREFRONT_DOMAIN` must match the host on the imported product URL. Never record or print
the Admin token.

5. Verify the gate before creating demo state:

```bash
curl -s http://localhost:4100/v1/shopify-test/status
```

The response must say `enabled: true`, show the intended store/front-end domains, identify a
non-production adapter, and disclose that no real money moves.

6. In **Find**, select a product from the configured storefront. Choose the finish line
   **Create a valid Shopify test order**, add the group and complete every Sutra/Prava test
   approval. On the committed group board, fill the fictional address form and click
   **Create valid Shopify test order**.

The board uses the endpoint below. The equivalent operator request is useful for diagnosis, not
for the final recording:

```bash
curl -sS -X POST http://localhost:4100/v1/groups/GROUP_ID/shopify-test-order \
  -H 'Authorization: Bearer dev-token' \
  -H 'Content-Type: application/json' \
  --data '{
    "email":"demo-recipient@example.com",
    "shipping_address":{
      "first_name":"Demo",
      "last_name":"Recipient",
      "address1":"123 Test Street",
      "city":"Ottawa",
      "province_code":"ON",
      "country_code":"CA",
      "zip":"K1P 1J1"
    }
  }'
```

Replace `dev-token` when `ENGINE_API_TOKEN` is configured. Preserve the returned `admin_url` for
recording. Do not include the `.env`, token or terminal request in the final video.

### What to record in Shopify Admin

Open the returned `admin_url` and capture, in one slow sequence:

1. the order's **Test** indicator and order number;
2. the development-store domain;
3. line items and total matching the Sutra cart;
4. the fictional delivery address;
5. transaction history with exactly one labeled test transaction per participant;
6. the Sutra test-only note or attributes.

Keep an on-screen caption throughout:

> SHOPIFY DEVELOPMENT-STORE PROOF · TEST ORDER AND TEST TRANSACTIONS · NO REAL MONEY

Say:

> “These completed Sutra test outcomes are mirrored into one valid Shopify test order, including
> delivery and one labeled test transaction per participant. This proves the adapter mapping. It
> is not Shopify Checkout, not four real card captures, and no money moved.”

## Future production merchant adapter

A fully automatic no-fronting online order requires a materially different integration:

1. Merchant authentication creates/reserves a cart or draft order.
2. Shopify/merchant owns the address and fulfilment choice and returns a stable final quote with
   inventory, shipping, tax, discounts, currency and expiry.
3. Sutra hashes that quote, allocates it and collects one capped approval per payer. Material
   quote drift requires fresh consent.
4. The adapter submits real captures with durable idempotency references and reconciles unknown
   outcomes before retrying.
5. The merchant associates successful captures with one order and calls it paid only after the
   required total is confirmed.
6. Explicit policy handles partial failure: reconcile, release uncaptured authorizations, invoke
   an approved backstop, or preserve a truthful partial outcome.
7. Refund and fulfilment events flow back from the merchant without inventing a reversal.

Merchant willingness or a POS feature alone is not this integration. It still requires approved
APIs, code, authentication, operational reconciliation and merchant adoption.

## Ownership checklist

| Fact or action | Owner today |
|---|---|
| Public product facts | Shopify storefront; Sutra records source/confidence |
| Participant constraints and proposed shares | Sutra |
| Consent, group policy and signed decision evidence | Sutra / GMP/1 |
| Physical cart and split collection | Merchant cashier / Shopify POS |
| Ordinary online address, final quote and order | Merchant / Shopify Checkout |
| Development-proof address and test order | Shopify development store; address is not retained by Sutra |
| Real merchant payment receipt | Shopify / merchant payment provider, not the Sutra agreement |
| Prava mandate approval on supported rails | Individual payer / Prava |
