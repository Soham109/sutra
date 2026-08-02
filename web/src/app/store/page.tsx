import type { Metadata } from 'next'
import './storegate.css'

export const metadata: Metadata = {
  title: 'Open the demo store — Sutra',
  description: 'The Shopify development store behind Sutra’s merchant-record proof.',
}

const STORE = process.env.NEXT_PUBLIC_SHOPIFY_STORE ?? 'sutra-agzdw2mf.myshopify.com'
const PASSWORD = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_PASSWORD ?? 'sutra'

// Shopify locks the password page ON for development stores — it cannot be
// turned off, only given a password. So rather than ask a visitor to copy a
// password out of a README and paste it into a gate, this posts Shopify's own
// unlock form for them and lands them in the shop.
//
// The form has to target Shopify directly: the cookie it sets is first-party to
// their domain, so a server-side proxy on our origin could not hand it over.
// The password is public by design — it is printed below as well, because a
// button that silently submits a secret would be worse than one that shows it.
export default function StoreGatePage() {
  return (
    <main className="storegate">
      <div className="storegate-card">
        <p className="storegate-kicker">Merchant proof</p>
        <h1>Open the demo store</h1>
        <p className="storegate-lede">
          Sutra&rsquo;s merchant-record proof runs against a real Shopify development store. Three
          products live there, and a committed group writes one <code>test: true</code> order into
          it with a labelled test transaction per person.
        </p>

        <form action={`https://${STORE}/password`} method="post" className="storegate-form">
          <input type="hidden" name="form_type" value="storefront_password" />
          <input type="hidden" name="utf8" value="✓" />
          <input type="hidden" name="password" value={PASSWORD} />
          <button type="submit">Unlock and open {STORE.replace('.myshopify.com', '')} &rarr;</button>
        </form>

        <p className="storegate-note">
          Shopify keeps development stores behind a password and offers no way to switch it off.
          The button submits Shopify&rsquo;s own unlock form; the password is{' '}
          <code>{PASSWORD}</code> if you would rather type it yourself.
        </p>

        <p className="storegate-honest">
          Nothing here moves real money. Orders written to this store carry Shopify&rsquo;s own
          <code>test: true</code> flag on the order and on every transaction, which is a merchant
          record of an agreed split — not Shopify Checkout collecting several cards.
        </p>
      </div>
    </main>
  )
}
