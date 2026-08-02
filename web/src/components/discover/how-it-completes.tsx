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
  /** `enabled` = this environment has a card-mandate merchant configured at all.
   *  `available` = this specific product is from that merchant, so it is selectable.
   *  `reason`/`reasonDetail` explain `enabled` when it is false — never hide the
   *  capability, say why it isn't on right now. */
  testProof?: {
    enabled: boolean
    available: boolean
    adapter: 'mock' | 'sandbox' | 'production'
    store: string | null
    reason?: 'ready' | 'not_configured' | 'misconfigured' | 'blocked_in_production'
    reasonDetail?: string
  }
  posConfirmed: boolean
  onPosConfirmed: (confirmed: boolean) => void
}) {
  // This tile is the whole point of the product — N separate capped mandates,
  // not a shared cart. It stays on screen even when it can't be picked, so
  // nobody looking at this page ever mistakes "not selectable for this item"
  // for "sutra doesn't do that." Only what happens when you press it changes.
  return (
    <section className="checkout-mode card card-pad">
      <div className="section-head" style={{ marginBottom: 10 }}>
        <div>
          <span className="eyebrow">How will the merchant be paid?</span>
          <h3 style={{ marginTop: 5 }}>Choose the real finish line</h3>
        </div>
      </div>
      <div className="checkout-mode-grid">
        {testProof?.available ? (
          <button
            type="button"
            className={`checkout-mode-card${value === 'shopify_test_order' ? ' is-on' : ''}`}
            onClick={() => onChange('shopify_test_order')}
            aria-pressed={value === 'shopify_test_order'}
          >
            <span className="checkout-mode-kicker">The real mechanism · zero real money</span>
            <b>Capped card mandates, one per person</b>
            <p>
              Each person approves their own {testProof.adapter === 'mock' ? 'Prava simulator' : 'Prava sandbox'}{' '}
              mandate — locked to this merchant, capped at their exact share, usable once. Only after every mandate
              is approved does Sutra charge each card, one at a time. As independent proof, the outcome is also
              mirrored into one labeled Shopify test order.
            </p>
            <small>Finishing the passkey needs a phone holding the sandbox test card — not a script.</small>
          </button>
        ) : testProof?.enabled ? (
          // Configured in this environment, but this particular product isn't
          // from the wired-up storefront — a mismatch, not an outage.
          <div className="checkout-mode-card" aria-disabled="true" style={{ cursor: 'default', opacity: 0.62, borderStyle: 'dashed' }}>
            <span className="checkout-mode-kicker">Configured · not this product</span>
            <b>Capped card mandates, one per person</b>
            <p>
              N people, N separate single-use mandates, each capped at their own share, nobody fronting anybody
              else — this is what makes sutra different from a shared cart or Splitwise. This environment has it
              wired up for <b>{testProof.store}</b> — choose a product from that store to unlock it here.
            </p>
            <small>Not hidden — just not available for this particular item.</small>
          </div>
        ) : (
          // Not a failure state — a capability notice. The mechanism is real
          // and shipped; this deployment simply hasn't turned the demo
          // storefront on (or, on a live-payment deployment, refuses to by
          // design). Say what it would do rather than pretend it isn't there.
          <div className="checkout-mode-card" aria-disabled="true" style={{ cursor: 'default', opacity: 0.62, borderStyle: 'dashed' }}>
            <span className="checkout-mode-kicker">
              {testProof?.reason === 'blocked_in_production' ? 'Disabled in live-payment mode' : 'Not enabled on this deployment'}
            </span>
            <b>Capped card mandates, one per person</b>
            <p>
              N people, N separate single-use mandates, each capped at their own share, nobody fronting anybody
              else — this is what makes sutra different from a shared cart or Splitwise. Sutra can mirror every
              participant&rsquo;s completed test approval into one real Shopify Admin order — <code>test: true</code>{' '}
              on the order and every transaction, so Shopify itself marks it a demo, not a sale.
            </p>
            <small>{testProof?.reasonDetail ?? 'This deployment has no card-charging merchant configured right now.'}</small>
          </div>
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
        <b>{people} separate capped mandates — the actual mechanism, not a stand-in for it.</b>
        <p>
          Each person opens their own approval link and authorises a single-use Prava mandate: locked to{' '}
          {merchant}, capped at their own share, good for one charge. Nothing is pooled and nobody fronts anyone
          else. Only once every mandate is approved does Sutra charge each card, one at a time, against the cap
          they set.
        </p>
        <p className="completes-fix">
          Finishing the passkey needs a phone holding the sandbox test card — that boundary is real, not a missing
          feature. As independent proof the charges happened, Sutra also mirrors the outcome into one Shopify
          development-store order marked test. No real money moves either way, and this does not claim Shopify&apos;s
          normal checkout accepted several cards.
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
