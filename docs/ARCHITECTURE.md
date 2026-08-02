# Architecture

What the code actually contains, how the pieces fit, and where the honest boundaries are. Citations are `file:line` — code moves, so re-grep rather than trust a stale number. Test and line counts below are a snapshot; run `npm test -w engine` (PowerShell) and `wc -l` yourself for the current figures.

## 1. One account, several entry points

The web app, installable PWA, browser extension, and agent surfaces (MCP, A2A) are all clients of the same product API. Accounts, friendships, circles, groups, and receipts live in the engine database — they are not browser-extension data.

| Surface | Best at | Cannot do |
|---|---|---|
| Web / PWA | Planning, discovery, group management, approvals, receipts | Inspect another site's live DOM or authenticated cart |
| Browser extension | Import the product/cart currently open in the browser | Inherit the merchant login, place the order, or bypass checkout |
| In-app discovery | Search configured public catalogs, resolve pasted public URLs | See a private cart or claim universal web coverage |
| Native app (roadmap) | Push, camera, share sheet, passkeys, location | Replace the engine or fork the account system |

The extension uses a revocable 90-day device session: the plaintext token lives in `chrome.storage.local`, only its SHA-256 hash is stored in SQLite, and it never receives `ENGINE_API_TOKEN`, Prava credentials, or card data.

**Detection is not checkout.** Importing a page answers "what is the user looking at, roughly what does it cost, and where did those facts come from" — not "can Sutra place this order." Reaching checkout needs one of six capabilities after import: a supported merchant/payment adapter (real mandates); the configured development-store proof (a real Shopify **test** order, no real money); a confirmed Shopify POS counter (Sutra computes shares, the cashier runs the terminal); a merchant deep link or reserved cart (Sutra coordinates, then hands back to the merchant's own checkout); no merchant integration at all (Sutra records the plan and consent, and must not say the merchant was paid); or a physical bill (the `at_venue` rail records what's owed, never a card charge).

Sutra does not collect a delivery address for an ordinary online handoff — the buyer enters it inside the merchant's own checkout, which owns fulfilment and can recompute shipping and tax, at which point the old split is just a stale quote needing fresh consent. The one exception is the development-store proof, where an explicit form sends a fictional demo address straight to Shopify and Sutra does not retain it.

## 2. Top-level directories

| Dir | What it is | Depends on |
|---|---|---|
| `engine/` | The backend: GMP/1 protocol engine, coordination layer, SQLite persistence, HTTP API. Everything else is a client of it. | Prava (mock or real), OpenAI (optional), OSM (no key), Shopify storefronts (no key) |
| `web/` | Next.js 15 / React 19 product UI. Talks to the engine only through `web/src/app/api/[...path]/route.ts`, a thin proxy that injects `ENGINE_API_TOKEN` on `POST /v1/groups` only. | engine over HTTP, `tesseract.js` (client-side OCR fallback) |
| `widget/` | `detect.js`: the page-detection heuristics shared verbatim by web bill-scan, the bookmarklet, and the extension. `widget/detect.test.mjs` is the one suite Node's own test runner (not vitest) executes. | none — pure DOM/text heuristics |
| `extension/` | Chrome MV3 extension (`manifest.json`, v1.2.0). `background.js`/`content.js`/`popup.js` mount a sheet on the merchant page using the same `detect.js`, then POST to `/v1/extension/groups`. Host permissions list only the deployed engine URL and localhost; "load unpacked" is the only distribution — it is not published to the Chrome Web Store. | engine's `/v1/extension/groups`, `/v1/me/extension-token` |
| `cli/` | `cli/src/gmp.ts` (demo runs, offline receipt verify) and `cli/src/nanda.ts` (NANDA discovery-doc publish/check), both importing `@sutra/engine` in-process. | `@sutra/engine` (workspace) |
| `mcp/` | One file, `mcp/src/server.ts`, exposing the engine as an MCP server (spec §15): `create_group_session`, `get_group_status`, `cancel_group`, plus the delegate tools in §9 below. Charging still goes engine-side over REST. | `@modelcontextprotocol/sdk`, engine over REST |
| `e2e/` | Six standalone `tsx` scripts run against a live engine, not part of vitest: `plan-flow.ts`, `product-flow.ts`, `sandbox-smoke.ts`, `sandbox-proof.ts` (the real-sandbox-mandate proof), `auth-check.ts`, `agent-mesh.ts` (the delegate demo, §9). None are unit tests — they hit real OSM/Shopify/Prava. | running engine, real OSM/Shopify, optionally real Prava sandbox |
| `nanda-town-prava/` | A separate Python package, the NANDA-track submission: a `nest.plugins.payments` entry-point plugin backing NANDA Town's simulator with real Prava/GMP mandates instead of a pooled ledger. Own `pytest` suite, own `.venv`. | `nest-sdk` (Python), stdlib `urllib` only |
| `chaos/` | `chaos/src/run.ts`: GMP/1 §11 chaos suite — random groups/declines/backstops through a fault-injecting Prava proxy, checked against the event log and the mock's own ground truth. | `@sutra/engine` in-process |
| `spec/` | The protocol as prose: `PROTOCOL.md` (GMP/1 itself) and `AP2-EXTENSION.md`. Design intent, not generated from code. | — |

Not a code directory but worth knowing: `openapi.json` at the repo root is the team's copy of Prava's published API spec, verified byte-identical to Prava's own on 2026-08-01 (`engine/src/prava/client.ts:1-3`).

## 3. Engine module map (`engine/src/`)

66 files, ~18,700 lines. Grouped by concern; every line below is drawn from the file's own header comment plus a read of its content.

**Protocol core — the frozen GMP/1 contract (spec §13).** `types.ts` (284L) money as integer minor units, `Cart`/`CartItem` zod schemas, the `Policy` algebra type, row shapes, canonical-JSON hashing. `service.ts` (1,375L, largest file) `GroupService`: creation, member lifecycle, the decision point, crash-safe commit execution, abort/expiry — see §6/§7. `protocol/policy.ts` (127L) `evaluatePolicy`: pure evaluation of `all_of`/`quorum`/`weighted`/`veto`/`required`/`deadline` nodes, property-tested for monotonicity. `protocol/money.ts` (89L) `distribute()` (largest-remainder split), `computeShares()` (per-item claimant splitting, pro-rata fees, sponsor absorption), `capFor()`. `protocol/backstop.ts` (57L) proportional shortfall allocation, capacity-clamped. `protocol/auction.ts` (45L) sealed-bid allocation-only auctions for scarce cart slots — bids never move money. `db.ts` (292L) raw `node:sqlite` schema + CAS accessors. `receipt.ts` (182L) `ReceiptSigner`: Ed25519-signed, hash-chained receipts. `events.ts` (74L) append-only event log, in-process SSE fan-out, signed webhook dispatch. `ids.ts` (24L) hand-rolled ULID generator. `rails.ts` (113L) the four settlement rails as data plus `railFor()` — full detail in §8. `poller.ts` (98L) the engine's only inbound signal, since Prava has no webhooks: polls for passkey approvals, external cancels, deadline enforcement, resumes interrupted commits on boot. `rate-limit.ts` (79L) per-device rate limiting, written after a live probe fired 20 clean 401s in 16s with zero backoff. `routes.ts` (739L) the frozen `/v1/groups`, `/v1/members/*` REST+SSE surface. `server.ts` (310L) Fastify wiring, adapter selection, `/health`.

**Coordination layer — the hour before a cart exists, not part of GMP/1.** `plan/types.ts` (313L) `Plan`, `Slots`, `SignalPayload`, deliberately vertical-neutral. `plan/service.ts` (777L) `PlanService`: creation, signal submission with re-rank diffing, option generation, ranking, `chooseOption`/`convertToGroup` — the handoff into GMP/1, which alone decides the rail (§8; a plan can never produce `prava_mandates`). `plan/store.ts` (291L) persistence. `plan/rank.ts` (957L, second-largest file) the explainable scorer — §10. `plan/geo.ts` (159L) great-circle distance, centroid, bounding radius. `plan/time.ts` (305L) half-open `TimeWindow` interval algebra. `plan/opening-hours.ts` (238L) parses OSM `opening_hours` to catch a provably-closed venue. `agent/extract.ts` (531L) sentence → structured `Slots`, deterministic floor always available, OpenAI only fills slots when keyed. `agent/classify.ts` (119L) closed 21-id category classifier, keyword table first, model on a miss. `delegate/rules.ts` (339L) `decideSignals` — pure, no I/O, structurally cannot emit a payment approval — §9. `delegate/store.ts` (40L), `delegate/routes.ts` (149L). `routes-plan.ts` (645L) coordination HTTP surface, kept apart from `routes.ts` on purpose.

**Catalog and discovery — product resolution.** `catalog/index.ts` (85L) `Catalog`: federates `ShopifySource` + `PravaShopSource`. `catalog/sources.ts` (174L) `ShopifySource` (any storefront's public `/search/suggest.json`, no key) and `PravaShopSource` (documented but deliberately unwired — Prava's own shop search needs Ed25519 agent request-signing a merchant key can't do). `catalog/resolver.ts` (971L, largest catalog file) `resolveProductUrl`: confidence-ordered strategies — JSON-LD, microdata, WooCommerce Store API, DOM heuristic — no per-merchant branches. `catalog/fetcher.ts` (151L) `safeFetch`: SSRF-hardened outbound fetch, https-only, public-address-only, every redirect hop re-validated. `catalog/compare.ts` (300L) cross-store price comparison, unit-normalized. `bill/parse.ts` (553L) `parseBillText`: deterministic receipt-text → itemized bill, works offline. `bill/index.ts` (184L) `parseBill` + `billToCart`. `bill/integrity.ts` (66L) the fractured-decimal OCR check. `places/index.ts` (244L) `Places` façade, 10-minute TTL cache, never throws. `places/nominatim.ts` (103L), `places/overpass.ts` (359L, mirror failover), `places/taxonomy.ts` (346L, free text → OSM tags, hand-checked against the wiki).

**Social, messages, notify.** `social.ts` (573L) `Social` class: users/friendships/circles/sessions, `assertSeatable` (the seat-attachment authority check, §9), `reliability()` computed from the event log. `messages/bot.ts` (517L) `mentionsSutra`, `isPaymentRequest`/`PAYMENT_REFUSAL` — the hard payment boundary, §9. `messages/classify.ts`, `messages/routes.ts` — same deterministic-first/model-fallback shape. `notify/push.ts` (315L) hand-rolled Web Push, RFC 8291 + RFC 8292, pinned against the RFC's own test vector. `notify/index.ts`, `notify/schema.ts`, `notify/routes.ts`.

**Prava adapters.** `prava/adapter.ts` (124L) the `PravaAdapter` interface — three implementations. `prava/client.ts` (321L) `PravaClient`: the real REST client, verified field-for-field against Prava's OpenAPI spec. `prava/mock.ts` (305L) `MockPrava`: offline simulator matching the real lifecycle, zero network, zero test-card burn. `prava/chaos.ts` (102L) fault-injecting proxy, refuses to wrap anything but the mock.

**Discovery (NANDA/A2A surface).** `discovery/endpoints.ts` (386L, the single generated inventory everything else derives from), `discovery/agent-card.ts` (431L, A2A AgentCard), `discovery/agent-facts.ts` (350L, NANDA AgentFacts, schema-validated), `discovery/catalog.ts` (217L, AI Catalog + NANDA Index record), `discovery/routes.ts` (192L).

`routes-v2.ts` (765L) — auth, `/v1/extension/groups`, people/circles/dashboard, bill routes, `/v1/discover/*` — kept apart from the frozen `routes.ts` for the same reason `routes-plan.ts` is.

## 4. The data model

Two schemas' worth of tables in one SQLite file (`node:sqlite`, not a package), installed by four `install*Schema` functions called from `server.ts`. A chat line has no table of its own — it's an `events`/`plan_events` row with `type: 'message.posted'`, which is why messages inherit replay and SSE for free.

**Protocol core** (`db.ts:20-103`): `groups` — one row per session, keyed `gs_<ulid>`, holding the canonical-JSON-hashed cart, the policy tree, `status`, `rail`, `origin` (`bill`/`extension`/`plan`/`discover`/…), and a CAS `version`. `members` — one row per seat, `role` (`payer|sponsor|backstop|observer`), `share_amount`/`cap_amount`, `status`, the Prava session/mandate ids, and a parallel backstop lifecycle on the same row. `auction_bids` — append-only sealed bids. `events` — append-only, never updated or deleted; the single source of truth for SSE, replay, receipts, and crash recovery. `receipts` — one signed row per group.

**Social** (`social.ts:67-133`): `users`, `friendships` (two rows per friendship, so a lookup never needs an `OR`), `friend_requests`, `circles`, `circle_members`, `user_sessions` (only a SHA-256 `token_hash` is persisted — losing the DB cannot reveal a usable token).

**Coordination** (`plan/store.ts:22-94`): `plans`, `plan_participants`, `plan_signals` (append-only; latest row per `(participant, kind)` wins, except `vote`, which also keys on `option_id`), `plan_options` (keeps the literal upstream response for provenance), `plan_events`.

**Delegate** (`delegate/store.ts:12-19`): `delegate_rules` — one row per user, `INSERT OR REPLACE`, no history, because a standing rule is a fact about the human, not the plan.

**No balance, ledger, or wallet table exists anywhere in this schema.** Every `CREATE TABLE` in the engine was read to confirm this; there genuinely is none.

## 5. The four request flows, traced by function call

**A sentence becomes a plan with ranked venues.** `POST /v1/agent/plan` (`routes-plan.ts:395-492`) calls `extractIntent` (`agent/extract.ts:520-531`), which tries OpenAI when keyed and falls back to `extractDeterministic` on any failure. The extractor only ever names a place *phrase*; `d.places.geocode()` turns it into coordinates via Nominatim. `createPlan` (`plan/service.ts:81-132`) inserts at `status: 'gathering'` with a provisional rail of `checkout_handoff` — a plan is coordination, not payment capability, and the concrete rail is decided only when an option converts to a group (§8). `generateOptions` computes a search anchor from participants' `location` signals or the geocoded place, resolves the category, and calls Overpass; a prior non-empty board is never wiped by a subsequent empty search. The board is read through `PlanService.ranked()` → `rankOptions`/`scoreOption` (§10).

**A pasted link becomes a group.** `POST /v1/discover/resolve` (`routes-v2.ts:755`) calls `resolveProductUrl` (`catalog/resolver.ts:69`): https-only, rejects known non-shops, confidence-ordered strategies through the SSRF-hardened `safeFetch`. `POST /v1/groups` (`routes.ts:83` → `service.createGroup`) calls `railFor({ merchantUrl, requested })` (`rails.ts:93-109`): a real, non-`.test` host defaults to `checkout_handoff`, never `prava_mandates` — a resolved page proves provenance, not chargeability. The one UI path that sends `requested: 'prava_mandates'` is the discover builder's "Capped card mandates" tile, selectable only against the one configured Shopify development store. The extension's own path, `POST /v1/extension/groups` (`routes-v2.ts:180-211`), hardcodes `rail: 'checkout_handoff'` regardless of the merchant URL — "reading a page is not a merchant payment integration."

**A photographed bill becomes a settled group.** `POST /v1/bill/parse` runs `parseBillText` for pasted text; the image path needs `OPENAI_API_KEY` and throws an explicit `no_vision_key` error rather than degrading silently — vision only transcribes pixels to text, and the transcript is re-parsed by the same deterministic parser, never trusted with arithmetic. `checkOcrIntegrity` flags the fractured-decimal failure mode. `POST /v1/bill/split` refuses outright, not just warns, if the integrity check is suspect and `force` wasn't passed, then calls `createGroup({ merchant: { url: 'https://venue.local.test' }, rail: 'at_venue', origin: 'bill' })` — the `.local.test` host is deliberate, since `railFor()` treats any `.test` host as "not a merchant," forcing `at_venue` even if a caller requested a charging rail.

**A member approves and the group commits.** `openMember` first flips `invited → viewed`; on `at_venue` it then goes straight to `awaiting_approval` with no Prava call at all, otherwise it mints a real mandate session. On the card rail the poller detects the passkey approval and calls `memberApproved`; on `at_venue` the member calls `POST /v1/members/:id/accept` directly. Either way `decide()` (`service.ts:386-426`) evaluates the policy: satisfied → `lockAndCommit`, unsatisfiable → `abort`. `lockAndCommit` drops any non-locked payer, recomputes shares over the locked set, and if the total exceeds what's covered, tries `allocateBackstops` and then a **requote cascade** (round-capped at 2, else abort). `executeCommit` either delegates to `settleAtVenue` (`charged_amount: 0`) or iterates the locked plan calling `chargeEntry` per member — write `charging`, call `chargeWithReconciliation` (5 retries with backoff, reconciling via `findChargeByReference` before ever risking a double charge), and on success write `charged` to the DB *before* the also-retried settlement report. A terminal 4xx fails immediately without retry; a fully-exhausted-and-unreconciled charge returns `'unknown'` and the group stays in `committing` for the poller to resume. `committed` requires every allocated entry to have settled; otherwise `partial`. `issueReceipt` signs and stores the terminal receipt.

## 6. State machines

`MemberStatus` (`types.ts:98-115`): `invited → viewed → awaiting_approval → approved → {charging → charged | settled | failed | declined | expired | dropped}`. `isSettled(status)` is `charged || settled` — the predicate every surface must use instead of hand-rolling "did this person pay." `on_hold` is an orthogonal flag on an already-`approved` member, read by `decide()` as `pending`.

`GroupStatus` (`types.ts:122-134`): `collecting → committing → {committed | partial}`, with exits to `aborted`/`expired` from either non-terminal state. `draft` is declared in the type but assigned nowhere — a grep for the literal `'draft'` across `engine/src/` finds only the declaration. `deciding` is documented in `spec/PROTOCOL.md` as "instantaneous in this implementation," confirmed against the code: `decide()` evaluates and, if satisfied, calls `lockAndCommit` synchronously in the same call — a group's status column jumps `collecting` straight to `committing`, never persisting `deciding`. Do not confuse this with the Plan status machine below, where `deciding` *is* real and persisted.

`PlanStatus` (`plan/types.ts:31-41`): `gathering → options → deciding → converted`, with exits to `cancelled`/`expired`.

## 7. What is genuinely tested, and external dependencies

Run directly, PowerShell (Git Bash throws a config error and runs zero engine tests):

```
npm test -w engine        →  43 files, 716 tests   (vitest)
npm run test:widget       →  33 pass, 0 fail        (node --test)
pytest -q  (nanda-town-prava/, via .venv)  →  117 passed, 1 skipped
```

Point-in-time numbers on an actively-developed repo — re-run rather than trust them. Coverage spans the policy algebra, money/backstop/auction math, the crash-double-charge and requote-cascade paths, rail selection, bill parsing and OCR-integrity, the delegate and payment-refusal boundaries, social privacy and seat-attachment authority, notify's RFC 8291 test vector, and AgentFacts schema validity.

| Dependency | Used for | Needs a key? | Unavailable behaviour |
|---|---|---|---|
| Prava | Mandate sessions, charges, settlement, cancel — the entire card-rail lifecycle | `PRAVA_API_KEY` (`sk_`) | `PRAVA_ENV` defaults to `mock`; a real env with no key logs an error and falls back to `MockPrava` rather than crashing |
| Prava's own shop search | Would let the catalog search Prava's merchant listings | N/A | Permanently unavailable — `PravaShopSource.available()` hardcodes `false`; verified live that it needs Ed25519 agent-signing a merchant key can't do |
| OpenAI | Slot extraction, category classification, receipt-photo transcription, chat-intent classification | `OPENAI_API_KEY` | All four fail open to deterministic behaviour except vision transcription, which has no deterministic substitute and throws a typed error asking for pasted text instead |
| Nominatim (geocoding) | Place phrase → coordinates | No key, 1 req/s self-enforced | Never throws — returns `{ places: [], reason }` |
| Overpass (venues) | Real venues for the `venue` plan kind | No key | Same never-throw contract; mirror failover; a `remark`-carrying 200 is treated as failure, never as "nothing near you" |
| Shopify storefronts | Keyword search across a configured shelf, plus one URL-resolver strategy | No key | A dark store contributes zero results; a password-walled dev store raises a typed error instead of a silent zero |
| WooCommerce | One resolver strategy inside `catalog/resolver.ts`, not a federated search source the way Shopify is | No key | Falls through to the next-lower-confidence strategy |

## 8. The four settlement rails

`railFor()` (`rails.ts:93-109`) decides mechanically: no merchant URL, or a placeholder/`.test`/`localhost` host, → `at_venue`; any other real host → `checkout_handoff`. **Neither charging-shaped rail is ever chosen automatically — only an explicit `requested` selects `prava_mandates` or `shopify_pos`.** A plan's own `convertToGroup` uses separate inline logic: an OSM venue always settles `at_venue`; a catalog option settles `checkout_handoff` unless `shopify_pos` was explicitly requested — a plan can **never** produce `prava_mandates`. `capabilityOf(rail).charges` gates every place `runCommit` decides whether to call Prava at all — a code path, not just a label, keeps any non-`prava_mandates` group away from `chargeMandate`.

| Rail | Charges | Disclosure shown to every member before they accept |
|---|---|---|
| `prava_mandates` | real, capped card charges | "Your card is charged directly by the merchant, up to the cap you approve and no further. The cap is enforced by the card network, not by this app. Nobody fronts money and no funds are pooled." |
| `shopify_pos` | none — `settled_verb: 'ready for Shopify POS'` | "No card is charged through sutra. Everyone confirms their exact share here, then the cashier uses Shopify POS split payment and charges each person directly. This receipt proves the agreement, not the POS payment." |
| `checkout_handoff` | none — `settled_verb: 'approved for checkout'` | "No card is charged and no merchant order is placed through sutra. Everyone confirms the proposed split, then the group returns to the merchant checkout. A one-card checkout still needs a merchant adapter before several people can pay one order without somebody fronting it." This is the explicit admission that **Sutra does not place the merchant order for a shared online cart** — stated in the rail's own copy, not just in prose. |
| `at_venue` | none — `settled_verb: 'settled at the venue'` | "No card is charged through sutra on this split. Everyone agrees their exact amount here, then pays the venue directly on their own card. What you get is the arithmetic, the agreement, and a signed record of who owed what — not a payment." |

The receipt itself carries the same disclosure in `settlement_disclosure` specifically so a receipt handed to anyone cannot be mistaken for proof of a payment it never claims. `verifyReceipt` (`receipt.ts:142-144`) independently fails any receipt that reports a non-zero charge on a rail whose `capabilityOf().charges` is false, recomputing the charged total from the entries rather than trusting a stored field.

## 9. What an agent may and may not do

Two independent, code-level enforcement points, not a shared gate anyone could accidentally bypass.

`delegate/rules.ts`'s `decideSignals` is pure, synchronous, no I/O. Its output type draws only from `SignalPayload` — `rsvp | availability | location | budget | vote | constraint` — and **there is no payment-shaped variant in that union**, so an agent calling this code cannot construct a payment approval even if it tried; the value simply isn't representable. `messages/bot.ts`'s `isPaymentRequest()` matches a deliberately over-broad payment-word regex and phrase list, and anything merely *shaped like* a payment instruction gets a fixed refusal string — never a judgment call about intent, because that judgment is exactly what this bot is not trusted to make. And the passkey ceremony itself is off-limits by construction: minting a mandate session only produces an approval-URL iframe; nothing in `PravaAdapter` exposes a way to complete a passkey on a human's behalf.

### The delegate mesh

`engine/src/delegate/` closes a real gap: every shipped multi-principal payment surface — AP2, ACP, Visa Intelligent Commerce, Prava's own mandate API — is single-principal, and none of them has a primitive for the conversation that happens *before* anyone reaches for a mandate (who's in, when, where, how much). A `StandingRules` object is one human's answers set in advance — a spending ceiling, blackout days, a home location, constraints — and `decideSignals(rules, { ask, slots })` walks the plan's open questions and, per kind, either answers with a real `SignalPayload` or skips with a human-readable reason. Four rules hold without exception: refuse rather than guess (no `auto_rsvp` on file skips RSVP, never defaults to "in"); never invent a location or budget (no `home` set skips `location` rather than fabricating one); respect blackout days against the plan's actual window; and decline with a stated reason when the rules *do* have enough information to say no. `vote` is always skipped — it's an opinion on a specific option, and standing rules are set before any option exists.

Routes: `PUT`/`GET /v1/delegate/rules` (signed in as yourself), `GET /v1/plans/:planId/questions?participant_id=` (machine-readable open questions), `POST /v1/participants/:id/delegate-answer` (runs `decideSignals` and submits through the ordinary `PlanService.submitSignal` path — same signal log, and a second `delegate.answered`/`delegate.skipped` event so the timeline shows a standing rule answered, not a human typing). Three MCP tools sit alongside the three that already existed: `list_open_questions`, `answer_as_delegate` (whose description states, mirroring Prava's own decision, that payment approval is not available over MCP and never will be), and `get_plan_status`.

A real three-delegate run (`e2e/agent-mesh.ts`, `PRAVA_ENV=mock`, over real HTTP, real Overpass venues) exercised every behaviour at least once: Arsh's standing rule declined RSVP outright with a reason ("never on Saturday, Sunday"); Priya's and Arsh's availability rules refused rather than guess, since neither covers a Saturday; Maya's location was refused because no `home` was set — "refusing to invent one" — even though her other answers went through; and the plan still converted to a real `at_venue` group, with `GET /v1/plans/:id/questions` independently confirmed to agree with what `decideSignals` computed for each delegate. The boundary held at the end exactly as designed: the group landed on the `at_venue` rail, and each human still had to open `POST /v1/members/:id/accept` themselves — no delegate, and no agent anywhere in the script, could complete it. On a card rail the same boundary holds through a real hosted Prava passkey ceremony instead.

Honestly not built: no UI for standing rules (`PUT /v1/delegate/rules` only, no form in `web/`); no rate limit on `delegate-answer`; a participant not linked to a signed-in user has no rules to fall back on unless the caller passes `rules` inline; availability windows are plain UTC clock times with no per-place timezone lookup; and `not_on`/availability checks only the plan's two calendar-day endpoints, not a general recurrence engine.

## 10. The coordination layer

*"Movie with friends," "dinner Saturday," "four tickets at this URL," and "split this bill" are the same object with different slots filled and a different option source — there is no movie code path. Adding a vertical means adding an option source, not a branch.*

```
free text ─agent/extract.ts─► SLOTS ─► PARTICIPANTS ─► SIGNALS ─► OPTIONS ─rank.ts─► the group picks one ─► convertToGroup()
```

A model may propose slots but never picks a venue, sets a price, or emits a coordinate — the extractor reports a place *phrase* and a real geocoder resolves it, so a hallucinated slot shows up as an obviously wrong search rather than a wrong charge. The deterministic extractor is the floor, not a fallback stub: with no network and no key it still parses "dinner with Arsh and Maya around 8pm saturday near Koramangala, under 800 each." Currency is the one place inference is allowed, and it's bounded: an explicit currency in the sentence wins; a bare number plus a geocoded country picks the country's currency and shows the substitution as an uncertainty; moving between minor-unit exponents is a rescale, never a conversion, and no rate is applied.

**Signals** are one generic mechanism — `rsvp`, `availability` (windows plus a separate `anytime` flag), `location`, `budget`, `vote` (deliberately coarse, −1/0/+1), `constraint` — and they're append-only: changing your mind is a new row, not an edit, so "she said 6, then moved to 8" stays on the timeline. The plan view shows *that* a budget was set, never the number; the ranker sees all of it, the board does not. Generating options spends someone else's rate limit, so it triggers only once `min(2, n)` participants have responded, capped at 8 options on the board.

**Common time** (`plan/time.ts`, pure, half-open `[start, end)` windows): `bestCommonWindows` sweeps every window-start/end instant once, cuts the timeline into elementary segments where the set of available people is constant, and grows a candidate window outward while the neighbouring segment's availability is a superset of the current one — O(W log W) instead of pairwise O(n²) intersection. `anytime: true` participants are kept out of the sweep entirely so a person who's always free can't invent a slot; participants who sent nothing are never counted as available; with no concrete window at all the result is `[]`, never an invented slot.

**Geography** (`plan/geo.ts`, pure): great-circle distance on a 6371.0088 km sphere — a deliberate proxy, since road distance is typically 1.2–1.4× the straight line anyway, which dwarfs the ~0.5% ellipsoid error the spherical model introduces. Centroid averages points as 3D unit vectors rather than degrees, avoiding both the antipodal-longitude-wrap bug and the fact that a degree of longitude isn't a constant distance. The search anchor is the centroid of whoever has shared a location (labelled "between N people"), falling back to the plan's own `where` slot, and to no search at all with an explicit reason if neither exists.

**Real options.** `overpass` (real OSM place), `shopify` (real storefront product), `url` (a real merchant page read directly), `manual` (typed in, human-owned). OSM/Overpass calls self-enforce a 1100ms (Nominatim) / 250ms (Overpass) rate gate, an identifying User-Agent, a host allowlist with redirects refused, and a 10-minute cache — failure never throws into the request path, it becomes an empty list plus a readable reason. Overpass reporting trouble as HTTP 200 with a `remark` and no elements is treated as a **failure**, not "nothing near you" — the one lie this module must not tell. OSM knows where a restaurant is, never what dinner costs — every venue option carries `price: null`, and a venue plan cannot convert to a group without a human supplying the amount.

**The ranker** (`plan/rank.ts`, pure): score is exactly the weighted mean of the factors that carry weight — an uncomputable factor gets **weight 0** and a stated reason, never a guessed 0.5, and every curve is linear and checkable by hand rather than a smoother, unverifiable logistic. Five factors sum to 1.00: `time_fit` (0.35, against the option's own fixed time or the best common window), `travel_fit` (0.25, a 50/50 blend of mean and worst-case trip against a 25km ceiling, so one person crossing the city can't be averaged away), `budget_fit` (0.25, per-person price against shared ceilings, currency never coerced), `preference` (0.10, mean of −1/0/+1 votes — a non-voter is not a neutral vote), `freshness` (0.05, mainly the hard exclusion of past options below). A silent participant is dropped from that factor's denominator and named in the sentence, rather than counted as a no — rejected on purpose, since it changes no ordering while making every fraction misleading. `confidence` is a separate number over *invited* participants.

Hard exclusions, checked in order, first match wins: in the past; above every shared budget (the sentence names the option's own price and how many budgets were compared, never a specific person's ceiling); closed the whole proposed window (`plan/opening-hours.ts` hand-parses the OSM grammar and treats anything it doesn't confidently recognise as unknown rather than half-trusting it, working in UTC clock time as the venue's own local time); contradicts a stated constraint (matched only on an explicit tag contradiction — never inferred from a tag's *absence*, a title guess, or a negated mention — because a wrongly-excluded option vanishes silently while a wrongly-included one just gets voted down). Excluded options stay visible on the board, marked with the reason, never dropped.

Two small pure functions keep the board honest about its own precision: `summariseRanking` flags live options within 0.05 of the top score as near-ties (one RSVP can swing a factor by 0.1–0.33, so anything closer than that is inside the noise) and separately surfaces the best-scoring *excluded* option as `strongest_rejected`, so "you'd have loved this, but it's closed" doesn't quietly sink to the bottom of the list. `diffRankings` compares a before/after snapshot around each new signal and narrates up to 3 real moves in the top 3 — reported only when an option was scored on both sides, so the *initial* ranking of a brand-new option is never mistaken for a "move."

**What this layer refuses to do:** invent a coordinate, price, or venue; count silence as agreement; convert between currencies; hide an excluded option; claim a dark source answered when it didn't; let `chooseOption` be anything but a human action; guess at a venue's opening hours it only half-parsed.

## 11. The Shopify boundary

Shopify, Prava, and Sutra are separate layers — a capability in one does not silently grant a capability in another.

| Surface | Built | Boundary |
|---|---|---|
| Public Shopify shelf | Searches configured storefronts; public title/variant/price/currency/image/stock | Best-effort public data, not an authenticated cart or universal search |
| Browser extension | Imports the active product/cart after a click | Load-unpacked; cannot log in, enter checkout, or place an order |
| Sutra group | Exact allocation, roles, policies, consent, signed evidence | A product URL is not proof the merchant supports group payment |
| Shopify POS handoff | Prepares exact shares for a cashier running split payment | No terminal connection, payment observation, or Shopify receipt in Sutra |
| Online handoff | Returns the group to authenticated merchant checkout | Merchant owns address/shipping/tax/payment/fulfilment; one card may still front the total |
| Development-store proof | Mirrors completed **test** outcomes into one valid Shopify order, `test: true`, one labeled transaction per participant | Test-only Admin API artifact — no real money, not multi-card Checkout |

One-person purchases work too: GMP/1 doesn't require a group. A single payer on an ordinary store still lands on `checkout_handoff`; on the configured development store it becomes one valid Shopify test order with one test transaction; on a verified Prava merchant rail it becomes one capped credential. The extension itself never presses checkout or inherits payment authority.

**Path A, cashier-operated POS.** Sutra closes a `ready for Shopify POS`, zero-charged receipt; the cashier builds the real cart, confirms the total, and runs Shopify's own split-payment UI, taking each person's card. Sutra never connects to the terminal, transmits a cart, or observes the transaction — the Shopify order is the evidence, not Sutra's agreement.

**Path B, ordinary online handoff.** Sutra issues an `approved for checkout`, zero-charged receipt; the organizer returns to the merchant's authenticated checkout, which computes final shipping/tax/discounts and takes payment. Sutra neither supplies nor stores the delivery address, and a one-card checkout doesn't become multi-payer just because Sutra calculated several shares.

**Path C, the development-store proof.** Uses Shopify's `orderCreate` Admin GraphQL mutation with `test: true` on both the order and each transaction. The server refuses unless `SHOPIFY_TEST_ORDER_ENABLED=true`, Prava is `mock`/sandbox (never production), the group's `origin`/`rail` are `shopify_test`/`prava_mandates`, the merchant matches the one configured storefront exactly, and the committed test-charged total matches the cart. Sutra then verifies the returned order is test-only with a matching total and transaction count, and persists only a non-sensitive summary — the address goes to Shopify but not into Sutra's own database. Still a demo adapter: a crash between Shopify creating the order and Sutra saving the proof could duplicate on retry, so it claims no production idempotency. Setup steps live in [`RUNBOOK.md`](RUNBOOK.md).

**A future production adapter** would need real cart reservation, a stable fulfilment-aware quote Sutra hashes and re-confirms before charging, real captures with reconciled idempotency references, an order marked paid only once the full total is confirmed, an explicit partial-failure policy, and real refund/fulfilment events flowing back rather than being invented. Merchant willingness or a POS feature alone is not this integration.

## 12. Roadmap: built, partly built, not built

The user-facing model is five steps — bring the plan, shape the group, set the promise, collect consent, commit or release — each mapped onto real code:

| Area | Status |
|---|---|
| Exact item/seat claimants, sponsor/backstop roles, tiered carts, quote drift with requote | Built |
| Sealed-bid contested-item auctions | Built (`protocol/auction.ts`) |
| Shared fees by mode other than pro-rata; per-group tax/tip policy | Not built — fees are pro-rata on item subtotals only |
| Circles: default people seeding a plan | Partly built — a circle does not yet propagate policy, reminders, or currency defaults |
| Private reliability facts from the event log (never a public score) | Built (`GET /v1/people/:id/reliability`) |
| Standing auto-approve rules per circle | Not built |
| Live presence and approval state over SSE | Built, both group and plan timelines |
| Push notifications | Partly built — Web Push + always-on inbox; no email/SMS |
| No-blame mode as a group setting | Built |
| Offline-safe mobile caches | Not built |
| Route the `at_venue` acceptance action over HTTP | **Built** — `POST /v1/members/:id/accept` exists and is tested; this was previously the largest gap in the build and has since closed |
| Publish the discovery documents on a public host | Built — live, and `cli/src/nanda.ts` refuses to submit a loopback URL |

**Mobile: recommendation only, not built.** Expo/React Native over the same API and account sessions, not two native forks and not a WebView wrapper — critical payment approval still opens Prava's own hosted, passkey-capable ceremony in an authenticated browser session either way, so a WebView adds store distribution and little else. `engine/src/protocol/` and `engine/src/plan/{rank,time,geo}.ts` are already pure and dependency-free, making them the natural first extraction into a shared package if the codebase ever splits into a monorepo.

**Production engine target, not built.** The shipped engine is one Fastify + `node:sqlite` process — deliberately an executable protocol proof, not a scaled service. A production version would move to PostgreSQL as the system of record, materialize projections off the append-only event log, move long-running work (mandate polling, requote, commit orchestration, notifications) into retryable idempotent workers, and add row/advisory locks where today's CAS-on-version-column is correct for one process but not two. The rule that must not regress in that move: an unknown provider outcome stays unknown until reconciled, never converted to failure just to unblock a queue — already true today in `chargeWithReconciliation`.

**Non-negotiables that survived contact with the implementation**, beyond the ones in [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md): no vertical-specific backend fork for movies, flights, dinner, or stays — they are templates over one protocol; no mobile WebView shell presented as a native app; no coordinate, price, venue, or merchant may originate from a language model, ever; no currency conversion without a rate — amounts in different currencies are never compared or coerced, and a minor-unit change is a rescale, labelled as one; a degraded external source is a sentence on the board, never a 500 and never an implied "there is nothing near you."
