'use client'

export type CheckoutMode = '' | 'shopify_test_order' | 'shopify_pos' | 'checkout_handoff'

export function CheckoutModePicker({
  value,
  onChange,
  isShopify,
  testProof,
  posConfirmed,
  onPosConfirmed,
}: {
  value: CheckoutMode
  onChange: (mode: CheckoutMode) => void
  isShopify: boolean
  testProof?: { available: boolean; adapter: 'mock' | 'sandbox' | 'production'; store: string | null }
  posConfirmed: boolean
  onPosConfirmed: (confirmed: boolean) => void
}) {
  return (
    <section className="checkout-mode card card-pad">
      <div className="section-head" style={{ marginBottom: 10 }}>
        <div>
          <span className="eyebrow">How will the merchant be paid?</span>
          <h3 style={{ marginTop: 5 }}>Choose the real finish line</h3>
        </div>
      </div>
      <div className="checkout-mode-grid">
        {testProof?.available && (
          <button
            type="button"
            className={`checkout-mode-card${value === 'shopify_test_order' ? ' is-on' : ''}`}
            onClick={() => onChange('shopify_test_order')}
            aria-pressed={value === 'shopify_test_order'}
          >
            <span className="checkout-mode-kicker">Demo proof · zero real money</span>
            <b>Create a valid Shopify test order</b>
            <p>
              Each person completes a Sutra/{testProof.adapter === 'mock' ? 'Prava simulator' : 'Prava sandbox'} test
              approval. The organiser then adds the delivery address and creates one Shopify test order with one
              labeled test transaction per share.
            </p>
            <small>Shopify marks the order and every transaction as test. This is not multi-card Checkout.</small>
          </button>
        )}
        <button
          type="button"
          className={`checkout-mode-card${value === 'shopify_pos' ? ' is-on' : ''}`}
          onClick={() => onChange('shopify_pos')}
          aria-pressed={value === 'shopify_pos'}
        >
          <span className="checkout-mode-kicker">Works now · in person</span>
          <b>Split at Shopify POS</b>
          <p>
            Everyone confirms a share here. At the counter, the cashier uses Shopify POS split payment and
            charges each person directly.
          </p>
          <small>
            {isShopify
              ? 'Use only after the store confirms this location takes payment on Shopify POS.'
              : 'Use only after the merchant confirms its counter supports split tender.'}
          </small>
        </button>
        <button
          type="button"
          className={`checkout-mode-card${value === 'checkout_handoff' ? ' is-on' : ''}`}
          onClick={() => onChange('checkout_handoff')}
          aria-pressed={value === 'checkout_handoff'}
        >
          <span className="checkout-mode-kicker">Coordination only · online</span>
          <b>Return to online checkout</b>
          <p>
            Sutra records the exact proposed split, then sends the group back to the merchant. It does not place
            or pay the order.
          </p>
          <small>A one-card checkout still needs a merchant adapter before several people can pay one order.</small>
        </button>
      </div>
      {value === 'shopify_pos' && (
        <label className="checkout-confirm">
          <input
            type="checkbox"
            checked={posConfirmed}
            onChange={(event) => onPosConfirmed(event.target.checked)}
          />
          <span>I confirmed this physical location uses Shopify POS and its cashier can take split payments.</span>
        </label>
      )}
    </section>
  )
}

export function HowItCompletes({
  mode,
  merchant,
  people,
}: {
  mode: CheckoutMode
  merchant: string
  people: number
}) {
  if (mode === 'shopify_test_order') {
    return (
      <div className="completes is-ok">
        <b>End-to-end development-store proof.</b>
        <p>
          Sutra runs the multi-person test approvals first. After every share succeeds, the organiser enters the
          recipient and delivery address, and Sutra creates a real Shopify development-store order whose order and
          per-person transaction records are explicitly marked test.
        </p>
        <p className="completes-fix">
          This proves the adapter, allocation, address and order reconciliation. No real money moves, and it does
          not claim Shopify&apos;s normal checkout accepted several cards.
        </p>
      </div>
    )
  }

  if (mode === 'shopify_pos') {
    return (
      <div className="completes is-ok">
        <b>Ready for a {people}-way Shopify POS payment.</b>
        <p>
          Sutra locks the arithmetic and each person confirms their amount. Then the cashier enters each share as
          a split payment at {merchant}; every person presents their own card.
        </p>
        <p className="completes-fix">
          Sutra is not connected to the terminal. The signed receipt says “ready for Shopify POS,” not “paid,”
          until the cashier actually completes those payments.
        </p>
      </div>
    )
  }

  if (mode === 'checkout_handoff') {
    return (
      <div className="completes is-warn">
        <b>This prepares the split; it does not pay the online order.</b>
        <p>
          Everyone confirms their proposed amount, but no Prava credential is minted and no card is charged.
          The group then returns to {merchant} to finish checkout.
        </p>
        <p className="completes-fix">
          If the checkout accepts only one card, somebody would still have to front the order. Full no-fronting
          completion requires a merchant adapter that can reconcile several payments into one order.
        </p>
      </div>
    )
  }

  return (
    <div className="completes is-warn">
      <b>Choose how this will finish before inviting anyone.</b>
      <p>A merchant URL tells Sutra what the item costs. It does not prove the merchant can take a group payment.</p>
    </div>
  )
}
