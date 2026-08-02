# NANDA: the plugin, the evidence, the registry

This document is scoped to two different things that share a name. The **$1,000 "Best Prava Adapter for the NANDA Town" prize** is judged on the Python plugin in [`nanda-town-prava/`](../nanda-town-prava/) — §1–6 below. The **NANDA Index / AgentFacts registry** is a separate discovery surface, not the prize criterion — §7–9. Do not conflate them; §7 exists specifically to stop that conflation.

## 1. What the plugin is

NANDA Town's bundled `payments` plugin, `prepaid_credits`, is a pooled ledger: `pay()` is two lines that debit one simulated agent's balance and credit another's inside the scenario. It models a closed toy economy, not a payment — value never crosses a boundary, so conservation is trivial.

`nanda-town-prava` inverts that. It registers as a real `nest.plugins.payments` entry point (`nanda_town_prava.plugin:PravaMandates`, declared in `pyproject.toml`) and charges real cards on the card network through Prava mandates and the GMP/1 engine. `pay()` never moves pooled funds: each principal's consent mints a merchant-scoped, amount-capped mandate, charged once. An agent cannot pay another agent — there is no rail for it, since the money is never in the simulator, it's at the merchant — and `balance()` returns remaining authorization headroom, not custody of anything.

```
$ nest plugins list payments
payments:
  - prava_mandates
  - prepaid_credits
```

`nanda_town_prava/plugin.py` is the `Payments` implementation and `pay_group()`; `client.py` is the stdlib-only HTTP client for the GMP/1 engine; `_simulator.py` is the in-process engine that makes `simulated` mode work with no network.

## 2. `live` mode against a real engine

Until this evidence was gathered, `live` mode was covered only by tests injecting a fake transport — `GmpHttpClient`'s request path had never touched a real socket. `scripts/live_check.py` fixes that: it reads `GET /health` for which Prava adapter the engine is running and grades itself accordingly, because a real key and the mock adapter have genuinely different correct answers.

**What broke the first time, and the fix.** The first run against the deployed engine, then holding `PRAVA_ENV=mock`, found a real bug: a four-principal `quorum(3)` group never committed. The event log showed why — three members approved, the fourth was dropped, the cart re-divided across the survivors (4650 → 6200 each), and 6200 exceeded the 4883 cap those three had already consented to. This is the **requote cascade** (GMP/1 §4.1): consent can't stretch, so the engine cancelled their mandates and put them back to `viewed` at a new cap, waiting for a fresh passkey tap. The plugin had opened each mandate session exactly once and then polled a group that could never move again — invisible before this run because `_simulator.py` doesn't implement requote rounds at all. Only a real engine could find it. The fix made session-minting re-entrant (any member reported as `invited`/`viewed` gets a session minted or re-minted, on any polling pass), made the internal headroom reservation delta-based and idempotent instead of double-debiting on repeated polls, and corrected the capped-amount calculation to match what the card network is actually holding. Two regression tests on a fake engine that reproduces the cascade now cover it. A second bug found in the same run — `conservation_report()` counting phantom drift from agents belonging to a different handle's ledger — was fixed by scoping it to the ledger the handle can actually see.

**Against a real Prava sandbox key.** The deployed engine was then switched to a real Prava **sandbox** key, which is the run that shows the plugin trying to approve a mandate and failing to. A single-principal `pay()` and a four-principal `pay_group()` both minted real hosted sessions at `sandbox.collect.prava.space` and stayed `PENDING` — correctly, since nothing approved them. The two lines that matter:

```
approve_member(mi_01KYYD9JBBA03254W5E5X0N0M6) -> False
[PASS] the plugin cannot approve a real mandate — False
```

`approve_member()` looks for a `/mock/pay/` marker in the approval URL; against `sandbox.collect.prava.space` that marker is absent, so it returns `False` without sending a request at all. There is no code path in this package that can approve a real mandate — only a human's passkey can, and that is the security property, not a gap. A pre-capture `refund()` in the same run made a real `POST /v1/groups/{id}/cancel` call against the deployed sandbox-backed engine and genuinely cancelled the mandate session; nobody was ever charged. Conservation invariants (`authorization_conserved`, `no_pooled_funds`, `settlement_conserved`, `headroom_consistent`) reported green throughout.

**Mock adapter, full commit path.** Since the deployed engine now holds a real key, the charging half — which needs an adapter that can stand in for the passkey tap — was run against a local engine on `PRAVA_ENV=mock`, still real HTTP over a real socket, just on loopback. A single `pay()` committed and charged; a four-principal `pay_group()` committed with all four `charged`; the `quorum(3)`-plus-requote scenario committed after one requote round, with `requote_rounds: {"Soham": 1, "Arsh": 1, "Dev": 1}` recorded by the plugin itself; and a post-capture `refund()` correctly raised `RefundNotSupportedError`, carrying the real remedy: "issue a merchant-initiated refund against the Prava transaction id on the authorization record, or have the cardholder open a chargeback." **Post-capture refunds are not supported on this rail, by design, in the underlying Prava charge primitive** — a real capture, not a delayed authorization that could simply be released.

An unknown-state check stood up a stub HTTP server on a real socket answering with a nonsense status (`quantum_superposition`/`levitating`) and separately queried a nonexistent group and an unreachable engine: all three resolved to `PENDING`, never `FAILED` — an unresolved charge may well have landed, and calling it failed is how a retry becomes a double charge.

## 3. The baseline diff: `prepaid_credits` vs `prava_mandates`

The stock `marketplace` scenario — 100 agents, 10,000 ticks, seed 42 — was run once against each plugin, changing only the one `payments:` line. The resulting traces are **byte-identical**: `sha256 dd6cdb7a631e153a...` on both, reproduced again a day later with the identical hash. Every upstream validator (`marketplace_no_double_sell`, `marketplace_all_responded`, `marketplace_price_agreement`) passes identically on both, because the traces are identical — the strongest available form of "drop-in," checked rather than asserted.

What changed is only visible by reading the ledgers each plugin was left holding: the same 266 payments, the same 16,675 credits debited from buyers, and then the paths diverge completely.

```
                                          prepaid_credits   prava_mandates
value moved between agents in the sim         16,675               0
agents ending richer than they started            49               0
credits still pooled inside the simulator    100,000          83,325
value that reached a merchant outside              0          16,675
```

`prepaid_credits` conserves value *inside* the simulator — nothing reached a merchant, because there is no merchant. `prava_mandates` credits **zero** agents from another agent's payment; the pool drops because real authorization headroom was consumed by real charges, all landing at 49 real merchants outside the simulator. The plugin's own `conservation_report()` over the same run confirms `authorization_conserved`, `no_pooled_funds`, `settlement_conserved`, and `headroom_consistent`, all true.

This conservation evidence is explicitly **ours, not upstream's**: upstream's `validate_streaming_conservation` scans a trace for `payment_debited`/`payment_credited` events, and neither event kind exists in either trace — no plugin can write trace lines at all, and the validator itself isn't even in the published `nest-core` 0.1.4 package, only on unreleased git HEAD. It would pass trivially, `0 == 0`, on both plugins equally, and that pass is not claimed here.

## 4. Test suite, and the one-command scene

The local package suite has moved repeatedly during active development — 46, then 51, then 57, then 117 passed with 1 skip — each number superseded within the same working session by new test files landing. **The only count worth trusting is the one your own `pytest -q` prints.** `python scripts/town_scene.py` is the narrated, self-grading, no-keys-no-network demo: it now opens with an **ACT 0** that reads `importlib.metadata.entry_points(group="nest.plugins.payments")` directly — the same call NANDA Town's own `PluginRegistry` makes — to prove `prava_mandates` really is a discovered entry point (not a hardcoded fallback) and that the bundled `prepaid_credits` still resolves too, unshadowed. `python scripts/town_scene.py --mode live`, run with no `ENGINE_API_TOKEN` present (as a judge without the token would run it), correctly fails at the mandate-minting act with an honest HTTP 401 rather than skipping or faking a result — exit code 1, by design. `npm run nanda:test` and `npm run nanda:scene` from the repo root are thin wrappers around the identical `.venv` and `town_scene.py`.

## 5. Upstream contribution

The reusable adapter is submitted to NANDA Town as [`projnanda/nandatown#210`](https://github.com/projnanda/nandatown/pull/210), from the required branch `hackathon/soham109-prava-group-mandates`. Before submission it passed the exact upstream gates: `ruff check` and `ruff format --check` clean, `pyright` 0 errors/0 warnings, the full upstream `pytest -q` at 1,429 passed/1 skipped/1 deselected, and the plugin package alone at 118 passed. The PR is evidence of submission, not of merge or endorsement — those remain upstream decisions.

## 6. What we did NOT verify

This section is the reason to trust the rest of the document.

No real card was charged, anywhere. The deployed engine held a real Prava **sandbox** key and minted real hosted-ceremony sessions, but every one stayed `pending` and was cancelled — approving needs a human passkey, and nothing in this package can do that. Sandbox is not production either; the end-to-end "a card was debited and a merchant was paid" claim is verified only against `MockPrava`, the team's own simulator. No human ever approved a mandate in any run recorded here — the passkey ceremony is the one step this package structurally cannot exercise. The requote cascade is verified on the mock adapter and in tests, not on a real rail, since a real requote needs two rounds of human taps. `_simulator.py` is not the engine: it implements a subset of GMP/1 — no requote rounds, no deadline policies, no sealed-bid auctions, no FX display — and two further divergences were found in this work: it gives a `backstop` member a zero share where the real engine gives it a real one, and it has no `at_venue` rail. Credits are not dollars — `NANDA_PRAVA_CREDIT_MINOR_UNITS` defaults 1:1 as a declared assumption. The §3 baseline-diff run is `simulated` mode, not `live` — 266 payments against a real engine is not something to point at a rate-limited sandbox. Upstream's adversarial payments validators were never run against real upstream code, because they don't exist in the released `nest-core` package. And agent-to-agent payment is impossible with this plugin, by design — a scenario whose premise is agents trading value with each other is modelling something this rail cannot represent; that is a limitation, and it is the same sentence as the thesis.

## 7. Two different registries — do not conflate them

| | What | Verified live |
|---|---|---|
| NANDA Index | The canonical org-level registry (`api.nandaindex.org`) the arXiv papers describe | Reachable; **sutra is not in it** |
| NANDA Town SkillMD registry | A lighter, no-auth listing at `nandatown.projectnanda.org/api/skills` | Reachable; sutra has one entry |
| NANDA Town, the Python simulator | `nest-core`/`nandatown` — the actual $1,000 prize track | §1–6 above |

Project NANDA (MIT Media Lab, Prof. Ramesh Raskar) frames itself as infrastructure for an "Internet of AI Agents," with agent-mediated commerce named explicitly as an in-scope research theme — the commerce framing Sutra is built around is genuinely inside NANDA's stated scope. The technical architecture, per the NANDA Index papers (abstract-level only; the full PDF bodies would not render through available tooling), pitches the Index as a "DNS for agents": a resolver mapping a handle to a cryptographically verifiable **AgentFacts** record, federating NANDA-native and third-party registries into one "quilt-like" discovery surface.

**We are not in the NANDA Index.** `GET /api/v1/search?q=sutra` returns zero results; `GET /api/v1/index/sutra` 404s; the full index (250 org records) was pulled and confirmed not to contain `sutra`. Registration (`cli/src/nanda.ts`'s `indexRegister()`) needs a NANDA account and then a **DNS TXT domain-verification challenge** on a domain the registrant controls — confirmed real by fetching the Index's own OpenAPI document. `sutra-gmp.vercel.app` is a subdomain of `vercel.app`, which this team does not control the zone for, so the challenge cannot be completed. This is also, separately, not what the prize judges.

**We are in the SkillMD registry, with an honest `null` badge.** Entry `47063b5f-5000-4c03-8f33-c98555618f85`, name `sutra — group checkout (GMP/1)`, `source_url` the deployed `/skill.md`, created `2026-08-01T13:29:23.374Z`. Its `reachable` field is **`null`**, not `true` — the registry has not recorded a probe of its own, even though all five declared endpoints return 200 when fetched directly. **Do not claim a green badge.** Registry-wide count: 273 entries, unchanged and consistent across repeated checks. The discovery chain the entry points at is all live: `.well-known/agent-facts.json`, `.well-known/agent-card.json`, `/api/agents`, `/skill.md`, `/health` all return 200.

## 8. AgentFacts, checked against the real spec

The schema (`github.com/projnanda/agentfacts-format/agentfacts_schema.json`) was re-downloaded and byte-diffed against the vendored fixture used in tests — identical, no drift. Every schema-**required** field is present in Sutra's own document (`id`, `agent_name`, `label`, `description`, `version`, `provider.name`/`.url`, `endpoints.static`, `capabilities.*`, six `skills[]` entries each with all required sub-fields). The gaps are entirely in the **optional** trust vocabulary: `provider.did` is absent, and the whole `evaluations` (`performanceScore`, `auditTrail`, …) and `certification` blocks are absent — deliberately, since there is no real audit or uptime history to report, and this codebase's own standard ("never invent a price," "no claim without a source") argues directly against filling those slots with a plausible-looking synthetic number. The schema has no payment vocabulary at all — confirmed by reading every property — so payment facts live in a separately namespaced, explicitly labelled `x-payments` extension (`"proposal": "agentfacts-x-payments/draft-0"`) rather than pretending to be part of the standard; the same facts are *also* declared through the A2A card's actual standardized extension mechanism, dereferenceable at `/.well-known/extensions/gmp-1.json`. `npx vitest run engine/test/discovery.test.ts` — 36/36 passing, including ajv-backed schema validation.

Scored against discovery/identity/federation/interoperability: **discovery** is real (all four documents genuinely served, reachable, schema-valid, regression-tested). **Identity** is thin — an unsigned static JSON file with a URN and a name/URL pair, no DID, no Index org record, nothing cryptographically binding it to this domain the way the Index's own DNS-TXT flow would. **Federation** is genuinely absent, checked directly: the Index's own quilt aggregation (`/api/ard/agents`) is real infrastructure — it returns real third-party entries — and Sutra is not in it, not resolvable, not searchable. **Interoperability** is the one genuinely strong piece: the `x-payments` extension and the A2A card extension are real, spec-respecting engineering that fills an actual gap (there genuinely is no payment vocabulary in AgentFacts v1) without pretending the fix is standard.

The honest verdict: nothing here is fabricated — the `null` is reported as `null`, the Index absence is reported as absence — but this layer is shallow-real, not deep-real. It correctly serves a spec-valid document and lists it in a lightweight directory; it does not reach NANDA's actual differentiator, verifiable federated identity anchored by the Index. The genuine, deep engagement with what Project NANDA is building is in `nanda-town-prava/` and in GMP/1 itself, not in this registry paperwork.

## 9. If there's time left

Do not spend hours on NANDA Index registration — architecturally infeasible in any short window (no domain-zone control) and not the judging criterion regardless. Re-submitting `skill-submit` to see whether `reachable` flips from `null` is optional and carries a real risk: the registry API is a bare `POST` with no visible update path, so a second submission may create a duplicate listing rather than updating the existing one. Adding `provider.did` as `did:web:sutra-gmp.vercel.app` (a real, resolvable DID method) is the cheapest change that closes an actual, verified gap rather than a cosmetic one. Do not populate `evaluations` or `certification` with invented numbers — there is no real audit or 90-day uptime history behind either, and inventing one would be exactly the kind of confident fabrication this codebase otherwise refuses.
