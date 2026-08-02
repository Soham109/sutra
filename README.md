# sutra — GMP/1, the Group Mandate Protocol

Every payment protocol shipping today assumes exactly one person is saying yes.
**sutra** is a working multi-principal layer: one cart, N people, N cards, each
person passkey-approving a mandate on their own card, all committed or all
cancelled together under a policy the group chose. On top of that protocol sits
a coordination layer that gets a group from *"dinner saturday?"* to a concrete,
priced, agreed thing — using real venues from OpenStreetMap and an explainable
scorer, not a model's opinion.

Team `__init__ to win it` (Soham + Arshjeet) · Agentic Commerce Hackathon,
Aug 1–2 2026 · built on [Prava](https://docs.prava.space).

Documents: [`spec/PROTOCOL.md`](spec/PROTOCOL.md) (GMP/1 formally) ·
[`docs/COORDINATION.md`](docs/COORDINATION.md) (the plan layer) ·
[`spec/AP2-EXTENSION.md`](spec/AP2-EXTENSION.md) (where this sits relative to
AP2 v0.2) · [`docs/`](docs/README.md) (index).

---

## Where the money flows, exactly

The engine never touches funds and never sees a card number. A member opens
their own private link; the engine lazily creates a **Prava session with
`mandate_setup`** and sends them to **Prava's hosted page**, where they approve
with their own passkey on their own device. What comes back to us is a mandate
id — merchant-locked, one-time, capped at that member's share plus the group's
tolerance. At commit the engine calls `POST /v1/mandates/:id/charge` once per
member with an idempotency `reference`; Prava mints a single-use, merchant-
scoped, amount-capped card credential against that member's card, and the
**merchant** is paid. Nothing is pooled, nobody fronts anybody's money, and a
charge over the cap is refused by the card network rather than by our code. If
the policy fails, every mandate is cancelled and nobody was ever charged.

See [`engine/src/service.ts`](engine/src/service.ts) (the commit saga) and
[`engine/src/prava/client.ts`](engine/src/prava/client.ts) (the REST contract).

## Two settlement rails, and why the second one exists

The paragraph above describes the `prava_mandates` rail. It needs a merchant
Prava can charge. **A restaurant bill has no such merchant.** The honest
response is not to invent one — a receipt claiming a card charge that never
happened is the single worst thing this system could produce — so there is a
second rail that does everything except move money.

|  | `prava_mandates` | `at_venue` |
|---|---|---|
| Needs a chargeable merchant | yes | no |
| Member's consent is | a passkey mandate on Prava's page | an explicit acceptance of their exact amount |
| Engine moves money | yes | **no** |
| Member terminal status | `charged` | `settled` |
| Receipt `charged_amount` | the amount charged | always `0` |
| Receipt `owed_amount` | the amount charged | what that person agreed to pay |

`settled` is deliberately a different status from `charged`
([`engine/src/types.ts`](engine/src/types.ts)), and the receipt carries a
`rail` plus a `settlement_disclosure` sentence so a receipt read in isolation
cannot be mistaken for proof of a payment. `verifyReceipt()` **fails** any
receipt whose rail is `at_venue` and whose charged total is non-zero
([`engine/src/receipt.ts`](engine/src/receipt.ts)). The rail is chosen from
evidence, not from a request flag: a bill split is forced onto `at_venue`, and
so is any option that came from OpenStreetMap, because an OSM `url` is a map
page or a brochure site, never a checkout
([`engine/src/plan/service.ts`](engine/src/plan/service.ts), `convertToGroup`).

Rail definitions and the exact disclosure sentence each one carries:
[`engine/src/rails.ts`](engine/src/rails.ts). That sentence is in the receipt,
in the `/v1/bill/split` response and in the discovery documents; it is not yet
on the member approval page, because the accept flow it belongs to has no route
(see *Designed, not built*).

## Quickstart

```bash
npm install
cp .env.example .env      # PRAVA_ENV=mock — no keys, no network, full demo
npm run dev               # engine on :4100, Next.js app on :3000
```

`.env` is optional: every value in it has a working default (`PORT=4100`,
`PRAVA_ENV=mock`, `ENGINE_API_TOKEN=dev-token`, SQLite at `data/gmp.db`, a
signing key generated at boot). The web app needs no env file at all — it
proxies `/api/*` to `http://localhost:4100` by default
([`web/next.config.ts`](web/next.config.ts)).

| URL | What |
|---|---|
| `http://localhost:3000` | landing page |
| `http://localhost:3000/app` | dashboard: what needs you, what your card is exposed to |
| `http://localhost:3000/app/plan/new` | one sentence → a coordinated plan |
| `http://localhost:3000/app/plans/:id` | the plan board: signals in, ranked options out |
| `http://localhost:3000/p/:participantId` | a participant's answer page (rsvp / times / where / budget) |
| `http://localhost:3000/app/bill` | photograph or paste a bill, split it |
| `http://localhost:3000/app/discover` | search or paste a product URL, build a cart |
| `http://localhost:3000/a/:memberId` | the approval page — the hero surface |
| `http://localhost:3000/app/groups/:id` | the war room, with a replay scrubber |
| `http://localhost:3000/app/receipts/:id` | the signed receipt |
| `http://localhost:4100/new`, `/a/:id`, `/g/:id/board`, `/g/:id/receipt`, `/g/:id/share`, `/g/:id/totem`, `/j/:id`, `/widget-demo` | zero-build HTML served by the engine itself — the offline fallback and the reference client for `/v1` |

Then, in another terminal:

```bash
npm run demo          # 4 approvals → 4 charges → verified receipt
npm test              # engine unit/property/integration suite
npm run test:widget   # the page detector shared by widget, bookmarklet, extension
npm run chaos         # randomized fault injection + invariant checker
npm run e2e:plan      # coordination end-to-end against live OpenStreetMap
```

Other CLI runs: `npx -w cli tsx src/gmp.ts demo backstop | abort | auction`,
and `npx -w cli tsx src/gmp.ts verify receipt.json`.

**Real Prava sandbox:** set `PRAVA_ENV=sandbox` and `PRAVA_API_KEY=sk_test_…`.
Run `npx tsx e2e/sandbox-smoke.ts` first — it performs exactly one mandate
setup, one charge and one report, and pauses for a human at the passkey step,
because the team test card allows 30 transactions a day. The chaos suite is
structurally incapable of touching sandbox: `ChaosPrava` refuses to wrap a
non-mock adapter and never reads `PRAVA_API_KEY`.

## Architecture

```
                       free text: "dinner saturday with Arsh and Maya
                        near Koramangala, under 900 each"
                                     │
   ┌─────────────────────────────────▼──────────────────────────────────┐
   │  COORDINATION LAYER  (engine/src/plan/, agent/extract.ts)          │
   │  not part of GMP/1 — it decides WHAT, then hands over              │
   │                                                                    │
   │   extract slots ──► invite participants ──► typed SIGNALS          │
   │   (LLM optional;    (people, circles)       rsvp · availability    │
   │    deterministic                            location · budget      │
   │    floor always                             vote · constraint      │
   │    runs)                                          │                │
   │                                                   ▼                │
   │   OPTION SOURCES                          ┌───────────────┐        │
   │    overpass  ── OpenStreetMap venues ────►│  rank.ts      │        │
   │    shopify   ── storefront search    ────►│  pure scorer  │        │
   │    url       ── resolved product page ───►│  5 weighted   │        │
   │    manual    ── typed in by a human  ────►│  factors, each│        │
   │                                           │  with a human-│        │
   │   Nominatim geocoding + Overpass venues   │  checkable    │        │
   │   (keyless, global, rate-gated, cached)   │  sentence     │        │
   │                                           └───────┬───────┘        │
   │                              group picks one ◄────┘                │
   └────────────────────────────────┬───────────────────────────────────┘
                                    │  convertToGroup(): cart + members
                                    │  + policy + RAIL
   ┌────────────────────────────────▼───────────────────────────────────┐
   │  GMP/1 PROTOCOL ENGINE  (engine/src/service.ts)                    │
   │                                                                    │
   │   computeShares ─► per-member cap = share × (1 + tolerance)        │
   │        │                                                           │
   │        ├─ rail = prava_mandates ──► Prava session per member       │
   │        │                            │  member passkeys on          │
   │        │                            │  Prava's hosted page         │
   │        │                            ▼                              │
   │        │                          poller (no webhooks exist)       │
   │        │                            │                              │
   │        └─ rail = at_venue ────► explicit per-member acceptance     │
   │                                     │  (no card, no mandate)       │
   │                                     ▼                              │
   │   decide(policy) ──► satisfied ──► lock set ──► COMMIT             │
   │        │              unsatisfiable ──► abort, cancel everything   │
   │        │                                                           │
   │   commit: sequential · idempotent · crash-resumable                │
   │      shortfall ──► armed backstops ──► else requote (cap 2 rounds) │
   │      charge(reference) ──► 4xx = terminal refusal                  │
   │                       ──► transport error = ASK charges[] first    │
   │                       ──► unknown is NEVER failed                  │
   │        │                                                           │
   │        ▼                                                           │
   │   Ed25519-signed, hash-chained RECEIPT (rail, owed, charged)       │
   └────────────────────────────────────────────────────────────────────┘
        │                    │                      │
   append-only          SSE streams            verifyReceipt()
   event log            /v1/*/events           offline, anywhere
   (replay, recovery)
```

Storage is `node:sqlite`; every mutation is a compare-and-swap on a row
version, so two people answering at the same instant cannot corrupt a
decision. Money is integer minor units everywhere inside the engine; decimal
strings appear only at the Prava boundary.

## What is here

| Piece | Where | What |
|---|---|---|
| Protocol engine | `engine/src/service.ts`, `db.ts`, `events.ts`, `poller.ts` | group/member state machines, append-only event log, SSE, crash-resumable commit |
| Pure protocol core | `engine/src/protocol/` | `computeShares` (largest remainder, integer minor units), the policy algebra, backstop allocator, sealed-bid auction allocator |
| Settlement rails | `engine/src/rails.ts` | `prava_mandates` and `at_venue`, their capabilities and their member-facing disclosures |
| Receipts | `engine/src/receipt.ts` | hash-chained consent objects, Ed25519-signed; `verifyReceipt` enforces the rail rule |
| Prava adapter | `engine/src/prava/` | typed REST client, offline mock with real lifecycle semantics, fault-injecting chaos proxy |
| Coordination layer | `engine/src/plan/` | signals, interval sweep for common windows, spherical geo, the explainable ranker |
| Venue discovery | `engine/src/places/` | Nominatim geocoding + Overpass venues, keyless, global, rate-gated, cached, degrades to a stated reason |
| Bill parsing | `engine/src/bill/` | deterministic receipt parser that reconciles against the printed total; optional vision layer only transcribes |
| Intent extraction | `engine/src/agent/extract.ts` | free text → slots; deterministic floor that works with no key and no network |
| Marketplace discovery | `engine/src/catalog/` | federated product search + SSRF-hardened URL resolution |
| Notifications | `engine/src/notify/` | inbox always; Web Push (RFC 8291 + RFC 8292, hand-rolled on `node:crypto`) once VAPID keys exist |
| Discovery documents | `engine/src/discovery/` | A2A AgentCard, NANDA AgentFacts, AI Catalog, served SkillMD — all generated from one endpoint inventory |
| Web app | `web/` | Next.js 15 / React 19, proxies `/api/*` to the engine |
| Zero-build surfaces | `engine/public/` | HTML served by the engine; the offline demo path |
| CLI | `cli/src/gmp.ts`, `cli/src/nanda.ts` | demo runs + offline receipt verification; NANDA publication tooling |
| Chaos | `chaos/src/run.ts` | randomized fault injection + invariant checker |
| MCP server | `mcp/src/server.ts` | `create_group_session`, `get_group_status`, `cancel_group` |
| Agent skill | `SKILL.md` | the same contract as plain HTTP |
| Widget / bookmarklet / extension | `widget/`, `extension/` | one shared page detector (`widget/detect.js`) behind three delivery mechanisms |
| NANDA Town plugin | `nanda-town-prava/` | a real `nest.plugins.payments` entry-point plugin that charges cards instead of pooling credits |

## Endpoints

Everything is JSON. `bearer` means `Authorization: Bearer <ENGINE_API_TOKEN>`;
`session` means a signed-in principal (cookie `sutra_uid` or header
`x-sutra-user`); `none` means the (unguessable) id in the path is the
capability.

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
| GET | `/v1/discover/search?q=` | none | federated product search, or resolve a pasted URL |
| GET | `/v1/discover/compare?q=` | none | the same search, grouped into like-for-like offers and ranked per unit |
| POST | `/v1/discover/resolve` | none | one product URL → a priced cart line |
| GET | `/v1/discover/sources` | none | which catalog sources answered |
| POST | `/v1/auth/register`, `/v1/auth/login` | — | email + password; sets a session cookie |
| POST/GET | `/v1/me` | — / session | pick a handle / read yourself |
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
anything payment-shaped — see [`engine/src/messages/bot.ts`](engine/src/messages/bot.ts).

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
| 24 | Only some people share a location | the search centres on the spherical centroid of those who did (radius: see the caveat in [`docs/COORDINATION.md`](docs/COORDINATION.md) §4), and `travel_fit` prints how many did not answer |
| 25 | Nobody has shared availability | `time_fit` is scored at **weight 0** with a stated reason, not at a guessed 0.5 — silence never contributes a number |
| 26 | Someone's budget is in a different currency from the price | dropped from the arithmetic and named in the sentence; currency is never coerced without a rate we do not have |
| 27 | The chosen venue has no price (OSM knows the restaurant, not the bill) | `convert` refuses: *"this option has no price attached — enter the amount, or split the real bill once you have it"* |
| 28 | Bill does not reconcile against its printed total | the delta is reported and warned about (*"do not charge anyone until this is resolved"*); nothing is invented to force a match, and every ignored line comes back in `unparsed_lines` |
| 29 | Bill has no printed total | `total: null` and the note says the itemisation is **unverified** |
| 30 | A bill line's `qty × unit` does not equal its printed amount | the printed amount wins and a warning says so — that is what the merchant charged |
| 31 | Photo of a bill, no vision key | a typed error telling you to paste the text instead; the text path needs no key and no network |
| 32 | Extractor misreads the sentence | the model only fills slots — it never picks a venue, sets a price, or invents a coordinate. Slots are editable, `uncertainties[]` is shown, and `dry_run: true` previews the reading without creating anything |
| 33 | No `OPENAI_API_KEY`, or the model call fails | the deterministic extractor runs. It is the floor, not a stub — the end-to-end run below used it |
| 34 | A bare number with no currency (*"under 800"*) | the geocoded country decides (₹800 near Koramangala, not $800), recorded as an uncertainty. Moving between currencies with different minor-unit exponents is a **rescale**, never a conversion — no rate is applied or implied |
| 35 | Two people choose an option simultaneously | CAS on the plan version; the loser gets 409 *"the plan moved while you were choosing — try again"* |
| 36 | A plan nobody answers | expires at its deadline |

## Verification

Everything below is actual output observed on 2026-08-01, Node 22 on Windows.
Test counts grow as the suite does; run them yourself.

### `npm test -w engine`

```
 RUN  v4.1.10 C:/Users/acer/sutra/engine

 Test Files  10 passed (10)
      Tests  346 passed (346)
   Duration  1.18s
```

The ten files are `allocators`, `bill`, `discovery`, `integration`, `money`,
`notify`, `places`, `plan-math`, `policy`, `resolver`. Four of them carry
fast-check property tests — `money` (shares always sum to the cart total),
`policy` (flipping a member from pending to approved can never turn a
satisfied policy unsatisfied), `allocators` (a backstop allocation covers the
shortfall exactly and never exceeds a cap), and `plan-math` (the interval and
ranking algebra). `notify` reproduces the RFC 8291 §5 published example byte
for byte.

### `npm run test:widget`

```
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

Including a test that `widget/widget.js` and `extension/detect.js` carry an
identical copy of `widget/detect.js`, so the three delivery mechanisms cannot
drift.

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

### `npm run demo`

```
  ══════ COMMITTED ══════
  all 4 approved; locked 4 member(s)

  ✓ Soham    charged    charged $46.50
  ✓ Arsh     charged    charged $46.50
  ✓ Dev      charged    charged $46.50
  ✓ Maya     charged    charged $46.50

  receipt: ✓ chain + signature verified
```

### `npm run e2e:plan` — the coordination layer, against live OpenStreetMap

Nothing is mocked here. The geocoder is Nominatim, the venues are real OSM
places with real coordinates, the ranking is the same pure code the UI renders.

```
2. One sentence → a structured plan (no LLM key needed)
   "dinner saturday with Arsh and Maya near Koramangala, under 900 each"
   extractor:  deterministic
   category:   restaurant
   budget:     INR 900.00 each
   anchor:     Koramangala (IN) 12.9357,77.6241
   invited:    Soham, Arsh, Maya
   · Amounts read as INR because Koramangala is in IN. Change it if that is wrong.

3. Everyone answers: in / when / where
   Soham  in · Koramangala  · free 19:00–23:00
   Arsh   in · Indiranagar  · free 20:00–23:30
   Maya   in · Jayanagar    · free 19:30–22:30

4. Real venues, ranked against those answers
   best common window: 20:00–22:30 UTC, 3 of 3 can make it
   7 options on the board

    1.  93%  Sukh Sagar
         time_fit    100%  No fixed time on this option, so it is scored against the
                           best common slot instead: 2026-08-08 20:00–22:30 UTC
                           (2h 30m) suits 3 of 3 who shared availability.
         travel_fit   84%  Average trip 2.73 km, longest 5.36 km (Arsh), over 3 who
                           shared a location. Scored against a 25 km ceiling, half on
                           the average trip and half on the longest one.
         budget_fit   50%  This option has no price, so there is nothing to compare.
         preference   50%  Nobody has voted on this option yet.
         freshness    50%  This option has no fixed time, so it cannot be stale.

5. Pick one and hand it to the protocol
   chose: Sukh Sagar
   rail:   at_venue
     Soham  owes INR 850.00
     Arsh   owes INR 850.00
     Maya   owes INR 850.00
```

Note the rail: the winning option came from Overpass, so the group is on
`at_venue` and no card is charged through sutra. Note also that `budget_fit`
and `preference` show 50% at **weight 0** — the score is the weighted mean over
factors that carry weight, and an uncomputable factor contributes nothing
rather than a fabricated middle. See [`docs/COORDINATION.md`](docs/COORDINATION.md).

### `POST /v1/bill/split`, observed

```json
{
  "rail": "at_venue",
  "disclosure": "No card is charged through sutra on this split. …",
  "reconciliation": {
    "items_sum": 100000, "fees_sum": 5000,
    "computed_total": 105000, "printed_total": 105000,
    "delta": 0, "balanced": true,
    "note": "3 item(s) INR 1000.00 + 2 charge(s) INR 50.00 = INR 1050.00, matching the printed total."
  },
  "members": [
    { "name": "Soham", "share_amount": 35001 },
    { "name": "Arsh",  "share_amount": 35000 },
    { "name": "Maya",  "share_amount": 34999 }
  ]
}
```

35001 + 35000 + 34999 = 105000 exactly. Largest remainder, integer minor units,
no rounding leak. Each member then accepts their own number at
`POST /v1/members/:id/accept`, and once the policy is satisfied the group
reaches `committed` with a signed receipt that says `settled at the venue` and
claims no charge.

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
deterministic bill parsing with reconciliation · the two settlement rails ·
notifications (inbox always, Web Push when VAPID keys exist) · the shared page
detector behind widget, bookmarklet and Chrome extension · MCP server · CLI ·
zero-build HTML fallback surfaces.

### P2 — the ecosystem. Built; nothing published.

`nanda-town-prava/` is a real `nest.plugins.payments` entry-point plugin
(Python, Apache-2.0) registered as `prava_mandates`. Its argument is in
[`nanda-town-prava/README.md`](nanda-town-prava/README.md): NANDA Town's
bundled `prepaid_credits` is a pooled internal ledger, and this plugin never
pools — `pay()` maps onto a real card-network authorization, `balance()`
returns remaining authorization headroom rather than custody of anything, and
`refund()` raises `RefundNotSupportedError` post-capture rather than pretending
a settled card charge can be rolled back. That README also records the run
transcript it was verified against (`nest-core` 0.1.4, CPython 3.12,
`nest plugins list payments` showing both plugins, and the three `marketplace`
validators passing) — reproducing it needs a Python environment, which this
README's other numbers do not.

Its test count is deliberately not quoted here. It has moved several times in a
day, and a number copied into a second file is a number that goes stale without
anybody noticing. Run `pytest -q` in that directory and believe what it prints.

`engine/src/discovery/` builds an A2A AgentCard, a NANDA AgentFacts record, an
AI Catalog entry and a served copy of `SKILL.md`, all generated from a single
endpoint inventory (`engine/src/discovery/endpoints.ts`) so a discovery
document cannot drift from the API, and all covered by
`engine/test/discovery.test.ts`, which asserts among other things that every
advertised path is genuinely registered in `engine/src/routes*.ts`. All seven
are served by a running engine — observed against a fresh boot:

| Path | |
|---|---|
| `/.well-known/agent-card.json` | 200 `application/json` — A2A AgentCard |
| `/.well-known/agents/sutra.json` | 200 — the same card where a NANDA catalog entry points |
| `/.well-known/agent-facts.json`, `/agent-facts.json` | 200 — NANDA AgentFacts |
| `/.well-known/extensions/gmp-1.json` | 200 — the A2A capability extension the card declares, so its URI dereferences instead of 404ing |
| `/api/agents` | 200 — the AI Catalog |
| `/skill.md` | 200 `text/markdown` — `SKILL.md`, with every occurrence of the dev base URL rewritten to `APP_BASE_URL`, so the published skill's example curls cannot point somewhere the engine is not |

`/.well-known/ai-plugin.json` is deliberately **not** served: that manifest
belonged to ChatGPT plugins, which were sunset in April 2024, and serving a
dead manifest would be discovery cosplay.

`cli/src/nanda.ts` can validate these and submit them to the NANDA registries.
It refuses to submit a loopback or private-network URL, because both registries
*probe* what you give them and badge the listing reachable or unreachable —
submitting `http://localhost:4100` does not fail loudly, it fails quietly and
permanently in public. **Nothing has actually been published**; the engine is
not on a public host.

### Designed, not built

- **A real card charge.** Mandate sessions mint correctly against the real
  Prava sandbox and the poller commits the group by itself once a mandate goes
  active — but completing one requires a human opening the hosted approval URL
  on a phone and passing the passkey ceremony, and no script can do that on
  their behalf. That is the security property of the protocol, and it is also
  the largest thing this repository cannot demonstrate on its own. If a receipt
  here shows a real charge, a person tapped for it.

  *(This section previously claimed `POST /v1/members/:id/accept` had no HTTP
  route and called that the largest gap. That was wrong — the route is at
  [`engine/src/routes.ts`](engine/src/routes.ts), the web app calls it, and a
  bill split reaches `committed` end to end.)*
- **Per-participant authorisation on the coordination layer.** A plan link is a
  bearer capability by design — the whole point is answering on a phone with no
  account — but the plan view hands every participant's id to anyone holding
  the plan link, which is wider than it should be. The payment layer is not
  affected: spending needs the member's own passkey on Prava's page.
- **Mobile clients.** Recommended architecture only; see the roadmap.
- **Postgres, workers, transactional outbox.** The engine is one process with
  SQLite. The roadmap describes the production shape.
- **Standing rules and trust lines on recurring mandates.** L4 in
  `spec/PROTOCOL.md` §9. Nothing is implemented.
- **AP2 interoperability.** `spec/AP2-EXTENSION.md` is a positioning memo
  against AP2 v0.2. No AP2 mandate is issued or consumed by this code.

## Honest notes on the Prava integration

Checked against `openapi.json` in this repository, which the client's header
comment records as byte-identical to
`https://docs.prava.space/api-reference/openapi.json` on 2026-08-01
([`engine/src/prava/client.ts`](engine/src/prava/client.ts)).

- **No webhooks.** Polling is the design, not a shortcut.
- **A session carries its own `expires_at`** and the spec states no fixed
  lifetime. Sessions are therefore created **lazily**, on the member's first
  open, so whatever the clock is it starts when the human is actually looking
  at the page rather than when the organizer created the group.
- **There is no server-side session→mandate correlation**, so approval is
  detected by listing mandates for our per-member `customer_id`, with
  `standing_only=true` — the spec's own words for that flag are *"Set
  `standing_only=true` to exclude transient per-checkout mandates"*, and
  picking one of those up would read as an approval that never happened.
- **`callback_url` must be https**, so a non-https base URL omits it entirely
  rather than sinking the whole session request. The poller, not the callback,
  is what detects approval.
- **A failed charge clears its idempotency key at Prava.** Reference replay
  protects the in-flight case, not the post-failure retry — which is exactly
  why a failure must be *classified* rather than retried blindly. Our mock was
  made *less* strict to match this.
- **We check `authorizeOnly === true` on the session response.** It is the only
  signal that the session really became a mandate setup; without it we may have
  created an ordinary checkout that charges immediately, so we refuse rather
  than assume.
- **Two ambiguities we did not resolve, recorded rather than guessed at.**
  `mandate_setup.valid_until` is documented as *"Ignored for one_time (clamped
  to 7 days)"*, while `purchase_context[].effective_until_minutes` is
  documented as *"How long the mandate remains effective, in minutes. Positive
  integer, no maximum."* — the spec does not say how the second interacts with
  the first for a one-time mandate, and we send 60. Separately, nothing states
  what revoking a session does to a still-pending mandate, so
  `cleanupMemberAuthorizations` attempts **both** the session revoke and the
  mandate cancel and never relies on a side effect.

## NANDA, honestly

The official AgentFacts schema
(`github.com/projnanda/agentfacts-format/agentfacts_schema.json`,
`"$id": "https://agentfacts.org/schema/v1"`) contains **no payment fields
whatsoever** — the words *payment*, *pricing*, *billing*, *mandate* and *cost*
appear zero times in it. Our record therefore puts everything payment-related
in a single clearly namespaced `x-payments` block, labelled in the document
itself as a proposed, non-standard extension
(`"proposal": "agentfacts-x-payments/draft-0"`), rather than implying it is
part of the schema. See `engine/src/discovery/agent-facts.ts`.

## Pre-existing work disclosure

The concept and the protocol specification document (`spec/PROTOCOL.md`)
existed before the event. **All code in this repository was written during the
hackathon.** The coordination layer, the settlement rails, the bill parser, the
venue discovery, the NANDA Town plugin, the web app and the discovery documents
were all built during the event; `spec/PROTOCOL.md` has been extended during it
to cover the rails and the coordination phase.

## Deploy

Engine: any Node ≥ 22.5 host, `npm run start -w engine`, with a persistent disk
for `data/` and `APP_BASE_URL` set to the public HTTPS origin (approval links,
QR codes and every discovery document derive from it). Web: `vercel.json`
builds `web/` and the app proxies `/api/*` to `ENGINE_URL`. CORS is open on the
engine, so a separate frontend origin works either way.
