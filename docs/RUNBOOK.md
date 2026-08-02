# Runbook — running, deploying and operating sutra

Operations only. For the rules and traps that must not be broken, read [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md). For track-by-track judging evidence, read [`TRACK-EVIDENCE.md`](TRACK-EVIDENCE.md).

Every command below is run from the repository root unless it says otherwise.

## 0. Read this before running anything

**Use PowerShell, not Git Bash.** `npm test -w engine` from Git Bash fails every test file with `TypeError: Cannot read properties of undefined (reading 'config')`. The same command in PowerShell passes every file — the code is fine, do not edit a test file in response to this error. If you must run tests from Git Bash, `cd engine && npx vitest run` reports the same passing count. Git Bash (MSYS) also rewrites a path-shaped value like `/data/gmp.db` into a Windows path before the command sees it — set `DB_PATH` and similar variables from PowerShell.

**Never print a secret.** Secrets live outside the repository, in local gitignored files (`secrets.env`, `vapid.env`) kept off the working tree, and are set directly on the hosting provider (Railway, Vercel). `secrets.env` holds `ENGINE_SIGNING_SEED`, `ENGINE_API_TOKEN`, `WEBHOOK_SECRET`; `vapid.env` holds the VAPID keypair. Never paste a key into a chat transcript, commit message, or doc — an OpenAI key was auto-revoked minutes after landing in a chat, because OpenAI scans for leaked keys. §4.4 shows how to set a secret without it touching shell history.

**The Prava sandbox has a hard, depleting daily transaction budget.** Never point the chaos suite, a load test, or a hand-written loop at it. `npm run chaos` cannot reach it structurally — `ChaosPrava` refuses to wrap a non-mock adapter — but nothing stops a `for` loop you write yourself.

## 1. Local development

```powershell
npm install
npm run dev
```

`npm run dev` starts the engine (port 4100) and the Next.js app (port 3000) together via `concurrently`. Run them separately with `npm run dev:engine` / `npm run dev:web`. No `.env` is required — every value has a working default (`PORT=4100`, `PRAVA_ENV=mock`, `ENGINE_API_TOKEN=dev-token`, SQLite at `data/gmp.db`, a signing key generated at boot), and the web app proxies `/api/*` to `http://localhost:4100` by default. Copy `.env.example` to `.env` if you want one explicitly; it ships with `PRAVA_ENV=mock` and an empty `PRAVA_API_KEY` on purpose — the real sandbox key exists only as a Railway variable, and local development runs entirely offline against the built-in Prava simulator.

| URL | What |
|---|---|
| `localhost:3000` | landing page |
| `localhost:3000/app` | dashboard: what needs you, what your card is exposed to |
| `localhost:3000/app/plan/new` | one sentence becomes a coordinated plan |
| `localhost:3000/app/bill` | photograph or paste a bill and split it |
| `localhost:3000/app/discover` | search or paste a product URL |
| `localhost:4100/health` | engine liveness and which Prava adapter it's using |
| `localhost:4100/new` | the engine's own zero-build HTML fallback |

## 2. Every npm script

### Root scripts (`package.json`)

| Script | What it does | Needs |
|---|---|---|
| `npm run dev` | Both halves, ports 4100 and 3000 | nothing |
| `npm run build` | Next.js production build. Route count moves as routes are added — believe what the build prints. | nothing |
| `npm start` | Engine in the foreground; Railway's start command | nothing |
| `npm test` | `npm run test -w engine` (vitest). Believe the printed count. | **PowerShell** |
| `npm run test:widget` | The page detector against captured real pages (`node --test`), including a check that `widget.js`/`extension/detect.js`/`detect.js` stay identical | nothing |
| `npm run build:widget` | Regenerates the bookmarklet and `extension/detect.js` from `widget/detect.js` — run after editing the detector | nothing |
| `npm run chaos` | Randomized fault-injection runs against the mock adapter, in-process (no server to start). Tune with `CHAOS_ITERS`/`SEED`. | nothing |
| `npm run demo` | Full commit run against the mock adapter, driving the engine **over HTTP** — start one first | a running engine (`GMP_API`, default `localhost:4100`) |
| `npm run e2e:plan` | Coordination end to end against **live OpenStreetMap** | running engine, `GMP_API`, `ENGINE_API_TOKEN` |
| `npm run e2e:product` | Resolves a real merchant URL, commits through the mock ceremony. Never touches the sandbox. | running engine + web app, `ENGINE_API_TOKEN` |
| `npm run e2e:sandbox` | One mandate setup, one charge, one report against the **real** Prava sandbox, pausing for a human passkey. Refuses unless the key starts `sk_test_`. | `PRAVA_API_KEY` |
| `npm run e2e:proof` | Creates a group and mints real Prava mandate sessions, printing the hosted approval URLs. Add `-- --watch` to poll to terminal. This is the script that produces real on-network payment evidence. | `GMP_API`, `ENGINE_API_TOKEN` |
| `npm run e2e:auth` | Registers a throwaway account against a deployed engine and reads a protected route | `GMP_API` |

### Workspace scripts

`npm run typecheck -w engine` / `-w web` · `npm run lint -w web` · `npm run start -w web` (serve an already-built app) · `npm run gmp -w cli -- <args>` (§2.1) · `npm run nanda -w cli -- <args>` (§5) · `npm start -w mcp` (the MCP server).

### CLI runs

`demo` scenarios drive a **running engine** over HTTP at `GMP_API` (default `localhost:4100`) — start one with `npm run dev:engine` first. `verify` is offline and needs nothing.

```powershell
npx -w cli tsx src/gmp.ts demo commit       # same as npm run demo
npx -w cli tsx src/gmp.ts demo backstop     # shortfall absorbed by an armed backstop
npx -w cli tsx src/gmp.ts demo abort        # policy becomes unsatisfiable, everything cancelled
npx -w cli tsx src/gmp.ts demo auction      # sealed-bid priority allocation
npx -w cli tsx src/gmp.ts verify receipt.json
```

### The NANDA Town plugin (Python)

```powershell
Set-Location nanda-town-prava
.\.venv\Scripts\python.exe -m pytest -q
Set-Location ..
```

This count has moved repeatedly as property-based cases landed. Do not quote it anywhere — run it.

## 3. Deploying

Two halves, two hosts, two separate commands. Deploying one does nothing to the other.

### Web app (Vercel)

**Pushing to `main` does not deploy the web app** — Vercel's git auto-deploy does not fire for this project. Two steps, from PowerShell at the repository root:

```powershell
npx vercel --prod --yes
```

That prints a deployment URL. **The public site is still serving the old build at this point.** Copy the printed URL into:

```powershell
npx vercel alias set https://<the-url-that-just-printed> sutra-gmp.vercel.app
```

Verify with `curl.exe -s -o NUL -w "%{http_code}`n" https://sutra-gmp.vercel.app` — expect `200`.

Project `sutra`, org `soham-aggarwals-projects`, linked to GitHub `Soham109/sutra`. The public alias is **`sutra-gmp.vercel.app`** (`sutra.vercel.app` belongs to someone else — the namespace is global). Deployment protection/SSO is disabled so judges can open the site without a login; do not turn it on. Build config is in `vercel.json`: build command `npm run build -w web`, output `web/.next`.

### Engine (Railway)

```powershell
npx --yes @railway/cli up --ci --service engine
```

`--service engine` is required — without it Railway errors with "Multiple services found." **If the CLI produces zero output and exits 1, it has not deployed anything** — deploy from the Railway dashboard instead and verify with `/health` below; a small `uptime_s` is the only proof the deploy landed. **Do not rely on Railway's git auto-deploy either** — the trigger can be switched off while the repo still shows as connected, in which case pushing to `main` changes nothing.

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
```

Expect JSON with `"ok":true` and `"prava_adapter":"sandbox"`; a small `uptime_s` means a fresh boot. Project `sutra-engine`, service `engine`. Deploy config is in `railway.json`: NIXPACKS, build `npm install`, start `npm run start -w engine`, healthcheck `/health` (60s timeout), restart on failure up to 10 times, **`numReplicas: 1`**. A persistent volume is mounted at `/data`, `DB_PATH=/data/gmp.db`.

### Deploy invariants — do not change these

`numReplicas: 1` is load-bearing, not a cost decision: the approval poller, the in-process event hub, and the single-file SQLite database all assume exactly one process — two replicas double-poll and split the SSE fan-out. The `/data` volume and `DB_PATH=/data/gmp.db` must both exist, or every redeploy wipes all groups, accounts, and receipts (the engine throws on boot if `NODE_ENV=production` and `DB_PATH` is unset, rather than quietly writing to a disk about to disappear). `ENGINE_SIGNING_SEED` must stay fixed — an unset seed mints a new Ed25519 key at every boot, and every receipt signed before the redeploy stops verifying. The engine cannot run on Vercel: it needs file-backed SQLite, the 1.5-second poller (the only way approvals are ever detected), long-lived SSE, and an in-process event hub — serverless kills all four. The web proxy forwards the first-party session cookie and deliberately never stamps `ENGINE_API_TOKEN` onto browser calls; doing so would turn every visitor into an operator.

## 4. Environment variables

| Variable | Railway (engine) | Vercel (web) | Local `.env` | What it does |
|---|---|---|---|---|
| `PRAVA_ENV` | `sandbox` | — | `mock` | `mock` uses the offline simulator; `sandbox` uses the real Prava sandbox |
| `PRAVA_API_KEY` | `sk_test_*` | — | empty | Only on Railway |
| `PRAVA_BASE_URL` | default | — | `https://sandbox.api.prava.space` | |
| `APP_BASE_URL` | the web origin | — | `http://localhost:4100` | Every approval link, QR code, and discovery document derives from this — point it at **web**, not the engine |
| `NODE_ENV` | `production` | — | `development` | `production` + missing `DB_PATH` throws at boot |
| `DB_PATH` | `/data/gmp.db` | — | empty | Set from PowerShell only |
| `ENGINE_API_TOKEN` | set | optional, server-only | `dev-token` | Operator bearer; the browser proxy must never attach it automatically |
| `ENGINE_SIGNING_SEED` | set | — | empty | 32-byte hex Ed25519 seed. Must not change. |
| `WEBHOOK_SECRET` | set | — | `dev-webhook-secret` | |
| `ENGINE_URL` | — | the Railway URL | — | Where the Next.js proxy forwards `/api/*` |
| `OPENAI_API_KEY` | set | — | empty | Optional everywhere |
| `OPENAI_MODEL` | `gpt-4.1-nano` | — | same | Cheapest tier handling constrained tool-calling |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | set | — | — | Web push; already configured and live |
| `SHOPIFY_DOMAINS` | unset | — | unset | Comma-separated override for the default search shelf |
| `SHOPIFY_TEST_ORDER_ENABLED` | demo only | — | `false` | Enables only the development-store `test: true` proof — never point at a live store |
| `SHOPIFY_TEST_STORE` / `SHOPIFY_STOREFRONT_DOMAIN` / `SHOPIFY_API_VERSION` | demo only | — | see §6 | Admin API host, public host that unlocks the proof rail, API version |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` **or** `SHOPIFY_ADMIN_CLIENT_ID`/`SHOPIFY_ADMIN_CLIENT_SECRET` | demo secret | — | empty | Either the static token or the client-credentials pair — not both. See §6. |
| `ALLOW_DEV_AUTH` | **unset** | — | — | Leave unset in production — re-enables a header-based identity bypass |

`OPENAI_API_KEY` is optional everywhere; the deterministic extractor is the floor and runs whenever the model is unavailable.

**Read current values:** `npx --yes @railway/cli variable list --service engine` (add `--kv` for raw values, only in a terminal nobody is recording); `npx vercel env ls production`.

**Set a secret without shell history:** `Write-Output "the-value" | npx --yes @railway/cli variable set OPENAI_API_KEY --stdin --service engine`. For Vercel, `npx vercel env add ENGINE_API_TOKEN production` reads from a prompt. Vercel environment changes do not apply to an existing deployment — redeploy the web app afterward.

**Rotate `OPENAI_API_KEY`/`PRAVA_API_KEY`:** create the new key, set it via `--stdin`, wait for redeploy, check `/health`'s `uptime_s`, revoke the old key. **Rotate `ENGINE_API_TOKEN`:** both hosts must change together (set on Railway, then `vercel env rm`/`add` on Vercel, then redeploy web) — the app is broken between those steps, so do it quickly and not during a demo. **`ENGINE_SIGNING_SEED` invalidates every receipt already signed if rotated** — do not rotate before judging.

## 5. Running the demo

**Offline demo.** `npm run demo` drives the engine over HTTP; it does not start one. `npm run dev:engine` first, then `npm run demo` in a second terminal: four members, four approvals, four charges, a verified receipt, needing no network or keys. If it fails with a connection error, nothing is listening on 4100.

**Live demo path.** Open `https://sutra-gmp.vercel.app`, sign in (do this *before* creating the plan you'll demo — an anonymous organiser loses their copy-link buttons a few seconds after creation, with no way to get them back), go to `/app/plan/new`, type a sentence, answer from each `/p/:participantId` link, open the plan board, and convert to a group. Note the rail: an OpenStreetMap option always lands on `at_venue`, where no card is charged — to demonstrate a real charge you need the product-search or pasted-URL path instead.

**The real-Prava proof run** — the one that produces the evidence the hackathon actually asks for:

```powershell
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from secrets.env>"
npm run e2e:proof -- --watch
```

Prints, per member, the approval page URL and Prava's own hosted URL on `sandbox.collect.prava.space`. Open it on a phone and complete the passkey ceremony with the sandbox test card: PAN `4622 9431 2323 2440`, CVV `157`, expiry `12/30`, card id `CARD-27`, sandbox device-binding OTP `456789`. These are sandbox-only values already in the repository root's gitignored `.env`. With `--watch` the script polls to a terminal state and prints the total charged plus the receipt URL — capture that output.

## 6. Configuring the Shopify development-store proof

The proof adapter mirrors a **committed, test-only** Sutra group into one real Shopify order with `test: true`. Shopify stopped letting merchants create *new* custom apps directly from a store's admin on 2026-01-01 — a store with a pre-existing admin-created app keeps its permanent `shpat_…` token (branch B below); a store set up after that date must use the **Dev Dashboard**, which issues a client ID/secret pair instead (branch A).

**Branch A — Dev Dashboard (new setups).** In the store admin: Settings → Apps and sales channels → Develop apps → Build apps in Dev Dashboard → Create app. Add the `write_orders` scope. Under API access requests, request Protected customer data access (name, address, email, phone — needed for the `orderCreate` shipping/billing address) — a development-store-only app activates immediately, no Shopify review. Release the app, install it on the target store. The Dev Dashboard shows a Client ID and Client secret (shown once — copy both). Verify the exchange before touching the host:

```bash
curl -s -X POST "https://your-store.myshopify.com/admin/oauth/access_token" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET'
```

A working pair returns a token that itself expires in ~24h — don't paste it anywhere; only the client ID/secret go in env vars, and `ShopifyTestOrderClient` exchanges and refreshes automatically.

**Branch B — legacy admin-created app (only if one already exists).** Confirm `write_orders` and protected-customer-data access under Settings → Apps and sales channels → Develop apps, and reveal the permanent Admin API token.

Add to the root `.env` (local) or the Railway service variables (production), using the Branch A block for a Dev Dashboard app or the Branch B line for a legacy token — never both:

```dotenv
PRAVA_ENV=mock
SHOPIFY_TEST_ORDER_ENABLED=true
SHOPIFY_TEST_STORE=your-store.myshopify.com
SHOPIFY_STOREFRONT_DOMAIN=your-public-storefront.example
SHOPIFY_API_VERSION=2026-07
SHOPIFY_DOMAINS=your-public-storefront.example,allbirds.com,gymshark.com

# Branch A
SHOPIFY_ADMIN_CLIENT_ID=client-id-from-dev-dashboard
SHOPIFY_ADMIN_CLIENT_SECRET=client-secret-from-dev-dashboard

# Branch B (only if no Branch A pair)
# SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_redacted
```

`SHOPIFY_STOREFRONT_DOMAIN` must match the host on the imported product URL. Never record or print the token, client secret, or a filled-in curl command. Use a fictional demo recipient address — never a real participant's.

**Verify the gate:** `curl -s http://localhost:4100/v1/shopify-test/status` should say `enabled: true` with the intended store/domains and the no-real-money disclosure. If `enabled` is `false`, `reason` explains why: `not_configured` (the flag isn't `true`), `misconfigured` (flag is `true` but store/token are still missing), or `blocked_in_production` (Prava is in production on this deployment — the bridge refuses on principle, regardless of Shopify config).

**Run it:** in the product finder, select a configured-storefront product, choose "Create a valid Shopify test order," add the group, complete every test approval, then fill the fictional address on the committed board and submit. The equivalent operator call:

```bash
curl -sS -X POST http://localhost:4100/v1/groups/GROUP_ID/shopify-test-order \
  -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  --data '{"email":"demo-recipient@example.com","shipping_address":{"first_name":"Demo","last_name":"Recipient","address1":"123 Test Street","city":"Ottawa","province_code":"ON","country_code":"CA","zip":"K1P 1J1"}}'
```

Open the returned `admin_url` and capture, in order: the order's **Test** indicator and number, the store domain, line items and total matching the Sutra cart, the fictional address, and transaction history showing exactly one labeled test transaction per participant. Caption it plainly (test order, test transactions, no real money) and say so out loud — this proves the adapter mapping, not Shopify Checkout, and not real card captures.

The bridge is a demo adapter, not a production one: a crash between Shopify creating the order and Sutra saving the proof could produce a duplicate on retry, so it does not claim production idempotency.

## 7. The NANDA registry and the plugin

```powershell
$env:SUTRA_PUBLIC_URL = "https://sutra-gmp.vercel.app"
npm run nanda -w cli -- check
```

Fetches and validates our own well-known URLs. A loopback or private-network base is refused for any real submission — both registries probe whatever URL they're given and badge the listing permanently.

```powershell
curl.exe -s https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85
```

Re-check before quoting the entry's `reachable` field — it has been `null` (not `true`) every time this has been checked. `npm run nanda -w cli -- skill-submit --dry-run` previews the exact submission body without submitting.

**Do not run `npm run nanda -w cli -- index-register`.** NANDA Index v2 registration needs a DNS TXT record on a domain the team controls; a `.vercel.app` subdomain can't carry one, and it isn't what the prize judges anyway — see [`NANDA.md`](NANDA.md).

**The plugin's live check against a real engine:**

```powershell
Set-Location nanda-town-prava
$env:GMP_API = "https://engine-production-e6fa.up.railway.app"
$env:ENGINE_API_TOKEN = "<from secrets.env>"
.\.venv\Scripts\python.exe scripts\live_check.py
Set-Location ..
```

Exercises `live` mode over a real socket (the test suite otherwise injects fake transports), grading itself differently for `mock` vs. a real key, and cancels every group it created before exiting. It never prints `ENGINE_API_TOKEN`. Transcripts are in [`NANDA.md`](NANDA.md) §2.

## 8. Screenshots

`docs/screenshots/capture.mjs` opens the deployed product in headless Chrome, registers a disposable account, and drives the UI to capture a product search and link split, a reconciled bill split, a group mid-flight, the individual decision page and terminal receipt, a plan with real OpenStreetMap venues, and the NANDA discovery page. Run metadata lands in `docs/screenshots/run-report.json`.

```bash
node docs/screenshots/capture.mjs
node docs/screenshots/prepare-readme.mjs
```

Override the target or browser with `SUTRA_URL=http://localhost:3000 CHROME_PATH=/path/to/chrome`. `prepare-readme.mjs` crops the numbered captures into the `readme-*.png` files the root README uses, changing no text, number, status, or browser state. The Chrome extension is the one deliberately-skipped artifact — it can't be captured honestly without loading it unpacked in a real browser on a real merchant page, and a faked browser frame would be false. The bill flow is deliberately captured on `at_venue`: exact agreement and a signed receipt, `charged_amount = 0`.

## 9. When things break

**Railway's API flakes mid-deploy.** Just re-run `npx --yes @railway/cli up --ci --service engine`. If it fails repeatedly, check `deployment list` and `logs --lines 200` (always pass `--lines` — without it, `logs` streams forever and hangs the session).

**"Multiple services found."** You omitted `--service engine`.

**Vercel is serving a stale build.** Either auto-deploy didn't fire, or you deployed but never moved the alias. Run both steps from §3 in order, and confirm with `vercel alias list` / `vercel ls`. Check you're not looking at a browser cache — use a private window.

**"missing or invalid bearer token" from the web app.** Vercel's `ENGINE_API_TOKEN` doesn't match Railway's. Compare `vercel env ls production` against `railway variable list --service engine`, make them identical, redeploy web.

**The engine is running an old build.** A feature that works locally 404s in production. Either Railway's auto-deploy trigger is off, or the CLI exited 1 silently — both leave a stale process running happily. Check `/health`'s `uptime_s`, then `npm run e2e:auth` against the deployed `GMP_API` to prove the specific feature; redeploy per §3.2 and re-check.

**Overpass is rate-limiting (empty venue board).** This is working as designed — a 429/504, or a 200 with a `remark` and no elements, is treated as a failure and rendered with its reason, never as "nothing near you." Wait a minute and press refresh (an explicit action, since it spends someone's rate limit; an empty refresh preserves the previous board). Check last-observed reachability at `/api/v1/places/status`, or use the product-search/pasted-URL path during a demo, which never touches Overpass.

**A Prava session expired.** Sessions expire roughly 15 minutes after creation — that's why they're minted lazily on first open, not at group creation. Don't debug it; create a fresh group with `npm run e2e:proof -- --watch` and open the new URL promptly. Remember the sandbox's daily transaction budget; don't burn it retrying.

**A member approved but the group hasn't moved.** Prava has no webhooks — approval is detected by a poller listing mandates for the member's `customer_id` on a 1.5-second cycle, resuming on boot via `recoverOnBoot()` after any restart. Check the engine is alive and recently booted, then read the group state directly. A group stuck in `committing` is not necessarily a failure — unknown charge state is never treated as failure, and the poller re-enters the commit under the same idempotency reference. Give it a cycle.

**The engine won't boot: `DB_PATH is required in production`.** `NODE_ENV=production` with no `DB_PATH` set — this guard exists so a missing volume fails loudly instead of writing to a disk that vanishes on the next deploy. Fix from PowerShell (never Git Bash, which mangles the path): `npx --yes @railway/cli variable set DB_PATH=/data/gmp.db --service engine`, then confirm the volume is actually mounted at `/data` in the dashboard.

**Receipts stopped verifying after a redeploy.** `ENGINE_SIGNING_SEED` changed or was never set, so a new Ed25519 key was minted at boot. Compare `receipt_public_key` in `/health` against its last-known value. Restore the original seed from `secrets.env` and redeploy — receipts signed under a different key cannot be recovered, since the signature is over the content and the key is gone.

**Tests fail with "Cannot read properties of undefined (reading 'config')."** You're in Git Bash — see §0.

**After an interrupted session, verify before trusting the tree.** `git status`, `git log --oneline -5`, `npm test -w engine`. Read the diff of the most recent commit before trusting it, especially anything touching validation or security-relevant checks — the dangerous case is not a failing test, it's a change that passes and is wrong. Concretely: a seat-attachment check should refuse attaching somebody else's **account** without their agreement, while still allowing a **bare name** to make a link-only participant — the commonest real case, the person at the table who will never sign up. A rewrite that refuses any seat without a `user_id` looks like a tightened rule but silently deletes that case.

## 10. Health checks — the five-minute sweep

```powershell
curl.exe -s https://engine-production-e6fa.up.railway.app/health
curl.exe -s -o NUL -w "web %{http_code}`n" https://sutra-gmp.vercel.app
curl.exe -s -o NUL -w "skill %{http_code}`n" https://sutra-gmp.vercel.app/skill.md
curl.exe -s -o NUL -w "card %{http_code}`n" https://sutra-gmp.vercel.app/.well-known/agent-card.json
curl.exe -s -o NUL -w "facts %{http_code}`n" https://sutra-gmp.vercel.app/.well-known/agent-facts.json
curl.exe -s -o NUL -w "catalog %{http_code}`n" https://sutra-gmp.vercel.app/api/agents
curl.exe -s -o NUL -w "places %{http_code}`n" https://sutra-gmp.vercel.app/api/v1/places/status
```

All seven should return 200, and `/health` should report `"prava_adapter":"sandbox"`. Then the local suites — expect all files passing, believe the counts they print:

```powershell
npm test -w engine
npm run test:widget
npm run chaos       # expect GREEN WALL
npm run build        # expect a successful build; route count moves as routes are added
```
