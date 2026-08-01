# Sutra product, platform, and mobile roadmap

This roadmap expands the original GMP/1 build specification without weakening its central constraint: Sutra coordinates consent; it never pools money, stores card data, or turns one friend into the group lender.

**Status of this document.** Sections marked **Built** describe code in this repository, with the file that implements them. Everything else is roadmap and is written in the future tense on purpose. If you are checking claims, [`README.md`](../README.md) has the built/not-built split with test output attached, and the [Non-negotiables](#non-negotiables) at the end are the constraints that survived contact with an implementation.

## Product north star

Sutra should become the default place a group turns an intention into one coordinated checkout.

The user-facing model is deliberately simpler than the protocol:

1. **Bring the plan** — search an idea, paste a merchant link, scan a receipt, or import a cart. **Built:** free text via `POST /v1/agent/plan`, URL resolution via `engine/src/catalog/resolver.ts`, receipt parsing via `engine/src/bill/`, cart import via the widget/extension detector.
2. **Shape the group** — choose people or a circle, assign items, split shared costs, and add sponsors/backstops. **Built.**
3. **Set the promise** — show each person what they receive, what they can be charged, and what makes the group proceed. **Built** for the card rail. The rails work added the sentence that says *whether a card is charged at all* (`engine/src/rails.ts`); it reaches the organiser and the receipt today, and needs to reach the member approval page as part of routing the `at_venue` accept action.
4. **Collect consent** — native push, universal link, passkey approval, live presence, reminders, and a clear deadline. **Partly built:** Web Push, links, passkey approval on Prava's hosted page, SSE presence and deadlines all work; native push and reminder schedules do not.
5. **Commit or release** — charge the locked set in one window, or cancel every mandate. Produce a portable signed receipt. **Built.**

The protocol algebra remains available as an advanced layer, but the primary UI expresses it as human choices: “everyone,” “any 4 of 5,” “wait until 8pm, then go with whoever is ready,” and “Maya must be included.”

## Product domains

### Moments

Consumer entry points, not hard-coded vertical products:

- movies and ticketed events;
- flights, stays, and trips;
- restaurants and shared carts;
- group gifts and targets;
- clubs, dues, and recurring circles;
- arbitrary merchant URLs and agent-originated purchases.

Each moment is a template over the same primitives: cart, items, allocations, people, policy, deadline, mandate, and receipt.

**Built, and the design held.** The coordination layer is vertical-neutral by construction: “movie with friends”, “dinner Saturday”, “four tickets at this URL” and “split this bill” are the same object with different slots and a different option source ([`docs/COORDINATION.md`](COORDINATION.md)). Adding a vertical means adding an option source, not a branch. What is *not* built is a curated template per moment — today a group starts from a sentence or a link, not from a tile.

### Allocation engine

Evolve “divide equally” into a composable allocation plan:

- exact item/seat/room claimants — **built**;
- quantity-aware contested items — **built** (sealed-bid allocation, `engine/src/protocol/auction.ts`);
- shared fees allocated equally, proportionally, by item, or manually — **partly built**: fees are pro-rata on item subtotals, largest remainder; the other modes are not exposed;
- tax/tip/service charge policies — **partly built**: the bill parser classifies tax, service, tip, delivery, discount and other charges and reconciles them against the printed total, but there is no per-group policy for how to allocate them differently;
- sponsor and dependent relationships — **built**;
- backstop capacity and allocation order — **built** (proportional to caps, `engine/src/protocol/backstop.ts`);
- per-member display currency with an auditable snapshot — **built** (FX snapshot recorded on the group and shown on member views; the charge currency is always the merchant's);
- tiered carts where optional extras cannot kill the core purchase — **built**;
- quote drift with explainable re-consent — **built** (tolerance-derived caps, requote cascade capped at 2 rounds).

Every recomputation should return both numbers and an explanation tree. The UI, receipt, support tools, and audit log should all render from that same explanation.

**Partly built, and the coordination layer is where it went furthest.** `rank.ts` already returns the arithmetic alongside the number, and the UI renders those sentences verbatim — there is no second, prettier explanation. The *allocation* side has a decision narrative and a full event log but not yet a structured explanation tree.

### Circles

Circles are recurring groups with defaults, not merely saved contact lists:

- default people, roles, policy, reminders, display currencies, and backstop preferences — **partly built**: a circle carries default people and seeds a plan's participant list automatically; a group records the circle it came from but does not yet inherit anything else from it;
- private reliability facts derived from Sutra events, never a public social score — **built** (`GET /v1/people/:id/reliability`: groups, approvals, declines, approval rate, median latency, totals charged and backstopped);
- standing rules such as “auto-approve my share under ₹1,500 for Movie Crew” backed by the correct Prava primitive — **not built**;
- shared history, receipts, saved merchants, and repeat-cart templates — **not built**;
- transparent monthly exposure and revocation controls — **partly built**: `GET /v1/my/dashboard` reports live exposure per currency, split into authorized / charging / settled / backstop-armed / owed-at-venue. There is no monthly view and no bulk revocation.

### Coordination

- live presence and approval state over SSE initially, WebSocket fan-out when scale requires it — **SSE built** on both the group and plan timelines;
- push notifications, email/SMS fallback, deep links, QR, and NFC join — **partly built**: Web Push (RFC 8291 + RFC 8292, hand-rolled on `node:crypto`) plus an inbox that always works, QR for member and join pages, an NFC totem programmer page. No email or SMS;
- no-blame mode as a first-class group setting — **built**, including the rule that the organiser is the one viewer it does not hide declines from;
- private decline reasons, optional alternatives, and deadline negotiation — **not built**;
- append-only timeline with a user-readable decision narrative — **built** on both layers;
- offline-safe invitation and approval-state caches on mobile — **not built**.

## Mobile recommendation

**Not built. Recommendation only.**

Build the iOS and Android clients with **Expo + React Native**, not two separate native apps and not a WebView wrapper.

Why:

- one product team can ship both platforms while retaining native push, universal links, secure storage, camera/QR, NFC, biometrics, haptics, and background refresh;
- the existing TypeScript protocol types, API schemas, split calculations, and state-machine tests can be shared;
- critical payment approval still opens Prava’s hosted, passkey-capable ceremony through an authenticated browser session, so Sutra does not rebuild card entry;
- native navigation and notifications matter far more for this product than sharing DOM components with the website.

Recommended monorepo shape:

```text
apps/web             Next.js marketing + desktop product
apps/mobile          Expo Router app for iOS and Android
services/api         HTTP/SSE edge, auth, rate limits, request validation
services/worker      mandate polling, commit sagas, notifications, reconciliation
packages/contracts   generated OpenAPI types and Zod schemas
packages/domain      money, allocation, policies, state machines, explanation trees
packages/client      typed API client, query keys, retry/idempotency helpers
packages/design      tokens, copy primitives, icon rules; no DOM/native components
packages/telemetry   event names, traces, redaction, error taxonomy
```

The current repository is a flatter version of this — `engine/` holds the API, the workers and the domain in one process; `web/` is the Next.js app. `engine/src/protocol/` and `engine/src/plan/{rank,time,geo}.ts` are already pure and dependency-free, so they are the natural first extraction into `packages/domain`.

Mobile launch sequence:

1. **Companion MVP** — sign in, universal-link invitation, approval status, push reminders, live group board, receipts.
2. **Organizer parity** — create from link/share sheet, edit allocation, choose circle/policy, send invites.
3. **Mobile-native advantages** — contact suggestions with consent, QR scanner, NFC join/programming on supported Android devices, Wallet receipt/pass, calendar deadline, widgets/live activities.
4. **Agent and circle layer** — voice/agent-assisted creation, standing rules, recurring groups, delegate approvals with explicit caps.

Use passkeys for Sutra account authentication as well as Prava approval. Store only refresh credentials in Keychain/Keystore. Support magic-link recovery, device/session management, and remote revocation.

## Production architecture

**Not built.** The current Fastify + `node:sqlite` engine is an executable protocol proof: one process, one file, compare-and-swap on row versions, an in-process event hub and a 1.5-second poller. Production should preserve its pure domain core while separating coordination from serving traffic.

### Data and state

- PostgreSQL as the durable system of record.
- Append-only `group_events` table plus materialized group/member projections. *(The append-only log exists today; the projections are computed on read.)*
- Unique constraints on `(group_id, member_id, operation, attempt)` and provider idempotency references. *(Today the idempotency reference is `gmp:<group>:<member>:<source>:<attempt>` and uniqueness is enforced by the provider, not by us.)*
- Transactional outbox for jobs and notifications; no “write DB, then hope enqueue succeeds.”
- Row/advisory locks around group decisions and commit ownership. *(Today: CAS on a version column, plus an in-process re-entrancy guard on `executeCommit`. Correct for one process; not for two.)*
- Signed receipt objects in immutable object storage, with key rotation metadata. *(Today the signing seed comes from `ENGINE_SIGNING_SEED` and is generated at boot if absent — fine for a demo, wrong for anything that must verify next year.)*
- Redis only for ephemeral presence, rate limits, and fan-out — not correctness.

### Saga workers

Move long-running work out of the API process:

- mandate-session creation;
- mandate polling and reconciliation;
- deadline evaluation;
- requote cascade;
- commit orchestration;
- settlement reporting;
- notifications and reminder schedules;
- receipt finalization.

Every job is retryable, idempotent, lease-owned, and observable. Unknown provider outcomes remain unknown until reconciled; they are never converted to failure just to unblock a queue. *(This last rule is already implemented — see `chargeWithReconciliation` in `engine/src/service.ts` — and it is the one behaviour that must not regress in the move.)*

### API boundaries

- versioned public GMP API distinct from private product/BFF endpoints. *(Already separated by file: `routes.ts` is the frozen `/v1/groups` contract; `routes-v2.ts` and `routes-plan.ts` are the product layer built on top of it. Not yet separated by deployment or by token scope.)*
- generated clients from one OpenAPI contract;
- cursor-based event streams with resumable `Last-Event-ID`. *(SSE already carries `id:` and accepts an `after` cursor; the browser client does not yet resume on it.)*
- scoped tokens for agents/widgets and session-bound credentials for humans;
- explicit tenant/actor/role authorization on every route;
- SSRF-resistant merchant resolver with egress allow/deny policy, DNS rebinding defense, size/time limits, content-type validation, and isolated fetching. **Built** for both the catalog fetcher and the OSM client (`engine/src/catalog/fetcher.ts`, `engine/src/places/http.ts` — host allowlist, HTTPS enforced, redirects refused, byte caps);
- webhook signature verification plus replay protection when providers add webhooks. *(Prava has none today; the poller is the design.)*

### Security and privacy

- replace handle-cookie identity with passkey/OIDC auth before any public launch. **This is a launch blocker, not a nice-to-have.** Today a handle in a cookie picks who you are. It grants no spending power — spending needs the member's own passkey on Prava's page, so the weakest link in this identity scheme cannot cost anyone money — but it is not authentication;
- encrypted sensitive metadata, managed secrets, key rotation, least-privilege service identities;
- audit every organizer action, policy change, and privileged support read;
- redact approval URLs, tokens, provider payloads, and personal data from logs;
- per-user export/deletion workflows that preserve legally required receipt proofs through pseudonymization;
- CSP, trusted image proxying, CSRF protection, rate limiting, abuse controls, and dependency scanning in CI.

### Reliability target

- multi-AZ API and workers;
- point-in-time PostgreSQL recovery and regularly tested restores;
- SLOs for invite creation, event freshness, decision latency, and reconciliation age;
- traces keyed by `group_id`, `member_id`, and idempotency reference;
- provider circuit breakers and visible degraded-mode UX. *(The pattern exists for the OSM sources — a dark source becomes a sentence on the board, never a 500 — and should be generalised.)*
- synthetic commit/abort runs against the mock adapter on every deployment;
- chaos and property suites retained as release gates. *(`npm run chaos` and `npm test` are the gates today.)*

## Delivery order

### Phase 1 — product foundation

- finish the responsive design system and core create/approve/board/receipt journeys — **substantially done**;
- make the allocation explanation tree shared and authoritative — **done for ranking, outstanding for allocation**;
- **route the `at_venue` acceptance action.** `GroupService.acceptShare()` exists and is tested, but has no HTTP endpoint, so a bill-split group cannot reach `committed` over the API. This is the largest concrete gap in the build and it belongs at the front of the queue;
- **publish the discovery documents.** The AgentCard, AgentFacts record, AI Catalog entry and served SkillMD are all live on a running engine, and `cli/src/nanda.ts` will submit them — but it correctly refuses a loopback URL, so nothing is registered until the engine has a public host;
- passkey/OIDC identity, notifications, analytics, accessibility, localization — notifications partly done, the rest outstanding;
- upgrade production dependencies and keep `npm audit`/lockfile scanning green.

### Phase 2 — mobile companion and hardened engine

- Expo companion clients;
- PostgreSQL, workers, transactional outbox, resumable event stream;
- provider reconciliation dashboard and support tooling;
- universal links, push, QR, and mobile receipts.

### Phase 3 — broader commerce

- merchant adapters with a capability registry;
- travel/event-specific allocation templates over the common model;
- cart import, receipt scan, share-sheet intake, agent-originated sessions — **largely built** via the widget/bookmarklet/extension detector, the bill parser and the MCP server;
- production widget/SDK with scoped credentials and origin restrictions — the widget exists; the scoped credentials do not.

### Phase 4 — network effects

- circles, standing rules, recurring mandates where supported;
- delegate agents and negotiation for contested items;
- trust lines and backstops with clear exposure controls — backstops are built; the standing trust line on a recurring mandate is not;
- enterprise/club administration and protocol federation.

## Non-negotiables

The first six were in the original specification. The rest came out of building the settlement rails and the coordination layer, and each one exists because the opposite behaviour was available, easier, and would have been a lie.

- No pooled balance and no peer-to-peer debt ledger masquerading as settlement.
- No silent allocation changes after a person approves.
- No second charge to “repair” an unknown first attempt.
- No public reliability score or coercive decline UX.
- No vertical-specific backend fork for movies, flights, dinner, or stays; they are templates over one protocol.
- No mobile WebView shell presented as a native app.
- **The word *charged* is reserved for money this engine actually moved.** A rail that cannot charge produces `settled`, never `charged`; the two are distinct member states, distinct verbs on every surface, and distinct fields in the receipt. `verifyReceipt` fails an `at_venue` receipt that reports a non-zero charged total.
- **No merchant is inferred from a URL that is not one.** A map page, a brochure site, or the schema's placeholder host does not make something chargeable. When there is no reachable merchant, say so and take the other rail.
- **Nothing is invented to make arithmetic close.** A bill that does not reconcile against its printed total is reported as not reconciling, with every unread line returned; the printed line amount always wins over a computed one.
- **Silence is not agreement.** A participant who has not answered is never counted as a yes, is never folded in with someone who deliberately abstained, and is always named in the sentence that explains the number.
- **No coordinate, price, venue or merchant may originate from a language model.** A model may propose structure over text a human wrote; every fact underneath it comes from a named source with its raw response retained.
- **No currency conversion without a rate.** Amounts in different currencies are not compared, coerced, or silently added. Changing an amount's minor-unit exponent is a rescale and is labelled as one.
- **A degraded external source is a sentence, not an exception.** A dark geocoder or a rate-limited venue API produces an honest empty board with the reason on it, never a 500 and never an implied "there is nothing near you".
