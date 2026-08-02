# TASKS — the work queue

**This is the file to hand an agent.** It contains one task at a time, in priority order,
each self-contained enough to be picked up cold.

Why the project is in this state and what the evidence is: [`AUDIT.md`](AUDIT.md).
How to run, deploy and debug anything: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
Rules that must never be broken: [`docs/ENGINEERING-NOTES.md`](docs/ENGINEERING-NOTES.md).

---

## How to work this file

**If you are an agent picking this up:**

1. Read this section, then read [`AUDIT.md`](AUDIT.md) sections 3 and 4 so you know what
   you are protecting and what you are aiming at.
2. Take the **topmost task that is not `DONE` and not `IN FLIGHT`**. Do not skip ahead, and
   do not batch several tasks together. Phases are ordered deliberately: the product is
   made good *before* it is proved, and proved *before* it is submitted.
3. Do only that task. When it is done, verify it with the task's own acceptance check,
   then update its status line in this file and report what you actually changed.
4. If the task turns out to be wrong, impossible, or already done — **say so and stop**.
   Do not invent adjacent work. A task that dissolves on contact is useful information.

**Non-negotiable rules for every task in this file:**

- **Never claim money moved when it did not.** No fabricated charge, no forged receipt, no
  `charged_amount` for money that did not move. This project's entire credibility rests
  here. If you find yourself about to write a charge event, stop and report.
- **Run the tests from PowerShell, never Git Bash.** `npm test -w engine` under Git Bash
  fails every file with a config error and runs zero tests. That is an environment trap on
  this machine, not a bug to fix. From Git Bash, `cd engine && npx vitest run` works.
- **Verify before you believe.** Several docs in this repo have been confidently wrong.
  Check the code, not the description of the code.
- **Do not commit** unless the task says to. The user pushes.

---

# Phase 1 — make the product complete

*Everything here is about the product being genuinely good. Finish this phase before
touching Phase 2. This is the explicit instruction from the project owner: product first,
proof second.*

---

### P1-1 · A judge must be able to reach a card-charging flow from the live site — `TODO`

**The problem.** Every flow a judge can click on `sutra-gmp.vercel.app` terminates in a
zero-charge rail. `web/src/components/discover/builder.tsx` maps the finish lines to
`shopify_pos` and `checkout_handoff`, both of which charge nothing by design; the only
charging finish line is the Shopify test-order mode, and that is switched off in
production (see P1-2). The actual card-charging path currently requires the CLI, a bearer
token, and a phone. So the product's entire thesis — N people, N cards, one decision — is
invisible to anyone who only clicks.

**What to do.** Make the `prava_mandates` rail reachable and legible from the live UI. A
judge should be able to build a group, see per-person capped mandates being created, and
reach the point where each member's approval URL exists — without a terminal. They cannot
complete the passkey without the test card, and that is fine and honest; the flow must
still be *visible and self-explaining* up to that boundary, and must say clearly what the
last step is and who can take it.

**Do not** fake the charge to make the flow feel complete. The honest end state — "two
mandates created, waiting on two people to approve on their phones, nothing charged yet" —
is a true and impressive screen. Make that screen good.

**Files.** `web/src/components/discover/builder.tsx`,
`web/src/components/discover/how-it-completes.tsx`, `web/src/components/group/`,
`engine/src/rails.ts` for the rail definitions.

**Acceptance.** From a private browser window, logged in as the judge account, a person
who has never seen this repo can start from the dashboard, produce a group on the
`prava_mandates` rail, and arrive at a member approval page — with no terminal, no token,
and no instructions from you. Write down the exact click path you took.

---

### P1-2 · Configure the Shopify dev store — `BLOCKED ON THE PROJECT OWNER`

> **This is the single highest-value thing only the project owner can do before the real
> card charge, and it unlocks P1-1 as a side effect.**
>
> The engine deliberately refuses to let a browser user create a `prava_mandates` group
> unless the merchant has a server-verified payment adapter — `engine/src/routes.ts:94-104`,
> which errors with *"this merchant has no server-verified payment adapter — use Shopify POS
> or checkout handoff"*. That gate is **right**: minting real capped card mandates for a
> merchant Sutra cannot actually complete an order with would be taking four people's money
> for a purchase that cannot happen. It is the honest answer to the "fundamentally flawed"
> objection.
>
> Today the only merchant that can pass that gate is a configured Shopify development store.
> So **without the dev store, the card rail is reachable only through the CLI proof run**,
> and a judge clicking around never reaches it. With the dev store, the whole path opens:
> browse a real product, build a capped-mandate group, approve on phones, and finish with a
> genuine `test: true` Shopify Admin order showing one labelled test transaction per person.
>
> The checklist is in `docs/SHOPIFY_FLOW.md` under "Configure the development store", Branch
> A. It takes about 15 minutes and needs a Shopify account, which is why an agent cannot do
> it. Note that Shopify discontinued legacy custom apps on 1 January 2026 — follow Branch A
> (Dev Dashboard, client ID + secret), not any older instructions, or the token will expire
> after 24 hours.

**Engine and docs work for this task is DONE:** client-credentials token exchange with
auto-refresh, a richer status endpoint (`reason` and `reason_detail`), the degraded-state UI,
and the verified setup checklist all landed. Only the owner's 15 minutes remain.

---

### P1-2b · Original scoping notes — `DONE`

**The problem.** `GET /v1/shopify-test/status` on the live engine returns
`{"enabled":false}`. The flow is real, well-gated and tested — it mirrors completed test
charges into one genuine `test: true` Shopify Admin order with a labelled test transaction
per participant — but a judge cannot see it produce anything without standing up their own
dev store and offline admin token. It is currently the newest, most impressive-sounding
feature and it is invisible.

**What to do.** Either (a) configure a real Shopify development store on Railway so the
flow works live — the setup is documented in `docs/SHOPIFY_FLOW.md` "Configure the
development store" — or (b) if that is not achievable in the time available, make the
product state the situation plainly rather than silently hiding the option. Right now
`how-it-completes.tsx` hides the card when the status endpoint says unavailable, which is
correct behaviour but means judges never learn the capability exists.

Route (a) is much stronger if the dev store can be created. It ends with a Shopify Admin
order a judge can open.

**Do not** loosen any of the server gates: non-production Prava only, organiser-or-operator
auth, `origin=shopify_test` + `rail=prava_mandates`, group committed, charged total equal
to cart total, merchant domain match. Those gates are what make this honest.

**Files.** `engine/src/shopify/test-order.ts`, `engine/src/routes.ts` (the status and
proof endpoints), `web/src/components/group/ShopifyTestProof.tsx`,
`web/src/components/discover/how-it-completes.tsx`, `docs/SHOPIFY_FLOW.md`.

**Acceptance.** Either the live status endpoint reports `enabled: true` and a test order
can be created end to end and opened in Shopify Admin, or the UI explains the capability
and its configuration requirement without pretending it is unavailable for a different
reason. State which route you took and why.

---

### P1-3 · `npm run demo` must fail helpfully — `TODO`

**The problem.** The flagship demo command silently depends on an engine already listening
on port 4100. Against a dead port it fails with a bare `✗ fetch failed` and npm error
spew. A judge who clones the repo and runs the command the README advertises gets an
opaque failure and forms their entire impression from it.

**What to do.** Detect the unreachable engine and print a short, human instruction —
start `npm run dev:engine` first, or run `npm run dev` for both halves. Better still, have
the demo start an engine itself when none is running, if that can be done without
surprising anyone. Check the README's quickstart actually works from a cold clone.

**Files.** `cli/src/gmp.ts`, `package.json` scripts, `README.md` quickstart section.

**Acceptance.** With nothing running on 4100, `npm run demo` prints a one-line explanation
a stranger can act on. With an engine running, behaviour is unchanged and the demo still
prints `COMMITTED` and a verified receipt.

---

### P1-4 · Curate the judge demo account — `IN FLIGHT`

**The problem.** A fresh account lands on "All clear / Nothing needs you right now". If the
account judges are given is empty, their first authenticated screen is a blank page and the
dashboard's stats, exposure meter and history panels all render empty.

**What to do.** Seed the live judge account with believable, *honest* history: several
friend accounts with real names, completed `at_venue` bill splits that produce genuine
signed receipts, in-flight groups so "needs you" and "waiting on" are non-empty, a plan
resolved against real OpenStreetMap venues with participant answers, and group threads
including `@sutra` exchanges.

The honesty constraint is absolute: `at_venue` groups can be completed by API and produce
real receipts with `charged_amount = 0`, which is true for that rail. `prava_mandates`
groups will legitimately sit at `awaiting_approval` because the passkey needs a human —
that is a real product state and worth showing. Never fabricate a charge.

**Deliverable.** A re-runnable `scripts/seed-demo.mjs`, plus a screen-by-screen report of
what a judge now sees.

---

### P1-5 · Correct the false and stale claims in the docs — `DONE`

Several documents stated things about this repo that were not true. All resolved:

- **`spec/PROTOCOL.md` said `acceptShare` has no HTTP route.** It does —
  `engine/src/routes.ts:314`, with a consent guard, an `action: 'accept'` member view and a
  UI button. A live probe returned an application-level error, proving the handler ran.
  Corrected in two places: the "implementation gap" passage and a cross-reference that
  repeated the falsehood. A simulated judge had downgraded functionality because of it.
- **`docs/HACKATHON.md` claimed the Senso track** with zero Senso integration. Now says
  plainly "We have no entry for this track. Do not claim one," matching the Linq row. The
  discovery-chain and receipt work it used to point at was preserved in a new section,
  labelled as real work belonging to no track.
- **The deadline** is resolved to 7:00 PM PT / 7:30 AM IST from the handbook, with the
  target moved to 5 PM PT for a two-hour margin.
- **The NANDA pull-request qualify bar** is now an explicit UNMET checklist item naming
  `projnanda/nandatown`, with a warning not to write a PR link anywhere until one exists.
- **`docs/AGENT-MESH.md` said the delegate routes were not deployed.** All four probe live
  (401 and application-level 400/404, never Fastify route-not-found). Corrected.
- **`README.md` was checked and found already clean** — the atomicity claim had been fixed
  in `a6f8f04`. A full repo sweep found no assertion anywhere that charges land
  simultaneously.

---

### P1-6 · Malformed JSON should return 400, not 500 — `TODO`

**The problem.** Posting malformed JSON to `/v1/auth/register` returns `500 internal
error`. Reproduced three times, live and locally. Anyone exercising the documented REST
API from PowerShell hits this immediately, because PowerShell 5.1's quoting mangles JSON
by default — so this is one of the likelier things a technical judge trips over.

**What to do.** Add a body-parser error handler that returns a 400 with a useful message.
Check the whole surface, not just this one route. Add a test.

**Files.** `engine/src/server.ts` (Fastify error handling), `engine/src/routes-v2.ts`.

**Acceptance.** Malformed JSON returns 400 with a message naming the problem, on every
route. A test pins it. Valid requests are unaffected and the suite stays green.

---

### P1-7 · Make venue search feel fast, or feel deliberate — `TODO`

**The problem.** Live venue search takes about 6 seconds with no streaming and no progress,
on the flagship "one sentence → real venues" path. It is not broken — a live probe returned
real venues near Koramangala in 5.8s, so the "zero venues" failure recorded in the old
status doc appears fixed — but 6 seconds of nothing is a long time in a demo, and a judge
watching a still screen assumes it has hung.

**What to do.** Stream or progressively render results, or show honest staged progress
("geocoding… searching OpenStreetMap… ranking 27 venues"). Do not fake a progress bar that
does not reflect real work. If results can be returned incrementally as Overpass responds,
better still.

**Files.** `engine/src/places/`, `engine/src/routes-plan.ts`,
`web/src/app/app/plan/new/page.tsx`, `web/src/components/plan/`.

**Acceptance.** From clicking search to seeing something meaningful is under two seconds,
even if the full ranked board takes longer. Nothing displayed is invented.

---

### P1-8 · An anonymous plan organiser must not lose their links — `TODO`

**The problem.** An anonymous organiser loses their "copy link" buttons a few seconds after
creating a plan, which strands them: they have a plan and no way to invite anyone. The
current workaround is "log in before creating the plan you demo", which is a workaround,
not a fix.

**What to do.** Find why the buttons disappear — likely an identity or session resolution
race after creation — and make the organiser's links durable for the life of their session.

**Files.** `web/src/app/app/plan/new/page.tsx`, `web/src/components/plan/`,
`engine/src/routes-plan.ts`, `web/src/lib/links.ts`.

**Acceptance.** Create a plan anonymously in a private window; the participant links remain
copyable after a minute and after a reload. Add a test if the fix is server-side.

---

### P1-9 · Walk the whole product as a stranger and fix what confuses — `TODO`

**Do this last in Phase 1**, once the tasks above have landed.

**What to do.** In a private window, with no knowledge assumed, walk every main flow:
sign up → dashboard → one sentence → plan → participants answer → board → convert to group
→ member approval page → receipt. Then the bill split path. Then the discover/link path.
Then the group thread with `@sutra`.

Write down every moment you had to explain something out loud, every dead control, every
piece of copy that describes behaviour that does not exist, and every number without a
visible source. Then fix them, smallest-first.

Pay particular attention to language a non-technical judge will hit cold: "rail",
"merchant finish line", "mandate", and the truth-labelling that a layperson may read as
*this doesn't actually work*. The honesty must stay; the dialect can go.

**Acceptance.** A written walkthrough listing what you found, and the fixes landed. The
build stays clean and the suites stay green.

---

# Phase 2 — prove it

*Only start this once Phase 1 is done. These are short tasks with outsized scoring impact.*

---

### P2-1 · Charge a real card on the Prava sandbox — `TODO — HUMAN ONLY`

**This one cannot be delegated to an agent.** It needs a person with a phone. It is
judging criterion #1 and it has never been done.

**Why it is worth more than anything else.** One successful run upgrades the Prava overall
track, the Visa track, and half the NANDA track simultaneously, and deletes the sentence
every judge would otherwise quote back at us.

**Procedure.** From PowerShell in the repo root:

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from scratchpad secrets.env — see docs/RUNBOOK.md §4>"
npm run e2e:proof -- --watch
```

The script prints, per member, our approval page URL and the **Prava** hosted URL. Open a
Prava URL on a phone and complete the passkey with the sandbox test card.

**Card details — Prava SANDBOX test card, issued by the organisers for this hackathon. No
real money can move on it and it is safe to write down.** PAN `4622 9431 2323 2440` ·
CVV `157` · OTP `456789`. **Expiry: the docs say `12/30` and note Prava corrected this by
email; the kickoff email says `12/27`. Try `12/30` first and fall back to `12/27`.** Do not
burn attempts guessing — the team card allows **30 transactions per day**.

**Two traps.** A Prava session expires about 15 minutes after creation, so have the phone
ready before you start; if the page says expired, do not debug it, just re-run and open the
fresh URL. And never point the chaos suite or any loop at the sandbox.

**What to capture.** The `--watch` output printing the total charged through the card
network and the receipt URL. Film it while you do it — one session yields both the evidence
and the video's payment scene.

**Afterwards.** Update `AUDIT.md` section 4 and the README's limits section to reflect that
it has now happened, and run the NANDA plugin's live check against the sandbox engine so
the evidence pack contains a real charge (`nanda-town-prava/scripts/live_check.py`,
commands in `docs/RUNBOOK.md` §6).

---

### P2-2 · Open the NANDA Town upstream pull request — `TODO`

**The problem.** The NANDA track's qualify bar reads: *"Demonstrate a sandbox transaction,
handle failures, document the adapter and **submit the relevant pull request** and Devfolio
project."* There is no fork, no branch, and no mention of the requirement in any of our
checklists. This is the track the project is best placed to win — every published look-for
is met at a high standard — and it is currently failing a stated qualify item.

**What to do.** Fork the NANDA Town upstream repository, prepare a clean contribution of
the `prava_mandates` payment adapter from `nanda-town-prava/`, and open the pull request.
Link `docs/NANDA-EVIDENCE.md` in the PR body as the evidence pack. Keep the PR honest about
what is and is not proven — the evidence pack's own "what we did not verify" section is a
strength, not something to hide.

Then record the PR URL where the submission can cite it.

**Do not** run `nanda index-register`. It needs a DNS TXT record on a domain we control and
it is not what this prize is for.

**Acceptance.** A real, open pull request URL against the upstream repository, and that URL
referenced in `docs/HACKATHON.md` and ready for the Devfolio form.

---

# Phase 3 — submit

*Everything here depends on Phase 2 landing, or on consciously deciding to submit without
it and saying so plainly.*

---

### P3-1 · Draft the complete Devfolio submission text — `TODO`

**What to do.** Produce one paste-ready document containing every field Devfolio asks for,
so publishing is mechanical rather than improvised at deadline. It must include:

- name, tagline, the problem, and the product explanation
- the Prava integration and **the transaction outcome** — written truthfully in whichever
  world we end up in, charged or not charged
- track implementations and their evidence links, **excluding Senso** (see
  [`AUDIT.md`](AUDIT.md) §5.2 — do not check that track)
- the pre-existing work disclosure, verbatim, from `docs/HACKATHON.md`
- a "what worked, what didn't, what we learned" section that is specific and honest
- Technologies Used, naming **Prava** explicitly plus NANDA/nest, Shopify Admin API,
  OpenAI, OpenStreetMap
- the judge-access test account credentials, in the submission form only — never in the repo
- repository link, live links, video link

**Acceptance.** A single file someone can paste from, top to bottom, without writing new
prose at deadline.

---

### P3-2 · Re-render the demo film, then record the live reel — `TODO`

**The problem.** `film/sutra-demo.mp4` was encoded at 10:57; `narration.json`,
`v2-scenes.js` and `index.html` were rewritten at 13:37, nearly three hours later. The
rendered cut still carries atomicity wording that our own claim card forbids ("EVERYONE
APPROVES → ONE DECISION → OR NOBODY PAYS"); the current source says `SAFE COMMIT`.

**What to do.** Re-render (`powershell -File film/build.ps1`) and check the output's
captions against the current `film/narration.json` before publishing anything. Then record
the live product reel per `film/DEMO_RECORDING.md`, including the two-phone payment
sequence from P2-1 if it happened.

Keep every `SIMULATED` and `TEST` badge on screen. Never show a card number, CVV, OTP,
token or `.env` in frame.

**Note.** `film/` is the project owner's active working area. Coordinate before editing
anything there.

---

### P3-3 · Publish on Devfolio — `TODO — HUMAN ONLY`

Only the team admin can publish, and both members must have completed RSVP and check-in.

**Hard deadline: 7:00 PM PT Sunday 2 August = 7:30 AM IST Monday 3 August.** Aim to
publish about two hours early — Devfolio's publish flow has failed for people before and
video uploads stall.

A draft is not a submission. The status must read **Submitted** after clicking Publish
Project. Verify it on reload, and check the live site and video from a private window
afterwards.

The **first screenshot becomes the cover image** — put the landing page first.

---

### P3-4 · Final honesty pass — `TODO`

Before publishing, re-read the submission and the README against `docs/PITCH.md`'s
"claims to avoid" table. Every claim must be one the repo can defend under questioning.

Specifically confirm: nothing claims an order was placed that was not; nothing describes
sequential charging as atomic; the NANDA registry `reachable` badge is reported as whatever
it actually says rather than as a pass; and if the real charge did not happen, the
submission says so plainly in the "what didn't work" section. Claiming a charge that did
not occur is the exact failure this codebase is built to refuse.

---

### P3-5 · Purge the browser profile from git history — `TODO — AFTER JUDGING`

**Deliberately last.** About 782 objects of a throwaway Chrome profile remain reachable in
public git history, including `Login Data` and `Cookies` files. They are gone from the
working tree and gitignored, but anyone cloning still downloads them.

Purging requires `git filter-repo` and a coordinated force-push, which is dangerous while
teammates are active and catastrophic if it collides with the submission window. The
working tree is clean and both remotes are synced, so it is cheap to do — but **do it after
judging, not during**, unless the project owner explicitly decides otherwise.

---

## Status summary

| Phase | Task | Status |
|---|---|---|
| 1 | P1-1 Card rail visible and legible in the UI | DONE |
| 1 | P1-2 Shopify engine work + setup checklist | DONE — **15 min of owner time remains** |
| 1 | P1-3 `npm run demo` self-heals | DONE |
| 1 | P1-4 Curate the judge demo account | DONE |
| 1 | P1-5 Correct false and stale doc claims | DONE |
| 1 | P1-6 Malformed JSON returns 400 | DONE |
| 1 | P1-7 Venue search 2.3s–36s → 35ms–1.9s | DONE |
| 1 | P1-8 Anonymous organiser links | DONE — not reproducible; `shell.tsx` gates `/app/*` behind an account, so the case cannot arise |
| 1 | P1-10 Dashboard honesty, verify footgun, reliability, people, countdown, profile | DONE |
| 1 | P1-11 Plan category fallback (police station offered as brunch) | DONE — closed at three layers |
| 1 | P1-9 Stranger walkthrough and de-jargon | IN FLIGHT |
| 2 | P2-1 Real sandbox card charge | TODO — human only |
| 2 | P2-2 NANDA upstream pull request | TODO |
| 3 | P3-1 Devfolio submission text | TODO |
| 3 | P3-2 Re-render film, record live reel | TODO |
| 3 | P3-3 Publish on Devfolio | TODO — human only |
| 3 | P3-4 Final honesty pass | TODO |
| 3 | P3-5 Purge git history | TODO — after judging |
