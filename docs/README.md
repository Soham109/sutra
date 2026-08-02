# Documentation index

Start with [`../AUDIT.md`](../AUDIT.md) for where the project actually stands, then
[`../TASKS.md`](../TASKS.md) for what to do next.

## Start here

| Document | One line |
|---|---|
| [`../AUDIT.md`](../AUDIT.md) | The complete audit and the current state: what is built, what is broken, what is claimed versus what is true, with the evidence for each. |
| [`../TASKS.md`](../TASKS.md) | The prioritised work queue. One task at a time, in order. |
| [`../README.md`](../README.md) | The front door: what this is, how the money moves, what the product does, where it honestly stops, and a 60-second quickstart. |
| [`HACKATHON.md`](HACKATHON.md) | The event, the deadline with timezone arithmetic, the tracks and prizes, what each judging criterion wants, the submission checklist, and the pre-existing work disclosure. |
| [`RUNBOOK.md`](RUNBOOK.md) | Operations: every npm script, how to deploy each half, every environment variable, how to rotate a key, and what to do when something breaks. |
| [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md) | Permanent engineering knowledge: the nine invariants that must not break, the Prava integration traps, and the file ownership map. Read before changing anything in `engine/src/`. |

## The product and the protocol

| Document | One line |
|---|---|
| [`REFERENCE.md`](REFERENCE.md) | The long tail the front page should not carry: the full endpoint inventory, the 36-case failure taxonomy, built vs designed-not-built, and the pre-existing-work disclosure. |
| [`REPO-MAP.md`](REPO-MAP.md) | What the code actually contains, with a file:line on every claim — the data model, the state machines, and the four main request flows traced through real function calls. Written to be checked, not trusted. |
| [`../spec/PROTOCOL.md`](../spec/PROTOCOL.md) | GMP/1 formally: objects, state machines, the decision, the commit saga, crash recovery, receipts, and the settlement rails. |
| [`COORDINATION.md`](COORDINATION.md) | The layer above the protocol: the signal model, common-window sweeping, spherical geometry, and the exact arithmetic behind every option's score. |
| [`../spec/AP2-EXTENSION.md`](../spec/AP2-EXTENSION.md) | A positioning memo against AP2 v0.2: where the multi-principal gap is and what an extension would need. |
| [`PRODUCT_ARCHITECTURE.md`](PRODUCT_ARCHITECTURE.md) | The boundary between web discovery, extension import, merchant checkout, accounts and mobile. |
| [`PRODUCT_AND_MOBILE_ROADMAP.md`](PRODUCT_AND_MOBILE_ROADMAP.md) | Product, platform and mobile roadmap, each item marked built / partly built / not built. |
| [`SHOPIFY_FLOW.md`](SHOPIFY_FLOW.md) | The Shopify path end to end: storefront search, the POS split-tender rail, and the checkout handoff boundary. |

## Pitch and evidence

| Document | One line |
|---|---|
| [`PITCH.md`](PITCH.md) | The argument, compressed: the problem, the demo beats, and the lines worth saying out loud. |
| [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md) | The NANDA Town evidence pack: live-mode transcripts, the baseline diff against `prepaid_credits`, the SkillMD submission, and what was not verified. |
| [`NANDA-REGISTRY.md`](NANDA-REGISTRY.md) | What the two NANDA registries actually are, what we submitted where, and why Index v2 registration is not the prize. |
| [`AGENT-MESH.md`](AGENT-MESH.md) | The agent mesh: delegate answering, open questions, and the MCP tools that expose them. |
| [`SCREENSHOTS.md`](SCREENSHOTS.md) | The screenshot set, how it is captured, and which shot is the Devfolio cover image. |
| `../film/DEMO_RECORDING.md` | The demo recording plan: the shot list, what has to be on screen, and what must never be. Developed locally and gitignored — the finished video is uploaded to the submission rather than shipped in the repository. |

## Integrations

| Document | One line |
|---|---|
| [`../nanda-town-prava/README.md`](../nanda-town-prava/README.md) | The NANDA Town payments plugin: why a card rail cannot be a pooled ledger, and what it honestly cannot do. |
| [`../extension/README.md`](../extension/README.md) | The Chrome extension: what the page detector can see, and why its permissions are the ones they are. |
| [`../SKILL.md`](../SKILL.md) | The agent-facing contract over plain HTTP. |
| [`../openapi.json`](../openapi.json) | Our copy of Prava's published API specification. |

## Where the code lives

| Concern | Path |
|---|---|
| The commit saga | [`../engine/src/service.ts`](../engine/src/service.ts) |
| Settlement rails and the honesty model | [`../engine/src/rails.ts`](../engine/src/rails.ts) |
| Receipts and offline verification | [`../engine/src/receipt.ts`](../engine/src/receipt.ts) |
| Boot, adapter selection, `/health` | [`../engine/src/server.ts`](../engine/src/server.ts) |
| The approval poller (Prava has no webhooks) | [`../engine/src/poller.ts`](../engine/src/poller.ts) |
| Pure protocol core: shares, policy, backstops, auctions | [`../engine/src/protocol/`](../engine/src/protocol/) |
| Prava adapter, offline mock, chaos proxy | [`../engine/src/prava/`](../engine/src/prava/) |
| Coordination: signals, time, geo, ranking | [`../engine/src/plan/`](../engine/src/plan/) |
| OpenStreetMap venue discovery | [`../engine/src/places/`](../engine/src/places/) |
| Bill parsing and reconciliation | [`../engine/src/bill/`](../engine/src/bill/) |
| Free text into slots | [`../engine/src/agent/extract.ts`](../engine/src/agent/extract.ts) |
| Routes: protocol / product / coordination | [`../engine/src/routes.ts`](../engine/src/routes.ts) · [`../engine/src/routes-v2.ts`](../engine/src/routes-v2.ts) · [`../engine/src/routes-plan.ts`](../engine/src/routes-plan.ts) |
| Discovery documents: AgentCard, AgentFacts, catalog, SkillMD | [`../engine/src/discovery/`](../engine/src/discovery/) |
| The Next.js proxy in front of the engine | [`../web/src/app/api/[...path]/route.ts`](../web/src/app/api/[...path]/route.ts) |
| The universal cart detector, shared by widget / bookmarklet / extension | [`../widget/detect.js`](../widget/detect.js) |
| NANDA publication tooling | [`../cli/src/nanda.ts`](../cli/src/nanda.ts) |
| Chaos harness | [`../chaos/src/run.ts`](../chaos/src/run.ts) |
| End-to-end proofs | [`../e2e/`](../e2e/) — `plan-flow.ts` · `product-flow.ts` · `sandbox-smoke.ts` · `sandbox-proof.ts` · `auth-check.ts` · `agent-mesh.ts` |
