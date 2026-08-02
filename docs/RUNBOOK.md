# Runbook — running, deploying and operating sutra

Operations only. For the state of the project and what to do next, read
[`../HANDOFF.md`](../HANDOFF.md). For the hackathon submission, read
[`HACKATHON.md`](HACKATHON.md).

The repository is at `c:\Users\acer\sutra`. Every command below assumes you are in that
directory unless it says otherwise.

---

## 0. Read this before running anything

### 0.1 Use PowerShell, not Git Bash

Two things break in Git Bash on this machine.

**The test suite.** `npm test -w engine` from Git Bash fails all 14 test files with:

```
TypeError: Cannot read properties of undefined (reading 'config')
```

The same command in PowerShell reports **14 test files, 365 tests passed**. The code is fine.
Do not edit any test file in response to that error. If you must run tests from Git Bash, this
works and reports the same 365 passing:

```bash
cd /c/Users/acer/sutra/engine && npx vitest run
```

**Any path-like environment value.** Git Bash (MSYS) rewrites `/data/gmp.db` into a Windows
path before the command ever sees it. Setting `DB_PATH=/data/gmp.db` from Git Bash silently
puts the production database in the wrong place. Set it from PowerShell.

### 0.2 Never print a secret

Secrets live outside the repository, in:

```
C:\Users\acer\AppData\Local\Temp\claude\c--Users-acer-sutra\4c8b49f0-b384-4e78-813a-a6faef19542a\scratchpad\secrets.env
C:\Users\acer\AppData\Local\Temp\claude\c--Users-acer-sutra\4c8b49f0-b384-4e78-813a-a6faef19542a\scratchpad\vapid.env
```

`secrets.env` holds `ENGINE_SIGNING_SEED`, `ENGINE_API_TOKEN` and `WEBHOOK_SECRET`.
`vapid.env` holds `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

Never paste a key into a chat transcript, a commit message, or a documentation file. An
earlier OpenAI key was auto-revoked about twenty minutes after being pasted into a chat,
because OpenAI scans public and semi-public text for leaked keys. Section 4.4 of this file
shows how to set a secret without it appearing in your shell history or process arguments.

### 0.3 The Prava sandbox has a hard budget

The team test card allows **30 transactions per day**. Never point the chaos suite, a load
test, or a hand-written loop at the sandbox. `npm run chaos` is structurally incapable of
touching it — `ChaosPrava` refuses to wrap a non-mock adapter and never reads
`PRAVA_API_KEY` — but nothing protects you from a `for` loop you wrote yourself.

---

## 1. Local development

```powershell
npm install
npm run dev
```

`npm run dev` starts both halves with `concurrently`: the engine on port 4100 and the Next.js
app on port 3000. To run them separately, in two terminals:

```powershell
npm run dev:engine     # engine only, port 4100
npm run dev:web        # Next.js only, port 3000
```

No `.env` file is required. Every value has a working default: `PORT=4100`, `PRAVA_ENV=mock`,
`ENGINE_API_TOKEN=dev-token`, SQLite at `data/gmp.db`, and a signing key generated at boot.
The web app proxies `/api/*` to `http://localhost:4100` by default
([`../web/next.config.ts`](../web/next.config.ts)).

If you want a `.env` anyway:

```powershell
Copy-Item .env.example .env
```

The local `.env` currently has `PRAVA_ENV=mock` and an **empty** `PRAVA_API_KEY`. That is
deliberate — the real sandbox key exists only as a Railway environment variable. Local
development runs entirely offline against the built-in Prava simulator.

Useful local URLs once `npm run dev` is running:

| URL | What |
|---|---|
| http://localhost:3000 | landing page |
| http://localhost:3000/app | dashboard: what needs you, what your card is exposed to |
| http://localhost:3000/app/plan/new | one sentence becomes a coordinated plan |
| http://localhost:3000/app/bill | photograph or paste a bill and split it |
| http://localhost:3000/app/discover | search or paste a product URL |
| http://localhost:4100/health | engine liveness and which adapter it is using |
| http://localhost:4100/new | the engine's own zero-build HTML fallback |

---

## 2. Every npm script

### 2.1 Root scripts — [`../package.json`](../package.json)

| Script | Runs | What it does | Needs |
|---|---|---|---|
| `npm run dev` | `concurrently` engine + web | Both halves, ports 4100 and 3000. | nothing |
| `npm run dev:engine` | `npm run start -w engine` | Engine only, port 4100. | nothing |
| `npm run dev:web` | `npm run dev -w web` | Next.js dev server, port 3000. | nothing |
| `npm run build` | `npm run build -w web` | Next.js production build. Observed: succeeds, **19 routes, 14 static pages**. | nothing |
| `npm start` | `npm run start -w engine` | Engine in the foreground. This is Railway's start command. | nothing |
| `npm test` | `npm run test -w engine` | Vitest. Observed: **14 files, 365 tests passed**. | **PowerShell** |
| `npm run test:widget` | `node --test widget/detect.test.mjs` | The page detector against captured real pages. Observed: **30 pass, 0 fail**. Includes a test that `widget/widget.js` and `extension/detect.js` carry an identical copy of `widget/detect.js`. | nothing |
| `npm run build:widget` | `node widget/build-bookmarklet.mjs` | Regenerates the bookmarklet and `extension/detect.js` from `widget/detect.js`. Run it after editing the detector. | nothing |
| `npm run chaos` | `npm run chaos -w chaos` | 60 randomized fault-injection runs. Observed: seed base 42, terminal states `{"partial":9,"committed":38,"aborted":13}`, six invariants pass, prints `GREEN WALL`. Runs the engine **in process** — no HTTP, no server to start. Mock adapter only. Tune with `CHAOS_ITERS` and `SEED`. | nothing |
| `npm run demo` | `npm run demo -w cli` | Full commit run against the mock adapter. Observed: `COMMITTED`, four members charged $46.50 each, `receipt: ✓ chain + signature verified`. **Drives the engine over HTTP — start one first.** | a running engine on `GMP_API` (default `http://localhost:4100`) |
| `npm run e2e:plan` | `tsx e2e/plan-flow.ts` | Coordination end to end against **live OpenStreetMap**: real geocode, real venues, real ranking, then a group. | a running engine; `GMP_API`, `ENGINE_API_TOKEN` |
| `npm run e2e:product` | `tsx e2e/product-flow.ts` | Resolves a real merchant URL, builds a cart, commits through the mock ceremony, checks every surface renders. Never touches the sandbox. | a running engine and web app; `ENGINE_API_TOKEN` |
| `npm run e2e:sandbox` | `tsx e2e/sandbox-smoke.ts` | Exactly **one** mandate setup, one charge and one report against the real Prava sandbox, pausing for a human at the passkey step. Budget-aware by design. Refuses to run unless the key starts `sk_test_`. | `PRAVA_API_KEY` |
| `npm run e2e:proof` | `tsx e2e/sandbox-proof.ts` | Creates a group and mints **real** Prava mandate sessions, printing the hosted approval URLs. Add `-- --watch` to poll until terminal. **This is the script for the number-one open task.** | `GMP_API`, `ENGINE_API_TOKEN` |
| `npm run e2e:auth` | `tsx e2e/auth-check.ts` | Registers a throwaway account against a deployed engine, follows the session cookie, reads a protected route. Proves sign-in works on a live host in one command. | `GMP_API` |

### 2.2 Workspace scripts

| Command | What |
|---|---|
| `npm run typecheck -w engine` | `tsc --noEmit`. Same as `npx tsc --noEmit -p engine/tsconfig.json`. Observed clean. |
| `npm run typecheck -w web` | `tsc --noEmit` for the Next.js app. |
| `npm run lint -w web` | `next lint`. |
| `npm run start -w web` | Serves an already-built Next.js app. Run `npm run build` first. |
| `npm run gmp -w cli -- <args>` | The CLI. See section 2.3. |
| `npm run nanda -w cli -- <args>` | NANDA publication tooling. See section 6. |
| `npm start -w mcp` | The MCP server (`create_group_session`, `get_group_status`, `cancel_group`). |

### 2.3 CLI runs

Every `demo` scenario drives a **running engine** over HTTP at `GMP_API` (default
`http://localhost:4100`). Start one with `npm run dev:engine` first. `verify` is offline and
needs nothing.

```powershell
npx -w cli tsx src/gmp.ts demo commit       # same as `npm run demo`
npx -w cli tsx src/gmp.ts demo backstop     # shortfall absorbed by an armed backstop
npx -w cli tsx src/gmp.ts demo abort        # policy becomes unsatisfiable, everything cancelled
npx -w cli tsx src/gmp.ts demo auction      # sealed-bid priority allocation
npx -w cli tsx src/gmp.ts verify receipt.json   # offline receipt verification
```

### 2.4 The NANDA Town plugin (Python)

The plugin is a separate Python project with its own virtual environment.

```powershell
Set-Location c:\Users\acer\sutra\nanda-town-prava
.\.venv\Scripts\python.exe -m pytest -q
```

Whatever it prints is the answer. This count has moved repeatedly — 44, then 46,
then 51, then 117 as property-based cases landed — and every document that
copied a number instead of a command has been wrong within hours of being
written. Do not quote it anywhere; run it.

Return to the repository root afterwards:

```powershell
Set-Location c:\Users\acer\sutra
```

---

## 3. Deploying

Two halves, two hosts, two completely separate commands. Deploying one does nothing to the
other.

### 3.1 Deploy the web app (Vercel)

**Pushing to `main` does not deploy the web app.** Vercel's git auto-deploy does not fire for
this project. This has caught this team more than once: you push, the site does not change,
and you conclude your code is broken.

Two steps, both from PowerShell in `c:\Users\acer\sutra`:

```powershell
npx vercel --prod --yes
```

That prints a deployment URL like `https://sutra-abc123xyz.vercel.app`. **The public site is
still serving the old build at this point.** Copy the printed URL into the second command:

```powershell
npx vercel alias set https://sutra-abc123xyz.vercel.app sutra-gmp.vercel.app
```

Replace `https://sutra-abc123xyz.vercel.app` with whatever the first command actually printed.

Verify:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://sutra-gmp.vercel.app
```

Expect `200`.

Facts about the Vercel side:

- Project `sutra`, org `soham-aggarwals-projects`, linked to GitHub `Soham109/sutra`.
- The public alias is **`sutra-gmp.vercel.app`**. `sutra.vercel.app` belongs to a stranger;
  the namespace is global. Do not try to claim it.
- Deployment protection / SSO is **disabled**, so judges can open the site without a login.
  Do not turn it on.
- Build configuration is in [`../vercel.json`](../vercel.json): build command
  `npm run build -w web`, output directory `web/.next`, framework `nextjs`.

### 3.2 Deploy the engine (Railway)

From PowerShell in `c:\Users\acer\sutra`:

```powershell
npx --yes @railway/cli up --ci --service engine
```

`--service engine` is **required**. Without it Railway errors with "Multiple services found".
`--ci` streams build logs and then exits, instead of attaching to the log stream forever.

Verify:

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
```

Expect JSON containing `"ok":true` and `"prava_adapter":"sandbox"`. The `uptime_s` field is the
fastest way to tell whether the process you are looking at is the one you just deployed — a
small number means a fresh boot.

Facts about the Railway side:

- Project `sutra-engine`, service **`engine`**.
- Deploy configuration is in [`../railway.json`](../railway.json): builder NIXPACKS, build
  command `npm install`, start command `npm run start -w engine`, healthcheck `/health` with a
  60-second timeout, restart on failure up to 10 times, and **`numReplicas: 1`**.
- A persistent volume is mounted at `/data`, and `DB_PATH=/data/gmp.db`.

### 3.3 Deploy invariants — do not change these

1. **`numReplicas: 1`.** Load-bearing, not a cost decision. The approval poller, the in-process
   `EventHub`, and the single-file SQLite database all assume exactly one process. Two replicas
   double-poll and split the SSE fan-out.
2. **The `/data` volume and `DB_PATH=/data/gmp.db`.** Without them every redeploy wipes all
   groups, accounts and receipts. [`../engine/src/server.ts`](../engine/src/server.ts) lines
   39-41 throw on boot if `NODE_ENV=production` and `DB_PATH` is unset, so a missing volume
   fails loudly rather than quietly writing to a disk that is about to disappear.
3. **`ENGINE_SIGNING_SEED` must be fixed.** If it is unset the engine mints a new Ed25519 key
   at every boot and every receipt signed before the redeploy stops verifying.
4. **The engine cannot run on Vercel.** It needs file-backed SQLite, a 1.5-second poller that
   is the only mechanism by which approvals are ever detected, long-lived SSE connections, and
   an in-process event hub. Serverless kills all four.
5. **Vercel needs both `ENGINE_URL` and `ENGINE_API_TOKEN`.** The proxy at
   [`../web/src/app/api/[...path]/route.ts`](../web/src/app/api/[...path]/route.ts) reads
   `ENGINE_API_TOKEN` on the server and attaches it as a bearer token. Forgetting it produces
   "missing or invalid bearer token" on every API call.

---

## 4. Environment variables

### 4.1 Which variable goes on which host

| Variable | Railway (engine) | Vercel (web) | Local `.env` | What it does |
|---|---|---|---|---|
| `PRAVA_ENV` | `sandbox` | — | `mock` | `mock` uses the built-in offline simulator. `sandbox` uses the real Prava sandbox. |
| `PRAVA_API_KEY` | set (`sk_test_*`) | — | empty | The Prava sandbox key. Only on Railway. |
| `PRAVA_BASE_URL` | default | — | `https://sandbox.api.prava.space` | Prava API base. |
| `APP_BASE_URL` | `https://sutra-gmp.vercel.app` | — | `http://localhost:4100` | Every approval link, QR code and discovery document derives from this. Point it at the **web** origin, not the engine. |
| `PORT` | Railway sets it | — | `4100` | |
| `NODE_ENV` | `production` | — | `development` | With `production`, a missing `DB_PATH` throws at boot. |
| `DB_PATH` | `/data/gmp.db` | — | empty | **Set this from PowerShell only.** Git Bash mangles the path. |
| `ENGINE_API_TOKEN` | set | **set** | `dev-token` | One shared bearer token. Both hosts need the **same** value. |
| `ENGINE_SIGNING_SEED` | set | — | empty | 32-byte hex seed for the Ed25519 receipt key. Must not change. |
| `WEBHOOK_SECRET` | set | — | `dev-webhook-secret` | |
| `ENGINE_URL` | — | `https://engine-production-e6fa.up.railway.app` | — | Where the Next.js proxy forwards `/api/*`. |
| `OPENAI_API_KEY` | set | — | empty | Optional everywhere. Upgrades intent extraction and enables server-side receipt-photo reading. |
| `OPENAI_MODEL` | `gpt-4.1-nano` | — | `gpt-4.1-nano` | Cheapest tier that handles constrained tool-calling. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | set | — | — | Web push. Already configured; push is live. |
| `SHOPIFY_DOMAINS` | unset | — | unset | Comma-separated override for the default product-search shelf. |
| `ALLOW_DEV_AUTH` | **unset** | — | — | Leave unset in production. It re-enables the header-based identity bypass. |

`OPENAI_API_KEY` is optional in every path. The deterministic extractor
([`../engine/src/agent/extract.ts`](../engine/src/agent/extract.ts)) is the floor, not a stub,
and runs whenever the model is unavailable. Nothing in the demo depends on the key.

### 4.2 Read the current Railway variables

```powershell
npx --yes @railway/cli variable list --service engine
```

Add `--kv` to print raw values in `KEY=value` form. **Only do that in a terminal nobody is
recording.**

### 4.3 Read the current Vercel variables

```powershell
npx vercel env ls production
```

### 4.4 Set a secret without it appearing in your shell history

Preferred, because the value never becomes a command argument:

```powershell
Write-Output "the-secret-value" | npx --yes @railway/cli variable set OPENAI_API_KEY --stdin --service engine
```

The legacy inline form also works, but the value lands in your shell history:

```powershell
npx --yes @railway/cli variable set OPENAI_API_KEY=the-secret-value --service engine
```

Add `--skip-deploys` if you are setting several variables and want to redeploy once at the end.

For Vercel, `env add` reads the value from a prompt rather than an argument, which is the
behaviour you want:

```powershell
npx vercel env add ENGINE_API_TOKEN production
```

Then redeploy the web app — Vercel environment changes do **not** apply to an existing
deployment. Use the two-step deploy in section 3.1.

### 4.5 Rotate a key

Rotating `OPENAI_API_KEY` or `PRAVA_API_KEY` (engine only, nothing else needs to know):

1. Create the new key in the provider's dashboard.
2. `Write-Output "<new value>" | npx --yes @railway/cli variable set OPENAI_API_KEY --stdin --service engine`
3. Wait for the redeploy, then `curl.exe -s https://engine-production-e6fa.up.railway.app/health`
   and check `uptime_s` is small.
4. Revoke the old key in the provider's dashboard.
5. Update the scratchpad file if the key is recorded there. Do not write it into the repo.

Rotating `ENGINE_API_TOKEN` (**both** hosts must change together):

1. Generate a value: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set it on Railway with `variable set ENGINE_API_TOKEN --stdin --service engine`.
3. Set it on Vercel with `npx vercel env rm ENGINE_API_TOKEN production` then
   `npx vercel env add ENGINE_API_TOKEN production`.
4. Redeploy the web app with the two-step process in section 3.1.
5. Update `secrets.env` in the scratchpad directory.

Between steps 2 and 4 the web app is broken, because the token it sends no longer matches the
one the engine expects. Do this quickly, and not during a demo.

**Rotating `ENGINE_SIGNING_SEED` invalidates every receipt already signed.** They will fail
verification permanently. Do not rotate it before judging. Rotate it afterwards if you want.

Rotating VAPID keys invalidates every existing push subscription; every user has to re-subscribe.

---

## 5. Running the demo

### 5.1 The offline demo — no network, no keys, but it needs a local engine

`npm run demo` drives the engine **over HTTP**. It does not start one. Start the engine first,
in its own terminal:

```powershell
npm run dev:engine
```

Then, in a second terminal:

```powershell
npm run demo
```

Four members, four approvals, four charges, a verified receipt. It prints a receipt page URL
and a replay board URL on `localhost:4100`. With `PRAVA_ENV=mock` (the local default) it needs
no network and no keys, so this is the fallback if anything live is down.

If it fails with a connection error, nothing is listening on port 4100. Check with:

```powershell
Get-NetTCPConnection -LocalPort 4100 -State Listen -ErrorAction SilentlyContinue
```

To drive a different engine, set `GMP_API` and `ENGINE_API_TOKEN` first.

Other scenarios, all needing the same running engine:

```powershell
npx -w cli tsx src/gmp.ts demo backstop     # a decline, absorbed by an armed backstop
npx -w cli tsx src/gmp.ts demo abort        # policy becomes unsatisfiable, everything cancelled
npx -w cli tsx src/gmp.ts demo auction      # 3 claimants, 2 seats, sealed bids allocate
```

### 5.2 The live demo path

1. Open https://sutra-gmp.vercel.app in a private window.
2. Sign up, or sign in.
3. Go to `/app/plan/new` and type a sentence such as
   *"dinner saturday with Arsh and Maya near Koramangala, under 900 each"*.
4. Answer as each participant from `/p/:participantId` — no account is needed for that page.
5. Open the plan board at `/app/plans/:id` and show the ranked options with the arithmetic
   visible.
6. Choose one and convert it to a group.

Note which rail you land on. An option that came from OpenStreetMap is always on the
`at_venue` rail and **no card is charged**, by design — see
[`../HANDOFF.md`](../HANDOFF.md) section 7. To demonstrate a real card charge you need a
merchant, which means the product-search or pasted-URL path, not the venue path.

### 5.3 The real-Prava proof run

This is the one that produces the evidence the hackathon actually asks for.

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from secrets.env>"
npm run e2e:proof -- --watch
```

The script prints, per member, our approval page URL and the **Prava** hosted URL on
`sandbox.collect.prava.space`. Open a Prava URL on a phone and complete the passkey ceremony
with the sandbox test card:

| Field | Value |
|---|---|
| PAN | `4622 9431 2323 2440` |
| CVV | `157` |
| Expiry | `12/30` (Prava corrected this by email — it is not 12/27) |
| Card ID | `CARD-27` |
| OTP for sandbox device binding | `456789` |

These are sandbox-only values and are already in `.env` at the repository root (gitignored, so
it exists on this machine but not in a fresh clone). The engine never reads them; they are
typed by a human on Prava's page.

With `--watch` the script polls until the group reaches a terminal state, then prints the total
charged through the card network and the receipt URL. Capture that output.

---

## 6. The NANDA registry and the plugin

### 6.1 Check what we publish

```powershell
$env:SUTRA_PUBLIC_URL = "https://sutra-gmp.vercel.app"
npm run nanda -w cli -- check
```

That fetches our own well-known URLs and validates them. The base URL comes from
`SUTRA_PUBLIC_URL`, falling back to `APP_BASE_URL`, defaulting to `http://localhost:4100`. A
loopback or private-network address is **refused** for any real submission, because both
registries probe whatever URL you give them from their own network and badge the listing
permanently.

### 6.2 Read our SkillMD registry entry

```powershell
curl.exe -s https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85
```

Observed on 2026-08-01: the entry exists, `name` is `sutra — group checkout (GMP/1)`,
`source_url` is `https://sutra-gmp.vercel.app/skill.md`, `created_at` is
`2026-08-01T13:29:23.374Z`, and **`reachable` is `null`** — not `true`. `null` means the
registry has recorded no probe result. Re-check before quoting it and report what it actually
says.

The whole registry index, with the current entry count:

```powershell
curl.exe -s https://nandatown.projectnanda.org/api/skills
```

Observed count on 2026-08-01: **273**.

### 6.3 Re-submit or update the SkillMD entry

```powershell
$env:SUTRA_PUBLIC_URL = "https://sutra-gmp.vercel.app"
npm run nanda -w cli -- skill-submit --dry-run
```

`--dry-run` previews the exact body without submitting. Drop it to submit for real. Flags:
`--all`, `--content`, `--dry-run`. `skill-submit` probes the SkillMD URL first and refuses if
it is unreachable.

### 6.4 Do not run index-register

```
npm run nanda -w cli -- index-register       # DO NOT RUN
```

NANDA Index v2 registration needs a DNS TXT record on a domain we control. A `.vercel.app`
subdomain cannot carry one. It is also not what the NANDA prize is for — the prize is
"Best Prava Adapter for the NANDA Town", which is the Python plugin.

### 6.5 The plugin's live check against a real engine

```powershell
Set-Location c:\Users\acer\sutra\nanda-town-prava
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from secrets.env>"
.\.venv\Scripts\python.exe scripts\live_check.py
Set-Location c:\Users\acer\sutra
```

`scripts/live_check.py` exercises `live` mode over a real socket, because the test suite
injects fake transports. It asks `GET /health` for the adapter kind and grades itself
differently for `mock` versus a real key. On a real adapter it cancels every group it created
before exiting. It never prints `ENGINE_API_TOKEN`.

Transcripts of previous runs are in [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md) sections 3.2 and
3.3.

---

## 7. When things break

### 7.1 Railway's API flakes during a deploy

**Symptom.** `railway up` fails with a network or GraphQL error partway through.

**Fix.** Run the same command again. This is routine and not a sign of a problem:

```powershell
npx --yes @railway/cli up --ci --service engine
```

If it fails repeatedly, check the deployment list and the logs:

```powershell
npx --yes @railway/cli deployment list --service engine
npx --yes @railway/cli logs --service engine --lines 200
```

**Always pass `--lines` to `logs`.** Without it, `railway logs` *streams* and never exits,
which will hang a terminal or an agent indefinitely. `--lines 200` fetches history and returns.

### 7.2 Railway says "Multiple services found"

**Cause.** You omitted `--service engine`.

**Fix.** Always pass it:

```powershell
npx --yes @railway/cli up --ci --service engine
```

### 7.3 Vercel is serving a stale build

**Symptom.** You pushed, or you deployed, and https://sutra-gmp.vercel.app still shows the old
version.

**Cause, almost always.** Either git auto-deploy did not fire (it does not fire for this
project), or you deployed but never moved the alias.

**Fix.** Both steps, in order:

```powershell
npx vercel --prod --yes
npx vercel alias set <the-url-that-just-printed> sutra-gmp.vercel.app
```

To confirm which deployment the alias currently points at:

```powershell
npx vercel alias list
npx vercel ls
```

Also check you are not looking at a browser cache — test in a private window.

### 7.4 "missing or invalid bearer token" from the web app

**Cause.** Vercel does not have `ENGINE_API_TOKEN`, or it does not match the value on Railway.

**Fix.**

```powershell
npx vercel env ls production
npx --yes @railway/cli variable list --service engine
```

Make the two values identical, then redeploy the web app with both steps from section 3.1.
Vercel environment changes do not apply to an existing deployment.

### 7.5 The engine is running an old build

**Symptom.** A feature that works locally 404s or misbehaves in production. This has happened
before: "login is broken" turned out to mean the engine had been up for 95 minutes running a
build from before `/v1/auth/*` existed.

**Diagnose.**

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
```

A large `uptime_s` means the process is old. Then prove the specific feature:

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
npm run e2e:auth
```

**Fix.** Deploy the engine (section 3.2), then re-run the check.

### 7.6 Overpass is rate-limiting (empty venue board)

**Symptom.** A plan board shows no options, with a reason such as *"Overpass is rate-limiting
us; try again in a minute"*.

**This is working as designed.** An Overpass 429 or 504, or a 200 that carries a `remark` and
no elements, is treated as a **failure** and rendered with its reason — never as "nothing near
you". Rendering an incomplete answer as an empty neighbourhood is the one lie that module must
not tell.

**Fix.** Wait a minute and press refresh on the plan board, which calls
`POST /v1/plans/:id/options/refresh`. Refresh is an explicit action precisely because it spends
someone's rate limit. An empty refresh preserves the previous board rather than wiping it — that
was a real bug and it is fixed.

Check the last observed reachability of both OSM sources:

```powershell
curl.exe -s https://sutra-gmp.vercel.app/api/v1/places/status
```

During a demo, prefer a location you have already searched — results are cached — or use the
product-search or pasted-URL path, which does not touch Overpass at all.

### 7.7 A Prava session expired

**Symptom.** The hosted approval page says the session is expired or invalid.

**Cause.** Prava sessions expire roughly **15 minutes** after creation. This is why sessions
are minted lazily on the member's first open rather than at group creation — the clock starts
when the human is actually looking at the page.

**Fix.** Do not debug it. Create a fresh group and open the new URL promptly:

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from secrets.env>"
npm run e2e:proof -- --watch
```

Remember the 30-transactions-per-day budget on the team test card. Do not burn it retrying.

### 7.8 A member approved but the group has not moved

**Cause.** Prava has **no webhooks**. Approval is detected by a poller that lists mandates for
our per-member `customer_id` with `standing_only=true`, on a 1.5-second cycle. If the engine
process restarted, the poller re-enters on boot via `recoverOnBoot()`.

**Diagnose.** Check the engine is alive and recently booted:

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
npx --yes @railway/cli logs --service engine --lines 200
```

Then read the group state directly, which shows each member's status:

```powershell
curl.exe -H "Authorization: Bearer <ENGINE_API_TOKEN>" https://engine-production-e6fa.up.railway.app/v1/groups/<group_id>
```

If the group is stuck in `committing`, that is not necessarily a failure. **Unknown charge
state is never treated as failure** — the engine resolves it by fetching the mandate's
`charges[]` and matching our idempotency `reference`, and the poller re-enters the commit under
the same reference. Give it a cycle before intervening.

### 7.9 The engine will not boot with a DB_PATH error

**Symptom.** Boot throws: `DB_PATH is required in production. Mount a persistent Railway volume
at /data and set DB_PATH=/data/gmp.db.`

**Cause.** `NODE_ENV=production` with no `DB_PATH`. This guard exists so a missing volume fails
loudly instead of quietly writing to a disk that vanishes on the next deploy.

**Fix, from PowerShell** (never from Git Bash, which mangles the path):

```powershell
npx --yes @railway/cli variable set DB_PATH=/data/gmp.db --service engine
```

Then confirm the volume is actually mounted at `/data` in the Railway dashboard. Setting the
variable without the volume gets you a database that disappears on every redeploy.

### 7.10 Receipts stopped verifying after a redeploy

**Cause.** `ENGINE_SIGNING_SEED` changed, or was never set, so the engine minted a new Ed25519
key at boot.

**Diagnose.** Compare `receipt_public_key` in `/health` against what it was before. On
2026-08-01 it was
`b71838a635e97a8f8104e95213bbf3b718f64d89c13d645a8ab6245ca1f8de94`.

**Fix.** Restore the original seed from `secrets.env` and redeploy. Receipts signed under a
different key cannot be recovered — the signature is over the content, and the key is gone.

### 7.11 Tests fail with "Cannot read properties of undefined (reading 'config')"

**Cause.** You are in Git Bash. See section 0.1.

**Fix.** Run it from PowerShell:

```powershell
npm test -w engine
```

Or, if you must stay in Git Bash:

```bash
cd /c/Users/acer/sutra/engine && npx vitest run
```

Both report 14 files and 365 tests passing. **Do not edit a test file in response to this
error.**

---

## 8. Health checks — the five-minute sweep

Run these when you pick the project up, or before a demo.

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
curl.exe -s -o NUL -w "web %{http_code}`n" https://sutra-gmp.vercel.app
curl.exe -s -o NUL -w "skill %{http_code}`n" https://sutra-gmp.vercel.app/skill.md
curl.exe -s -o NUL -w "card %{http_code}`n" https://sutra-gmp.vercel.app/.well-known/agent-card.json
curl.exe -s -o NUL -w "facts %{http_code}`n" https://sutra-gmp.vercel.app/.well-known/agent-facts.json
curl.exe -s -o NUL -w "catalog %{http_code}`n" https://sutra-gmp.vercel.app/api/agents
curl.exe -s -o NUL -w "places %{http_code}`n" https://sutra-gmp.vercel.app/api/v1/places/status
```

All seven returned 200 on 2026-08-01, and `/health` reported `"prava_adapter":"sandbox"`.

Then the local suites:

```powershell
npm test -w engine        # expect 14 files, 365 tests passed
npm run test:widget       # expect 30 pass, 0 fail
npm run chaos             # expect GREEN WALL
npm run build             # expect a successful build, 19 routes
```
