# HANDOFF — read this first

Working state for the Agentic Commerce Hackathon submission (deadline **3 PM PT, Aug 2 2026**;
target submission 1 PM PT). If you are a fresh agent picking this up, read this file top to
bottom before touching anything, then read `README.md` and `spec/PROTOCOL.md`.

**Last updated:** 2026-08-01, after the Vercel frontend deploy.

---

## 1. What this is, in three sentences

Every agentic payment protocol shipping today (AP2, ACP, Visa IC, Prava) assumes **one** user
granting **one** agent **one** mandate. GMP/1 is the multi-principal layer: N people each approve
their own Prava mandate on their own card, and an engine commits them atomically-enough or cancels
every one. On top of that sits a coordination layer that decides *what* the group is buying in the
first place — from a sentence, a link, or a photographed bill.

---

## 2. Current state — BOTH HALVES ARE DEPLOYED AND TALKING

| What | Where | Status |
|---|---|---|
| Frontend (Next.js) | https://sutra-gmp.vercel.app | **live, public** |
| Engine (Fastify) | https://engine-production-e6fa.up.railway.app | **live**, `/health` 200 |
| Vercel project | `soham-aggarwals-projects/sutra` | linked to GitHub `Soham109/sutra` |
| Railway project | `sutra-engine` / service `engine` | volume at `/data`, 1 replica |

Verified: `/api/v1/places/status` through the Vercel proxy returns 200, and the full
`e2e/plan-flow.ts` runs against the production engine (real geocode → real venues → ranked → group).

`sutra.vercel.app` is taken by another Vercel account (global namespace). Vercel SSO protection is
**disabled** so judges can open it without a login. Pushing to `main` auto-deploys the frontend.

### Deploy invariants — do not break these
- **`numReplicas: 1`.** Load-bearing, not a cost choice: the poller, the in-process `EventHub` and a
  single-file SQLite database all assume exactly one process. Two replicas double-poll and split the
  SSE fan-out.
- **Volume mounted at `/data`, `DB_PATH=/data/gmp.db`.** Without it every redeploy wipes all groups
  and receipts. (Watch out: Git Bash mangles `/data/gmp.db` into a Windows path via MSYS path
  conversion — set that variable from PowerShell, or with `MSYS_NO_PATHCONV=1`.)
- **`ENGINE_SIGNING_SEED` is fixed.** Without it the engine mints a new Ed25519 key on every restart
  and receipts signed before a redeploy stop verifying.
- **The engine cannot run on Vercel.** File-backed SQLite, a 1.5s poller that is the only way
  approvals are ever detected, long-lived SSE, in-process `EventHub`. Serverless kills all four.

Redeploy commands:
```bash
npx @railway/cli up --ci          # engine (from repo root, project already linked)
npx vercel --prod --yes           # frontend
npx vercel alias set <deployment-url> sutra-gmp.vercel.app
```

---

## 3. Next steps, in order

### 3.1 Prava sandbox — DONE, now needs a human with a phone
The engine runs `PRAVA_ENV=sandbox` against a real `sk_test_*` key. `/health` reports
`"prava_adapter":"sandbox"`. `npm run e2e:proof` creates a group and mints a **real** Prava mandate
session per member, returning hosted `sandbox.collect.prava.space` approval URLs.

What remains is the one step no script may perform: a human opening that URL on a phone and
completing the passkey ceremony with a sandbox test card. Then the poller sees the mandate go
active and the engine commits on its own. `npm run e2e:proof -- --watch` polls until terminal and
prints the charged total and the receipt URL.

Merchant identity registered with Prava: application name `sutra` (this became the permanent
merchant id — it appears as `merchantId: "sutra"` inside the session token), merchant URL
`https://sutra-gmp.vercel.app`.

**Prava production access** (they emailed a Tally form): *not needed, and do not submit yet.* Their
own instruction is "only submit once you have your sandbox functioning end to end", and access is
revoked after judging anyway. Sandbox is the demo of record.

**Key hygiene:** the sandbox secret was pasted into a chat transcript. It is sandbox-only so the
blast radius is small, but rotate it in the Prava dashboard after judging.

#### A live-doc discrepancy worth knowing
The API reference says the Create Session response carries `authorizeOnly: true` for mandate-setup
sessions, and an earlier revision of `client.ts` refused to proceed without it. **The live sandbox
never sends that field** — a 201 carries exactly `session_id, session_token, expires_at,
iframe_url, order_id`, identically for a `mandate_setup` body and a plain one. That guard blocked
every approval until it was removed.

There is also no substitute assertion available at creation time: a mandate does not exist until
the human passkeys, so `GET /v1/mandates?customer_id=…` returns `{"mandates":[]}` for both kinds of
session immediately afterwards (verified). The real confirmation is the one the poller already
does — a standing mandate appearing `active` for that customer. Sessions expire ~15 minutes after
creation, which is why sessions are created lazily on first open rather than at group creation.

### 3.2 NANDA prize work (see §5 — the human's stated priority)

### 3.3 `OPENAI_API_KEY`
Optional everywhere. It upgrades intent extraction and enables server-side receipt-photo reading.
The deterministic paths are the floor, not a stub, and work with no key at all.

---

## 4. What is built and verified

Run these; they are the evidence.

| Command | Expected |
|---|---|
| `npm test -w engine` | 11 files, **356 tests** pass |
| `npm run test:widget` | **30** pass — detector against 10 real captured pages |
| `npm run chaos` | 60 randomized fault runs, six invariants, "GREEN WALL" |
| `npm run demo` | full commit run, receipt chain + signature verify |
| `npm run e2e:plan` | needs a running engine; real OSM geocode → real venues → ranked → group |
| `npm run build` | Next.js production build, 17 routes |
| `npx tsc --noEmit -p engine/tsconfig.json` | clean (also `cli/`, and `web/` via `npx tsc --noEmit`) |

### The two halves

**Coordination layer** (`engine/src/plan/`, `places/`, `agent/`) — new this session.
A `Plan` is vertical-neutral: movies, dinner, flights, a receipt and a checkout page are the same
object with different slots filled. Free text → slots → each participant answers typed **signals**
(rsvp / availability / location / budget / vote / constraint) → real options from OpenStreetMap
(Nominatim + Overpass, keyless, global) or storefront/URL resolution → ranked by a pure explainable
scorer → chosen → becomes an ordinary GMP/1 group.

**Protocol engine** (`engine/src/service.ts`) — pre-existing, hardened this session.
Cart → N Prava mandates → sequential idempotent commit → hash-chained Ed25519 receipt.

### Surfaces
- `/app` — command centre: needs-you queue, **exposure meter**, waiting-on, settled
- `/p/:participantId` — the phone page a friend opens to answer, no account
- `/app/plans/:id` — ranked options with the arithmetic visible
- `/app/bill` — paste a receipt, itemise, claim, split
- `/a/:memberId` — the approval page (rail-aware: passkey vs accept)
- `widget/` + `extension/` — one detector, three shells (script tag, bookmarklet, Chrome MV3)
- `nanda-town-prava/` — the NANDA Town payments plugin
- discovery: `/.well-known/agent-card.json`, `/agent-facts.json`, `/api/agents`, `/skill.md`

---

## 5. NANDA prize — the human cares most about this

The prize is named **"$1,000: Best Prava Adapter for the NANDA Town."** It is *not* index
registration. NANDA Town (`github.com/projnanda/nandatown`) is a Python agent simulator with a
pluggable layer architecture; `payments` is one layer.

**We are eligible — it is built.** `nanda-town-prava/` registers under entry point
`nest.plugins.payments` as `prava_mandates`, verified against published `nest-core` **0.1.4**:
`nest plugins list` shows it, `nest run ./bench.yaml` produces a 2200-event trace that passes the
same three marketplace validators as the `prepaid_credits` baseline, 44 pytest pass.

**The pitch:** their built-in `prepaid_credits` is a pooled internal ledger — agents hold balances
and move value between each other. Ours never pools. `pay()` maps onto a real card-network
authorization scoped to one merchant and capped at one amount; money leaves a real card and reaches
a real merchant, and the simulator holds no balance. `refund()` honestly reports that a settled card
charge does not roll back, rather than pretending.

### Gaps, ranked by how much a judge would care
1. **`live` mode has never run over HTTP against the real engine.** Only injected-transport tests.
   This is the mode that actually demonstrates Prava. **Unblocked by §3.1.**
2. **No `nest report` diff against the `prepaid_credits` baseline.** This is the evidence artifact:
   same validators, same scenario, ours never pools. Generated once but never inspected or diffed.
3. **Not submitted to the SkillMD registry.** `POST https://nandatown.projectnanda.org/api/skills`,
   no auth. **Unblocked by §3.1** — `npm run nanda -w cli -- check` correctly *refuses* to submit a
   localhost URL, because the registry probes publicly and badges you unreachable permanently.
4. **No real Prava charge through the plugin.** Blocked on `sk_test_*`.
5. `_simulator.py` implements a subset of GMP/1 — no deadline policies, requotes, auctions, or FX.
   Unknown policies raise rather than degrade.

### Also worth doing
- `POST https://api.nandaindex.org/auth/register` → `/api/v1/orgs` → DNS TXT challenge →
  `verify-domain`. `cli/src/nanda.ts index-register` implements the whole flow; `--dry-run` works.
  Needs a domain we control for the TXT record (a `.vercel.app` subdomain will not work).
- The `x-payments` block we add to AgentFacts is a **deliberate, clearly-labelled proposed
  extension** — the official schema has no payment vocabulary at all (there is a test that walks the
  real schema's property names and asserts this). That is a genuine spec contribution and worth
  saying out loud in the pitch.

---

## 6. Invariants a new agent must NOT break

These are load-bearing honesty rules. Breaking one turns the product into a liar.

1. **`charged` means money moved through this engine. `settled` means it did not.**
   Two settlement rails exist (`engine/src/rails.ts`): `prava_mandates` charges real cards;
   `at_venue` exists because a restaurant bill has **no merchant Prava can charge**. On that rail
   the engine allocates, records explicit acceptance and signs a receipt, and never claims a charge.
   `verifyReceipt` **fails** any receipt claiming `charged > 0` on `at_venue`. Tested in
   `engine/test/rails.test.ts` including a forged-receipt case.
2. **An OpenStreetMap venue is always `at_venue`.** Its `url` is a map page or a brochure site, not
   a payment endpoint. This was a real bug that got fixed; do not "improve" it back.
3. **Never invent a price.** OSM knows where a restaurant is, not what dinner costs. The UI asks the
   human and says why.
4. **A missing signal is never agreement.** `engine/src/plan/rank.ts` drops silent participants from
   a factor's *denominator* and says so in the `why` sentence; it never counts them as a yes.
5. **The ranking is arithmetic, not a model.** Five weighted factors, each with a human-checkable
   sentence rendered verbatim in the UI. No LLM gets a vote in the ordering.
6. **The LLM only fills slots.** It never picks a venue, sets a price, or decides who pays what.
   Everything works with no key at all via `extractDeterministic`.
7. **Unknown charge state is never treated as failure.** It is resolved by fetching the mandate's
   `charges[]` and matching our idempotency `reference`.
8. **Currency is never guessed from a schema default.** Inferred from the geocoded country or the
   bill's tax regime, always disclosed as an inference, and an explicit symbol always wins.

---

## 7. Prava integration notes (audited against live docs this session)

Our `openapi.json` matched the live spec when checked. Fixes made — do not regress them:

- The idempotency field is named **`reference`**.
- A **4xx error envelope is terminal**, not a transport blip. Retrying it wastes the commit window
  and lets a deterministic refusal masquerade as unknown state.
- `listMandates` must send **`standing_only=true`** — an ordinary checkout creates transient
  per-checkout mandates internally, and picking one up reads as an approval that never happened.
- **`callback_url` must be https.** A non-https base URL now omits it rather than 400-ing the whole
  session. The poller, not the callback, is what actually detects approval.
- Settlement is only settled when `status === 'completed'` **and** `visaConfirmation !== 'FAILURE'`.
- The mock was made **less** strict to match reality: Prava clears the idempotency key of a *failed*
  charge, so a failed charge is no longer deduplicated.

Documented ambiguities (unresolved in Prava's own docs): how `effective_until_minutes` interacts
with the one-time 7-day clamp; what revoking a session does to a still-pending mandate; the browser
harness page has no API surface at all.

---

## 8. Known holes (be honest about these, do not paper over them)

- `ENGINE_API_TOKEN` is one shared bearer token, and `NEXT_PUBLIC_ENGINE_TOKEN` ships it to the
  browser. Anyone can create groups on the engine. Fine for a hackathon, not for production.
- Identity is a handle in a cookie. An `x-sutra-user` header is enough to read someone's dashboard.
  It grants no spending power — that still needs the member's own passkey on Prava's page.
- SQLite single file, single process. No rate limiting. The URL resolver fetches arbitrary merchant
  pages (SSRF surface; `safeFetch` guards it but it needs a real audit before public launch).
- Chrome Web Store publishing is blocked on the shared token being extractable from the bundle.
- Web push needs VAPID keys; iOS needs the PWA installed to Home Screen.

---

## 9. File ownership map

```
engine/src/service.ts        the commit saga — the hard part, treat with care
engine/src/rails.ts          settlement rails + the honesty model
engine/src/plan/             coordination: types, store, service, rank, time, geo
engine/src/places/           OpenStreetMap: nominatim, overpass, taxonomy (keyless, rate-limited)
engine/src/bill/             deterministic receipt parser + reconciliation + currency inference
engine/src/agent/extract.ts  free text → slots (deterministic floor, LLM optional)
engine/src/notify/           RFC 8291 web push, hand-rolled, validated against the RFC test vector
engine/src/discovery/        A2A card, AgentFacts, AI catalog
engine/src/prava/            client (real REST), mock (offline sim), chaos (fault proxy)
web/src/app/app/page.tsx     the command centre
web/src/components/plan/     the answer flow and option cards
widget/detect.js             the universal cart detector — shared by widget, bookmarklet, extension
nanda-town-prava/            the NANDA Town payments plugin (Python)
cli/src/nanda.ts             nanda check / skill-submit / index-register
```

---

## 10. Progress log

- **2026-08-01** — Coordination layer built end to end and verified live against real OpenStreetMap.
  Prava client audited against live docs; five real defects fixed, including unknown-charge-state
  reconciliation. Settlement rails added with the receipt honesty rule. Dashboard rebuilt as a
  command centre. Bill splitter, participant answer flow, plan board. Universal cart detector +
  bookmarklet + Chrome extension. NANDA Town plugin. Web push. Discovery documents. Docs rewritten
  (README, PROTOCOL draft-2, AP2-EXTENSION against **v0.2**, new COORDINATION.md).
  Three real bugs caught only by live runs: bare amounts defaulting to USD, JPY minor-unit rescale,
  and an OSM venue landing on the card rail.
- **2026-08-01** — Frontend deployed to Vercel, SSO protection disabled, aliased
  `sutra-gmp.vercel.app`. Engine deployed to Railway with a `/data` volume; both halves verified
  talking through the `/api/*` proxy, and `e2e/plan-flow.ts` runs green against production.
- **2026-08-01** — Two bugs found only by running against the deployed engine: options were being
  scored against a **stale** common time window frozen at whatever the first responder said, and a
  rate-limited Overpass call would **wipe a working board to zero** because `clearOptions` ran
  before the search result was known. Both fixed; options now carry only a time their source really
  knows, and an empty refresh preserves the previous board.
- **2026-08-01** — Photo bill capture, with OCR **in the browser** (tesseract.js, dynamically
  imported, no key, nothing uploaded) feeding the same deterministic parser. Finding the right
  page-segmentation mode was not cosmetic: modes 3/4/11/12 read a receipt as two columns and tear
  `2587.50` into `2587.` plus an orphaned `50`, after which the parser reconciles 2587.00 against a
  printed 2587.00 and reports — truthfully — that the maths checks out, on numbers that are all
  wrong. Mode 6 scored 8/8 exact amounts against 0/8 for every other mode. Because a different
  receipt could still fracture, `engine/src/bill/integrity.ts` detects the signature server-side,
  the UI refuses to show a green tick over it, and `POST /v1/bill/split` **rejects** it unless the
  caller passes `force`. Regression test uses the verbatim broken OCR output.

### Next agent: start at §3.1 (Prava sandbox key), then §5 (NANDA)
