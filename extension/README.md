# sutra browser extension

Imports the product, ticket, stay or cart facts visible to the active tab into the same Sutra account used by the web app. When the detector exposes several cart lines, the extension preserves every line in the proposed split. It can choose persisted friends/circles and create a coordinated group; detection does not authenticate to, order from, or pay a merchant.

Groups can seat only **you or people you are already friends with**. The engine rejects strangers with a clear 403; add friends in the web app People page first.

## Install from source

There is currently no Chrome Web Store listing or packaged GitHub Release. To install the checked-in build:

1. Clone or download the [Sutra repository](https://github.com/Soham109/sutra).
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` directory.
3. Open the extension and choose **Open account settings**.
4. In [Sutra settings](https://sutra-gmp.vercel.app/app/settings), create an extension token, copy it once, and paste it into the extension.

The generated detector and icons are committed, so installing does not require a build. Contributors changing the shared detector or artwork should regenerate them with `npm run build:widget` and `node extension/icons/make-icons.mjs` before loading the extension.

Production defaults are `https://engine-production-e6fa.up.railway.app` (engine) and `https://sutra-gmp.vercel.app` (app). Local development can override the engine preference to `http://localhost:4100` (allowed in the manifest).

The extension never receives `ENGINE_API_TOKEN`. Its revocable, 90-day user session is stored in `chrome.storage.local`; non-secret preferences use `chrome.storage.sync`. Only a SHA-256 token hash is persisted by the engine.

## What it reads

The generated `detect.js` is shared with the widget and tries Shopify cart data, JSON-LD, Shopify metadata, microdata, selected text, OpenGraph fields, then visible total text. Every result carries its strategy, provenance and confidence. Page access is granted only after a click through `activeTab`; no product page is monitored in the background.

The manifest has host permissions only for the deployed and local Sutra engines. Those permissions allow the service worker to call the product API; they do not grant persistent access to merchant sites. The account token is never injected into a tab.

## Important boundary

The extension imports merchant-reported facts and starts coordination. It does not retain or control the merchant's authenticated session, submit an address or checkout, place an order, or verify a payment. Final prices, discounts, shipping and tax must be checked at the merchant. Automatic completion would additionally need a supported merchant/payment adapter, a stable quote or reservation, and merchant authentication. See [product architecture](../docs/PRODUCT_ARCHITECTURE.md).

## Files

- `background.js` — detection, account API and signed-in group creation.
- `popup.html` / `popup.js` — account, circle/friend picker and split review.
- `content.js` — optional in-page surface (Alt+Shift+S).
- `detect.js` — generated from `widget/detect.js`; do not edit directly.
- `icons/` — generated consent-graph PNG mark.
