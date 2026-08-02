# Documentation index

Start with [`../README.md`](../README.md) for what this is and how the money moves, then [`TRACK-EVIDENCE.md`](TRACK-EVIDENCE.md) for the judging evidence, track by track.

| Document | One line |
|---|---|
| [`../README.md`](../README.md) | The front door: what this is, how the money moves, what the product does, where it honestly stops, and a 60-second quickstart. |
| [`EXPLANATION.md`](EXPLANATION.md) | The zero-knowledge explainer — assumes no prior knowledge of payments infrastructure or agent protocols. |
| [`TRACK-EVIDENCE.md`](TRACK-EVIDENCE.md) | Track-by-track judging evidence, every claim sourced to a file, line, or live URL. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the system is built: the repo and engine module map, the data model, the four request flows, the coordination layer's math, the delegate mesh, the Shopify boundary, and what's built vs. roadmap. Written to be checked, not trusted. |
| [`NANDA.md`](NANDA.md) | The NANDA Town payments plugin: the thesis, live-mode evidence, the baseline diff, the registry status, and what was not verified. |
| [`RUNBOOK.md`](RUNBOOK.md) | Operations: every npm script, how to deploy each half, every environment variable, how to rotate a key, and what to do when something breaks. |
| [`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md) | Permanent engineering knowledge: the invariants that must not break, the Prava integration traps, and the file ownership map. Read before changing anything in `engine/src/`. |
| [`REFERENCE.md`](REFERENCE.md) | The long tail: the full endpoint inventory, the 36-case failure taxonomy, built vs. designed-not-built, and the pre-existing-work disclosure. |
| [`BUSINESS-CASE.md`](BUSINESS-CASE.md) | The commercial argument, argued honestly: unit economics, the wedge, the competitive landscape, and what would kill it. |
| [`../spec/PROTOCOL.md`](../spec/PROTOCOL.md) | GMP/1 formally: objects, state machines, the decision, the commit saga, crash recovery, receipts, and the settlement rails. |
| [`../spec/AP2-EXTENSION.md`](../spec/AP2-EXTENSION.md) | A positioning memo against AP2 v0.2: where the multi-principal gap is and what an extension would need. |
| `../film/DEMO_RECORDING.md` | The demo recording plan. Developed locally and gitignored — the finished video is uploaded to the submission rather than shipped in the repository. |

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
