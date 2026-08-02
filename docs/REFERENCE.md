# Reference — endpoints, failure taxonomy, and the fine print

This is the material that used to live in `README.md` before it got cut down to
something a judge can read in 90 seconds. Nothing here was deleted, only moved.
The front door is [`../README.md`](../README.md); this file is where the depth went.

Contents: [full endpoint inventory](#endpoints) · [the 36-case failure
taxonomy](#the-failure-taxonomy--every-way-this-dies-and-the-answer) ·
[full verification
output](#full-verification-output) · [built vs designed-not-built](#built-vs-designed-not-built)
· [honest notes on the Prava integration](#honest-notes-on-the-prava-integration)
· [NANDA, honestly](#nanda-honestly) · [pre-existing work disclosure](#pre-existing-work-disclosure)

For the end-to-end architecture — coordination layer through the commit saga to the receipt — see the root [`README.md`](../README.md) diagram and [`ARCHITECTURE.md`](ARCHITECTURE.md) §5. Storage is `node:sqlite`; every mutation is a compare-and-swap on a row version, so two people answering at the same instant cannot corrupt a decision. Money is integer minor units everywhere inside the engine; decimal strings appear only at the Prava boundary.

## Endpoints

Everything is JSON. `bearer` means `Authorization: Bearer <ENGINE_API_TOKEN>`;
`session` means a signed-in principal (cookie `sutra_uid` or header
`x-sutra-user`); `none` means the (unguessable) id in the path is the
capability. This table has 65 rows, one per table entry (some rows cover more
than one HTTP method or path) — that is a count of documentation rows, not a
claim of full coverage; re-grep `app\.(get|post|put|patch|delete)\(` across
`engine/src/routes*.ts` and the route modules under `engine/src/*/routes.ts`
for the exact current number of registered JSON routes, which runs higher
than the row count once every method on a shared path is counted separately.
Page/asset routes served by the engine's own zero-build HTML fallback
(`/`, `/new`, `/app.js`, `/widget.js`, `/g/:groupId/*`, and similar) are
deliberately out of scope here — this section documents the JSON API only.

### GMP/1 protocol

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/v1/groups` | bearer | create a group checkout |
| GET | `/v1/groups/:id` | none | full group state |
| GET | `/v1/groups/:id/events` | none | SSE timeline from a cursor |
| POST | `/v1/groups/:id/cancel` | none | cancel pre-commit; every mandate cancelled |
| GET | `/v1/groups/:id/receipt` | none | the signed receipt |
| GET | `/v1/groups/:id/joinable` | none | which member seats are still claimable |
| GET | `/v1/groups/:id/join-qr.png` | none | QR for the shared-join page |
| GET | `/v1/shopify-test/status` | none | whether the Shopify development-store proof adapter is configured on this deployment, and why not if it isn't |
| POST | `/v1/groups/:id/shopify-test-order` | session (organiser) or bearer | organiser-only: mirror a committed `prava_mandates` group created via the test-order checkout mode into one labelled Shopify test order |
| GET | `/v1/members/:id` | none | one member's own view |
| POST | `/v1/members/:id/open` | none | first open — lazily mints the Prava session |
| POST | `/v1/members/:id/decline` | none | decline |
| POST | `/v1/members/:id/hold` | none | pause the mandate; held counts as not-approved |
| POST | `/v1/members/:id/resume` | none | resume |
| POST | `/v1/members/:id/bid` | none | sealed priority bid on a contested item |
| GET | `/v1/members/:id/qr.png` | none | QR for that member's approval page |

### Coordination

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/v1/agent/plan` | none | one sentence → a plan (`dry_run: true` previews without creating) |
| POST | `/v1/plans` | none | create a plan explicitly |
| GET | `/v1/plans/:id` | none | plan state |
| GET | `/v1/plans/:id/events` | none | SSE plan timeline |
| GET | `/v1/my/plans` | session | plans you organised or were invited to |
| POST | `/v1/plans/:id/participants` | none | invite someone |
| POST | `/v1/participants/:id/signal` | none | record one answer |
| GET | `/v1/participants/:id` | none | that seat's view + what is still being asked |
| GET | `/v1/plans/:id/options` | none | ranked options + best common windows |
| POST | `/v1/plans/:id/options/refresh` | none | re-run discovery (spends someone's rate limit, so explicit) |
| POST | `/v1/plans/:id/choose` | none | lock the group choice |
| POST | `/v1/plans/:id/convert` | none | hand over to GMP/1 |
| POST | `/v1/plans/:id/cancel` | none | cancel |
| GET | `/v1/places/geocode?q=` | none | free text → candidate places |
| GET | `/v1/places/search?lat=&lng=&category=` | none | real venues near a point |
| GET | `/v1/places/status` | none | last observed reachability of the OSM sources |

### Bills, discovery, people, notifications

| Method | Path | Auth | |
|---|---|---|---|
| POST | `/v1/bill/parse` | none | bill text (or a photo, with a vision key) → itemised, reconciled lines |
| POST | `/v1/bill/split` | none | parsed bill + who-claimed-what → a group on the `at_venue` rail |
| GET | `/v1/discover/featured` | none | a curated shelf of products, shown before anyone searches |
| GET | `/v1/discover/search?q=` | none | federated product search, or resolve a pasted URL |
| GET | `/v1/discover/compare?q=` | none | the same search, grouped into like-for-like offers and ranked per unit |
| POST | `/v1/discover/resolve` | none | one product URL → a priced cart line |
| GET | `/v1/discover/sources` | none | which catalog sources answered |
| POST | `/v1/auth/register`, `/v1/auth/login` | — | email + password; sets a session cookie |
| POST/GET | `/v1/me` | — / session | pick a handle / read yourself |
| POST | `/v1/me/profile` | session | rename yourself or change your handle |
| POST | `/v1/me/signout` | session | |
| POST | `/v1/me/extension-token`, `/extension-token/revoke` | session | mint or revoke a browser-extension credential |
| POST | `/v1/extension/groups` | session | group creation from the extension; invitees must be you or a friend |
| GET | `/v1/people`, `/v1/people/:id/reliability` | none | |
| POST | `/v1/people/:id/friend`, `/unfriend` | session | |
| GET | `/v1/people/requests` | session | friend requests in both directions |
| POST | `/v1/people/:id/accept`, `/decline` | session | answer a friend request |
| GET/POST | `/v1/circles`, `POST /v1/circles/:id/delete` | session | recurring groups |
| GET | `/v1/my/groups`, `/v1/my/dashboard` | session | what needs you, and your live card exposure per currency |
| GET | `/v1/notify/status`, `/v1/notify/inbox` | mixed | |
| POST | `/v1/notify/subscribe`, `/unsubscribe`, `/read/:id`, `/read-all`, `/test` | mixed | |
| POST | `/v1/agent/propose` | none | free text → an editable cart proposal (predates `/v1/agent/plan`) |

### Threads and delegates

The thread is not a new transport: a message is a `message.posted` event on the
plan's or group's existing log, so it replays and streams over the SSE endpoints
already listed above. Tagging `@sutra` answers from real state and refuses
anything payment-shaped — see [`../engine/src/messages/bot.ts`](../engine/src/messages/bot.ts).

| Method | Path | Auth | |
|---|---|---|---|
| GET/POST | `/v1/plans/:id/messages` | session or link | the plan's thread |
| GET/POST | `/v1/groups/:id/messages` | session or link | the group's thread |
| PUT/GET | `/v1/delegate/rules` | session | standing rules your own agent may answer from |
| GET | `/v1/plans/:planId/questions` | session | what this plan still wants from you |
| POST | `/v1/participants/:id/delegate-answer` | session | answer from those rules, tagged as delegated in the log |

### Discovery

| Method | Path | |
|---|---|---|
| GET | `/.well-known/agent-card.json` | A2A AgentCard, with the GMP/1 capability extension declared |
| GET | `/.well-known/agents/sutra.json` | the same card, at the path a NANDA AI-Catalog entry points to |
| GET | `/.well-known/agent-facts.json`, `/agent-facts.json` | NANDA AgentFacts |
| GET | `/.well-known/extensions/gmp-1.json` | the extension definition, so the URI the card declares dereferences |
| GET | `/api/agents` | the AI Catalog |
| GET | `/skill.md` | `SKILL.md` as `text/markdown`, rewritten to the configured base URL |

All are unauthenticated, CORS-open and derived entirely from `APP_BASE_URL` —
point that at a real host and the whole discovery chain relocates with it.
Verified 2026-08-02 against the live engine
(`https://engine-production-e6fa.up.railway.app`): all six return 200.

Mock-only routes (`/mock/pay/:sessionId`, `/mock/pay/:sessionId/approve`,
`/mock/decline-next-charge/:memberId`) are registered **only** when the adapter
is `MockPrava`. Point anything at an engine holding a real key and they 404.

## The failure taxonomy — every way this dies, and the answer

### Protocol layer

| # | Failure | Answer |
|---|---|---|
| 1 | Member never opens the link | deadline expires them; the policy decides |
| 2 | Opens, never approves | same |
| 3 | Member declines | `all_of` aborts all; `quorum` drops and cascades; backstops may absorb |
| 4 | Passkey / OTP ceremony fails | mandate stays `pending` = not approved; retry from the same page |
| 5 | Price drift within tolerance | absorbed by the cap; the receipt records quoted vs charged |
| 6 | Drift beyond tolerance | consent binding fires → requote at the new share, round-capped at 2, then abort |
| 7 | Item gone at commit | straggler policy on that charge; tiered carts confine the damage to extras |
| 8 | Charge declined by the network | `failed` → `retry_once` / `drop_and_continue` / `halt_partial` |
| 9 | Charge succeeded, settlement report fails | report retried with backoff, **never re-charged**; `charge.settlement_pending` recorded |
| 10 | Transport dies mid-charge | before retrying, fetch the mandate's `charges[]` and look for our `reference`; if it landed, adopt its transaction id |
| 11 | Reconciliation also fails | state is **unknown**, and unknown is never failed — the group stays in `committing` and the poller re-enters under the same reference |
| 12 | Prava returns a 4xx error envelope | **terminal** refusal (wrong merchant, mandate not active, validation). Fail immediately; retrying a refusal burns the commit window and, worse, disguises a definite `no` as unknown |
| 13 | Engine crashes mid-commit | event-log replay resumes from the first unsettled entry; the attempt counter is reconstructed from `charge.attempted`, and an attempt with no recorded outcome is redone under its original reference |
| 14 | Duplicate / replayed delivery | the commit re-reads the event log and skips any plan entry already settled, and every retry carries the same idempotency reference — so a duplicate delivery is a no-op rather than a second charge |
| 15 | Member cancels from their own Prava portal | the poller sees `cancelled`/`expired` and treats it as a decline |
| 16 | Organizer cancels | every mandate cancelled; the receipt records who had approved |
| 17 | Two approvals race the decision | compare-and-swap on the row version; the loser re-reads |
| 18 | Approval URL leaks | ULIDs are unguessable, and a leaked URL still needs that member's passkey on Prava's page |
| 19 | A settlement report comes back `status: failed` or `visaConfirmation: FAILURE` | not treated as settled — settlement is only closed when Prava says `completed` **and** the network did not report FAILURE |

### Coordination layer

| # | Failure | Answer |
|---|---|---|
| 20 | Geocoder (Nominatim) down, slow, or finds nothing | `Places.geocode` returns an empty list plus a readable `reason`, never a throw. The plan is still created and simply asks everyone for their location: *"…could not be found — asking everyone for their location instead"* |
| 21 | Overpass rate-limits us (429) or times out (504) | the mirror is tried within a shared 40 s budget; if both refuse, the board is empty with the reason rendered verbatim (*"Overpass is rate-limiting us; try again in a minute"*) |
| 22 | Overpass answers HTTP 200 with a `remark` and no elements | treated as a **failure**, not as "nothing near you". An incomplete answer rendered as an empty neighbourhood is the one lie that module must not tell |
| 23 | Nobody has shared a location and the plan has no anchor | no search is run, and the plan says why: *"…there is nowhere to search around."* Status stays `gathering` |
| 24 | Only some people share a location | the search centres on the spherical centroid of those who did (radius: see the caveat in [`ARCHITECTURE.md`](ARCHITECTURE.md) §10), and `travel_fit` prints how many did not answer |
| 25 | Nobody has shared availability | `time_fit` is scored at **weight 0** with a stated reason, not at a guessed 0.5 — silence never contributes a number |
| 26 | Someone's budget is in a different currency from the price | dropped from the arithmetic and named in the sentence; currency is never coerced without a rate we do not have |
| 27 | The chosen venue has no price (OSM knows the restaurant, not the bill) | `convert` refuses: *"this option has no price attached — enter the amount, or split the real bill once you have it"* |
| 28 | Bill does not reconcile against its printed total | the delta is reported and warned about (*"do not charge anyone until this is resolved"*); nothing is invented to force a match, and every ignored line comes back in `unparsed_lines` |
| 29 | Bill has no printed total | `total: null` and the note says the itemisation is **unverified** |
| 30 | A bill line's `qty × unit` does not equal its printed amount | the printed amount wins and a warning says so — that is what the merchant charged |
| 31 | Photo of a bill, no vision key | a typed error telling you to paste the text instead; the text path needs no key and no network |
| 32 | Extractor misreads the sentence | the model only fills slots — it never picks a venue, sets a price, or invents a coordinate. Slots are editable, `uncertainties[]` is shown, and `dry_run: true` previews the reading without creating anything |
| 33 | No `OPENAI_API_KEY`, or the model call fails | the deterministic extractor runs. It is the floor, not a stub |
| 34 | A bare number with no currency (*"under 800"*) | the geocoded country decides (₹800 near Koramangala, not $800), recorded as an uncertainty. Moving between currencies with different minor-unit exponents is a **rescale**, never a conversion — no rate is applied or implied |
| 35 | Two people choose an option simultaneously | CAS on the plan version; the loser gets 409 *"the plan moved while you were choosing — try again"* |
| 36 | A plan nobody answers | expires at its deadline |

## Full verification output

Test counts drift daily on an active repo; the numbers on the front page
(`../README.md`) are whatever was true on the day you read it, personally
re-run. What follows are longer sample runs kept here because they are useful
evidence but too long for a 90-second read.

### `npm run chaos`

Random groups (3–5 members, random policies, random declines, random backstops,
random straggler policies) driven through a proxy that injects 500s, loses
responses and duplicates deliveries — then both the engine's event log and the
mock Prava's ledger are interrogated.

```
p✓✓✓✓aa✓✓p✓✓✓✓✓✓✓a✓✓✓✓✓✓✓✓✓✓✓✓p✓pa✓aa✓papaa✓✓a✓p✓✓ap✓ap✓✓✓a✓

chaos: 60 iterations, seed base 42
terminal states: {"partial":9,"committed":38,"aborted":13}

  ✓ every group reached a terminal state
  ✓ no member charged twice (mock ledger cross-check)
  ✓ aborted/expired groups have zero settled charges
  ✓ cancelled mandates have zero settled charges
  ✓ receipt totals equal the sum of settled charges
  ✓ every receipt hash chain + Ed25519 signature verifies

  GREEN WALL — the commit algorithm holds under fire.
```

Charges do not roll back. This is a saga with no compensating transactions, and
the receipt chain plus this suite are the proof we treated it that way.
`CHAOS_ITERS=200 SEED=7 npm run chaos` for a longer run.

### `npm run e2e:plan` — the coordination layer, against live OpenStreetMap

Nothing is mocked: the geocoder is Nominatim, the venues are real OSM places, the ranking is the same pure code the UI renders. A real run on "dinner saturday with Arsh and Maya near Koramangala, under 900 each" resolves deterministically to category `restaurant`, anchor Koramangala (12.9357, 77.6241), and ₹900/head (read as INR because of the geocoded country); after three participants answer in/when/where, it returns 7 real venues, best common window 20:00–22:30 UTC (3 of 3 can make it), and a top pick — Sukh Sagar at 93% — whose `time_fit` (100%) and `travel_fit` (84%, average 2.73 km / longest 5.36 km) are both backed by a printed sentence, while `budget_fit` and `preference` sit at 50% and **weight 0**, since neither has data to score against and an uncomputable factor contributes nothing rather than a fabricated middle. The winning option came from Overpass, so the group lands on `at_venue` — no card is charged — and each of the three owes ₹850.00. See [`ARCHITECTURE.md`](ARCHITECTURE.md) §10.

### `POST /v1/bill/split`, observed

A parsed ₹1,050.00 bill (3 items + 2 charges, reconciled exactly against the printed total) splits three ways to `35001 / 35000 / 34999` minor units — largest-remainder, integer arithmetic, no rounding leak — on the `at_venue` rail, with the response's own `disclosure` field stating plainly that no card is charged through sutra on this split. Each member then accepts their own number at `POST /v1/members/:id/accept`, and once the policy is satisfied the group reaches `committed` with a signed receipt reading `settled at the venue`.

## Built vs designed-not-built

The P0/P1/P2 tiers below are ours, not a hackathon rubric.

### P0 — the protocol. Built, tested, chaos-proven.

Group and member state machines with CAS versioning · append-only event log
driving SSE, the board, replay, receipts and crash recovery · the full policy
algebra (`all_of`, `quorum`, `weighted`, `veto`, `required`, `deadline`) ·
largest-remainder share computation in integer minor units · tolerance-derived
caps · lazy Prava mandate sessions · polling-based approval and external-cancel
detection (Prava has no webhooks) · crash-resumable sequential commit with
idempotency references, terminal-refusal classification and charges[]
reconciliation · straggler policies · requote cascade (round-capped at 2) ·
backstop shortfall allocation · tiered-cart adjustment · sealed-bid priority
auctions (allocation only — bids never price) · hold-my-share via mandate pause
· FX display snapshots · Ed25519-signed hash-chained receipts with offline
verification.

### P1 — the product. Built.

Next.js app (dashboard, plan board, participant answer page, approval page, war
room with replay, receipts, bill splitter, discover, people, circles,
settings) · the coordination layer end-to-end · real OpenStreetMap venue
discovery · federated product search and SSRF-hardened URL resolution ·
deterministic bill parsing with reconciliation · the four settlement rails ·
notifications (inbox always, Web Push when VAPID keys exist) · the shared page
detector behind widget, bookmarklet and Chrome extension · MCP server · CLI ·
zero-build HTML fallback surfaces.

### P2 — the ecosystem. Built; nothing published.

`nanda-town-prava/` is a real `nest.plugins.payments` entry-point plugin
(Python, Apache-2.0) registered as `prava_mandates`. Its argument is in
[`../nanda-town-prava/README.md`](../nanda-town-prava/README.md): NANDA Town's
bundled `prepaid_credits` is a pooled internal ledger, and this plugin never
pools — `pay()` maps onto a real card-network authorization, `balance()`
returns remaining authorization headroom rather than custody of anything, and
`refund()` raises `RefundNotSupportedError` post-capture rather than pretending
a settled card charge can be rolled back. Run `pytest -q` in that directory and
believe what it prints — its count moves too often to freeze here (see
`../README.md` for today's number).

`engine/src/discovery/` builds an A2A AgentCard, a NANDA AgentFacts record, an
AI Catalog entry and a served copy of `SKILL.md`, all generated from a single
endpoint inventory (`../engine/src/discovery/endpoints.ts`) so a discovery
document cannot drift from the API, and all covered by
`../engine/test/discovery.test.ts`, which asserts among other things that every
advertised path is genuinely registered in `../engine/src/routes*.ts`. All six
`.well-known` / catalog paths above return 200 against a fresh boot.

`/.well-known/ai-plugin.json` is deliberately **not** served: that manifest
belonged to ChatGPT plugins, which were sunset in April 2024, and serving a
dead manifest would be discovery cosplay.

`cli/src/nanda.ts` can validate these and submit them to the NANDA registries.
It refuses to submit a loopback or private-network URL, because both registries
*probe* what you give them and badge the listing reachable or unreachable —
submitting `http://localhost:4100` does not fail loudly, it fails quietly and
permanently in public.

### Designed, not built

- **A real card charge.** Mandate sessions mint correctly against the real
  Prava sandbox and the poller commits the group by itself once a mandate goes
  active — but completing one requires a human opening the hosted approval URL
  on a phone and passing the passkey ceremony, and no script can do that on
  their behalf. That is the security property of the protocol, and it is also
  the largest thing this repository cannot demonstrate on its own. If a receipt
  here shows a real charge, a person tapped for it.
- **Per-participant authorisation on the coordination layer.** A plan link is a
  bearer capability by design — the whole point is answering on a phone with no
  account — but the plan view hands every participant's id to anyone holding
  the plan link, which is wider than it should be. The payment layer is not
  affected: spending needs the member's own passkey on Prava's page.
- **Mobile clients.** Recommended architecture only; see
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §12.
- **Postgres, workers, transactional outbox.** The engine is one process with
  SQLite; [`ARCHITECTURE.md`](ARCHITECTURE.md) §12 describes the production target.
- **Standing rules and trust lines on recurring mandates.** L4 in
  `../spec/PROTOCOL.md` §9. Nothing is implemented.
- **AP2 interoperability.** `../spec/AP2-EXTENSION.md` is a positioning memo
  against AP2 v0.2. No AP2 mandate is issued or consumed by this code.

## Honest notes on the Prava integration

The traps, fixes, and unresolved ambiguities in the Prava API contract — no webhooks, the `authorizeOnly` check, session lazy-creation, the `standing_only` flag, idempotency-on-failure — are permanent engineering knowledge and live in one place: [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md) §2. One addition worth stating here since it's a scope decision rather than a trap: **the charge response's `credentials` field is read nowhere.** `chargeMandate()`'s return type carries only `status` and `transactionId` — Prava mints a single-use, merchant-scoped card credential per charge and this code drops it on the floor. Wiring it up is a PCI-scope decision, not a UI tweak, which is why it hasn't been made under a deadline.

## NANDA, honestly

The official AgentFacts schema
(`github.com/projnanda/agentfacts-format/agentfacts_schema.json`,
`"$id": "https://agentfacts.org/schema/v1"`) contains **no payment fields
whatsoever** — the words *payment*, *pricing*, *billing*, *mandate* and *cost*
appear zero times in it. Our record therefore puts everything payment-related
in a single clearly namespaced `x-payments` block, labelled in the document
itself as a proposed, non-standard extension
(`"proposal": "agentfacts-x-payments/draft-0"`), rather than implying it is
part of the schema. See [`../engine/src/discovery/agent-facts.ts`](../engine/src/discovery/agent-facts.ts).

## Pre-existing work disclosure

The concept and the protocol specification document (`../spec/PROTOCOL.md`)
existed before the event. **All code in this repository was written during the
hackathon.** The coordination layer, the settlement rails, the bill parser, the
venue discovery, the NANDA Town plugin, the web app and the discovery documents
were all built during the event; `../spec/PROTOCOL.md` has been extended during
it to cover the rails and the coordination phase.

## Deploy

Full instructions, every environment variable, and what to do when something
breaks: [`RUNBOOK.md`](RUNBOOK.md). Short version: engine needs any Node ≥ 22.5
host with a persistent disk for `data/` and `APP_BASE_URL` set to the public
HTTPS origin; web is `vercel.json` building `web/`, proxying `/api/*` to
`ENGINE_URL`. CORS is open on the engine, so a separate frontend origin works
either way.
