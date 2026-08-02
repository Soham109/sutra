# HANDOFF — read this first

> ### ⚠ Read [`STATUS.md`](STATUS.md) before this file.
>
> This document describes the system. **`STATUS.md` describes what happened on the last
> working day, what is broken right now, what is half-finished, and what to do next in
> order.** A long session on 1 Aug fixed a double-charge bug, a group-cancel auth hole, a
> password-hash leak, a participant IDOR, and several confidently-wrong price bugs; it also
> found that Railway's auto-deploy had been silently dead for hours. None of that is
> reflected below. If the two disagree about current state, `STATUS.md` is newer.

**Last verified:** 2026-08-01. Every number and URL below was observed by running the
command or fetching the URL on that date. If something here disagrees with another
document in this repo, trust this file and fix the other one.

---

## 1. You are here

1. This repo is **sutra**, a working implementation of **GMP/1 (the Group Mandate Protocol)**.
2. The problem: every agentic payment protocol shipping today (AP2, ACP, Visa Intelligent
   Commerce, Prava) assumes **one** user granting **one** agent **one** mandate.
3. GMP/1 is the multi-principal layer: N people each approve their own Prava mandate on
   their own card, and one engine commits them all together or cancels every one.
4. Above the protocol sits a **coordination layer** that decides *what* the group is buying,
   from a sentence, a link, or a photographed restaurant bill.
5. Two halves are deployed and talking to each other right now. Both are public.
6. This is a hackathon submission. The event is the **Agentic Commerce Hackathon** on
   Devfolio, and the hard deadline is **3:00 PM Pacific on Sunday 2 August 2026**.
7. Almost everything is built. The test suites are green. See section 4 for the real numbers.
8. **The single most important thing that is NOT done: no real card has ever been charged.**
   That is judging criterion number one, and it needs a human with a phone, not an agent.
9. The second most important thing that is NOT done: the demo video is not recorded and the
   Devfolio submission is not published.
10. Start at section 3. Do those three things in that order.

The repo is at `c:\Users\acer\sutra`. The shell is **PowerShell** — read section 4.1 before
running any npm script, because Git Bash breaks the test suite.

---

## 2. Live deployment

| What | URL | Verified |
|---|---|---|
| Web app (Next.js on Vercel) | https://sutra-gmp.vercel.app | HTTP 200 |
| Engine (Fastify on Railway) | https://engine-production-e6fa.up.railway.app | `/health` 200 |

`GET https://engine-production-e6fa.up.railway.app/health` returned, verbatim:

```json
{"ok":true,"service":"sutra-gmp-engine","prava_adapter":"sandbox",
 "app_base_url":"https://sutra-gmp.vercel.app",
 "receipt_public_key":"b71838a635e97a8f8104e95213bbf3b718f64d89c13d645a8ab6245ca1f8de94",
 "uptime_s":368}
```

`prava_adapter: "sandbox"` means the engine is pointed at the **real Prava sandbox** with a
real `sk_test_*` key, not at the offline simulator.

Hosting accounts:

- Vercel project `sutra`, org `soham-aggarwals-projects`, linked to GitHub `Soham109/sutra`.
- Railway project `sutra-engine`, service **`engine`**.
- `sutra.vercel.app` belongs to a stranger. Ours is **`sutra-gmp.vercel.app`**. Do not try to
  claim `sutra.vercel.app`.
- Vercel SSO/deployment protection is disabled, so a judge can open the site without logging in.

### 2.1 The deploy trap that has bitten this project repeatedly

**Vercel git auto-deploy DOES NOT FIRE when you push to `main`.** Pushing changes nothing on
the live site. You must deploy explicitly, in two steps, from PowerShell in `c:\Users\acer\sutra`:

```powershell
npx vercel --prod --yes
```

That prints a deployment URL that looks like `https://sutra-abc123xyz.vercel.app`. The public
alias is still pointing at the old build until you move it. Copy that URL and run:

```powershell
npx vercel alias set https://sutra-abc123xyz.vercel.app sutra-gmp.vercel.app
```

Replace `https://sutra-abc123xyz.vercel.app` with the URL the first command actually printed.
If you skip the second command, https://sutra-gmp.vercel.app keeps serving the old build and
everything will look like your change did nothing.

The engine is a separate deploy and is not affected by that. To deploy the engine, run this
from `c:\Users\acer\sutra`:

```powershell
npx --yes @railway/cli up --ci --service engine
```

`--service engine` is required. Without it Railway errors with "Multiple services found".
Railway's API flakes intermittently; if it fails, run the same command again.

Full operational detail, including every environment variable and every failure mode, is in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md).

### 2.2 Deploy invariants that will silently break things

Do not change any of these without understanding why they are set.

1. **`numReplicas: 1` in [`railway.json`](railway.json).** This is load-bearing, not a cost
   decision. The approval poller, the in-process `EventHub`, and the single-file SQLite
   database all assume exactly one process. Two replicas double-poll and split the SSE
   fan-out.
2. **A Railway volume is mounted at `/data`, and `DB_PATH=/data/gmp.db`.** Without it, every
   redeploy wipes all groups, all accounts and all receipts.
   [`engine/src/server.ts`](engine/src/server.ts) lines 39-41 throw on boot if
   `NODE_ENV=production` and `DB_PATH` is unset, so a missing volume fails loudly.
3. **`ENGINE_SIGNING_SEED` must be a fixed value.** If it is unset the engine mints a new
   Ed25519 key on every restart, and every receipt signed before the redeploy stops verifying.
4. **Set `DB_PATH` from PowerShell, never from Git Bash.** Git Bash (MSYS) rewrites the string
   `/data/gmp.db` into a Windows path before the CLI ever sees it, and you end up with a
   database in the wrong place.
5. **The engine cannot run on Vercel.** It needs file-backed SQLite, a 1.5-second poller that
   is the only mechanism by which approvals are ever detected, long-lived SSE connections, and
   an in-process event hub. Serverless kills all four. Do not try to "simplify" the deploy by
   moving it.
6. **Vercel needs BOTH `ENGINE_URL` and `ENGINE_API_TOKEN`.** The Next.js proxy at
   [`web/src/app/api/[...path]/route.ts`](web/src/app/api/[...path]/route.ts) reads
   `ENGINE_API_TOKEN` on the server and attaches it as a bearer token. If you forget it, every
   API call from the app fails with "missing or invalid bearer token".

---

## 3. The three things to do next, in priority order

Do them in this order. Do not start number two before number one is either done or has failed
for a reason you have written down.

### 3.1 FIRST: charge a real card on the Prava sandbox

**Why this is first.** The hackathon's stated challenge is to "build a working product where
an AI agent can discover, decide and complete a transaction using Prava". Everything else in
this repo is built. This is the one claim we cannot yet make.

**What already works.** The engine mints real Prava mandate sessions against the real sandbox
and returns real hosted approval URLs on `sandbox.collect.prava.space`. The poller detects a
mandate going active and commits the group with no further human action.

**What is missing.** A human must open the approval URL on a phone and complete the passkey
ceremony with the sandbox test card. No script can do this step. That is the security property
of the protocol, not a bug.

**Exact commands.** From PowerShell in `c:\Users\acer\sutra`:

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<the value from secrets.env — see section 3.1.1>"
npm run e2e:proof -- --watch
```

That script is [`e2e/sandbox-proof.ts`](e2e/sandbox-proof.ts). It creates a two-member group,
calls `POST /v1/members/:id/open` for each member, and prints two things per member: our own
approval page URL, and the **Prava** hosted URL. Open a Prava URL on a phone.

Sandbox test card, for manual entry on Prava's hosted page. These values also live in `.env` at
the repository root (gitignored, so it exists on this machine but not in a fresh clone). They
are sandbox-only, so they are safe to write down:

| Field | Value |
|---|---|
| PAN | `4622 9431 2323 2440` |
| CVV | `157` |
| Expiry | `12/30` (Prava corrected this by email — it is not 12/27) |
| Card ID | `CARD-27` |
| OTP for sandbox device binding | `456789` |

**Hard limit: the team test card allows 30 transactions per day.** Never point the chaos suite
or any bulk test at the sandbox. `npm run chaos` is structurally incapable of touching it —
`ChaosPrava` refuses to wrap a non-mock adapter — but a hand-written loop is not.

**A Prava session expires roughly 15 minutes after it is created.** If the approval page says
the session is expired, do not debug it: create a fresh group by re-running `npm run e2e:proof`
and open the new URL promptly.

With `--watch`, the script polls until the group reaches a terminal state and then prints the
total charged through the card network and the receipt URL. That output is the evidence.
Capture it.

#### 3.1.1 Where the credentials are

Secrets are **not** in this repo and must never be pasted into a chat transcript. They are in:

```
C:\Users\acer\AppData\Local\Temp\claude\c--Users-acer-sutra\4c8b49f0-b384-4e78-813a-a6faef19542a\scratchpad\secrets.env
C:\Users\acer\AppData\Local\Temp\claude\c--Users-acer-sutra\4c8b49f0-b384-4e78-813a-a6faef19542a\scratchpad\vapid.env
```

`secrets.env` holds `ENGINE_SIGNING_SEED`, `ENGINE_API_TOKEN`, `WEBHOOK_SECRET`.
`vapid.env` holds `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

**Never print a secret value into a document, a commit, or a chat message.** An earlier OpenAI
key was auto-revoked about twenty minutes after being pasted into a chat transcript, because
OpenAI scans for leaked keys. Set keys directly on Railway with `railway variables --set`.
Instructions are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) section 4.

Note that the local [`.env`](.env) file has `PRAVA_ENV=mock` and an **empty** `PRAVA_API_KEY`.
The real sandbox key exists only as a Railway environment variable. That is deliberate.

### 3.2 SECOND: record the demo video and publish the Devfolio submission

The submission is **not published**. A Devfolio draft is not a submission — the status must
read "Submitted" after you click Publish Project.

The complete checklist, with literal checkboxes, the deadline arithmetic, and what each
judging criterion is asking for, is in [`docs/HACKATHON.md`](docs/HACKATHON.md). Work through
that file top to bottom. The points that most often get missed:

- Only the **team admin** can publish the project.
- Both team members must complete the Devfolio RSVP **and** check in.
- "Technologies Used" must name **Prava** explicitly.
- The **first screenshot becomes the cover image**, so put the best one first.
- The pre-existing work disclosure is mandatory. Our disclosure is in section 6 of this file;
  copy it verbatim.

### 3.3 THIRD: finish the NANDA Town evidence pack

The human running this project cares most about this track. The prize is titled, in Devfolio's
exact words, **"$1,000: Best Prava Adapter for the NANDA Town"**.

Read this carefully, because the old version of this file was wrong about it: **this prize is
about the Python plugin in [`nanda-town-prava/`](nanda-town-prava/), not about registering in
a NANDA index.** The plugin registers under the entry-point group `nest.plugins.payments` as
`prava_mandates`, verified against the published `nest-core` 0.1.4.

Status of the four things that used to be listed as gaps:

| Item | Status |
|---|---|
| `live` mode over real HTTP against the real engine | **Done.** Transcript in [`docs/NANDA-EVIDENCE.md`](docs/NANDA-EVIDENCE.md) section 3.2, run against the deployed engine with `prava_adapter: sandbox`. |
| `nest report` diff against the `prepaid_credits` baseline | **Done.** [`docs/NANDA-EVIDENCE.md`](docs/NANDA-EVIDENCE.md) section 4.3. Both `report-baseline.html` and `report-prava.html` are on disk in `nanda-town-prava/`. |
| SkillMD registry submission | **Done.** See below. |
| A real Prava charge through the plugin | **Not done.** Blocked on section 3.1 of this file. |

We are listed in the NANDA SkillMD registry. Read the entry back with:

```powershell
curl.exe -s https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85
```

Observed on 2026-08-01: the entry exists, `name` is `sutra — group checkout (GMP/1)`,
`source_url` is `https://sutra-gmp.vercel.app/skill.md`, `created_at` is
`2026-08-01T13:29:23.374Z`, and the registry `count` is **273**.

**The `reachable` field is `null`.** It is not `true`. `null` means the registry has not
recorded a probe result for this entry, so there is no positive reachability badge to point a
judge at. All five endpoints the entry declares do return 200 through
https://sutra-gmp.vercel.app (verified — see section 4.3), so if the registry does probe, it
should pass. Re-check the badge before submitting and say `null` if it is still `null`. Do not
claim a badge we do not have.

So the remaining NANDA work is:

1. Do section 3.1, then run the plugin's live check against the sandbox engine so the evidence
   pack contains a real charge. The script is `nanda-town-prava/scripts/live_check.py` and it
   reads `GMP_API` and `ENGINE_API_TOKEN`. Commands are in
   [`docs/RUNBOOK.md`](docs/RUNBOOK.md) section 6.
2. Re-check the `reachable` badge with the curl above and record whatever it actually says.
3. Note that [`docs/NANDA-EVIDENCE.md`](docs/NANDA-EVIDENCE.md) section 5 is titled "Registry
   submission — NOT SUBMITTED, and why". **That section is now out of date** — the submission
   happened after it was written. Do not quote it to a judge without correcting it.

**Do not attempt NANDA Index v2 registration** (`npm run nanda -w cli -- index-register`). It
needs a DNS TXT record on a domain we control, and a `.vercel.app` subdomain will not work.
It is not what this prize is for.

---

## 4. What is built, and the real numbers

Everything in this table was run on 2026-08-01, Node v24.16.0, npm 11.13.0, Windows 11.
Run them yourself; they are the evidence.

**A teammate is actively working in this repo.** At the time of writing, `git status` showed
uncommitted changes to `engine/src/service.ts`, `engine/test/social-privacy.test.ts`, a new
`engine/test/bill-auction.test.ts`, and several `web/src/components/home/` files. Test counts
therefore drift upward. If your numbers are higher than the ones below, that is expected. If
they are *lower*, or anything fails, that is a regression worth investigating.

| Command | Observed result |
|---|---|
| `npm test -w engine` | Vitest. **PowerShell only — read 4.1.** Believe the count it prints; every number written into a doc here has gone stale within hours. |
| `npm run test:widget` | **30 pass, 0 fail.** |
| `npm run chaos` | 60 iterations, seed base 42, terminal states `{"partial":9,"committed":38,"aborted":13}`, all six invariants pass, prints `GREEN WALL`. |
| `npm run demo` | `COMMITTED`, four members each charged $46.50, `receipt: ✓ chain + signature verified`. Needs a running engine — start one with `npm run dev:engine` first. |
| `npm run build` | Next.js production build succeeds. **19 routes, 14 static pages.** |
| `npx tsc --noEmit -p engine/tsconfig.json` | Clean, exit code 0. |
| `pytest -q` in `nanda-town-prava/` | Run it. The count has more than doubled since this line first claimed 46. |

`npm run e2e:plan`, `npm run e2e:product` and `npm run e2e:auth` need a reachable engine and
hit live third-party services. They are described in [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
section 2.

### 4.1 Run npm scripts from PowerShell, not Git Bash

This is a real, reproducible trap on this machine.

```
PowerShell:  npm test -w engine   →  every file passes
Git Bash:    npm test -w engine   →  14 test files FAILED, 0 tests run
```

The Git Bash failure looks like a broken codebase. It is not. Every one of the 14 files fails
identically with:

```
TypeError: Cannot read properties of undefined (reading 'config')
```

The code is fine. If you are in Git Bash and need to run the tests, this works:

```bash
cd /c/Users/acer/sutra/engine && npx vitest run
```

That passes too. The failure only happens when npm's
workspace runner (`-w engine`, or the root `npm test`) is invoked from Git Bash. **Do not
"fix" any test file in response to this error.**

The same Git Bash caution applies to `DB_PATH=/data/gmp.db`, which MSYS rewrites into a
Windows path. Use PowerShell for anything involving deploys or environment variables.

### 4.2 The two halves

**The coordination layer** — [`engine/src/plan/`](engine/src/plan/),
[`engine/src/places/`](engine/src/places/), [`engine/src/agent/`](engine/src/agent/).
A `Plan` is vertical-neutral: dinner, movies, flights, a receipt and a checkout page are the
same object with different slots filled. Free text becomes slots; each participant answers
typed **signals** (rsvp, availability, location, budget, vote, constraint); options come from
real OpenStreetMap venues (Nominatim plus Overpass, keyless and global), Shopify storefront
search, or a resolved product URL; a pure explainable scorer ranks them; the group picks one;
it becomes an ordinary GMP/1 group. Detail: [`docs/COORDINATION.md`](docs/COORDINATION.md).

**The protocol engine** — [`engine/src/service.ts`](engine/src/service.ts).
Cart becomes N Prava mandates, then a sequential idempotent commit saga, then a hash-chained
Ed25519 receipt. Formal definition: [`spec/PROTOCOL.md`](spec/PROTOCOL.md).

### 4.3 The discovery chain is live

All of these returned HTTP 200 through the public web origin on 2026-08-01:

```
https://sutra-gmp.vercel.app/skill.md                          200  text/markdown
https://sutra-gmp.vercel.app/.well-known/agent-card.json       200  application/json
https://sutra-gmp.vercel.app/.well-known/agent-facts.json      200  application/json
https://sutra-gmp.vercel.app/api/agents                        200  application/json
https://sutra-gmp.vercel.app/health                            200  application/json
https://sutra-gmp.vercel.app/api/v1/places/status              200  application/json
```

This matters because the NANDA SkillMD entry points at those exact URLs.

---

## 5. What is NOT done

Be blunt about these. Do not let any of them get papered over in the submission.

1. **No real card has ever been charged.** Sessions mint correctly against the Prava sandbox,
   but the passkey step needs a human with a phone. This is judging criterion number one. Fix
   with section 3.1.
2. **The demo video is not recorded, and the Devfolio submission is not published.** Fix with
   section 3.2 and [`docs/HACKATHON.md`](docs/HACKATHON.md).
3. **`.qa/` is still in git history.** It was a 65 MB throwaway Chrome profile, 1545 files,
   including `Login Data` and `Network/Cookies`. It is untracked now and gitignored at
   [`.gitignore`](.gitignore) line 21, and it was removed from the working tree in commit
   `00258e8`, but it was added in commit `572eab6` and **the blobs are still reachable in
   history**. Purging needs a force-push. That has not been done because a teammate is active
   on the repo. Do it after judging, not during. Anyone cloning this repo downloads 65 MB of
   somebody's browser profile.
4. **Free-text product search only reaches Shopify storefronts.** Eight domains are hardcoded
   as the default shelf in [`engine/src/server.ts`](engine/src/server.ts) lines 79-94:
   `allbirds.com`, `gymshark.com`, `fashionnova.com`, `kyliecosmetics.com`,
   `bombayshavingcompany.com`, `boat-lifestyle.com`, `mamaearth.in`, `beardo.in`. Each was
   verified to answer Shopify's public `/search/suggest.json` with real products and real
   prices. Overridable with the `SHOPIFY_DOMAINS` environment variable. **Pasting a product
   link works on nearly any site** — that is the path to demo.
5. **`ENGINE_API_TOKEN` is one shared bearer token.** Anyone holding it can create groups on
   the engine. Acceptable for a hackathon, not for production. It is server-side only: it is
   attached by the Next.js proxy and is never sent to the browser.
6. **Identity is thin.** Password auth with sessions exists (`POST /v1/auth/register`,
   `POST /v1/auth/login` in [`engine/src/routes-v2.ts`](engine/src/routes-v2.ts)), but a
   development header bypass exists too, gated on `NODE_ENV !== 'production'` or
   `ALLOW_DEV_AUTH`. Identity grants no spending power in any case — spending still requires
   the member's own passkey on Prava's hosted page.
7. **No rate limiting, single SQLite file, single process.** The URL resolver fetches arbitrary
   merchant pages; `safeFetch` guards the SSRF surface but it has not had a real audit.
8. **The Chrome extension is not published to the Web Store.**

---

## 6. Pre-existing work disclosure

Copy this into the Devfolio submission verbatim. It is required and it is true.

> The concept and the original protocol specification document (`spec/PROTOCOL.md`) existed
> before the event. **All code in this repository was written during the hackathon window.**
> The coordination layer, the settlement rails, the bill parser, the venue discovery, the
> NANDA Town plugin, the web application and the discovery documents were all built during the
> event. `spec/PROTOCOL.md` was extended during the event to cover the settlement rails and the
> coordination phase.

---

## 7. Invariants you must NOT break

These are load-bearing honesty rules. Breaking one turns the product into a liar, and a judge
who catches one will discount everything else. Each was re-verified against the source on
2026-08-01, with the file and line given.

1. **`charged` means money moved through this engine. `settled` means it did not.**
   [`engine/src/types.ts`](engine/src/types.ts) lines 107-110 define them as distinct member
   statuses, with a comment saying so. Two settlement rails exist in
   [`engine/src/rails.ts`](engine/src/rails.ts): `prava_mandates` charges real cards
   (`charges: true`), and `at_venue` exists because a restaurant bill has **no merchant Prava
   can charge** (`charges: false`). On `at_venue` the engine allocates exact amounts, records
   explicit acceptance, and signs a receipt — and never claims a charge.

2. **`verifyReceipt` fails an `at_venue` receipt that claims a charge.**
   [`engine/src/receipt.ts`](engine/src/receipt.ts) lines 123-125:
   ```ts
   if (receipt.rail === 'at_venue' && charged !== 0) {
     errors.push('at_venue receipt reports a charged amount — no card is charged on this rail')
   }
   ```
   `charged` is recomputed from the receipt entries, not read from `totals`, so a forged
   `totals.charged` cannot slip past.

3. **An OpenStreetMap venue is always on the `at_venue` rail.**
   [`engine/src/plan/service.ts`](engine/src/plan/service.ts) line 530:
   ```ts
   const rail: Rail = option.source === 'overpass' ? 'at_venue' : 'prava_mandates'
   ```
   The decision is made on the option's **source**, not by parsing its URL, because an OSM
   `url` is a map page or a brochure site, never a checkout endpoint. This was a real bug that
   got fixed. Do not "improve" it back into URL sniffing.

4. **Never invent a price.** OSM knows where a restaurant is, not what dinner costs.
   [`engine/src/plan/service.ts`](engine/src/plan/service.ts) lines 510-516 throw rather than
   guess: *"this option has no price attached — enter the amount, or split the real bill once
   you have it"*. Every Overpass venue is ingested with `price: null`.

5. **A missing signal is never agreement.** In
   [`engine/src/plan/rank.ts`](engine/src/plan/rank.ts), a factor that cannot be computed is
   returned by `unscored()` at lines 349-352 with `weight: 0`, so it cannot enter the weighted
   mean. Silent participants are dropped from the factor's **denominator** and named in the
   human-readable `why` sentence. Silence never counts as a yes and never contributes a
   fabricated 0.5.

6. **The ranking is arithmetic, not a model.**
   [`engine/src/plan/rank.ts`](engine/src/plan/rank.ts) lines 58-64 define exactly five
   weights, summing to 1.00: `time_fit` 0.35, `travel_fit` 0.25, `budget_fit` 0.25,
   `preference` 0.10, `freshness` 0.05. The file imports only `./geo.js` and `./time.js` — no
   network, no model client. Each factor carries a sentence rendered verbatim in the UI. **No
   LLM gets a vote in the ordering.**

7. **The LLM only fills slots.**
   [`engine/src/agent/extract.ts`](engine/src/agent/extract.ts) lines 427-438: if there is no
   `OPENAI_API_KEY`, or the model call throws, `extractDeterministic` runs. That is the floor,
   not a stub — it is pure regex and date arithmetic with no network. The model never picks a
   venue, sets a price, or decides who pays what.

8. **Unknown charge state is never treated as failure.**
   [`engine/src/service.ts`](engine/src/service.ts) lines 583-586 leave the group in
   `committing`; `findChargeByReference` at lines 796-801 fetches the mandate's `charges[]` and
   matches our idempotency `reference`. The reference is deterministic
   (`gmp:<group>:<member>:<source>:<attempt>`), so a redo is safe. **Never guess.**

9. **Currency is never taken from a schema default.** It is inferred from the geocoded country
   ([`engine/src/routes-plan.ts`](engine/src/routes-plan.ts) lines 264-279) or from the bill's
   tax regime ([`engine/src/bill/currency.ts`](engine/src/bill/currency.ts) lines 63-78), and
   the inference is always disclosed as an uncertainty. An explicit currency symbol always
   wins.

   Two known soft spots found while verifying this, both worth fixing if you have time:
   `POST /v1/bill/split` applies a tax-regime inference without surfacing the `why`
   ([`engine/src/routes-v2.ts`](engine/src/routes-v2.ts) line 507), unlike `/v1/bill/parse`;
   and `convertToGroup` has an undisclosed `?? 'USD'` fallback at
   [`engine/src/plan/service.ts`](engine/src/plan/service.ts) line 508.

---

## 8. Prava integration notes

Our [`openapi.json`](openapi.json) matched Prava's live specification when it was last checked
on 2026-08-01. These fixes are already made. Do not regress them.

- The idempotency field is named **`reference`**.
- **A 4xx error envelope is terminal**, not a transport blip. Retrying it burns the commit
  window and disguises a definite refusal as unknown state.
- `listMandates` must send **`standing_only=true`**. An ordinary checkout creates transient
  per-checkout mandates internally, and picking one of those up reads as an approval that
  never happened.
- **`callback_url` must be https.** A non-https base URL omits the field rather than 400-ing
  the whole session. The **poller**, not the callback, is what actually detects approval —
  Prava has no webhooks.
- Settlement is only settled when `status === 'completed'` **and** `visaConfirmation !== 'FAILURE'`.
- Our mock was deliberately made **less** strict to match reality: Prava clears the idempotency
  key of a *failed* charge, so a failed charge is no longer deduplicated.

**The `authorizeOnly` trap.** Prava's API reference says the Create Session response carries
`authorizeOnly: true` for mandate-setup sessions, and an earlier revision of
[`engine/src/prava/client.ts`](engine/src/prava/client.ts) refused to proceed without it. **The
live sandbox never sends that field.** A 201 carries exactly `session_id`, `session_token`,
`expires_at`, `iframe_url`, `order_id` — identically for a `mandate_setup` body and a plain
one. That guard blocked every approval until it was removed. Do not add it back.

There is also no substitute check available at session-creation time. A mandate does not exist
until the human passkeys, so `GET /v1/mandates?customer_id=…` returns `{"mandates":[]}` for
both kinds of session immediately afterwards. This was verified. The real confirmation is what
the poller already does: a standing mandate appearing `active` for that customer.

**Sessions expire about 15 minutes after creation**, which is why sessions are created lazily
on the member's first open rather than at group creation.

Ambiguities that Prava's own documentation does not resolve, recorded rather than guessed at:
how `purchase_context[].effective_until_minutes` interacts with the one-time 7-day clamp on
`mandate_setup.valid_until`; and what revoking a session does to a still-pending mandate.
`cleanupMemberAuthorizations` therefore attempts **both** the session revoke and the mandate
cancel, and never relies on a side effect.

**Prava production access.** They offer it via a Tally form at https://tally.so/r/eq8NZE.
**Do not submit it.** Their own instruction is to apply only once sandbox works end to end,
and access is revoked after judging anyway. Sandbox is the demo of record.

---

## 9. File ownership map

```
engine/src/service.ts          the commit saga — the hard part, treat with care
engine/src/rails.ts            settlement rails + the honesty model
engine/src/receipt.ts          hash-chained Ed25519 receipts + verifyReceipt
engine/src/server.ts           boot, adapter selection, Shopify shelf, /health
engine/src/poller.ts           the 1.5s approval poller — Prava has no webhooks
engine/src/routes.ts           GMP/1 protocol routes (groups, members, receipts)
engine/src/routes-v2.ts        auth, product, bill, people, circles, dashboard
engine/src/routes-plan.ts      coordination routes (plans, signals, options)
engine/src/protocol/           computeShares, policy algebra, backstops, auctions
engine/src/plan/               coordination: types, store, service, rank, time, geo
engine/src/places/             OpenStreetMap: nominatim, overpass, taxonomy (keyless)
engine/src/bill/               deterministic receipt parser, reconciliation, currency
engine/src/agent/extract.ts    free text → slots (deterministic floor, LLM optional)
engine/src/notify/             RFC 8291 web push, validated against the RFC test vector
engine/src/discovery/          A2A card, AgentFacts, AI catalog, served SKILL.md
engine/src/prava/              client (real REST), mock (offline sim), chaos (fault proxy)
engine/public/                 zero-build HTML surfaces served by the engine itself
web/src/app/api/[...path]/     the Next.js proxy that injects ENGINE_API_TOKEN
web/src/app/app/page.tsx       the command centre dashboard
web/src/components/plan/       the participant answer flow and option cards
widget/detect.js               the universal cart detector — one copy, three shells
extension/                     Chrome MV3 extension (detect.js is generated, do not edit)
nanda-town-prava/              the NANDA Town payments plugin (Python)
cli/src/gmp.ts                 demo runs + offline receipt verification
cli/src/nanda.ts               nanda check / skill-submit / index-register
chaos/src/run.ts               randomized fault injection + invariant checker
e2e/                           live end-to-end scripts (plan, product, sandbox, auth)
```

## 10. Documentation map

| File | What it is |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | this file — the entry point, current state, what to do next |
| [`docs/HACKATHON.md`](docs/HACKATHON.md) | the event, the deadline, the tracks, the submission checklist |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | operations: every script, deploys, env vars, what to do when things break |
| [`docs/README.md`](docs/README.md) | one-line index of every document |
| [`README.md`](README.md) | the front door: architecture, endpoint list, failure taxonomy |
| [`spec/PROTOCOL.md`](spec/PROTOCOL.md) | GMP/1 formally |
| [`docs/COORDINATION.md`](docs/COORDINATION.md) | the plan layer and the exact ranking arithmetic |
| [`docs/NANDA-EVIDENCE.md`](docs/NANDA-EVIDENCE.md) | the NANDA Town evidence pack (section 5 is stale — see 3.3) |

---

## 11. Progress log

Newest last. Dates are the day the work landed.

- **2026-08-01** — Coordination layer built end to end and verified live against real
  OpenStreetMap. Prava client audited against the live documentation; five real defects fixed,
  including unknown-charge-state reconciliation. Settlement rails added with the receipt
  honesty rule. Dashboard rebuilt as a command centre. Bill splitter, participant answer flow,
  plan board. Universal cart detector plus bookmarklet plus Chrome extension. NANDA Town
  plugin. Web push. Discovery documents. Docs rewritten. Three real bugs caught only by live
  runs: bare amounts defaulting to USD, JPY minor-unit rescale, and an OSM venue landing on
  the card rail.
- **2026-08-01** — Frontend deployed to Vercel, SSO protection disabled, aliased to
  `sutra-gmp.vercel.app`. Engine deployed to Railway with a `/data` volume. Both halves
  verified talking through the `/api/*` proxy.
- **2026-08-01** — Two bugs found only by running against the deployed engine: options were
  scored against a **stale** common time window frozen at whatever the first responder said,
  and a rate-limited Overpass call would **wipe a working board to zero** because
  `clearOptions` ran before the search result was known. Both fixed. An empty refresh now
  preserves the previous board.
- **2026-08-01** — Photo bill capture, with OCR **in the browser** (tesseract.js, dynamically
  imported, no key, nothing uploaded) feeding the same deterministic parser. Finding the right
  page-segmentation mode was not cosmetic: modes 3, 4, 11 and 12 read a receipt as two columns
  and tear `2587.50` into `2587.` plus an orphaned `50`, after which the parser reconciles
  2587.00 against a printed 2587.00 and reports — truthfully — that the arithmetic checks out,
  on numbers that are all wrong. Mode 6 scored 8/8 exact amounts against 0/8 for every other
  mode. Because a different receipt could still fracture,
  [`engine/src/bill/integrity.ts`](engine/src/bill/integrity.ts) detects the signature
  server-side, the UI refuses to show a green tick over it, and `POST /v1/bill/split`
  **rejects** it unless the caller passes `force`. The regression test uses the verbatim broken
  OCR output.
- **2026-08-01** — "Login is broken" turned out to mean the engine on Railway had been up 95
  minutes running a build from before `/v1/auth/*` existed. The auth code had only ever run
  locally. Deployed it; `npm run e2e:auth` now proves sign-in on a live host in one command.
- **2026-08-01** — A throwaway Chrome profile had been committed under `.qa/`: 1545 files,
  65 MB, including `Login Data` and `Network/Cookies`. Removed from the working tree and
  gitignored. **Still in git history** — see section 5 item 3.
- **2026-08-01** — OpenAI wired up. The first key was auto-revoked within about twenty minutes
  of being pasted into a chat transcript, because OpenAI scans for leaked keys. **Never paste
  a key into a transcript** — set it straight on Railway. The second key is live and verified.
  `OPENAI_MODEL=gpt-4.1-nano` is the cheapest tier that handles constrained tool-calling, and
  the deterministic floor still runs whenever the model is unavailable, so nothing depends on
  it.
- **2026-08-01** — Landing page: sticky glass nav, hero raised now that the nav overlays
  rather than pushes, and a plain-language "how it works" section, because the page explained
  the protocol but never said what the product does. The agent is called "**Sutra bot**" in all
  user-facing copy; which model is behind it is an implementation detail. Discovered here that
  **Vercel git auto-deploy does not fire on push** — see section 2.1.
- **2026-08-01** — NANDA SkillMD submission went through: entry id
  `47063b5f-5000-4c03-8f33-c98555618f85`, registry count 273. `reachable` reads `null`.
> Numbers in the entries below are what was observed ON THAT DATE. They are a
> record, not a current claim — several have since more than doubled. For what is
> true now, run the command.

- **2026-08-01** — Documentation rewritten for handover: this file,
  [`docs/HACKATHON.md`](docs/HACKATHON.md) and [`docs/RUNBOOK.md`](docs/RUNBOOK.md) created,
  [`docs/README.md`](docs/README.md) re-indexed. Corrections made while verifying: the engine
  suite is **14 files / 365 tests** (previously documented as 11 files / 356, and as 10 files /
  346 in [`README.md`](README.md)); the Next.js build emits **19 routes** (previously
  documented as 17); the plugin's pytest suite is **46 passed, 1 skipped** (the plugin's own
  README still says 44); `POST /v1/members/:id/accept` **does exist** at
  [`engine/src/routes.ts`](engine/src/routes.ts) line 154, so the old claim that the `at_venue`
  acceptance endpoint was missing is false and [`README.md`](README.md) still repeats it;
  `NEXT_PUBLIC_ENGINE_TOKEN` **does not exist anywhere in the codebase**, so the old claim that
  the bearer token ships to the browser is false.
