# Sutra product, platform, and mobile roadmap

This roadmap expands the original GMP/1 build specification without weakening its central constraint: Sutra coordinates consent; it never pools money, stores card data, or turns one friend into the group lender.

## Product north star

Sutra should become the default place a group turns an intention into one coordinated checkout.

The user-facing model is deliberately simpler than the protocol:

1. **Bring the plan** — search an idea, paste a merchant link, scan a receipt, or import a cart.
2. **Shape the group** — choose people or a circle, assign items, split shared costs, and add sponsors/backstops.
3. **Set the promise** — show each person what they receive, what they can be charged, and what makes the group proceed.
4. **Collect consent** — native push, universal link, passkey approval, live presence, reminders, and a clear deadline.
5. **Commit or release** — charge the locked set in one window, or cancel every mandate. Produce a portable signed receipt.

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

### Allocation engine

Evolve “divide equally” into a composable allocation plan:

- exact item/seat/room claimants;
- quantity-aware contested items;
- shared fees allocated equally, proportionally, by item, or manually;
- tax/tip/service charge policies;
- sponsor and dependent relationships;
- backstop capacity and allocation order;
- per-member display currency with an auditable snapshot;
- tiered carts where optional extras cannot kill the core purchase;
- quote drift with explainable re-consent.

Every recomputation should return both numbers and an explanation tree. The UI, receipt, support tools, and audit log should all render from that same explanation.

### Circles

Circles are recurring groups with defaults, not merely saved contact lists:

- default people, roles, policy, reminders, display currencies, and backstop preferences;
- private reliability facts derived from Sutra events, never a public social score;
- standing rules such as “auto-approve my share under ₹1,500 for Movie Crew” backed by the correct Prava primitive;
- shared history, receipts, saved merchants, and repeat-cart templates;
- transparent monthly exposure and revocation controls.

### Coordination

- live presence and approval state over SSE initially, WebSocket fan-out when scale requires it;
- push notifications, email/SMS fallback, deep links, QR, and NFC join;
- no-blame mode as a first-class group setting;
- private decline reasons, optional alternatives, and deadline negotiation;
- append-only timeline with a user-readable decision narrative;
- offline-safe invitation and approval-state caches on mobile.

## Mobile recommendation

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

Mobile launch sequence:

1. **Companion MVP** — sign in, universal-link invitation, approval status, push reminders, live group board, receipts.
2. **Organizer parity** — create from link/share sheet, edit allocation, choose circle/policy, send invites.
3. **Mobile-native advantages** — contact suggestions with consent, QR scanner, NFC join/programming on supported Android devices, Wallet receipt/pass, calendar deadline, widgets/live activities.
4. **Agent and circle layer** — voice/agent-assisted creation, standing rules, recurring groups, delegate approvals with explicit caps.

Use passkeys for Sutra account authentication as well as Prava approval. Store only refresh credentials in Keychain/Keystore. Support magic-link recovery, device/session management, and remote revocation.

## Production architecture

The current Fastify + SQLite engine is an excellent executable protocol proof. Production should preserve its pure domain core while separating coordination from serving traffic.

### Data and state

- PostgreSQL as the durable system of record.
- Append-only `group_events` table plus materialized group/member projections.
- Unique constraints on `(group_id, member_id, operation, attempt)` and provider idempotency references.
- Transactional outbox for jobs and notifications; no “write DB, then hope enqueue succeeds.”
- Row/advisory locks around group decisions and commit ownership.
- Signed receipt objects in immutable object storage, with key rotation metadata.
- Redis only for ephemeral presence, rate limits, and fan-out—not correctness.

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

Every job is retryable, idempotent, lease-owned, and observable. Unknown provider outcomes remain unknown until reconciled; they are never converted to failure just to unblock a queue.

### API boundaries

- versioned public GMP API distinct from private product/BFF endpoints;
- generated clients from one OpenAPI contract;
- cursor-based event streams with resumable `Last-Event-ID`;
- scoped tokens for agents/widgets and session-bound credentials for humans;
- explicit tenant/actor/role authorization on every route;
- SSRF-resistant merchant resolver with egress allow/deny policy, DNS rebinding defense, size/time limits, content-type validation, and isolated fetching;
- webhook signature verification plus replay protection when providers add webhooks.

### Security and privacy

- replace handle-cookie identity with passkey/OIDC auth before any public launch;
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
- provider circuit breakers and visible degraded-mode UX;
- synthetic commit/abort runs against the mock adapter on every deployment;
- chaos and property suites retained as release gates.

## Delivery order

### Phase 1 — product foundation

- finish the responsive design system and core create/approve/board/receipt journeys;
- make the allocation explanation tree shared and authoritative;
- passkey/OIDC identity, notifications, analytics, accessibility, localization;
- upgrade production dependencies and keep `npm audit`/lockfile scanning green.

### Phase 2 — mobile companion and hardened engine

- Expo companion clients;
- PostgreSQL, workers, transactional outbox, resumable event stream;
- provider reconciliation dashboard and support tooling;
- universal links, push, QR, and mobile receipts.

### Phase 3 — broader commerce

- merchant adapters with a capability registry;
- travel/event-specific allocation templates over the common model;
- cart import, receipt scan, share-sheet intake, agent-originated sessions;
- production widget/SDK with scoped credentials and origin restrictions.

### Phase 4 — network effects

- circles, standing rules, recurring mandates where supported;
- delegate agents and negotiation for contested items;
- trust lines and backstops with clear exposure controls;
- enterprise/club administration and protocol federation.

## Non-negotiables

- No pooled balance and no peer-to-peer debt ledger masquerading as settlement.
- No silent allocation changes after a person approves.
- No second charge to “repair” an unknown first attempt.
- No public reliability score or coercive decline UX.
- No vertical-specific backend fork for movies, flights, dinner, or stays; they are templates over one protocol.
- No mobile WebView shell presented as a native app.
