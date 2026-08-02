# REPO-MAP — what this repository actually contains

Written by reading the code and running it, not by reading other docs. Every
claim below carries a `file:line`. Where I could not verify something, it says
so explicitly instead of guessing. Line numbers are as of this session
(2026-08-02); they will drift as the codebase changes — re-grep rather than
trust them blindly a week from now.

Verification method: `Read` on the cited file, or a command whose output is
quoted. Test counts came from actually running the suites, not from any
existing doc.

---

## 1. Top-level directories

| Dir | What it is | Depends on | Size |
|---|---|---|---|
| `engine/` | The whole backend: GMP/1 protocol engine, coordination layer, all business logic, SQLite persistence, HTTP API. Everything else in this table is a client of it. | Prava (mock or real), OpenAI (optional), OSM Nominatim/Overpass (no key), Shopify storefronts (no key) | 15M excl. `node_modules`; `.ts` file/line counts and the test count all moved again during this very session (active concurrent development) — re-run `wc -l engine/src/**/*.ts` and `npm test -w engine` rather than trust any number written here |
| `web/` | Next.js 15 / React 19 app — the actual product UI. Talks to the engine only through `web/src/app/api/[...path]/route.ts`, a thin proxy that injects `ENGINE_API_TOKEN` on `POST /v1/groups` only (per the 2 Aug proxy-elevation fix). | `@sutra/engine` API over HTTP, `tesseract.js` (client-side OCR fallback for bill photos) | 137M incl. `node_modules`; `src/app` (route tree), `src/components`, `src/lib` |
| `widget/` | The page-detection heuristics (`detect.js`) shared verbatim by the web app's client-side bill scanning, the bookmarklet, and the browser extension. `widget/detect.test.mjs` is the widget's only test file and the one Node's built-in test runner (not vitest) executes. | none (pure DOM/text heuristics) | 6.9M incl. fixtures; `widget/detect.js`, `widget/widget.js`, `widget/bookmarklet.js` (built by `widget/build-bookmarklet.mjs`) |
| `extension/` | Chrome MV3 extension (manifest v3, `extension/manifest.json:2-3`, version 1.2.0). `background.js` + `content.js` + `popup.js` mount a sheet on a merchant page using the same `detect.js` as `widget/`, then POST to `/v1/extension/groups` (`engine/src/routes-v2.ts:154`). Not published to the Chrome Web Store — `manifest.json:7` host-permissions list only the Railway engine URL and localhost, and "load unpacked" is the only distribution. | engine's `/v1/extension/groups`, `/v1/me/extension-token` | 139K |
| `cli/` | Two scripts against a running engine: `cli/src/gmp.ts` (verify receipts, run demo commits/backstops) and `cli/src/nanda.ts` (publish/check NANDA discovery docs). Workspace member `@sutra/cli`, depends on `@sutra/engine` directly (in-process, not HTTP) — see `cli/package.json`. | `@sutra/engine` (workspace, in-process) | 46K, 4 files |
| `mcp/` | One file, `mcp/src/server.ts`, exposing the engine as an MCP server (spec §15): agent frameworks can originate group purchases and act as a coordination delegate (`list_open_questions`, `answer_as_delegate`, `get_plan_status`) over MCP. Charging still goes engine-side over REST (`mcp/src/server.ts:1-5`). | `@modelcontextprotocol/sdk`, engine over REST | 14K, 1 source file |
| `e2e/` | Six standalone `tsx` scripts run against a live engine (local or deployed), not part of the vitest suite: `plan-flow.ts`, `product-flow.ts`, `sandbox-smoke.ts`, `sandbox-proof.ts` (the real-sandbox-charge proof), `auth-check.ts`, `agent-mesh.ts` (the multi-delegate NANDA demo). None of these are unit tests — they hit real OSM/Shopify/Prava sandbox endpoints. | running engine, real OSM/Shopify, optionally real Prava sandbox | 76K, 6 files |
| `nanda-town-prava/` | A separate Python package (`nanda_town_prava`), the NANDA-track submission: a `nest.plugins.payments` entry-point plugin (`pyproject.toml:30-31`) that backs `nest-core`'s Nanda Town simulator with real Prava/GMP mandates instead of a pooled ledger. Has its own `pytest` suite, its own `.venv`, its own `scripts/` and `scenarios/`. | `nest-sdk` (Python), stdlib `urllib` only for the engine client (`pyproject.toml:19-22` — deliberately no HTTP dependency) | 29M incl. `.venv`; core package is 6 files (`nanda_town_prava/`), 9 test files |
| `chaos/` | One file, `chaos/src/run.ts`: GMP/1 §11 chaos suite — random groups/declines/backstops driven through a fault-injecting Prava proxy (`engine/src/prava/chaos.ts`), checked against both the engine's event log and the mock's ground truth. | `@sutra/engine` (workspace, in-process), `engine/src/prava/chaos.ts` | 14K, 1 file |
| `spec/` | The protocol specification as prose: `PROTOCOL.md` (GMP/1 itself — status "draft-2", `spec/PROTOCOL.md:3`) and `AP2-EXTENSION.md`. This is design intent, not generated from code — see §9 for places it and the code disagree or need a caveat; `wc -l spec/*.md` for current line counts. | — | 2 files |
| `docs/` | 19 markdown files: `AGENT-MESH.md`, `BUSINESS-CASE.md`, `COORDINATION.md`, `ENGINEERING-NOTES.md`, `EXPLANATION.md`, `HACKATHON.md`, `NANDA-EVIDENCE.md`, `NANDA-REGISTRY.md`, `PITCH.md`, `PITCH_DECK_SCRIPT.md`, `PRODUCT_ARCHITECTURE.md`, `PRODUCT_AND_MOBILE_ROADMAP.md`, `README.md`, `REFERENCE.md`, `RUNBOOK.md`, `SCREENSHOTS.md`, `SHOPIFY_FLOW.md`, `TRACK-EVIDENCE.md`, and this file — count and line total both drift fast, re-run `wc -l docs/*.md` rather than trust a number here. Also holds `docs/screenshots/` (product screenshots referenced by `SCREENSHOTS.md`) and `Sutra-Pitch-Deck.pdf`, neither of which is markdown. | — | ~560K across the markdown files; ~8.3M including the screenshots and the pitch-deck PDF |
| `film/` | **Gitignored — not in the repository.** Video production assets for the submission video, developed locally: scene scripts and storyboard, plus 6.6G of rendered frames, sound effects and voice tracks. The finished video is uploaded to the submission directly rather than shipped as source. Not code. | — | local only |

Not asked for but present at repo root and worth knowing about: `openapi.json` (48K, presumably a local copy of Prava's API spec — `engine/src/prava/client.ts:1-3` says it's verified byte-identical to the live spec as of 2026-08-01), `scripts/` (repo-root helper scripts, e.g. `scripts/nanda-run.mjs` which both `npm run nanda:scene` and `npm run nanda:test` shell out to), and `data/` (the runtime SQLite file, `data/gmp.db`, per `engine/src/server.ts:41`).

---

## 2. Engine module inventory (`engine/src/`)

66 files, 18,658 lines. One line each, grouped by concern. Every one-liner below is compressed from that file's own header comment (cited) plus a read of its content — not invented.

### Protocol core (GMP/1 itself — the frozen contract, spec §13)
- `types.ts` (284 lines) — money (integer minor units), `Cart`/`CartItem` zod schemas, the `Policy` algebra type, `MemberStatus`/`GroupStatus` enums, `GroupRow`/`MemberRow` row shapes, canonical-JSON hashing. `types.ts:1-7`.
- `service.ts` (1,375 lines, the largest file) — `GroupService`: group creation, member lifecycle (open/approve/decline/hold/resume), the decision point, commit execution with crash-safe reconciliation, abort/expiry. See §4/§5 below.
- `protocol/policy.ts` (127 lines) — `evaluatePolicy`: pure function evaluating `all_of`/`quorum`/`weighted`/`veto`/`required`/`deadline` policy nodes over a participant snapshot. No header comment but the code is small and self-explanatory; property-tested for monotonicity (`policy.ts:26-32`).
- `protocol/money.ts` (89 lines) — `distribute()` (largest-remainder proportional split), `computeShares()` (GMP/1 §12: per-item claimant splitting + pro-rata fees + sponsor absorption), `capFor()` (tolerance-band cap calculation).
- `protocol/backstop.ts` (57 lines) — `allocateBackstops()`: proportional shortfall allocation across willing backstops, capacity-clamped with overflow redistribution.
- `protocol/auction.ts` (45 lines) — `allocateAuction()`: sealed-bid, allocation-only priority auctions for scarce cart slots (§21.1). Bids never move money — cited explicitly, `auction.ts:1-4`.
- `db.ts` (292 lines) — raw SQLite (`node:sqlite`, not a package) schema + CAS (compare-and-swap) accessors for `groups`, `members`, `auction_bids`, `events`, `receipts`. See §3.
- `receipt.ts` (182 lines) — `ReceiptSigner`: Ed25519-signed, hash-chained receipt construction. `receipt.ts:1-4`.
- `events.ts` (74 lines) — `EventHub`: append-only event log + in-process SSE fan-out + signed webhook dispatch (HMAC-SHA256, fire-and-forget). `events.ts:7-11`.
- `ids.ts` (24 lines) — hand-rolled ULID (Crockford base32) generator, plus `groupId()`/`memberId()` prefixers.
- `rails.ts` (113 lines) — the four settlement rails as data (`RAILS` table) + `railFor()` (infers rail from merchant URL, defaulting to `checkout_handoff` or `at_venue` — the two charging rails are opt-in only) + `capabilityOf()`. Covered fully in §8.
- `poller.ts` (98 lines) — the engine's *only* inbound signal since Prava has no webhooks (verified 2026-08-01, `poller.ts:1-2`): polls for passkey approvals, external mandate cancellations, deadline enforcement, and resumes interrupted commits on boot.
- `rate-limit.ts` (79 lines) — per-device (not per-IP) rate limiting; written after a live probe fired 20 clean 401s in 16s with zero backoff (`rate-limit.ts:1-5`).
- `routes.ts` (739 lines) — the frozen `/v1/groups`, `/v1/members/*` REST+SSE surface (spec §13). `routes.ts:1`.
- `server.ts` (310 lines) — Fastify app wiring: picks `MockPrava` vs `PravaClient` by env, installs all route modules, serves `/health` and legacy static HTML.
- `index.ts` (13 lines) — barrel re-export of the protocol-core modules for `@sutra/cli` and `@sutra/chaos` to import in-process.

### Coordination layer (the product on top of the protocol — "the hour before a cart exists")
- `plan/types.ts` (313 lines) — `Plan`, `Slots`, `SignalPayload` (rsvp/availability/location/budget/vote/constraint), `OptionInput`, `ScoreFactor`/`OptionScore`, row shapes. Deliberately vertical-neutral — no movie-specific code path (`plan/types.ts:15-19`).
- `plan/service.ts` (777 lines) — `PlanService`: plan creation, signal submission with re-rank diffing, option generation (venue via Overpass / product via catalog), ranking, `chooseOption`/`convertToGroup` (the handoff into GMP/1, which decides the rail itself — an OSM venue always lands `at_venue`, a catalog option lands `checkout_handoff` unless the caller explicitly requests `shopify_pos`; a plan can never produce `prava_mandates`, see §8). See §4a/§4b.
- `plan/store.ts` (291 lines) — persistence: `plans`, `plan_participants`, `plan_signals` (append-only), `plan_options`, `plan_events`. See §3.
- `plan/rank.ts` (957 lines, second-largest file) — `scoreOption`/`rankOptions`: the explainable scorer. Every score is arithmetic a human can re-derive; the UI renders `factors` verbatim (`plan/rank.ts:1-6`).
- `plan/geo.ts` (159 lines) — great-circle distance, centroid, bounding radius over a sphere (deliberate modelling choice, not a hidden approximation — `plan/geo.ts:1-6`).
- `plan/time.ts` (305 lines) — half-open `TimeWindow` interval algebra (`bestCommonWindows` etc.); `[start, end)` semantics documented as deliberate (`plan/time.ts:1-6`).
- `plan/opening-hours.ts` (238 lines) — parses OSM `opening_hours` tags to check whether a venue is provably closed during a proposed window.
- `agent/extract.ts` (531 lines) — `extractIntent`/`extractDeterministic`/`extractWithOpenAI`: sentence → structured `Slots`. Deterministic floor always available; OpenAI (when keyed) only fills slots, never picks a venue/price (`agent/extract.ts:1-14`). See §4a and §7.
- `agent/classify.ts` (119 lines) — small closed-vocabulary category classifier (21 fixed ids), keyword table first, model only on a miss (`plan/service.ts:522-531` describes the calling contract).
- `delegate/rules.ts` (339 lines) — `decideSignals`/`decideRsvp`/`decideAvailability`: pure, synchronous, no I/O standing-rules evaluator. Structurally cannot emit a payment approval (`delegate/rules.ts:14-21`). Central to §8.
- `delegate/store.ts` (40 lines) — one row per user (`delegate_rules`), `INSERT OR REPLACE` snapshot semantics, no history.
- `delegate/routes.ts` (149 lines) — the surface any agent (MCP tool, extension, A2A agent) uses to act as a delegate for one human.
- `routes-plan.ts` (645 lines) — coordination HTTP surface (`/v1/plans/*`, `/v1/agent/plan`, `/v1/places/*`), kept apart from `routes.ts` on purpose (`routes-plan.ts:1-6`).

### Catalog / discovery (product resolution)
- `catalog/types.ts` (107 lines) — `Product`, `ProductDetail`, `ResolveResult` shapes.
- `catalog/index.ts` (85 lines) — `Catalog`: federates `ShopifySource` + `PravaShopSource` for keyword search, and owns `resolve()` for single-URL resolution.
- `catalog/sources.ts` (174 lines) — `ShopifySource` (`catalog/sources.ts:39-137`; any Shopify storefront's public `/search/suggest.json`, no key; raises `ShopifyPasswordProtected` rather than reporting "zero results" when a development-store password wall 302s every read, `catalog/sources.ts:6-19`) and `PravaShopSource` (`catalog/sources.ts:159-174`, **documented but deliberately unwired** — `available()` always returns `false`; Prava's own shop search needs Ed25519 agent request-signing a merchant `sk_test_*` key cannot do). See §7.
- `catalog/resolver.ts` (971 lines, largest catalog file) — `resolveProductUrl`: the universal single-URL resolver. Confidence-ordered strategies (JSON-LD, microdata, WooCommerce Store API, DOM heuristic), no per-merchant branches (`catalog/resolver.ts:18-23`).
- `catalog/parse.ts` (267 lines) — generic structured-data parsing primitives (JSON-LD extraction, microdata, `parseMoney`, availability) shared by the resolver.
- `catalog/fetcher.ts` (151 lines) — `safeFetch`: SSRF-hardened outbound fetch (https-only, public-address-only, size/time/redirect caps, every redirect hop re-validated) — resolver takes URLs from users (`catalog/fetcher.ts:1-3`).
- `catalog/compare.ts` (300 lines) — cross-store price comparison; the hard problem it solves is "are these two listings the same thing" (unit-normalized, currency-aware) rather than just fetching prices (`catalog/compare.ts:1-6`).
- `bill/parse.ts` (553 lines) — `parseBillText`: deterministic receipt-text → itemized `ParsedBill`. Works offline, no model in the loop (`bill/parse.ts:1-5`).
- `bill/index.ts` (184 lines) — `parseBill` (text or vision-transcribed image) + `billToCart` (bill → engine `Cart`). See §4c and §7.
- `bill/currency.ts` (79 lines) — currency inference from symbol or tax-regime, for bills with no printed symbol.
- `bill/integrity.ts` (66 lines) — `checkOcrIntegrity`: detects the "fractured decimal" OCR failure mode where a balanced reconciliation is not proof of a correct read.
- `places/index.ts` (244 lines) — `Places` façade: `geocode`/`reverse`/`search`, 10-minute TTL cache, health tracking, never throws (empty result + `reason` string instead). See §7.
- `places/nominatim.ts` (103 lines) — OSM Nominatim geocoding client; enforces the 1 req/s policy and identifying User-Agent itself.
- `places/overpass.ts` (359 lines) — `findVenues`: the actual venue lookup against Overpass, with mirror failover and a process-wide concurrency gate.
- `places/taxonomy.ts` (346 lines) — free text → OSM tag filters, checked against the OSM wiki (`places/taxonomy.ts:1-6`).
- `places/http.ts` (130 lines) — shared hardened fetch for the two OSM clients (form-POST capable, unlike `catalog/fetcher.ts`'s GET-only `safeFetch`).

### Social (accounts, friends, circles, reliability)
- `social.ts` (573 lines) — `Social` class: `users`/`friendships`/`friend_requests`/`circles`/`circle_members`/`user_sessions` schema + accessors, `assertSeatable` (the account-attachment authority check, §8), `reliability()` (evidence computed from the event log, never an assigned rating). Full detail in §3.

### Messages (chat + the @sutra bot)
- `messages/types.ts` (32 lines) — wire shape of one chat line; deliberately not its own DB table — a message *is* an event on the plan/group log it belongs to (`messages/types.ts:1-4`).
- `messages/bot.ts` (517 lines) — `mentionsSutra`, `isPaymentRequest`/`PAYMENT_REFUSAL` (the hard payment boundary, §8), intent classification and reply construction from exactly two ingredients: real stored rows and `decideSignals`' arithmetic — never a third (`messages/bot.ts:21-30`).
- `messages/classify.ts` (139 lines) — closed-vocabulary intent classifier for `@sutra` mentions, same deterministic-first/model-fallback shape as `agent/classify.ts`.
- `messages/routes.ts` (180 lines) — the chat HTTP surface for both plans and groups.

### Notify (push delivery)
- `notify/schema.ts` (92 lines) — `push_subscriptions`, `notifications` (in-app inbox — "the only channel that cannot fail"), `deliveries` (append-only attempt log). Full detail in §3.
- `notify/index.ts` (326 lines) — the delivery layer: synchronous inbox write, fire-and-forget push after.
- `notify/push.ts` (315 lines) — hand-rolled Web Push: RFC 8291 (aes128gcm) + RFC 8292 (VAPID), no dependency, pinned against the RFC's own test vector in `test/notify.test.ts` (`notify/push.ts:1-6`).
- `notify/routes.ts` (149 lines) — notification HTTP surface, strictly scoped to the signed-in caller.

### Places — see Catalog/discovery group above (grouped there since they share the "external, no key, never throws" design).

### Delegate — see Coordination layer group above.

### Prava adapters
- `prava/adapter.ts` (124 lines) — the `PravaAdapter` interface: everything the protocol needs from Prava, nothing more. Three implementations below (`prava/adapter.ts:1-3`).
- `prava/client.ts` (321 lines) — `PravaClient`: the real REST client, contracts verified field-for-field against Prava's own OpenAPI spec (`prava/client.ts:1-3`). Full detail in §7.
- `prava/mock.ts` (305 lines) — `MockPrava`: offline simulator matching the real sandbox's lifecycle semantics (pending→active on passkey, caps, idempotent charges), zero network, zero test-card burn (`prava/mock.ts:1-4`).
- `prava/chaos.ts` (102 lines) — fault-injecting proxy wrapping any adapter with probabilistic 500s/timeouts/duplicates for the chaos suite; refuses to wrap anything but the mock (`prava/chaos.ts:1-4`).

### Discovery (how another agent finds/trusts this engine — NANDA/A2A surface, distinct from "catalog/discovery")
- `discovery/index.ts` (13 lines), `discovery/endpoints.ts` (386 lines, the single generated inventory everything else derives from), `discovery/agent-card.ts` (431 lines, A2A AgentCard), `discovery/agent-facts.ts` (350 lines, NANDA AgentFacts, schema-validated against the real vendored schema), `discovery/catalog.ts` (217 lines, the AI Catalog at `/api/agents` + NANDA Index record), `discovery/routes.ts` (192 lines, wires all of the above to HTTP, every URL derived from `APP_BASE_URL`).

### Uncategorized top-level routers
- `routes-v2.ts` (765 lines) — "discovery + social routes": auth, `/v1/extension/groups`, people/circles/dashboard, `/v1/bill/parse` + `/v1/bill/split`, `/v1/discover/*`. Kept apart from `routes.ts` (frozen contract) for the same reason `routes-plan.ts` is (`routes-v2.ts:1-3`).

---

## 3. The data model

Two SQLite databases' worth of tables in one file (`node:sqlite`, not a package — `db.ts:5-8`), installed by four `install*Schema` functions called from `server.ts`: `db.ts` (protocol core), `social.ts:installSocialSchema`, `plan/store.ts:installPlanSchema`, `delegate/store.ts:installDelegateSchema`, `notify/schema.ts:installNotifySchema`. Messages have **no table of their own** — a chat line is an `events`/`plan_events` row with `type: 'message.posted'` (`messages/types.ts:1-4`), which is why messages inherit replay/SSE for free.

### Protocol core (`db.ts:20-103`)

- **`groups`** — one row per GMP/1 session. Key columns: `id` (`gs_<ulid>`), `merchant_json`/`cart_json`/`cart_hash` (canonical-JSON-hashed cart, tamper-evident), `policy_json` (the `Policy` algebra tree), `status` (`GroupStatus`), `rail` (`'prava_mandates' | 'shopify_pos' | 'checkout_handoff' | 'at_venue'`, see §8; the column's own `ALTER TABLE` default is `'prava_mandates'` for legacy-row migration only — `createGroup` always sets it explicitly from `railFor()`), `origin` (free text; values seen in the code include `'bill'`, `'extension'`, `'plan'`, `'discover'`, `'shopify_test'`), `locked_json` (the frozen charge plan once committing), `version` (optimistic-concurrency counter for CAS updates, `db.ts:155-163`).
- **`members`** — one row per seat. FK `group_id → groups(id)`. Key columns: `user_id` (nullable — the account behind this seat, or null for a bare name), `role` (`payer|sponsor|backstop|observer`), `share_amount`/`cap_amount` (minor units), `status` (`MemberStatus`), `prava_session_id`/`prava_approval_url`/`prava_mandate_id`/`prava_charge_txn_id` (the share-side Prava lifecycle), `backstop_session_id`/`backstop_mandate_id`/`backstop_absorbed` (a parallel, independent Prava lifecycle for the same member acting as a backstop), `on_hold` (0/1 — "hold my share", counts as pending at decision time), `version`.
- **`auction_bids`** — append-only, `(group_id, member_id, sku, amount, seq)`. Sealed bids for contested cart lines (§21.1); the reveal only happens through `allocateAuction`, never a direct read.
- **`events`** — append-only, never UPDATEd/DELETEd (`db.ts:87-88`). `(seq, group_id, member_id, type, payload_json, created_at)`. This is the single source of truth for SSE, replay, receipts, and crash recovery — `service.ts` repeatedly reads it back (e.g. `succeededCharge()`, `service.ts:950-961`) rather than trusting the mutable `members` row, specifically to survive a crash mid-charge.
- **`receipts`** — one row per group (`group_id` PK), `receipt_json` — the signed terminal artifact (§4).

### Social (`social.ts:67-133`)

- **`users`** — `id`, `handle` (unique), `name`, `email` (unique, case-insensitive via `lower(email)` index), `accent`, `password_hash` (added defensively via `addColumn`, `social.ts:132`).
- **`friendships`** — **two rows per friendship** (`user_id`, `friend_id`), so a lookup never needs an `OR` (`social.ts:78`).
- **`friend_requests`** — one row while an ask is outstanding, `(from_id, to_id)` PK, deleted on accept/decline.
- **`circles`** — `id`, `owner_id`, `name`, `emoji`, `policy_json` (optional default policy for the circle).
- **`circle_members`** — `(circle_id, user_id)` PK.
- **`user_sessions`** — companion-client credentials (browser extension). Only `token_hash` (SHA-256) is persisted; `social.ts:112-114` — losing the DB cannot reveal a usable token.
- Group/member ownership columns bolted onto the protocol-core tables via `addColumn`: `groups.created_by`, `groups.circle_id`, `groups.product_json`, `members.user_id` (`social.ts:128-131`).

### Coordination (`plan/store.ts:22-94`)

- **`plans`** — `id` (`pl_<ulid>`), `intent_text`, `kind` (`venue|product|bill|open`), `slots_json`, `ask_json` (which `SignalKind`s this plan wants), `status` (`PlanStatus`), `chosen_option_id`, `group_id` (set on conversion), `rail` (provisional until an option is chosen — `plan/service.ts:97-101`), `version`.
- **`plan_participants`** — `plan_id` FK, `user_id` (nullable), `display_name`, `contact`, `role` (`organizer|guest`), `responded_at`.
- **`plan_signals`** — append-only, `(seq, plan_id, participant_id, kind, payload_json)`. "Latest row per (participant, kind) wins" except `vote`, which keys additionally on `option_id` inside the payload since one participant can hold one vote per option (`plan/store.ts:209-225`).
- **`plan_options`** — the shortlist: `source` (`overpass|shopify|url|manual`), `place_json`/`when_json`/`price_json`, `raw_json` (the literal upstream response, for provenance).
- **`plan_events`** — mirrors the protocol's `events` table for the plan phase, same append-only discipline.

### Delegate (`delegate/store.ts:12-19`)

- **`delegate_rules`** — `user_id` PK, `rules_json` (a `StandingRules` snapshot, `INSERT OR REPLACE`, no history — a standing rule is a fact about the human, not the plan, `delegate/store.ts:8-10`).

### Notify (`notify/schema.ts:7-56`)

- **`push_subscriptions`** — one row per *browser*, not per person (`notify/schema.ts:9-10`): `endpoint` (unique), `p256dh`/`auth` (Web Push keys), `failure_count`.
- **`notifications`** — the in-app inbox, `user_id`, `kind`, `title`, `body`, `url`, `read_at`.
- **`deliveries`** — append-only per-channel attempt log (`inbox|push`, `ok|failed|gone|skipped`), because a boolean on the notification cannot answer "did it actually reach her phone" (`notify/schema.ts:43-45`).

### Relationships worth naming explicitly
- `members.group_id → groups.id`, `plan_participants.plan_id → plans.id`, `circle_members.circle_id → circles.id`: conventional FKs (declared with `REFERENCES` but SQLite FK enforcement is only as strong as `PRAGMA foreign_keys = ON`, set at `db.ts:18`).
- `groups.circle_id` and `plans.circle_id` are **soft** references to `social.ts`'s `circles` table — no FK constraint, cross-module by convention only.
- A group's `product_json` and a plan's `chosen_option_id` are how the coordination layer's provenance survives the handoff into the protocol-core `groups` table (`plan/service.ts:649-691`, the `product_json` fields themselves at `plan/service.ts:680-687`).
- **No balance, ledger, or wallet table exists anywhere in this schema.** The team's own docs made this claim in prose ("there is no balance anywhere in the schema, by design"); I independently confirm it by having read every `CREATE TABLE` in the engine — there genuinely is none.

---

## 4. The four request flows, traced by function call

### 4a. A sentence becomes a plan with ranked venues

1. UI: `web/src/app/app/plan/new/page.tsx:66` — dry-run preview via `api.post('/v1/agent/plan', { text, dry_run: true })`, then `:86` the real create.
2. `POST /v1/agent/plan` — `engine/src/routes-plan.ts:395-492`.
3. `extractIntent(text, now)` — `engine/src/agent/extract.ts:520-531`: tries `extractWithOpenAI` if `OPENAI_API_KEY` is set (`extract.ts:522-524`), catches any failure and falls back to `extractDeterministic` (`extract.ts:525-527`, regex/keyword tables at `extract.ts:38-63`).
4. `locationPhrase(text)` then `d.places.geocode(phrase)` — `routes-plan.ts:419-424` → `engine/src/places/index.ts:84-108` → `nominatimGeocode` (`places/nominatim.ts`). The extractor only ever names a place *phrase*; only Nominatim turns it into coordinates (`routes-plan.ts:416-419`).
5. Currency/budget rescaling from the geocoded country (`routes-plan.ts:432-440`, `currencyForCountry`/`rescaleMinor`).
6. `d.plans.createPlan(...)` — `engine/src/plan/service.ts:81-132`: inserts the `plans` row at `status: 'gathering'` (`plan/service.ts:94`) with a provisional rail of `checkout_handoff` (`plan/service.ts:97-101` — a plan is coordination, not payment capability; the concrete rail is only decided when an option converts to a group, see §8), seats the organiser and any named participants (`social.assertSeatable` gate at `plan/service.ts:120`).
7. `d.plans.generateOptions(plan.id)` — `plan/service.ts:264-274` (queued) → `generateOptionsNow`, `plan/service.ts:276-386`: for `kind === 'venue'`, computes a search anchor from participant `location` signals or the geocoded place (`searchAnchor`, `plan/service.ts:493-520`), resolves the category via the keyword table or a constrained model call (`resolveCategoryText`, `plan/service.ts:532-537`), then `d.places.search(...)` → `engine/src/places/overpass.ts` (`findVenues`). A prior empty search never wipes an existing board (`plan/service.ts:371-383`).
8. Response includes `plan: planView(...)`; the board itself is read via `GET /v1/plans/:id/options` → `PlanService.ranked()` (`plan/service.ts:419-449`) → `rankOptions`/`scoreOption` (`plan/rank.ts:372-...,734-`).

### 4b. A pasted link becomes a group

1. UI: `web/src/components/discover/discover-client.tsx:138-162` (`resolveUrl`) — `api.post('/v1/discover/resolve', { url })`.
2. `POST /v1/discover/resolve` — `engine/src/routes-v2.ts:755` → `catalog.resolve(url)` → `engine/src/catalog/resolver.ts:69` (`resolveProductUrl`): https-only (`assertHttps`), rejects known non-shops (`isNotAShop`, `resolver.ts:65-67,78-86`), then runs confidence-ordered strategies (JSON-LD → microdata → WooCommerce Store API → DOM heuristic) via the SSRF-hardened `safeFetch` (`catalog/fetcher.ts`).
3. UI switches to the builder (`discover-client.tsx:155`, `setMode('build')`); `web/src/components/discover/builder.tsx:350` posts the assembled cart to `POST /v1/groups`, with the rail set from the shopper's own checkout-mode pick (`builder.tsx:367`, see step 4).
4. `POST /v1/groups` — `engine/src/routes.ts:83` → `service.createGroup(input)` — `engine/src/service.ts:63-205`: validates sponsor/backstop shape, computes the auction-eligibility of contested items (`service.ts:82-111` — explicitly *not* inferred for bill-origin carts, see §8), calls `railFor({ merchantUrl, requested })` (`service.ts:85` → `engine/src/rails.ts:93-109`). For a plain resolved product page this returns `checkout_handoff` by default — a real, non-`.test` host proves where the item came from, not that the merchant can be charged. `prava_mandates` is reached only when the caller explicitly requests it; in the shipped UI that happens exactly once, from the discover builder's "Capped card mandates" checkout-mode tile, which is only selectable against the one configured Shopify development-store merchant (`web/src/components/discover/builder.tsx:367`, `web/src/components/discover/how-it-completes.tsx:44-59`). `createGroup` then inserts the `groups`/`members` rows at `status: 'invited'`/`'collecting'`, emits `group.created` + one `member.invited` per seat. See §8 for all four rails.
5. Alternative path for the browser extension specifically: `POST /v1/extension/groups` (`engine/src/routes-v2.ts:180-211`) takes a fully-formed `CreateGroupInput` straight from the extension's on-page sheet, hardcodes `rail: 'checkout_handoff'` regardless of the merchant URL (`routes-v2.ts:185-193` — "reading a page is not a merchant payment integration"), and calls the same `service.createGroup`, returning absolute URLs (because they render into the merchant's own DOM, not sutra's — `routes-v2.ts:195-199`).

### 4c. A photographed bill becomes a settled group

1. `POST /v1/bill/parse` — `engine/src/routes-v2.ts:589-613`: `parseBill({ text, image_base64 }, { currency })` — `engine/src/bill/index.ts:109-131`. Text path is fully deterministic (`parseBillText`, `bill/parse.ts`). Image path requires `OPENAI_API_KEY`; without it, throws `BillParseError('no_vision_key', ...)` with an explicit "paste it as text instead" message (`bill/index.ts:117-123`) — it does not silently degrade.
2. Vision, when used, only transcribes pixels → text (`transcribeReceipt`, `bill/index.ts:135-184`); the transcript is re-parsed by the same deterministic `parseBillText` the paste path uses (`bill/index.ts:125-126`) — the model is never trusted with arithmetic (`bill/index.ts:9-13`).
3. `checkOcrIntegrity(parsed)` — `engine/src/bill/integrity.ts` — flags the "fractured decimal" OCR failure mode.
4. `POST /v1/bill/split` — `routes-v2.ts:616-696`: re-runs `parseBill`, **refuses outright** (not just warns) if `integrity.suspect && !force` (`routes-v2.ts:646-649`), then `billToCart(bill, { claimantsByItemIndex })` — `bill/index.ts:54-86` (handles printed amounts that don't divide evenly by quantity, and pro-rata discount application).
5. `social.assertSeatable(me.id, body.members)` — `routes-v2.ts:654` (§8).
6. `service.createGroup({ ..., merchant: { url: 'https://venue.local.test' }, rail: 'at_venue', origin: 'bill' })` — `routes-v2.ts:656-683`. The `.local.test` host is deliberate: `railFor()` (`rails.ts:100`) treats any `.test` host as "not a merchant", forcing `at_venue` even if a caller tried to request a charging rail.
7. Because `rail === 'at_venue'`, every member's consent act is `acceptShare` (§4d, §5), not a Prava mandate; the group settles via `settleAtVenue` (§4d) the moment its policy is satisfied.

### 4d. A member approves and the group commits

1. Member opens `/a/:memberId` → `POST /v1/members/:id/open`? actually `service.openMember(memberId)` — `engine/src/service.ts:215-301`: first open flips `invited → viewed` (`:219-224`). If the rail has no mandates (`at_venue`), flips `viewed → awaiting_approval` with no Prava call at all (`:233-244`). Otherwise mints a real Prava mandate session (`prava.createMandateSession`, `:249-277`) and, separately, a backstop standing-offer session if the seat has `backstop_cap > 0` (`:280-298`).
2. **Card rail:** the poller (`engine/src/poller.ts`) detects the passkey approval and calls `service.memberApproved(memberId, mandateId)` — `service.ts:304-316`: `awaiting_approval → approved`, emits `member.approved`, calls `this.decide(groupId)`.
   **At-venue rail:** the member calls `POST /v1/members/:id/accept` — `routes.ts:353-383` (ownership-gated, see §8) → `service.acceptShare(memberId)` — `service.ts:323-341`: `→ approved` directly (no mandate), calls `decide()`.
3. `decide(groupId)` — `service.ts:386-426`: builds a `Participant[]` snapshot from member statuses (`approved`/`on_hold` → `pending|approved`; `declined|expired|dropped|failed` → `declined`; else `pending`), runs `evaluatePolicy(policy, participants, now)` (`protocol/policy.ts:33`). `satisfied` → `lockAndCommit`; `unsatisfiable` → `abort(..., 'aborted')`; still `open` at a forced deadline tick → `abort(..., 'expired')`.
4. `lockAndCommit` — `service.ts:428-527`: drops any paying, non-locked, non-terminal member (`status → 'dropped'`); recomputes shares over the locked set via `adjustCartForLocked`+`computeShares`; if the cart total exceeds what locked members' caps can cover, first tries `allocateBackstops` (§ protocol core), and if that's insufficient runs a **requote cascade** (`requoteCascade`, `service.ts:529-567`) that resets over-cap members to `viewed` at a new share so they re-approve (max 2 rounds, else `abort('aborted')`). Otherwise sets `groups.status = 'committing'`, `locked_json = plan`, and calls `executeCommit`.
5. `executeCommit → runCommit` — `service.ts:574-657`: if the rail can't charge (`at_venue`), delegates to `settleAtVenue` — `service.ts:665-692` (locks each `share` entry to `status: 'settled'`, `charged_amount: 0`, then `groups.status = 'committed'`). If it can charge, iterates the locked plan calling `chargeEntry` (`service.ts:700-780`) per member: writes `charging` before the call, calls `chargeWithReconciliation` (`service.ts:802-847` — 5 retries with backoff, reconciles via `findChargeByReference` on any non-terminal error before ever risking a double charge), and on success calls `settle()` which **writes `status: 'charged'` to the DB before** attempting the (also-retried) settlement report (`service.ts:867-876` — the exact crash-double-charge fix landed on 2 Aug). Terminal 4xx errors fail immediately without retry (`prava/client.ts:33-35`); a fully-exhausted-and-unreconciled charge returns `'unknown'` and the group stays in `committing` for the poller to resume (`service.ts:606-611`).
6. Final `groups.status` is `committed` only if every share entry reached `charged`/`settled` and every backstop entry that was allocated actually absorbed (`service.ts:633-640`); otherwise `partial`.
7. `issueReceipt` signs and stores the terminal `Receipt` (`receipt.ts`), and `cfg.notifier?.notify(...)` fires per member with a `user_id` (`service.ts:645-655`).

---

## 5. State machines

Read from `engine/src/types.ts` (declarations) and `engine/src/service.ts`/`engine/src/plan/service.ts` (actual transitions, found by grepping every `casGroup`/`casMember`/`casPlan`/`casParticipant` call and every literal status string — not inferred from prose).

### `MemberStatus` (`types.ts:98-115`)

`invited | viewed | awaiting_approval | approved | declined | expired | dropped | charging | charged | settled | failed`. `MEMBER_TERMINAL = {declined, expired, dropped, charged, settled, failed}` (`types.ts:113-115`). `isSettled(status)` is `charged || settled` (`types.ts:118-120`) — the predicate every surface must use instead of hand-rolling "did this person pay."

| Transition | Trigger | Where |
|---|---|---|
| (insert) → `invited` | `createGroup` | `service.ts:162` |
| `invited` → `viewed` | first `openMember` call | `service.ts:219-224` |
| `viewed` → `awaiting_approval` | `openMember`, at_venue rail (no mandate minted) | `service.ts:233-244` |
| `viewed` → `awaiting_approval` | `openMember`, card rail (mandate session minted) | `service.ts:249-277` |
| `awaiting_approval` → `approved` | `memberApproved` (poller sees passkey done), card rail | `service.ts:304-316` |
| `invited/viewed/awaiting_approval` → `approved` | `acceptShare`, at_venue rail only | `service.ts:323-341` |
| any non-terminal → `declined` | `declineMember` (explicit decline or external mandate cancel) | `service.ts:352-364` |
| non-locked, non-terminal payer → `dropped` | `lockAndCommit`, once policy is satisfied around a different locked set | `service.ts:438-441` |
| every remaining non-terminal payer → `dropped` (or `expired` if not yet approved) | `abort()` (group cancel/unsatisfiable/deadline) | `service.ts:1010-1022` |
| `approved` → `charging` | `chargeEntry`, immediately before the first charge attempt | `service.ts:711-717` |
| `charging`/in-flight → `charged` | `recordCharged`, once a transaction id is confirmed | `service.ts:913-931` |
| (share entry, at_venue) → `settled` | `settleAtVenue` | `service.ts:665-677` |
| any → `failed` | `failEntry` (no mandate at commit time, or a terminal charge decline) | `service.ts:963-968` |
| over-cap at requote → `viewed` (re-enters the approval loop) | `requoteCascade` | `service.ts:546-564` |

`on_hold` (0/1, `types.ts:212-214`) is an orthogonal flag, not a status: `holdShare`/`resumeShare` (`service.ts:1184-1197`) toggle it on an already-`approved` member; `decide()` reads `approved + on_hold` as `'pending'` (`service.ts:407`).

### `GroupStatus` (`types.ts:122-134`)

`draft | collecting | deciding | committing | committed | partial | aborted | expired`. `GROUP_TERMINAL = {committed, partial, aborted, expired}` (`types.ts:132-134`).

| Transition | Trigger | Where |
|---|---|---|
| (insert) → `collecting` | `createGroup` | `service.ts:132` |
| `collecting` → `committing` | `lockAndCommit`, once `evaluatePolicy` returns `satisfied` | `service.ts:516-524` |
| `committing` → `committed` | `runCommit`, all share/backstop entries settled | `service.ts:640-643` |
| `committing` → `partial` | `runCommit`, some entries not settled (a `halt_partial` straggler halt, or unresolved failures) | `service.ts:640-643` |
| `collecting/committing` → `aborted` | `abort()`: policy unsatisfiable, requote cap exceeded, or explicit `cancelGroup` | `service.ts:420,536,1003-1013` |
| `collecting/committing` → `expired` | `abort()`: deadline passed with policy still open | `service.ts:424` |
| at_venue: `committing` → `committed` | `settleAtVenue` | `service.ts:679` |

**`draft` is declared but dead.** I grepped every `.ts` file under `engine/src/` for the literal `'draft'`: the only hit is the type declaration itself (`types.ts:123`). No code path ever inserts, reads, or checks for a group in `draft` status — `createGroup` always inserts directly at `collecting` (`service.ts:132`). This is a vestigial enum member, not a bug (nothing depends on it existing or not), but it is worth knowing the type is wider than the implementation.

**`deciding` is real but never persisted for a group**, and this is *documented accurately*, not a contradiction: `spec/PROTOCOL.md:90-93` states the transition chain as `collecting → deciding → committing → committed` and then says outright "`deciding` is instantaneous in this implementation." I confirmed this against the code: `decide()` (`service.ts:386-426`) evaluates the policy and, if satisfied, calls `lockAndCommit` synchronously in the same function call — a group's `status` column goes `collecting` straight to `committing`, never stopping at a persisted `deciding` row. The only place `'deciding'` appears as a group check is `poller.ts:59`'s defensive `g.status !== 'collecting' && g.status !== 'deciding'`, which is dead in practice since nothing ever writes it. **Do not confuse this with the Plan status machine below**, where `'deciding'` *is* a real, persisted, and observable status — the two types share a name for a conceptually similar but operationally different state.

### `PlanStatus` (`plan/types.ts:31-41`)

`gathering | options | deciding | converted | cancelled | expired`. `PLAN_TERMINAL = {converted, cancelled, expired}` (`plan/types.ts:41`).

| Transition | Trigger | Where |
|---|---|---|
| (insert) → `gathering` | `createPlan` | `plan/service.ts:94` |
| `gathering` → `options` | `generateOptions`, once at least one option lands | `plan/service.ts:408` |
| any non-terminal → `deciding` | `chooseOption` — **persisted**, unlike the group status of the same name | `plan/service.ts:553` |
| → `converted` | `convertToGroup`, once the GMP/1 group is created | `plan/service.ts:691` |
| any non-terminal → `cancelled` | `cancelPlan` | `plan/service.ts:703` |
| any non-terminal → `expired` | `expireIfDue` (poller tick past `deadline_at`) | `plan/service.ts:713` |

---

## 6. What is genuinely tested

Ran directly this session (PowerShell for the engine suite — Git Bash does throw a config error and run zero tests there, confirmed; that is a documented PowerShell-vs-Git-Bash difference, not a code bug, so it was left as-is rather than "fixed"):

```
npm test -w engine        →  Test Files  43 passed (43)   Tests  716 passed (716)   (vitest, PowerShell)
npm run test:widget       →  33 pass, 0 fail               (node --test widget/detect.test.mjs)
pytest -q  (nanda-town-prava/, via .venv\Scripts\python.exe -m pytest -q)
                           →  117 passed, 1 skipped
```

These are point-in-time numbers from one run — and the engine number above already moved once *during* this same editing session, from 690/41 to 716/43, purely from other work landing in parallel. See §9 for how fast these have historically drifted. **Re-run the commands above rather than trust any test count quoted anywhere, including this one.**

### Engine — one line each per file (from each file's own top-level `describe(...)`); the list below was 41 files at the time it was written and is not guaranteed complete against a faster-moving tree

| File | Covers |
|---|---|
| `accept-authority.test.ts` | who may call `acceptShare` for a bare-name vs. account-linked seat |
| `allocators.test.ts` | `allocateBackstops` |
| `bill-auction.test.ts` | the shared-dish-became-an-auction regression (2 Aug security pass, fixed) |
| `bill-integrity.test.ts` | `checkOcrIntegrity` (fractured-decimal detection) |
| `bill.test.ts` | `parseBillText` against real Indian restaurant bills (₹, CGST/SGST, round-off) |
| `cancel-authority.test.ts` | who may cancel a group with an account behind it (2 Aug security pass, fixed) |
| `catalog-accuracy.test.ts` | resolver price accuracy against `parse.ts`-owned fixtures |
| `classify.test.ts` | the optional OpenAI category classifier |
| `compare.test.ts` | reading a size out of a product title, for cross-store comparison |
| `crash-double-charge.test.ts` | crash-between-charge-and-bookkeeping (2 Aug security pass, fixed) |
| `dashboard-exposure.test.ts` | `GET /v1/my/dashboard` exposure bucketed by rail capability, not member status |
| `delegate.test.ts` | `decideSignals` refusing what standing rules don't cover |
| `discovery.test.ts` | `AgentFacts` schema validity |
| `integration.test.ts` | a full commit, end to end, in-process |
| `location-phrase.test.ts` | lowercase/informal place names still geocoding (2 Aug security pass, fixed) |
| `malformed-body.test.ts` | malformed JSON, and adjacent input-validation failures, stay a 4xx and never a 500 |
| `messages-bot.test.ts` | `mentionsSutra` |
| `messages-classify.test.ts` | `classifyIntentWithOpenAI` only ever returns a validated label |
| `messages-routes.test.ts` | the payment boundary, through the real chat endpoint |
| `money.test.ts` | `distribute` (largest-remainder split) |
| `notify.test.ts` | RFC 8291 `aes128gcm` against the RFC's own test vector |
| `opening-hours.test.ts` | `parseOpeningHours` |
| `overpass-race.test.ts` | `raceHedged` (mirror failover) |
| `placeholder-names.test.ts` | a model inventing "friend1"/"friend2" is rejected (2 Aug regression guard) |
| `places-cache.test.ts` | the `Places` TTL cache |
| `places.test.ts` | Overpass response normalisation |
| `plan-math.test.ts` | `normalise` (plan-layer arithmetic helpers) |
| `plan-participant-privacy.test.ts` | the plan-participant IDOR (2 Aug security pass, fixed) |
| `plan-rerank.test.ts` | `submitSignal`'s re-rank diffing/narration |
| `policy.test.ts` | policy-algebra semantics |
| `profile-update.test.ts` | `Social.updateProfile` and the real `POST /v1/me/profile` HTTP route |
| `rails.test.ts` | rail selection (`railFor`) |
| `rate-limit.test.ts` | brute-forcing the real `/v1/auth/login` route |
| `receipt-verify.test.ts` | `verifyReceipt` rejecting a receipt signed by the wrong engine key |
| `reliability-counts.test.ts` | `Social.reliability` counting non-card commitments |
| `resolver-live-fixes.test.ts` | hashbang/Ecwid-style links refused before any fetch |
| `resolver.test.ts` | `parseMoney` |
| `shopify-test-order.test.ts` | the Shopify development-store proof adapter: order/transaction creation, the Dev Dashboard client-credentials token exchange, and `GET /v1/shopify-test/status` |
| `social-privacy.test.ts` | what the `/v1/people` directory exposes |
| `social-recent.test.ts` | `recentCollaborators` |
| `social-session.test.ts` | companion (extension) sessions |

### Widget — 1 file, `widget/detect.test.mjs`, 33 tests
Structured-data extraction across real-world fixtures: Shopify, WooCommerce (AggregateOffer range edge case), Eventbrite, IKEA (`@graph` buried types), Nike (SPA/variant pricing), cardekho.com (mixed-type JSON-LD graph), Bandcamp, Craigslist (309-product search page correctly returning zero "the" product), Wikipedia (negative control), a Shopify `/cart.js` outranking page markup, dead-cart fallback, manual highlight override, JSON-LD `Order`, microdata `Product`, DOM-heuristic subtotal-vs-total, currency inference from `<html lang>` and TLD, and a same-detector-everywhere check (`widget.js`/`extension/detect.js`/`detect.js` all carry identical logic).

### `nanda-town-prava` — 9 test files (excluding `conftest.py`), 117 passed + 1 skipped
`test_baseline_comparison.py`, `test_concurrency.py`, `test_conservation.py` + `test_conservation_property.py` (a Hypothesis-style property test — its single `def test_` runs many generated cases, which is most of why the file-level `def test_` count (59) undercounts the collected-test count (118)), `test_group_payment.py`, `test_no_secret_material.py`, `test_protocol_conformance.py`, `test_refund_honesty.py`, `test_unknown_state.py`. Names are self-describing; I did not open each file individually given the volume, but the plugin's own module docstring (`nanda_town_prava/plugin.py:1-34`) states the property under test precisely: `pay()` never moves pooled funds, `pay_group()` puts N humans/cards/passkeys behind one purchase, charged sequentially with idempotent recovery so the group ends either everyone charged in one window or every mandate cancelled — the docstring's own wording ("atomically enough") is a looser gloss on that same sequential-with-recovery mechanism, not a literal atomic commit.

`npm run nanda:test` (root) shells out to exactly `.venv .../python -m pytest -q` in `nanda-town-prava/` (`scripts/nanda-run.mjs:23-25`) — i.e. it is the *same command* I ran directly, so the 117/1 result is not an artifact of how I invoked it.

---

## 7. External dependencies

| Dependency | Used for | Needs a key? | Behaviour when unavailable |
|---|---|---|---|
| **Prava** (sandbox/prod REST API) | Mandate sessions, charges, settlement reports, cancel/pause/resume — the entire card-rail lifecycle. `prava/client.ts` verified field-for-field against `docs.prava.space`'s OpenAPI spec, re-verified 2026-08-01 (`prava/client.ts:1-3`). | Yes — `PRAVA_API_KEY` must start `sk_` (secret key; a `pk_` publishable key throws immediately rather than silently 401ing, `prava/client.ts:45-49`). | `PRAVA_ENV` defaults to `'mock'` (`server.ts:40`); if not mock but the key is missing, the engine logs an error and **falls back to `MockPrava`** rather than crashing (`server.ts:48-52`). `MockPrava` replicates the real lifecycle semantics offline (`prava/mock.ts:1-4`) so the whole demo runs with zero network. Mid-call failures are handled per §4d/§8 (terminal 4xx = fail fast; transport error = reconcile-then-retry; exhausted-and-unresolved = `'unknown'`, never silently retried past that point). |
| **Prava's own shop search** (separate from the mandate API) | Would let the catalog search Prava's own merchant listings. | N/A — not usable from a merchant key at all. | Permanently unavailable by design: `PravaShopSource.available()` hardcodes `false` (`catalog/sources.ts:163-165`); its `unavailableReason` string tells the caller to paste a URL instead. This was verified live (`catalog/sources.ts:152-157`): `prava shop search` authenticates with Ed25519 agent request-signing, which a merchant `sk_test_*` key cannot do. |
| **OpenAI** (`api.openai.com/v1/chat/completions`) | Three narrow uses, all optional and all fail-open to deterministic behaviour: (1) sentence→slots extraction (`agent/extract.ts:520-531`), (2) category classification when the keyword table misses (`agent/classify.ts`, `plan/service.ts:532-537`), (3) receipt-photo transcription — pixels to text only, never arithmetic (`bill/index.ts:135-184`), (4) `@sutra` chat intent classification on a keyword miss (`messages/classify.ts`). | Yes — `OPENAI_API_KEY`. `OPENAI_MODEL` env var overrides the default (`gpt-4.1-nano`) per call site. | Extraction/classification: silently falls back to the deterministic path (`extract.ts:525-527`; `plan/service.ts:535` `.catch(() => null)`). Bill vision specifically: **throws** `BillParseError('no_vision_key', ...)` with an explicit message to paste text instead (`bill/index.ts:117-123`) — this is the one place a missing key is a hard stop rather than a silent fallback, because there is no deterministic substitute for reading a photo. |
| **OpenStreetMap Nominatim** (geocoding) | Turning a place name/phrase into coordinates (`places/nominatim.ts`). | No key. Requires an identifying `User-Agent` (`places/http.ts:22-23,62`) and self-enforces the 1 req/s usage-policy cap (`nominatim.ts:8-12`) rather than relying on the caller to. | Never throws past `Places.geocode` — returns `{ places: [], reason: <human string> }` (`places/index.ts:93-107`); the `reason` classifies timeout/429/5xx/other (`places/index.ts:238-244`). |
| **OpenStreetMap Overpass** (venue search) | Real venues with real coordinates for the `venue`-kind plan flow (`places/overpass.ts`). | No key. | Same never-throw contract: `Places.search` returns `{ venues: [], reason }` (`places/index.ts:158-172`); a mirror-failover + process-wide concurrency gate protect the donated endpoint (`overpass.ts:1-6`). A prior non-empty board is never wiped by a subsequent empty search (`plan/service.ts:371-383`). The team separately reported this endpoint as *slow/unreliable in practice* ("restaurant near Koramangala returns zero venues, bar takes 39s") — I did not independently re-measure live latency; that is a live-service characteristic, not something the code under test proves or disproves. |
| **Shopify storefronts** (any store, via public `/search/suggest.json`) | Keyword product search across a configurable default shelf of stores (`catalog/sources.ts:39-137`), plus as one strategy inside the universal URL resolver. | No key — public storefront endpoint. | `ShopifySource` is one of `Catalog`'s federated sources; a dark store just contributes zero results, reported per-source in `GET /v1/discover/sources` (`routes-v2.ts:764`). A password-protected development store now raises `ShopifyPasswordProtected` instead of reporting a silent zero (`catalog/sources.ts:6-19`). |
| **WooCommerce stores** | Handled *inside* `catalog/resolver.ts` as one confidence-ordered single-URL resolution strategy (`fromWooCommerce`, `resolver.ts:383-433`, using the public WooCommerce Store API), **not** as a separate federated search source the way Shopify is. There is no `WooCommerceSource` class — I checked; only `ShopifySource` and `PravaShopSource` exist in `catalog/sources.ts`. | No key — public Store API. | Resolution simply falls through to the next-lower-confidence strategy (microdata, then DOM heuristic) if the WooCommerce-specific reads fail. |

---

## 8. Honest boundaries

### The four settlement rails, and what each may claim (`engine/src/rails.ts`)

There are four, not two — `checkout_handoff` and `shopify_pos` were added after this section was first written, and both are more conservative than `prava_mandates`, not less: they exist specifically so a resolved product URL does not silently get treated as a chargeable merchant just because it parses.

`RAILS.prava_mandates` (`rails.ts:41-51`): `charges: true`, `mandates: true`, `settled_verb: 'charged'`. Disclosure text, shown to every member before they accept and rendered verbatim on the receipt: *"Your card is charged directly by the merchant, up to the cap you approve and no further. The cap is enforced by the card network, not by this app. Nobody fronts money and no funds are pooled."*

`RAILS.shopify_pos` (`rails.ts:52-62`): `charges: false`, `mandates: false`, `settled_verb: 'ready for Shopify POS'`. Disclosure: *"No card is charged through sutra. Everyone confirms their exact share here, then the cashier uses Shopify POS split payment and charges each person directly. This receipt proves the agreement, not the POS payment."*

`RAILS.checkout_handoff` (`rails.ts:63-74`): `charges: false`, `mandates: false`, `settled_verb: 'approved for checkout'`. Disclosure: *"No card is charged and no merchant order is placed through sutra. Everyone confirms the proposed split, then the group returns to the merchant checkout. A one-card checkout still needs a merchant adapter before several people can pay one order without somebody fronting it."* This is the honest admission that sutra does not place the merchant order for a shared online cart, stated in the rail's own disclosure text rather than only in prose — and it is where a plain resolved product URL lands by default (see below).

`RAILS.at_venue` (`rails.ts:75-86`): `charges: false`, `mandates: false`, `settled_verb: 'settled at the venue'`. Disclosure: *"No card is charged through sutra on this split. Everyone agrees their exact amount here, then pays the venue directly on their own card. What you get is the arithmetic, the agreement, and a signed record of who owed what — not a payment."*

`railFor()` (`rails.ts:93-109`) decides mechanically: no merchant URL, or a placeholder/`.test`/`localhost` host, → `at_venue`; any other real host → `checkout_handoff`. **Neither of the two charging-shaped rails is ever chosen automatically — only an explicit `requested` rail selects `prava_mandates` or `shopify_pos`** (`rails.ts:94`), and a caller cannot request a charging rail for a bill because the bill-split path deliberately hands `railFor` a `.local.test` URL (`routes-v2.ts:658-663`, confirmed by `rails.ts:100`). Plans go through separate, inline logic in `convertToGroup` rather than `railFor` at all: an OSM venue option always settles `at_venue`; a catalog option settles `checkout_handoff` unless the caller explicitly passed `shopify_pos` (`plan/service.ts:612-624`) — a plan can **never** produce `prava_mandates`. In the product UI, the one place that actually sends `requested: 'prava_mandates'` is the discover builder's "Capped card mandates" checkout-mode tile, itself only selectable against the single configured Shopify development-store merchant (`web/src/components/discover/builder.tsx:367`). `capabilityOf(rail).charges` gates every place `runCommit` decides whether to call Prava at all (`service.ts:593`) — a code path, not just a label, prevents any non-`prava_mandates` group from ever reaching `chargeMandate`.

The receipt itself carries the same disclosure in its `settlement_disclosure` field (`receipt.ts:51-56`) specifically so a receipt "printed, emailed, handed to a judge" cannot be mistaken for proof of a payment it never claims.

### What an agent may and may not do

Two independent, textually-searched-for enforcement points, not one shared gate:

1. **`delegate/rules.ts` (standing-rules delegate).** `decideSignals` is pure, synchronous, no I/O (`delegate/rules.ts:9-12`). Its output type, `DecideResult { signals: SignalPayload[] }`, draws from `SignalPayload` (`plan/types.ts:144-152`) — `rsvp | availability | location | budget | vote | constraint`. **There is no payment-shaped variant in that union.** The file's own comment states the property directly: *"The one thing this file will never produce is an approval to pay... there is structurally nothing here it could reach out and guess WITH"* (`delegate/rules.ts:14-21`). This is a type-system guarantee, not a keyword filter — an agent calling this code cannot construct a payment approval even if it tried, because no such value is representable.
2. **`messages/bot.ts` (`@sutra` chat delegate).** `isPaymentRequest()` (`messages/bot.ts:85-89`) matches a payment-word regex (`approve|checkout|mandate|autopay|...`, `bot.ts:70`) plus an explicit phrase list (`'pay for'`, `'charge my'`, `'settle up'`, `'put it on my card'`, etc., `bot.ts:71-83`) and is deliberately over-broad — any message merely *shaped like* a payment instruction gets the fixed `PAYMENT_REFUSAL` string (`bot.ts:91-94`), never a judgment call about whether it was a command or a question, because that judgment call is explicitly the one this bot is not trusted to make (`bot.ts:56-67`).
3. **The passkey ceremony itself stays off-limits to any agent by construction, not by a check anyone could accidentally bypass**: minting a Prava mandate session only produces an `approvalUrl` (an iframe URL) — the actual approval requires a human completing a passkey ceremony in a browser on their own device; nothing in `PravaAdapter` (`prava/adapter.ts`) exposes a way to complete that step programmatically.

### What a bare-name participant loses

`Social.assertSeatable()` (`social.ts:335-351`) is the enforcement point: attaching somebody else's **account** (a non-null, non-self `user_id`) to a seat requires `areFriends(actorId, id)` to already be true, or it throws `403` (`social.ts:344-349`). A seat with `user_id: null` — a bare name — is explicitly, deliberately allowed through with no check at all (`social.ts:340-341`, `if (!id) continue`). The method's own comment states what that costs the person: *"no notifications and no history, because there is no account to attach either to"* (`social.ts:331-333`) — and now adds "the UI says so," a claim the comment makes but that a backend read cannot itself confirm (see the UNVERIFIED note below).

Independently, `POST /v1/members/:id/accept` (`routes.ts:353-383`) enforces the mirror-image rule at read time: if the seat *does* have a `user_id`, only that account (or the `ENGINE_API_TOKEN` bearer) may call accept on it (`routes.ts:371-379`) — "anyone with the group link could record somebody else's agreement, and on this rail the output is a SIGNED RECEIPT" (`routes.ts:362-366`). A bare-name seat has no such gate because there is no account to gate against — the link itself *is* the credential, which is the entire pass-the-phone design and cannot be tightened without deleting it (`routes.ts:368-370`) — the same design the 2 Aug fix restored (renaming `assertLinkedFriends` → `assertSeatable` after an over-tightened version rejected bare names outright).

I could not find, and did not expect to find, any code path where a bare-name participant is warned about this cost inline in the API response — the UI is presumably where that disclosure lives, and confirming that was out of scope for a backend code map. **UNVERIFIED**: whether every UI surface that creates a bare-name seat actually shows this warning to the organiser at creation time; I read the engine, not the full `web/src/components` tree.

---

## 9. Where documentation contradicts the code

Found by comparing `README.md` and `spec/PROTOCOL.md` against what running the suites and reading the source actually produced. Two earlier internal docs, `STATUS.md` and `HANDOFF.md`, were retired and deleted after repeatedly shipping stale test counts — their file:line citations no longer resolve, so they are not cited below. Their durable content moved to [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md) (the invariants, the Prava traps, the file ownership map), [`RUNBOOK.md`](RUNBOOK.md) (operations), and [`REFERENCE.md`](REFERENCE.md) (the pre-existing work disclosure).

1. **Test counts go stale within hours of active development, and every doc that has ever quoted one has been wrong before its next read.** Snapshots taken across one day of work climbed from 626 tests across 35 files, to 631/36, to 648/37, to 690/41 — each superseded before the next doc pass caught up, and the last of those was superseded again, to **716 tests across 43 files**, by other work landing in parallel with this very editing session. `README.md` deliberately does not embed a test transcript anymore, for exactly this reason — it tells the reader to run `npm test -w engine` themselves instead. **Do not quote a test count from any doc without re-running the suite first** — including this one, by the time you read it.

2. **The NANDA pytest count follows the identical pattern.** Earlier snapshots recorded far lower counts before the plugin's test suite grew. Actual result, run directly this session (`.venv/Scripts/python.exe -m pytest -q` in `nanda-town-prava/`) and independently confirmed by tracing `npm run nanda:test` to the identical invocation (`scripts/nanda-run.mjs:23-25`): **117 passed, 1 skipped.**

3. **`GroupStatus.draft` (`types.ts:123`) is declared in the type but assigned nowhere.** Not a contradiction of any doc found (no doc claims `draft` is used), but worth recording here since it otherwise takes a grep to rediscover (`grep -rn "'draft'" engine/src/`, one hit, the declaration).

4. **`GroupStatus.deciding` is correctly documented as ephemeral** — `spec/PROTOCOL.md:90-93` says outright that `deciding` "is instantaneous in this implementation," and I confirmed that against `service.ts:386-426` (`decide()` never persists an intermediate `deciding` status; it evaluates and, if satisfied, calls `lockAndCommit` in the same synchronous call). This is not a contradiction — I'm recording it as a place where the spec is *unusually* precise, specifically so nobody "fixes" `poller.ts:59`'s defensive `deciding` check thinking it's dead code by mistake; it is dead in practice but intentionally so.

5. **`catalog/sources.ts` and `catalog/resolver.ts` disagree, harmlessly, about what "a source" means for WooCommerce.** No doc claims WooCommerce is a federated search source the way Shopify is, but "Shopify/WooCommerce storefronts" read together as a paired external dependency could suggest parity. It is not symmetric: Shopify has a `CatalogSource` class searchable independent of any URL (`ShopifySource`, `catalog/sources.ts:39-137`); WooCommerce support exists only as one strategy inside the single-URL resolver (`fromWooCommerce`, `catalog/resolver.ts:383-433`) with no keyword-search equivalent. User-facing copy should say "paste a WooCommerce product link" and avoid implying WooCommerce stores are keyword-searchable the way the default Shopify shelf is.

6. **Endpoint count is approximate, and "how many are undocumented" is unverified.** Grepping every route registration (`app.(get|post|...)(`) across `routes.ts`, `routes-plan.ts`, and `routes-v2.ts` finds 64 endpoints as of this session. I did not cross-reference that list against `README.md`'s endpoint tables or `openapi.json` to independently count how many of those are undocumented anywhere — flagging that as unverified rather than asserting a number.

No other prose claim in `docs/PRODUCT_ARCHITECTURE.md`, `spec/PROTOCOL.md`, or `docs/COORDINATION.md` that I checked against the code (the rail disclosures, the `MemberStatus`/`GroupStatus` transition chains apart from the two items above, the "no pooled funds" claim, the delegate boundary) turned out to be wrong — where I quote spec prose in §5 and §8 above, I checked it against the implementing code and it held.
