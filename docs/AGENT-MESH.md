# The agent mesh: delegate agents for multi-principal coordination

*What this is, why it is not a badge, the real transcript, and what is
honestly still missing.*

---

## 1. The gap this closes

[`spec/AP2-EXTENSION.md`](../spec/AP2-EXTENSION.md) already makes the precise
version of this argument against AP2 v0.2, and it applies unchanged to ACP,
Visa Intelligent Commerce, and to Prava's own mandate API: **every one of
them is single-principal.** A Checkout Mandate is signed by *the* user. A
Payment Mandate authorizes *a* payment instrument for *the* agent bound to it.
There is no object anywhere in that surface that says *"these four people are
each authorizing part of one purchase, and it happens for all of them or none
of them."* GMP/1 is sutra's answer to that gap at the protocol level — a
shared cart hash, a commit policy, per-principal capped mandates, atomic
enough settlement.

This feature is the other half of the same gap, one layer up. NANDA's whole
premise — an "agent internet" where agents discover each other and act for
their humans — presumes that once agents can find each other, they will need
to *do something together*. Put a multi-agent world next to a
single-principal payment surface and the hole is obvious: **when N agents,
each representing a different human, want to jointly buy one thing, none of
them has a primitive for the conversation that happens *before* anyone reaches
for a mandate** — who's in, when everyone's free, where, and what each person
will spend. Today that conversation happens in a group chat, and the payment
protocol only starts listening once a human has already done all the
coordinating by hand.

Delegate agents make that conversation a first-class part of GMP/1's
coordination phase (`engine/src/plan/`, see its own header comment). Each
member points an agent at the plan; the agent answers from standing rules its
human set in advance, exactly the way a human answering a group chat would —
except it is auditable, instant, and it can correctly say nothing when its
human never anticipated the question.

## 2. How delegates work

### 2.1 The standing rule model — `engine/src/delegate/rules.ts`

A `StandingRules` object is one human's answers, set in advance:

```ts
{
  auto_rsvp: { max_share_minor: 80_000, categories: ['restaurant'], not_on: ['saturday','sunday'] },
  availability: { weekday_evenings: true, windows: [{ days: ['saturday'], from: '12:00', to: '23:00' }] },
  home: { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, source: 'manual' },
  budget_ceiling_minor: 80_000,
  currency: 'INR',
  constraints: ['vegetarian'],
}
```

The load-bearing function is `decideSignals(rules, { ask, slots })`, and it
is **pure** — no I/O, no clock read of its own, no database. It walks the
plan's `ask` list (exactly the signal kinds `POST /v1/plans` recorded as
still needed — the same list `routes-plan.ts`'s `/v1/participants/:id`
already exposes as `asked`) and, per kind, does exactly one of two things:

- **Answers**, with a real `SignalPayload` — the identical type
  `PlanService.submitSignal` accepts, imported straight from
  `../plan/types.js`.
- **Skips**, with a human-readable `why`, when the rules do not cover the
  question.

Four rules it enforces without exception, each backed by tests in
[`engine/test/delegate.test.ts`](../engine/test/delegate.test.ts) (29 cases):

1. **Refuse rather than guess.** No `auto_rsvp` on file → RSVP is skipped, not
   defaulted to "in". No category stated on the plan yet, but the rule
   restricts by category → skipped, not decided either way. A currency
   mismatch between the rule and the plan → skipped, never a guessed exchange
   rate.
2. **Never invent a location or a budget.** No `home` set → `location` is
   skipped with `"refusing to invent one"`, even if every other question was
   answered. No `budget_ceiling_minor` (or no `currency` alongside it) → same
   for `budget`.
3. **Respect `not_on` against the plan's actual window.** The plan's
   `slots.when.earliest` is read as a UTC calendar day and checked against
   the rule's blackout list — not a guess, not "probably a weekend".
4. **Decline, with a reason, when category or cost is out of range** — never
   a silent skip when the rule *does* have enough information to say no.

`vote` is always skipped: a vote is an opinion on a *specific option on the
board*, and standing rules are set before any option exists, so there is
structurally nothing for them to have anticipated.

### 2.2 Persistence and routes — `engine/src/delegate/store.ts` + `routes.ts`

- `PUT /v1/delegate/rules` / `GET /v1/delegate/rules` — a human's own
  standing rules, keyed by user id (`currentUserFrom`, same identity every
  other signed-in surface uses). Requires being signed in as yourself.
- `GET /v1/plans/:planId/questions?participant_id=…` — machine-readable open
  questions for one participant, meant for an agent to act on directly
  rather than parse the human-facing plan view.
- `POST /v1/participants/:id/delegate-answer` — runs `decideSignals` against
  whatever rules are on file for that participant's human (or against a
  `rules` object passed inline, for an agent that keeps its own), and submits
  every answered signal through the ordinary `PlanService.submitSignal` path
  — the same append-only signal log, the same `responded_at` bookkeeping, the
  same location-triggered re-search. **Provenance is not silent**: after
  `submitSignal` writes its own `signal.<kind>` event, this route appends a
  second `delegate.answered` (or `delegate.skipped`) event tagged
  `via: 'delegate'`, so the plan timeline and board can show that a standing
  rule answered, not a human typing into a form.

### 2.3 Any MCP-capable agent — `mcp/src/server.ts`

Three new tools sit alongside the three that already existed
(`create_group_session`, `get_group_status`, `cancel_group`):

- `list_open_questions(participant_id)` — resolves the participant's plan,
  then reads the machine-readable question list above.
- `answer_as_delegate(participant_id, rules?)` — the MCP-side call into
  `delegate-answer`. Its description states plainly, alongside every other
  tool's own boundary language, that **payment approval is not available over
  MCP and never will be** — mirroring Prava's own decision (quoted in the
  file's header) to keep charging off MCP entirely.
- `get_plan_status(plan_id)` — ranked options with full score factors, so an
  agent can see what the mesh would land on after delegates have answered.

All three were exercised directly over stdio JSON-RPC against a running
engine during verification (`tools/list` then `tools/call` for each) — not
just typechecked. `answer_as_delegate` correctly returned an `IN` + a
constraint answer plus a **skipped `location`** ("no home location is set…")
in that smoke test, on rules built entirely inline in the MCP call.

## 3. The boundary, and why it is not a limitation

**A delegate never approves a payment.** This is enforced structurally, in
three independent places, not by convention:

1. `SignalPayload` (`engine/src/plan/types.ts`) is a closed
   `z.discriminatedUnion` over `rsvp | availability | location | budget |
   vote | constraint`. There is no payment-shaped variant. `decideSignals`
   cannot emit what the type system does not let it construct.
2. `POST /v1/participants/:id/delegate-answer` calls exactly one method on
   the plan layer — `PlanService.submitSignal` — for exactly the signals
   `decideSignals` produced. It has no code path into `GroupService`, into
   `Prava`, or into anything that mints or approves a mandate.
3. Every MCP tool description that touches this feature says so out loud,
   the same way `create_group_session`'s description already did for the
   original three tools.

Mandate approval stays what it has always been in this codebase: a passkey
ceremony on the human's own device, driven by Prava's hosted collection page,
that no script anywhere in this repository can complete on a human's behalf
(`docs/NANDA-EVIDENCE.md` §3.2 demonstrates the same structural refusal
against a real Prava sandbox key: `approve_member(...) -> False`). Delegates
handle *coordination* — attendance, timing, location, a spending ceiling,
constraints. Humans handle *money*. That line is the interesting part of this
design, and it is why the demo below prints it loudly rather than skipping
past it: a system that let an agent complete the money step would not be a
safer or more convenient version of GMP/1, it would be a different, worse
protocol wearing GMP/1's name.

One nuance worth stating plainly: on the `at_venue` rail (real
OpenStreetMap venues have no merchant Prava can charge — see the comment on
`convertToGroup` in `plan/service.ts`), the human's own final step is not
literally a *passkey* — it is `POST /v1/members/:id/accept`, an explicit
acceptance of an exact amount with no card ceremony at all, because there is
no card ceremony to have. The boundary is identical either way — no agent can
complete either action — and the transcript below shows the `at_venue` case
exactly as it happened, because that is what a real venue plan actually
produces.

## 4. The real transcript

Run with:

```bash
npx tsx e2e/agent-mesh.ts
GMP_API=https://engine-production-e6fa.up.railway.app npx tsx e2e/agent-mesh.ts   # the deployed engine — see §6.1
```

Everything below is a real, unedited run (colour codes stripped) against a
local instance of the exact code in this PR — `PRAVA_ENV=mock`,
`DB_PATH=:memory:`, started with `npx tsx engine/src/server.ts` — over real
HTTP, on a real socket, on `127.0.0.1:4199`. **Step 1's discovery calls hit
the real, live, public `https://sutra-gmp.vercel.app`** regardless of which
engine the rest of the script drives — that is deliberate; discovery is a
question about what sutra has published, not about which engine happens to
be running this script. The operational half of this transcript was recorded
locally; the delegate routes are since live on the Railway host and the same
script runs against it unchanged — see §6.1 for the probes that show it.

```
discovery: https://sutra-gmp.vercel.app   engine api: http://127.0.0.1:4199

1. Discovery — an agent that has never heard of sutra reads its own documents
   GET https://sutra-gmp.vercel.app/.well-known/agent-card.json
     "sutra" — Group checkout for agents. sutra turns one cart and N humans into N card-network-enforced payment mandates — one per person, on th…
     the card's own declared API base: https://sutra-gmp.vercel.app/v1
     skills this agent found — read from the document, not hardcoded here:
       · create_group_checkout    Create a group checkout
       · coordinate_group_plan    Coordinate a group plan
       · split_a_bill             Split a bill
       · watch_a_group            Watch a group
       · verify_group_receipt     Verify a signed receipt
       · find_something_to_buy    Find something to buy
   GET https://sutra-gmp.vercel.app/api/agents
     3 catalog entries: sutra, sutra-agent-facts, sutra-skillmd
   → learned "Coordinate a group plan" from the card itself — that is the skill this run is about to use.

2. Origination — the agent creates a group plan via the documented API
   registering the three humans this plan will need real answers from…
     Priya (us_01KYYWY0NNY2A7Q007H3B7F1R2)
     Arsh (us_01KYYWY0PVJ5P7T0S48351G6D3)
     Maya (us_01KYYWY0R3K4R4C6R213A0Y7G3)
   POST /v1/plans → pl_01KYYWY0SA96G3M5S1G2Y387C6  "Dinner — three delegates, one plan"
     asking every participant for: rsvp, availability, location, budget, constraint
     window: 2026-08-08 18:00–23:00 UTC · budget INR 700.00/head · category "restaurant"

3. The mesh — three delegate agents, three different standing rules, one human each
   Each delegate below only ever runs decideSignals() — a pure function over its own human's
   standing rules and this plan. It cannot approve a payment: that verb does not exist here.

   Priya — budget-constrained (caps spend, weekday-evening availability only)
     rsvp         → IN  (within every standing rule that applies)
     availability → refused — no standing availability covers Saturday
     location     → HSR Layout (12.9116,77.6412)
     budget       → ceiling INR 800.00
     constraint   → refused — no standing constraints are set

   Arsh — weekday-restricted (never Saturday or Sunday)
     rsvp         → OUT  (the plan falls on Saturday, and the standing rule says never on Saturday, Sunday)
     availability → refused — no standing availability covers Saturday
     location     → Indiranagar (12.9784,77.6408)
     budget       → ceiling INR 2000.00
     constraint   → refused — no standing constraints are set

   Maya — vegetarian, no home address on file
     rsvp         → IN  (within every standing rule that applies)
     availability → free 12:00–23:00 UTC (2026-08-08)  (free 12:00–23:00 UTC on Saturdays per standing availability)
     location     → refused — no home location is set in these standing rules — refusing to invent one
     budget       → ceiling INR 1500.00
     constraint   → "vegetarian"

   → verified: GET /v1/plans/:id/questions agrees with decideSignals() for all three delegates.

4. Ranking — real OpenStreetMap venues, scored against what the delegates actually said
   best common window: 12:00–23:00 UTC, 1 can make it
   7 real venues on the board (OpenStreetMap, around Priya's and Arsh's stated locations)

    1.  95%  Sukh Sagar
         Mahayogi Vemana Road
         time_fit    100%  No fixed time on this option, so it is scored against the best common slot instead: 2026-08-08 12:00–23:00 UTC (11h) suits 1 of 1 who shared availability; 1 of 2 have not shared times.
         travel_fit   88%  Average trip 3.12 km, longest 3.12 km (Priya), over 1 who shared a location (1 did not). Scored against a 25 km ceiling, half on the average trip and half on the longest one.
         budget_fit   50%  This option has no price, so there is nothing to compare.
         preference   50%  Nobody has voted on this option yet.
         freshness    50%  This option has no fixed time, so it cannot be stale.

    2.  92%  Snack Corner
         Bannerghatta Road
         travel_fit   82%  Average trip 4.59 km, longest 4.59 km (Priya), over 1 who shared a location (1 did not). Scored against a 25 km ceiling, half on the average trip and half on the longest one.

    3.  92%  Nandhana
         travel_fit   80%  Average trip 4.93 km, longest 4.93 km (Priya) …

    4.  91%  Crazy Boys
         travel_fit   78%  Average trip 5.46 km, longest 5.46 km (Priya) …

    5.  91%  Nandhini
         100 Feet Road
         travel_fit   78%  Average trip 5.6 km, longest 5.6 km (Priya) …

   chose: Sukh Sagar

5. The boundary — coordination is done; the money step returns to the humans
   group gs_01KYYWY49EX5M105X5D3S7M6P4 on the "at_venue" rail — 2 real principal(s), not one
   No card is charged through sutra on this split. Everyone agrees their exact amount here, then pays the venue directly on their own card. What you get is the arithmetic, the agreement, and a signed record of who owed what — not a payment.
   No delegate above, and no agent anywhere in this script, can complete any of the following.
   Each person still has to open this and accept their own exact amount by hand:

     Priya    owes INR 650.00  status=awaiting_approval
       POST /v1/members/mi_01KYYWY49F50J1N6X1N5D3G230/accept — a human action this script deliberately never calls
     Maya     owes INR 650.00  status=awaiting_approval
       POST /v1/members/mi_01KYYWY49F4244V384S7N5H3Y3/accept — a human action this script deliberately never calls

   This script holds three real session cookies and zero payment credentials. That is not an
   omission — SignalPayload (../engine/src/plan/types.ts) has no payment-shaped variant, and
   neither POST /v1/participants/:id/delegate-answer nor any MCP tool can produce one.

   N humans, N delegate agents, one engine — and the mandate is still theirs alone to sign.
```

(Options 2–5's `time_fit` / `budget_fit` / `preference` / `freshness` lines
are identical in shape to option 1's and are trimmed here for length; the
full, untrimmed output — three real registered accounts, seven real Overpass
venues, real per-factor arithmetic on every line — is what actually printed.)

Read what step 3 actually proves, kind by kind, across three independently
run delegates:

| Kind | Priya | Arsh | Maya |
|---|---|---|---|
| `rsvp` | **accepted** (cost and category clear) | **declined**, with a reason (`not_on` hit) | **accepted** |
| `availability` | **refused** (no weekday-evening slot on a Saturday) | **refused** (same) | **answered** (explicit weekend window) |
| `location` | answered | answered | **refused** — no `home` set; not invented |
| `budget` | answered | answered | answered |
| `constraint` | **refused** — none set | **refused** — none set | answered (`"vegetarian"`) |

Every one of the four behaviours §2.1 lists fires at least once, on real
delegates, in one run: a decline with a stated reason (Arsh's RSVP), a
refusal because the rule genuinely does not cover the day (Priya's and
Arsh's availability), a refusal because a value was never set and the code
would rather say nothing than invent one (Maya's location), and full
coverage where the rule *does* apply (Maya's rsvp/availability/budget/
constraint). The script also asserts — not just prints — that
`GET /v1/plans/:id/questions` agrees with what `decideSignals` computed for
each delegate, so "the engine recorded what the pure function said it would"
is a checked claim in this transcript, not a narrated one.

### 4.1 The MCP layer, exercised directly

Beyond the transcript above, the three new MCP tools were driven over real
stdio JSON-RPC (`initialize` → `tools/list` → `tools/call`) against the same
running engine, independent of `e2e/agent-mesh.ts`. `tools/list` returned all
six tools (the three pre-existing plus the three new ones) with valid JSON
Schemas. A fresh plan + participant, answered via `answer_as_delegate` with
rules built entirely inline in the MCP call
(`{ auto_rsvp: { categories: ['cafe'] }, constraints: ['oat milk only'] }`,
no `home`), returned:

```json
{
  "answered": [ { "kind": "rsvp", "in": true }, { "kind": "constraint", "text": "oat milk only" } ],
  "skipped": [ { "kind": "location", "why": "no home location is set in these standing rules — refusing to invent one" } ]
}
```

— the same refusal behaviour as the main transcript, reached through the MCP
tool rather than the raw HTTP route.

## 5. Files

| File | What it is |
|---|---|
| [`engine/src/delegate/rules.ts`](../engine/src/delegate/rules.ts) | `StandingRules`, `decideSignals` — pure, no I/O |
| [`engine/src/delegate/store.ts`](../engine/src/delegate/store.ts) | Rules persistence, keyed by user id |
| [`engine/src/delegate/routes.ts`](../engine/src/delegate/routes.ts) | `registerDelegateRoutes` — the four routes in §2.2 |
| [`engine/test/delegate.test.ts`](../engine/test/delegate.test.ts) | 29 cases: refusal, never-invent, `not_on`, decline-with-reason, availability projection, the exact three-delegate demo scenario as a regression test |
| [`mcp/src/server.ts`](../mcp/src/server.ts) (extended) | `list_open_questions`, `answer_as_delegate`, `get_plan_status`, alongside the three pre-existing tools |
| [`e2e/agent-mesh.ts`](../e2e/agent-mesh.ts) | The demo in §4 |
| `engine/src/server.ts` (one wiring edit) | `installDelegateSchema` + `registerDelegateRoutes` — see §6.2 |

## 6. What is honestly not built, and every place a claim got weakened

### 6.1 Now live on the deployed Railway engine

This section previously recorded a deploy-timing gap: the delegate routes
existed in the code but the running Railway process had not picked them up,
so `PUT /v1/delegate/rules` answered `404 Route not found`. **That gap is
closed.** All four routes registered by
[`engine/src/delegate/routes.ts`](../engine/src/delegate/routes.ts) are
mounted on the deployed engine. Probed directly rather than assumed:

```
$ curl -s -X PUT  https://engine-production-e6fa.up.railway.app/v1/delegate/rules -d '{}'
{"error":"sign in to continue"}                       # HTTP 401
$ curl -s -X GET  https://engine-production-e6fa.up.railway.app/v1/delegate/rules
{"error":"sign in to continue"}                       # HTTP 401
$ curl -s        "https://engine-production-e6fa.up.railway.app/v1/plans/pl_x/questions"
{"error":"participant_id is required"}                # HTTP 400
$ curl -s -X POST https://engine-production-e6fa.up.railway.app/v1/participants/pp_x/delegate-answer -d '{}'
{"error":"no such participant"}                       # HTTP 404
```

Read the failures, because they are the evidence. A route that is *missing*
returns Fastify's `{"message":"Route PUT:/v1/delegate/rules not found",
"error":"Not Found","statusCode":404}`. None of these do. Two return the
engine's own auth refusal, one returns its own query validation error, and
one returns its own application-level "no such participant" — every one of
which is a handler that ran. Auth-required and validation-rejected are
proof of presence; only Fastify's route-not-found is proof of absence.

**The "run it against the live engine" instruction is now satisfiable as
literally stated.** §4's transcript is still a local run — it is retained
as-is rather than re-recorded, because it is a real run of the identical
code over real HTTP on real sockets against real OpenStreetMap, and its
step 1 discovery calls already hit the live public site. Nothing in
`e2e/agent-mesh.ts` is environment-specific beyond `GMP_API`, so
`GMP_API=https://engine-production-e6fa.up.railway.app npx tsx
e2e/agent-mesh.ts` now runs against the deployed host. The one caveat worth
stating: the delegate-rules endpoints require a signed-in session, so a
cold anonymous run gets 401 on those two calls — that is the auth guard
working, not the deploy failing.

### 6.2 One file outside the stated ownership list

`engine/src/server.ts` needed a two-line addition
(`installDelegateSchema(db)` + `registerDelegateRoutes(app, …)`) — without
it, every route in `engine/src/delegate/routes.ts` is dead code the running
engine never mounts, which would make this whole feature unverifiable even
locally. The edit is additive only (two new imports, four new lines in
`main()`) and was re-checked after a concurrent agent also touched the same
file for unrelated auth work in the middle of this session; both sets of
changes coexist correctly and the file still typechecks clean.

### 6.3 `npm test -w engine` is not green repository-wide

`engine/test/crash-double-charge.test.ts` — created by a different, concurrent
agent, exercising `GroupService.approveMember` / `MockPrava.charge` /
`MockPrava.chargeCount`, none of which exist yet — currently fails 3 tests.
This is unrelated, in-progress work outside `engine/src/delegate/**`; it was
not touched. Isolated: `npx tsc --noEmit -p engine/tsconfig.json` is clean
outside that one file, and **all 406 pre-existing tests plus all 29 new
`delegate.test.ts` tests pass** (`npx vitest run` restricted to those files,
and the full suite minus that one file).

### 6.4 Design simplifications, stated once and not hidden

- **One currency per human**, not one per rule. The task's illustrative
  example put `currency` inside `auto_rsvp`; the shipped schema hoists it to
  the top of `StandingRules` and every amount (`auto_rsvp.max_share_minor`,
  `budget_ceiling_minor`) reads it from there. A human with genuinely
  different currencies for their spending cap and their RSVP ceiling is not
  representable — this did not seem like a real case worth the complexity.
- **Availability windows are UTC clock times**, not local time with a
  timezone lookup. `RecurringWindow.from`/`to` are plain `HH:MM` interpreted
  as UTC, consistent with every other instant in `plan/types.ts`'s
  `WindowSchema`. A rule meant as "6pm my local time" has to be set as
  whatever UTC hour that actually resolves to. Inventing a timezone database
  lookup here would be exactly the kind of confident fabrication the rest of
  this codebase (see `plan/service.ts`'s own comments on invented prices and
  invented times) refuses to do.
- **`not_on` and `availability` windows only ever check a single calendar day**
  pair (the plan's `earliest`/`latest`) rather than a general recurrence
  engine. A plan spanning more than two UTC calendar days is checked against
  both endpoints, not everything in between.
- **A participant not linked to a signed-in user has no standing rules to
  fall back on.** `delegate-answer` correctly reports every open question as
  skipped in that case (`"this participant is not linked to a signed-in
  human"`) rather than guessing — but it also means a guest invited by name
  only, with no account, cannot have a delegate unless the caller passes
  `rules` inline in the request. This is a real, working path (used exactly
  this way by the MCP smoke test in §4.1) but it is worth knowing it is the
  fallback, not the primary one.
- **No UI.** Standing rules are set via `PUT /v1/delegate/rules` only; there
  is no form anywhere in `web/` to enter them. This was explicitly out of
  scope (`web/` is other agents' concurrent territory) and is not implied by
  anything above.
- **No rate limiting or per-user quota on delegate-answer.** An agent could
  call it in a loop; nothing here throttles that beyond whatever the rest of
  the engine already does.
