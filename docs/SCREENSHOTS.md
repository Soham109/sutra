# Product screenshots

The screenshots in [`docs/screenshots/`](screenshots/) are generated from the deployed product, not mockups.

[`capture.mjs`](screenshots/capture.mjs) opens `https://sutra-gmp.vercel.app` in headless Chrome, registers a disposable account, and drives the visible UI to create:

- a product search and link split;
- a reconciled three-person bill split;
- a group with two accepted shares and one still deciding;
- the individual decision page and terminal signed receipt;
- a plan with three participant responses and real OpenStreetMap venues;
- the live NANDA/A2A discovery evidence page.

The latest run metadata—including deployment, disposable handle, group IDs, timestamp, and findings—is recorded in [`run-report.json`](screenshots/run-report.json). The current run completed on 2 August 2026 against production. Its only skipped artifact was the Chrome extension, which cannot be captured honestly without loading the unpacked extension in a real browser on a merchant page.

## Reproduce

```bash
node docs/screenshots/capture.mjs
node docs/screenshots/prepare-readme.mjs
```

Override the deployment or Chrome executable when needed:

```bash
SUTRA_URL=http://localhost:3000 CHROME_PATH=/path/to/chrome node docs/screenshots/capture.mjs
```

The capture script supports standard Google Chrome, Chromium, and Microsoft Edge locations on macOS and Windows.

## Judge-facing frames

The README uses the `readme-*.png` files. [`prepare-readme.mjs`](screenshots/prepare-readme.mjs) creates them as focused crops of the full product captures so their text remains readable at GitHub width. It changes no text, number, status, or browser state.

| README frame | Source | What it proves |
|---|---|---|
| `readme-hero.png` | `01-landing-light.png` | Product positioning and the primary entry points |
| `readme-plan.png` | `09-plan-board-light.png` | Three participant responses, real venue options, and computed scores |
| `readme-discover.png` | `03-discover-search-light.png` | Merchant provenance, live price/stock facts, and the split action |
| `readme-bill.png` | `04-bill-parsed-light.png` | Printed-total reconciliation, item assignment, and exact minor-unit shares |
| `readme-approval.png` | `06-approval-pending-light.png` | One person’s complete decision and explicit at-venue no-charge disclosure |
| `readme-nanda.png` | `08-nanda-light.png` | Four live agent-discovery endpoints fetched by the browser |

## Full capture index

| File | State captured |
|---|---|
| `01-landing-light.png` | Logged-out landing page, light theme |
| `02-dashboard-light.png` | Signed-in dashboard with pending and waiting groups |
| `03-discover-search-light.png` | Public catalog search results |
| `04-bill-parsed-light.png` | Parsed and reconciled bill before sending shares |
| `05-group-midflight-light.png` | Bill group with two of three shares accepted |
| `06-approval-pending-light.png` | Remaining participant’s decision page |
| `07-receipt-settled-light.png` | Signed at-venue receipt; charged total remains zero |
| `08-nanda-light.png` | NANDA evidence page after all live fetches complete |
| `09-plan-board-light.png` | Plan board after all three participants answer |
| `10-dashboard-dark.png` | Terminal dashboard state, dark theme |
| `11-landing-dark.png` | Landing page, dark theme |

The short filenames (`dashboard.png`, `discover.png`, and similar) are compatibility aliases written by the capture script. New documentation should use the numbered full captures or the focused README frames.

## Integrity notes

- The bill flow is deliberately labelled `at_venue`: it creates exact agreement and a signed receipt, but no card charge. The terminal receipt records `charged_amount = 0`.
- The plan’s participants are disposable capture identities; the venue rows are returned by the real deployed coordination path.
- The screenshot harness does not complete a Prava passkey ceremony and must never be cited as proof of a settled sandbox card charge.
- `extension.png` is intentionally absent. A fake browser frame would be easier and would be false.
