# sutra — GMP/1, the Group Mandate Protocol

**Every payment protocol shipping today assumes exactly one person is saying
yes. We built the multi-principal layer.**

One cart, N people, N cards. Each member passkey-approves a **Prava mandate**
on their own card — capped at their share, locked to the merchant, enforced at
the card network. When the group's **commit policy** passes, the engine
charges everyone in one tight window. When it can't, it cancels every mandate
and *nobody was ever charged*. No pooled funds. No one fronts the money. The
engine never sees a card number.

Team **`__init__ to win it`** (Soham + Arshjeet) · Agentic Commerce Hackathon, Aug 1–2 2026 · built on [Prava](https://docs.prava.space).

---

## Quickstart

```bash
npm install
npm run dev          # engine + surfaces on http://localhost:4100 (mock Prava — full offline demo)
```

Then, in another terminal:

```bash
npm run demo                              # run one: 4 approvals → 4 charges → verified receipt
npx -w cli tsx src/gmp.ts demo backstop   # run two: a decline, silently absorbed by a friend's backstop
npx -w cli tsx src/gmp.ts demo abort      # run three: ABORTED, NOTHING CHARGED
npm test                                  # 35 unit/property/integration tests
npm run chaos                             # the green wall (see below)
```

Surfaces: `/new` organizer → QR sheet · `/a/:id` member approval (the hero)
· `/g/:id/board` war room with replay scrubber · `/g/:id/receipt` signed
receipt · `/g/:id/share` QR sheet · `/g/:id/totem` NFC totem programmer ·
`/j/:id` tap-to-join · `/widget-demo` the 1-script-tag integration.

Flip to real sandbox: set `PRAVA_ENV=sandbox` and `PRAVA_API_KEY=sk_test_…`
in `.env`. Run `npx tsx e2e/sandbox-smoke.ts` first (one deliberate
transaction; the team test card allows 30/day — the chaos suite structurally
refuses to touch sandbox).

## What's here

| Piece | Where | What |
|---|---|---|
| Engine | `engine/` | Fastify + node:sqlite + zod. State machines, append-only event log, SSE, poller, crash-resumable commit |
| Protocol core | `engine/src/protocol/` | `computeShares` (largest remainder, integer minor units), the full policy algebra (`all_of, quorum, weighted, veto, required, deadline`), backstop allocator, sealed-bid auction allocator — all pure, all property-tested |
| Prava adapter | `engine/src/prava/` | typed REST client (contracts verified against the live OpenAPI spec), offline mock with real lifecycle semantics, fault-injecting chaos proxy |
| Receipts | `engine/src/receipt.ts` | hash-chained consent objects, Ed25519-signed; `gmp verify` checks them offline |
| Surfaces | `web/public/` | zero-build pages served by the engine (the Next.js/Vercel port consumes the same `/v1` API) |
| CLI | `cli/` | `gmp demo commit\|backstop\|abort`, `gmp verify receipt.json` |
| Chaos | `chaos/` | randomized fault-injection runs + invariant checker |
| MCP server | `mcp/` | `create_group_session`, `get_group_status`, `cancel_group` — any MCP agent can originate group purchases |
| Agent skill | `SKILL.md` | the same over plain HTTP |
| Widget | `widget/widget.js` | “Split this with Prava” in one script tag (<150 lines) |
| Spec | `spec/PROTOCOL.md`, `spec/AP2-EXTENSION.md` | GMP/1 formally; the multi-principal gap in AP2/ACP/Visa IC |
| Sandbox smoke | `e2e/sandbox-smoke.ts` | the hour-zero deciding test, budget-aware |

## Where the money flows, exactly

1. Member opens their link → engine lazily creates a Prava **session with
   `mandate_setup`** (one-time, merchant-locked, capped at share + tolerance).
2. Member passkeys on **Prava's hosted page** (their card, their device, their
   issuer OTP). The engine polls `GET /v1/mandates?customer_id=…` — no
   webhooks exist, polling is the design.
3. At commit, the engine calls **`POST /v1/mandates/:id/charge`** per member
   (`reference` = idempotency key), Prava mints a **single-use, merchant-scoped,
   amount-capped card credential** against the member's own card — over-cap
   charges are declined *by the network*.
4. Settlement is reported back via **`POST /v1/mandates/:id/charges/:txn/report`**;
   one-time mandates become `consumed`.
5. Abort = `POST /v1/mandates/:id/cancel` for everyone — no credential is ever
   minted, nobody was charged. Members can verify at **pay.prava.space**.

## The failure taxonomy (§10) — every way this dies, and the answer

| # | Failure | Protocol answer |
|---|---|---|
| 1 | Member never opens the link | member deadline expires them; the policy decides |
| 2 | Opens, never approves | same |
| 3 | Member declines | `all_of` aborts all; `quorum` drops & cascades; backstops may absorb |
| 4 | Passkey/OTP ceremony fails | mandate stays `pending` = not approved; retry from the same page |
| 5 | Price drift within tolerance | absorbed by the cap; receipt records quoted vs charged |
| 6 | Drift beyond tolerance | consent binding fires → requote, round-capped at 2 |
| 7 | Item gone at commit | straggler policy on that charge; tiered carts localize damage to extras |
| 8 | Charge declined by network | `failed` → straggler policy (`retry_once` / `drop_and_continue` / `halt_partial`) |
| 9 | Charge ok, report fails | report retried with backoff; **never re-charged**; receipt notes settlement pending |
| 10 | Unknown charge state | reconcile under the SAME idempotency reference; **unknown is never failed** |
| 11 | Engine crashes mid-commit | event-log replay resumes from first unsettled entry; no member charged twice (chaos-proven) |
| 12 | Duplicate/replayed delivery | idempotent references + event dedupe |
| 13 | Member cancels from their own Prava portal | poller sees `cancelled` → treated as a decline, for free |
| 14 | Organizer cancels | every mandate cancelled; receipt records who had approved |
| 15 | Two approvals race the decision | compare-and-swap on group version; loser re-reads |
| 16 | Requote cascade oscillates | round cap 2, then abort, recorded with reason |
| 17 | Approval URL leaks | ULIDs unguessable; pages expire; a leaked URL still needs the member's passkey |
| 18 | Demo merchant flakes | mock adapter is a full Prava simulator; backup merchant chosen at hour 4 |

## The chaos suite

`npm run chaos` builds random groups (random policies, declines, backstops,
charge-declines, straggler policies) against a **fault-injecting proxy** that
throws 500s, loses responses, and duplicates deliveries — then interrogates
both the engine's event log and the mock Prava's ledger:

```
✓ every group reached a terminal state
✓ no member charged twice (mock ledger cross-check)
✓ aborted/expired groups have zero settled charges
✓ cancelled mandates have zero settled charges
✓ receipt totals equal the sum of settled charges
✓ every receipt hash chain + Ed25519 signature verifies

GREEN WALL — the commit algorithm holds under fire.
```

Charges do not roll back: this is a saga with no compensating transactions,
and the receipt chain + this suite are the proof we treated it that way.

## Judge ammunition

- **Why not pooled funds?** Pooling is custody. We coordinate authorizations;
  every dollar flows member card → merchant.
- **Is this Splitwise?** Splitwise administers the debt after someone fronted
  the money. We remove the fronting; nobody is ever owed anything.
- **Why is this hard?** See the failure table and `spec/PROTOCOL.md` §4.2.
- **What does the merchant see?** N card payments fulfilling one coordinated
  plan — for tickets, N orders is the *correct* outcome; the value is the
  atomicity policy across them.
- **What's next?** The widget is the wedge; circles + trust lines on Prava's
  recurring mandates are the network; `spec/AP2-EXTENSION.md` is the
  conversation with the protocol folks.

## VERIFY ledger (hour-zero findings, kept honest)

| Claim | Status |
|---|---|
| Create Session + `mandate_setup` shape, approval URL = `iframe_url` | ✅ verified against live OpenAPI + prava-skills CLI source |
| Idempotency on mandate charge | ✅ `reference` body field; `deduplicated: true` on replay |
| Webhooks | ✅ none — polling only ("coming soon") |
| Mandate lifecycle enums & transitions | ✅ verified |
| Session lifetime | ✅ 15 min → lazy session creation on first open is load-bearing |
| Session→mandate correlation | ✅ none server-side → per-member `customer_id` polling |
| `prava-merchants-checkout` folder / Swiggy skill | ❌ **does not exist** in prava-skills (repo has prava-pay, prava-sdk-integration, prava-shopping). Demo merchant flow: `prava-shopping` quote→checkout, or mock |
| Test cards | ✅ published set + per-team card (in gitignored `.env`), OTP `456789`, 30 txn/day |
| Sponsor-sized mandates (one mandate, two shares) | ⚠ just a bigger cap — sandbox-confirm at hour zero |
| Two one-time mandates, same card+merchant (backstop) | ⚠ sandbox-confirm at hour zero (`e2e/sandbox-smoke.ts` extends easily) |
| frankfurter.app keyless FX | ✅ used for display currency, snapshot recorded in group + receipt |

## Deploy

Engine: any Node 22.5+ host (Railway/Fly) — `npm run start`, persistent disk
for `data/`, set `APP_BASE_URL` to the public HTTPS URL so approval links and
QRs point at the world. Frontend: the current pages are served by the engine;
the planned Next.js app on Vercel consumes the same `/v1` API (CORS is on).
