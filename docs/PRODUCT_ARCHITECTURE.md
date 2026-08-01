# Sutra product architecture

## One account, several entry points

The web app, installable PWA, browser extension, agent surfaces and future native apps are clients of the same product API. Accounts, friendships, circles, groups and receipts live in the engine database; they are not browser-extension data.

| Surface | Best at | What it does not do |
| --- | --- | --- |
| Web / PWA | planning, discovery, group management, approvals, receipts | inspect another site's live DOM or authenticated cart |
| Browser extension | import the product/cart currently open in the browser | inherit the merchant login, place the order, or bypass checkout |
| In-app discovery | search configured public catalogs and resolve pasted public URLs | see a private cart or claim universal web coverage |
| Native app (later) | push, camera, share sheet, passkeys, location | replace the engine or create a separate account system |

The extension uses a revocable 90-day device session. The plaintext token is stored in `chrome.storage.local`; only its SHA-256 hash is stored in SQLite. It never receives `ENGINE_API_TOKEN`, Prava credentials, or card data. Preferences may sync through Chrome, credentials may not.

## Detection is not checkout

Importing a page answers: “What is the user looking at, approximately how much is it, and where did those facts come from?” It does not answer: “Can Sutra place this order?”

Checkout requires a capability after import:

1. **Supported merchant/payment adapter:** Sutra can create person-scoped mandates and commit a merchant payment.
2. **Merchant deep link or reserved cart:** Sutra coordinates the decision and returns the group to the merchant for the final authenticated action.
3. **No merchant integration:** Sutra records the plan, exact split and consent, but must not say the merchant was paid.
4. **Physical bill:** the `at_venue` rail records what each person owes; it explicitly does not claim a card charge.

### Example: buying a domain with four friends

The extension can detect a GoDaddy domain/cart and bring the domain, quoted price and four Sutra accounts into a group. It cannot borrow the user's GoDaddy authentication or register the domain by itself. A complete automatic purchase needs either a GoDaddy partner API/OAuth integration plus a stable quote/reservation, or a payment adapter the merchant accepts. Without that, Sutra coordinates consent and shares, then sends the organizer back to the authenticated GoDaddy checkout. The registrant/contact/renewal owner must also be chosen explicitly; equal payment does not imply equal legal ownership of a domain.

## Mobile path

The current web product is installable as a PWA and is the fastest honest mobile release. It should remain the shared responsive UI and product contract. A WebView wrapper adds store distribution but little product value and creates authentication, deep-link and payment-review problems.

The recommended native phase is Expo/React Native using the same API and account sessions, introduced when Sutra needs capabilities the PWA cannot provide reliably: share-sheet ingestion, background push, camera scanning, platform passkeys, contacts and universal links. Native clients must not fork payment or allocation logic; those invariants stay in the engine.

## Launch blockers

- Add email verification, password reset, login rate limits and breached-password checks to the new email/password + HttpOnly session flow.
- Move account/social data from the single-replica Railway volume to managed Postgres before horizontal scaling; the volume-backed SQLite deployment is durable but intentionally single-writer.
- Restrict production CORS to known web and extension origins.
- Add merchant capability records and reservation/quote expiry to every imported item.
- Never ship a master engine token in a public client.
- Add device/session management, rotation and audit UI.
- Test extension pairing and group creation against the deployed engine before store submission.
