# Sutra — complete pre-submission audit

**Produced:** 2 August 2026, afternoon IST · **Commit audited:** `68d1468`
**Verdict:** narrow finalist. Roughly **68%** against the event's published criteria.
**The one thing capping every score:** no card has ever been charged through this
system on any adapter that touches a card network.

This file is the honest, evidence-backed state of the project. It replaces the old
`HANDOFF.md` and `STATUS.md`, both of which had drifted into being wrong (one claimed
519 tests when the real count is 631, and named five agents as "in flight" that had
already died). **`AUDIT.md` says what is true. [`TASKS.md`](TASKS.md) says what to do
about it, one task at a time.**

Every claim below carries a file, a line, or a command output. Where a claim could not
be verified, it says so. Nothing here is inferred from documentation — the documentation
is exactly what was being audited.

---

## 1. How this audit was produced

Five independent reviewers were run against the repository at commit `68d1468`, each
given a different published judging criterion and instructed to be adversarial and to
cite evidence. They ran the test suites, probed the live deployments, read the code, and
attempted the flows a judge would attempt.

| Reviewer | Criterion owned | Score |
|---|---|---|
| Functionality | End-to-end functionality; product experience | **7/10** |
| Payments | Prava implementation — meaningful, reliable, central | **6/10** |
| Track eligibility | Track implementation across all six tracks | mixed, below |
| Submission readiness | The Devfolio checklist, security, disclosure | **6.5/10** |
| Adversarial panel | Simulation of the eight named judges | **47.5/70** |

Contradictions between reviewers were re-verified by hand. Two reviewer claims were
found to be wrong and are corrected in place below rather than repeated.

---

## 2. The scorecard

Scored as the panel would, against the seven published criteria.

| Criterion | Score | The one-line reason |
|---|---|---|
| End-to-end functionality | **6** | Airtight in the local mock world; on the live site every clickable flow terminates in a zero-charge rail. |
| Creativity and novelty | **9** | Multi-principal mandates, consent-bound cart hashes, requote cascades, rail-aware receipts. A real protocol contribution, not a wrapper. |
| User value / market feasibility | **5** | The case people most want — one shared online cart — is honestly declared out of scope. The cases that work face UPI, Splitwise and POS split-tender as incumbents. No unit economics anywhere. |
| Prava implementation | **8** | Deepest Prava usage the panel will see. Docked because every completed charge on record came from our own simulator. |
| Track implementation | **6** | NANDA is 10/10 and should win. Visa 5, OpenAI 4, Senso 1, Linq 0 (correctly declined). |
| Product experience | **7.5** | Accounts, friends, circles, threads, extension, dashboard, receipts — far past hackathon norm. Docked for jargon-heavy landing copy and a load-unpacked-only extension. |
| What happens next | **6** | A specified L3/L4 arc and a concrete seven-step merchant adapter, but no business model and no answer to "who pays Sutra". |

**Total: 47.5 / 70.**

**Prediction.** Finalist, narrowly, on engineering depth and radical honesty. Should win
the NANDA track outright. Not a favourite for the open prize: the two judges who move
that decision — Manjot Pahwa and a generalist engineer — both come away respecting the
team and doubting the business, and the event's own criterion #1 is the one box the repo
admits is unticked.

---

## 3. What is genuinely strong

Stated plainly so it is not lost among the problems. This is not a hackathon wrapper and
no judge will mistake it for one.

**The tests are real and they pass.** Verified by running them, not by reading a number
in a document:

| Suite | Result |
|---|---|
| `npm test -w engine` (PowerShell) | **631 passed / 631**, 36 files, 2.6s |
| `npm run test:widget` | **33 passed / 33** |
| `nanda-town-prava` pytest | **117 passed, 1 skipped**, 0.62s |
| `npm run build` | Clean. Next.js 15.5.22, 21 routes, no type or lint errors |

**Both halves are deployed and genuinely talking.** A reviewer registered a fresh account
against the live site and round-tripped register → session cookie → dashboard, all 200.
`GET /health` on Railway returns `"prava_adapter":"sandbox"` — the deployed engine is
pointed at the real Prava sandbox with a real `sk_test_` key, not the offline simulator.

**Real OpenStreetMap venue search works live.** A probe near Koramangala returned real
venues in 5.8s. The "zero venues" failure recorded in the retired status doc **did not
reproduce** and appears to be fixed. It is slow, not broken.

**The protocol work is a genuine contribution.** Multi-principal mandates, consent-bound
cart hashes, requote cascades with a round cap, backstops as group credit, and
rail-aware receipts. `spec/PROTOCOL.md` and `spec/AP2-EXTENSION.md` argue the
multi-principal gap against AP2 v0.2 in specific, dated terms.

**Reliability is tested, not asserted.** Idempotency reference per attempt with crash-safe
attempt reconstruction from the event log; unknown charge state never treated as failure;
the charge recorded durably *before* the slow settlement report; terminal-4xx distinguished
from transport failure. All pinned by `engine/test/crash-double-charge.test.ts`, which
reconstructs the exact crash state and asserts no double charge on resume. Caveat: these
paths have only ever run against `MockPrava`, never against real sandbox latency.

**The honesty architecture is the project's signature.** `verifyReceipt` structurally
rejects an `at_venue` receipt claiming a charge, and recomputes the total from entries so
a forged `totals.charged` cannot slip past (`engine/src/receipt.ts`). `docs/PITCH.md`
carries a "claims to avoid" table. The README pre-concedes the money boundary before any
judge can find it. The adversarial panel's verdict on the hardest attack was: *"cannot
catch them in a lie — the lie was pre-refuted."*

**The NANDA plugin is the single best artifact in the repository.** Real
`nest.plugins.payments` entry point verified at runtime via `importlib.metadata`; runs the
stock marketplace against `nest-core` 0.1.4 producing **byte-identical traces** to the
bundled baseline, which is the strongest possible drop-in proof; 117 tests; a limitations
section longer than most teams' entire READMEs; and a live-engine run that found and fixed
a real bug the simulator structurally could not detect.

---

## 4. The decisive gap

> **No real card has ever been charged.** Every completed charge in this repository came
> from our own mock adapter.

This is not a documentation problem. It is judging criterion #1 — the handbook's exact
words are *"build a working product where an AI agent can discover, decide and complete a
transaction using Prava"*, and its bright line is *"creating a payment session alone is
not a completed order."*

**What already works:** the engine mints real Prava mandate sessions against the real
sandbox and returns real hosted approval URLs on `sandbox.collect.prava.space`. Verified —
real session IDs exist in the evidence pack.

**What has never happened:** a human opening one of those URLs and completing the passkey.
Every real sandbox session ever minted **stayed pending and was cancelled**. No script can
do this step; that is the protocol's security property, not a bug.

**Why it is worth more than anything else on the list:** one successful run simultaneously
upgrades the Prava overall track, the Visa track, and half the NANDA track, and deletes the
single sentence every judge will otherwise quote back — the repo's own admission that no
charge is documented.

**Cost:** roughly 30 minutes with a phone. Procedure in [`TASKS.md`](TASKS.md) task P2-1.

---

## 5. Track-by-track

The team intends to enter every track except Linq. One of those entries should be dropped.

| Track | Verdict | Blocking gap |
|---|---|---|
| Prava overall finalists | Eligible-weak | No completed transaction, ever |
| **Project NANDA** | Eligible-weak | **No upstream pull request exists** — a stated qualify bar |
| Visa Intelligent Commerce | Eligible-weak | Same charge gap; strongest partner fit otherwise |
| OpenAI | Eligible-weak | Real and deployed, but our own docs call it dispensable |
| Localhost (startup-ready) | Eligible-weak | Zero user evidence; browser profile in git history |
| **Senso** | **Ineligible** | **Zero Senso integration anywhere in the repo** |

### 5.1 NANDA — the track most worth winning, currently failing a qualify item

Every published look-for is met at a high standard: reliability (117 tests), transaction
coverage (`pay`, `pay_group` across five policies, pre/post-capture refund, requote
cascade, unknown states, partial), reuse (real entry point, byte-identical baseline
traces), failure handling (unknown never becomes FAILED; `RefundNotSupportedError` carries
a remedy), documentation (a 979-line evidence pack including a "what we did NOT verify"
section), and simulation quality.

**But the handbook's qualify bar reads: *"Demonstrate a sandbox transaction, handle
failures, document the adapter and submit the relevant pull request and Devfolio
project."*** There is no fork, no PR branch, and no mention of the requirement anywhere in
our own checklists. The team appears simply not to have known. Cost to fix: about an hour.

Second gap: every *completed* transaction through the plugin is `MockPrava`. Real sandbox
sessions were minted through the plugin and all stayed pending.

One attack lands and should be prepared for rather than patched: Prof. Raskar can ask what
agents-with-money actually *did* that was interesting. The honest answer is that the town's
bundled economy is a closed loop that cannot represent a merchant, which makes P2P agent
payment structurally impossible — a real and negative finding, not an emergent one. It is
well argued in the evidence pack; it should be said out loud rather than hidden.

### 5.2 Senso — do not enter

"Senso" appears exactly twice in the entire repository, both times in a prize table. There
is no SDK, no API call, no configuration, no mention in any code path. The track row in
`docs/HACKATHON.md` mapped the entry to Sutra's *own* discovery chain — A2A AgentCard,
NANDA AgentFacts, SKILL.md, signed receipts — none of which involves Senso.

That discovery work is genuinely strong, possibly the best in the field. It is still not a
Senso entry. The qualify bar requires Senso to *materially influence the discovery or trust
decision*, and a product containing no Senso cannot meet it under any reading.

Entering anyway is the handbook's explicitly named anti-pattern ("partner technology added
only to qualify for a track"), and Saroop Bharwani sits on the same panel that judges the
strong NANDA and Visa entries. The downside is not losing Senso — that is unwinnable — it
is contaminating everything else. **Do not check this track.**

### 5.3 OpenAI — real, deployed, and undersold by our own words

The key is live on Railway (`OPENAI_MODEL=gpt-4.1-nano`) and there are five genuine call
sites, each with a deterministic fallback:

| Where | What it does |
|---|---|
| `engine/src/agent/extract.ts` | sentence → plan slots — the marquee demo's front door |
| `engine/src/agent/classify.ts` | intent → one of 21 closed venue categories |
| `engine/src/messages/classify.ts` | `@sutra` chat intent routing |
| `engine/src/bill/index.ts` | bill-photo vision |
| `engine/src/routes.ts` | free text → group proposal |

The architecture position — a model may propose slots but never commits, never picks a
venue, never sets a price, never invents a coordinate — is a genuinely good safety
argument. But we wrote the rejection letter ourselves: our own docs say *"nothing in the
demo path depends on an LLM being available."* True, principled, and track-fatal if quoted
into the submission. Demo the phrases the deterministic floor genuinely cannot parse, and
the bill-photo vision path, and let the five call sites speak.

### 5.4 Visa — best partner fit, same single blocker

The controls story is real in code: `merchant_scope: 'listed'` with
`purchase_context[].merchant_details`, `max_charges: 1`, per-member `total_amount` equal to
that member's own cap, and settlement closed only when `status === 'completed'` **and**
`visaConfirmation !== 'FAILURE'`. Nothing in the codebase can approve anything — proven
adversarially.

One honest caveat: the charge response's `credentials` field — the single-use
merchant-locked card Prava mints per person, which is the product's stated differentiator —
**is read nowhere and dropped**. That is a deliberate PCI-scope decision, not an oversight,
but it means the differentiator is narrated rather than exercised. Do not try to wire it
before the deadline.

The unanswerable-today attack: *"Visa Intelligent Commerce is user sets controls, agent
transacts within them. You built the controls and deleted the agent."* Our L3 delegate
layer is specified and not built. The defensible answer is that multi-principal mandates
are a genuine gap in the VIC and AP2 models and this is a contribution to that controls
model — but that answer exists nowhere in the docs and should be written down.

---

## 6. Every problem found, ranked

Ranked by what it costs at judging. Each carries its evidence and its fix task in
[`TASKS.md`](TASKS.md).

| # | Problem | Evidence | Task |
|---|---|---|---|
| 1 | No real card ever charged | Repo's own README and evidence pack; every real session stayed pending | P2-1 |
| 2 | No NANDA upstream pull request | `git remote -v` shows only our own repo; no fork, no branch | P2-2 |
| 3 | Every live clickable flow ends in a zero-charge rail | `builder.tsx` maps finish lines to `shopify_pos` / `checkout_handoff`; the only charging finish line is the Shopify test mode | P1-1 |
| 4 | Shopify test-order proof is **disabled in production** | Live probe: `GET /v1/shopify-test/status` → `{"enabled":false}` | P1-2 |
| 5 | Demo film is stale | `sutra-demo.mp4` encoded 10:57; `narration.json`, `v2-scenes.js`, `index.html` rewritten 13:37. The rendered cut still carries atomicity wording our own claim card forbids | P3-2 |
| 6 | `npm run demo` fails opaquely with no engine running | Bare `✗ fetch failed` and npm error spew; the dependency is documented only in a code comment | P1-3 |
| 7 | Judge account may land on an empty dashboard | Fresh accounts land on "All clear / Nothing needs you right now" | P1-4 |
| 8 | `spec/PROTOCOL.md` falsely states `acceptShare` has no HTTP route | The route exists at `engine/src/routes.ts:314` with a consent guard. A simulated judge downgraded functionality *because of our own false self-indictment* | P1-5 |
| 9 | Senso track claimed with zero integration | Two mentions repo-wide, both in prize tables | P1-5 |
| 10 | 782 objects of Chrome profile in public git history | `git rev-list --objects --all` — includes `Login Data`, `Cookies`; deleted from tree, still reachable by clone | P3-5 |
| 11 | Malformed JSON to `/v1/auth/register` returns 500, not 400 | Reproduced three times live and locally | P1-6 |
| 12 | Live venue search takes ~6s with no streaming | Measured 5.8s on the flagship "sentence → venues" path | P1-7 |
| 13 | Anonymous plan organiser loses their copy-link buttons | Known; work around by logging in before creating a demo plan | P1-8 |
| 14 | Engine test suite fails wholesale under Git Bash | Environment trap, not a bug. `cd engine && npx vitest run` works | documented |

### 6.1 Three claims that were checked and found false

Recorded because each was believed by someone — in one case by this audit — and should not
be re-believed. Two of the three were the documentation lying about the product, which is
the failure mode this repo is otherwise unusually good at avoiding.

- **"`acceptShare` has no HTTP route."** False. The route is at `engine/src/routes.ts:314`,
  the member view exposes `action: 'accept'`, and the UI button exists. A live probe returns
  an application-level error, proving the handler ran. The spec was stale; the product was
  correct — and a simulated judge downgraded functionality on the strength of it.
- **"README claims charges land at once, contradicting PITCH."** False as of commit
  `a6f8f04`. This audit's first pass read a pre-pull copy of the README. The current README
  contains no atomicity claim and line 106 explicitly disclaims one. A full repo sweep for
  "at once", "simultaneous", "atomic" and "same moment" found no assertion anywhere that
  charges land simultaneously; every hit is either unrelated, already a disclaimer, or
  deliberately hedged ("atomic *enough*"). **The atomicity discipline is intact.**
- **"Venue search near Koramangala returns zero venues."** Did not reproduce on 2 Aug. A
  live probe returned real venues in 5.8s. It is slow, not broken.

### 6.2 Known product limitations, honestly held

These are not defects to fix before the deadline. They are real boundaries that should be
stated rather than discovered by a judge.

- **Pasting an Amazon link cannot work.** Amazon serves no structured product data and
  renders its price in JavaScript, so the URL resolver cannot reach it. The browser
  extension's `buy-action` detection strategy is the only path that reaches Amazon, and it
  is verifiable only in a real browser, not from fetched HTML. This was previously recorded
  nowhere in the repository despite being a limitation a judge will hit within a minute of
  trying — demo with a Shopify storefront link instead.
- **There are four settlement rails, not two.** `prava_mandates` charges cards;
  `at_venue`, `shopify_pos` and `checkout_handoff` all carry `charges: false`. A product
  option now defaults to `checkout_handoff`, not to the card rail, because a storefront URL
  proves catalog provenance rather than payment capability. Receipt verification rejects a
  charge claim on *any* non-charging rail via `!capabilityOf(receipt.rail).charges` — it is
  no longer hardcoded to `at_venue`, and must not be narrowed back.
- **The Chrome extension is load-unpacked only**, not on the Web Store.
- **Prava's minted single-use `credentials` are read nowhere.** A single-use merchant-locked
  card is minted per charge and dropped. This is a deliberate PCI-scope decision, not an
  oversight, but it means the product's stated differentiator is narrated rather than
  exercised.

### 6.3 The security position

| Severity | Finding |
|---|---|
| **High** | ~782 objects of a throwaway Chrome browser profile remain reachable in public git history, including `Login Data` and `Cookies` files. Deleted from the working tree, still fetchable by anyone who clones. Almost certainly empty QA-profile schemas, and Windows DPAPI binds them to one machine — but "browser profile with login data in a public payments-hackathon repo" is precisely what a diligence-minded judge greps for. Purging needs a coordinated force-push. |
| Low, accepted | The organiser-issued **sandbox** test card is written out in several docs. It is sandbox-only and issued for this purpose, so this is defensible — but every copy should carry the "sandbox-only" label, and one currently does not. |
| Clean | No live keys are tracked anywhere. `PRAVA_API_KEY` is empty in `.env` and exists only as a Railway variable. No `sk_test_` / `sk_live_` / `sk-proj` values, no bearer tokens, no Shopify admin token (placeholder `shpat_redacted` only). Real secrets live outside the repo. The `/v1/me` password-hash leak was found and fixed. |

One process note: a reviewing agent, while investigating the git history finding, extracted
and dumped the contents of those profile databases into its transcript. That overstepped —
the finding stands without it, and nobody needs to open those files.

---

## 7. What each named judge attacks

Simulated against the published panel. "Answered" means the repo already contains a good
answer; "exposed" means it does not.

**Manjot Pahwa** (ex-Stripe India; Premji Invest, Lightspeed) — *"Card 4 declines after
1–3 captured. Your own plugin raises `RefundNotSupportedError`. Three cardholders are out
cash for an order that won't ship. That's a chargeback generator. Also: what's your take
rate, and why hasn't UPI collect already solved this?"*
Partial-decline **mechanics: answered**, unusually well — straggler policies, backstop
absorption, requote cap, unknown-is-never-failed, all implemented and tested.
Partial-decline **economics: exposed** — an honest `partial` receipt is evidence, not a
remedy, and nothing says what the three charged members do next. **UPI: exposed** — the
string does not appear anywhere in the repo, from a team whose demo sentence is set in
Koramangala. **Unit economics: exposed** — no pricing, take rate, or CAC anywhere.

**Justin Leung / Ujwal Chaudhari** (Visa) — *"Show me where an agent decides to spend
money. You built the controls and deleted the agent."* **Partially answered.** The
multi-principal contribution to the controls model is real; the L3 delegate layer is
specified and unbuilt; the rebuttal exists in nobody's document.

**Prof. Ramesh Raskar** (NANDA) — *"Your traces are byte-identical, so your plugin changed
nothing observable. What did agents-with-money actually do?"* **Answered** on contribution
(byte-identical *is* the drop-in proof, and is pre-spun as such). **Partial** on emergence:
the scene is a narrated demo, and the honest finding is negative.

**Harshit Marwah** (OpenAI) — *"Your own docs say nothing in the demo path depends on an
LLM. You wrote my rejection letter."* **Exposed, by our own hand.**

**Saroop Bharwani** (Senso) — *"You entered my track with zero integration."* **Exposed.
It is simply true.** Fix by not entering.

**Josh Flayhart** (Linq, generalist) — *"$100 Amazon cart, four people. Walk me through the
dollars."* The honest walk: Amazon has no Prava adapter, so this is the checkout-handoff
path; Sutra records the split, issues an approved-for-checkout receipt with **charged = 0**,
and one person still pays $100. **Dollars moved by Sutra: $0.00.** The documents answer
this completely and pre-emptively; the product is exposed and knows it. Where the dollars
walk *does* work end to end is a Prava-adapter merchant: four mandates capped at $26.25,
sequential person-scoped captures, no shared card field.

**Vidit Gujrathi** (non-technical) — can he understand it in 60 seconds? **Partially.** The
hero line lands. Then "merchant finish line", "rail", and "without pretending an agreement
was a payment" arrive, and the compulsive truth-labelling may read to a layperson as *this
doesn't actually work*.

---

## 8. Deadline

The participant handbook is the confirmed primary source: **hard deadline 7:00 PM PT
Sunday 2 August = 7:30 AM IST Monday 3 August.** Earlier planning in this repo targeted
3:00 PM PT because the 7 PM figure could not be verified at the time; that is now
resolved, and the extra four hours are real.

Aim to publish roughly two hours early anyway. Devfolio's publish flow has failed for
people before, and a video upload can stall.

---

## 9. What was fixed after this audit

The audit above is a snapshot taken at commit `68d1468`. This section records what changed
in response to it, so the two can be read together without the snapshot being rewritten into
something that was never true.

**Test suite: 631 → 690 tests across 41 files.** Every fix below is pinned by a test.

### Product defects fixed

| Was | Now |
|---|---|
| The dashboard bucketed **any** approved share into "Could still be charged — the merchant can take it, up to your cap, without asking again". That is false on the three non-charging rails, where no mandate exists. It was a false money claim on the first screen a judge sees. | Buckets branch on `capabilityOf(rail).charges`. Only card-rail approvals count as exposure; everything else reads "agreed, not charged". |
| `gmp verify` pinned against `GMP_API`, defaulting to `localhost:4100`. A judge with a dev engine running, following the command our own receipt page printed, saw **`✗ VERIFICATION FAILED`** on a genuine production receipt. | Pinning is opt-in via `--engine`. A key mismatch now reports "signed by a **different** engine" rather than a verification failure, so "forged" and "wrong engine" can never be confused. The receipt page prints a command that works as printed. |
| The reliability record counted only `member.approved`, but non-card rails emit `member.accepted`. An account that had honoured five group agreements displayed as 0% approved, next to two declines. | Counts either event for that aggregate, with the distinction preserved everywhere it carries meaning. |
| `/v1/people` returned the entire user table — every throwaway QA account on the deployment — and fired ~30 `403`s per page load. | Requires sign-in; returns friends plus people with real evidence of contact. Search still reaches the directory, so friend requests still work. No 403 storm. |
| A seven-day deadline displayed as "167h 57m left". | Days render. |
| The demo account was permanently called "test" — no route could rename a user. | `POST /v1/me/profile`, guarded so it is structurally impossible to edit another user's profile, with an explicit attack test. |
| Plan search blocked the create response on Overpass, which was dominated by a 3s hedge delay waiting on a mirror that essentially never answered first. **2.3s–36s** to create a plan. | Search is fire-and-forget with per-plan serialization; hedge tuned to 1200ms. **35ms–1.9s**, with the page honestly showing "Searching OpenStreetMap…" because it genuinely is. |
| An unrecognised category fell through to a name-substring search, so the model emitting `"venue"` matched every road ending in "Avenue" — the board offered a police station and a car dealership as brunch venues, each with a confident explanation. | Closed at three layers: the tool schema constrains the model to the taxonomy's closed set, an explicit check drops anything unrecognised, and the taxonomy refuses the name-substring fallback for generic words. |
| `npm run demo` — the README's flagship command — failed against a dead port with a bare `✗ fetch failed`. | Probes `/health` and starts an engine in-process when the target is local (no subprocess, so no orphaned Windows process tree), or explains clearly when it is remote. |
| Malformed JSON returned `500 internal error`. PowerShell mangles JSON quoting by default, so this was one of the likeliest things a judge would trip over. | 400 with a message naming the problem, fixed centrally so it covers every route. Empty body, wrong content-type, wrong shape and oversized body all return sane 4xx. |
| The card rail was invisible: the capped-mandate tile was hidden whenever unavailable, and the finish-line picker sat below policy settings. | The tile always renders in one of three honest states; the picker moved up beside the people editor; the member panel distinguishes "no mandate exists yet" from "mandate session live, capped at ₹X — waiting on their passkey". |
| The Shopify proof was invisible in production and its setup guide would have produced a token that dies after 24 hours (Shopify discontinued legacy custom apps on 1 January 2026). | Client-credentials exchange with auto-refresh, a status endpoint that distinguishes not-configured from blocked-in-production, a degraded-state UI that explains the capability, and a verified Dev Dashboard setup checklist. |

### Repository

Deleted a 5.2 MB Tesseract model nobody loads, a stray route dump, and a zero-byte file whose
filename was a mangled Windows path from a broken shell redirect. Added the `ALLOW_DEV_AUTH`
and `VAPID_*` variables the engine actually reads to `.env.example`.

### One gate that was examined and deliberately left alone

`engine/src/routes.ts:94-104` refuses to let a browser user create a `prava_mandates` group
unless the merchant has a server-verified payment adapter. This makes the card rail
unreachable from the UI until a Shopify development store is configured — which looks like a
defect and is not one. Minting real capped card mandates against a merchant Sutra cannot
complete an order with would mean taking a group's money for a purchase that cannot happen.
The gate is the honest answer to that objection and should not be loosened to make a demo
easier.

## 10. Documentation changes made by this audit

| Action | File | Why |
|---|---|---|
| Created | `AUDIT.md` | This file — the single source of truth on current state |
| Created | [`TASKS.md`](TASKS.md) | The prioritised work queue, one task at a time |
| Created | `docs/ENGINEERING-NOTES.md` | Permanent knowledge rescued from the retired docs: the honesty invariants, the Prava integration traps, the file ownership map |
| Deleted | `HANDOFF.md` | Superseded. Its permanent content migrated; its status content was stale |
| Deleted | `STATUS.md` | Superseded and actively wrong — 519 tests, a 3 PM deadline, five dead agents listed as in flight |
| Corrected | `spec/PROTOCOL.md` | Removed two false statements that our own `acceptShare` route does not exist over HTTP |
| Corrected | `docs/HACKATHON.md` | Senso row honest; deadline resolved to 7 PM PT; NANDA PR requirement added as UNMET; disclosure corroborated against git history |
| Verified clean | `README.md` | Checked for the atomicity contradiction and found none — already fixed in `a6f8f04` |
| Corrected | `docs/AGENT-MESH.md` | Delegate routes are live (401, not 404); the doc said they were not deployed |
| Removed from the repo | `film/**` | Untracked and gitignored. 6.7 GB of rendered frames, sound and voice tracks, plus the scene sources. Every file remains on the owner's disk; the finished video is uploaded to the submission directly. References in `package.json`, `docs/README.md` and `docs/REPO-MAP.md` updated to say so rather than link into a directory that no longer ships. |
| Created, gitignored | `DEMO/` | A local recording playbook: the run order, the narration, the shot checklist, and the never-show-on-camera list. Not part of the judged repository. |

`docs/ENGINEERING-NOTES.md` is worth calling out separately. Migrating the invariants
revealed that **eight of the nine file:line citations had drifted**, and three invariants
described code that had materially changed — most importantly, there are now **four**
settlement rails rather than two, and receipt verification rejects a charge claim on *any*
non-charging rail rather than being hardcoded to `at_venue`. Copying those forward verbatim
would have shipped three fresh false claims into a document whose entire purpose is
preventing exactly that.
