# sutra browser extension

Imports the product, ticket, stay or cart open in the active tab into the same Sutra account used by the web app. It can choose persisted friends/circles and create a coordinated group; detection alone does not authenticate to, order from, or pay an arbitrary merchant.

## Load and connect

1. Generate shared detector and icons: `npm run build:widget` and `node extension/icons/make-icons.mjs`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this directory.
3. Open the extension, then **Open account settings**.
4. In Sutra settings create an extension token, copy it once, and paste it into the extension.

Production defaults are `https://engine-production-e6fa.up.railway.app` and `https://sutra-gmp.vercel.app`. Local development can set the engine preference to `http://localhost:4100`.

The extension never receives `ENGINE_API_TOKEN`. Its revocable, 90-day user session is stored in `chrome.storage.local`; non-secret preferences use `chrome.storage.sync`. Only a SHA-256 token hash is persisted by the engine.

## What it reads

The generated `detect.js` is shared with the widget and tries Shopify cart data, JSON-LD, Shopify metadata, microdata, selected text, OpenGraph fields, then visible total text. Every result carries its strategy, provenance and confidence. Page access is granted only after a click through `activeTab`; no product page is monitored in the background.

The manifest has host permissions only for the deployed and local Sutra engines. Those permissions allow the service worker to call the product API; they do not grant persistent access to merchant sites. The account token is never injected into a tab.

## Important boundary

The extension imports facts and starts coordination. Automatic merchant purchase additionally needs a supported merchant/payment adapter, stable quote or reservation, and any required merchant authentication. Otherwise the group returns to the merchant for the final checkout. See [product architecture](../docs/PRODUCT_ARCHITECTURE.md).

## Files

- `background.js` — detection, account API and signed-in group creation.
- `popup.html` / `popup.js` — account, circle/friend picker and split review.
- `content.js` — optional in-page surface.
- `detect.js` — generated from `widget/detect.js`; do not edit directly.
- `icons/` — generated consent-graph PNG mark.
