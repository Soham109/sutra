# Documentation

| Document | What it is | Read it when |
|---|---|---|
| [`../README.md`](../README.md) | the front door: what this is, where the money flows, quickstart, the full endpoint list, the failure taxonomy, and the built / not-built split with real test output | you are starting |
| [`../spec/PROTOCOL.md`](../spec/PROTOCOL.md) | **GMP/1 formally.** Objects, state machines, the decision, the commit saga, crash recovery, the receipt and its verification rules, the two settlement rails (§10), and the coordination phase as an explicitly non-protocol layer (§11) | you want to know what the protocol guarantees |
| [`COORDINATION.md`](COORDINATION.md) | **the layer above the protocol.** The signal model, the boundary sweep for common time windows, the spherical geometry, and the five ranking factors with their exact weights, curves, and treatment of a missing signal | you want to check the arithmetic behind an option's score |
| [`../spec/AP2-EXTENSION.md`](../spec/AP2-EXTENSION.md) | a positioning memo against **AP2 v0.2**: where the multi-principal gap is, why `payment.budget` is the nearest existing analogue and why it is not enough, and what an extension would need | you care how this relates to the standards |
| [`PRODUCT_AND_MOBILE_ROADMAP.md`](PRODUCT_AND_MOBILE_ROADMAP.md) | product, platform and mobile roadmap, with each item marked built / partly built / not built, and the **non-negotiables** that survived contact with an implementation | you want to know where this goes next |
| [`../SKILL.md`](../SKILL.md) | the agent-facing contract over plain HTTP | you are an agent, or writing one |
| [`../nanda-town-prava/README.md`](../nanda-town-prava/README.md) | the NANDA Town payments plugin: why a card rail cannot be a pooled ledger, and what it honestly cannot do | you are looking at the NANDA integration |
| [`../extension/README.md`](../extension/README.md) | the Chrome extension: what the page detector can see, and why its permissions are the ones they are | you want the browser surface |
| [`../openapi.json`](../openapi.json) | our copy of Prava's published API specification; the client's header comment records it as byte-identical to the live one on 2026-08-01 | you are checking our integration against theirs |

## Where the code lives

| Concern | Path |
|---|---|
| The commit saga | [`engine/src/service.ts`](../engine/src/service.ts) |
| Settlement rails | [`engine/src/rails.ts`](../engine/src/rails.ts) |
| Receipts and verification | [`engine/src/receipt.ts`](../engine/src/receipt.ts) |
| Pure protocol core (shares, policy, backstops, auctions) | [`engine/src/protocol/`](../engine/src/protocol/) |
| Prava adapter, mock, chaos proxy | [`engine/src/prava/`](../engine/src/prava/) |
| Coordination: signals, time, geo, ranking | [`engine/src/plan/`](../engine/src/plan/) |
| OpenStreetMap venue discovery | [`engine/src/places/`](../engine/src/places/) |
| Bill parsing and reconciliation | [`engine/src/bill/`](../engine/src/bill/) |
| Free text → slots | [`engine/src/agent/extract.ts`](../engine/src/agent/extract.ts) |
| Routes: protocol / product / coordination | [`routes.ts`](../engine/src/routes.ts) · [`routes-v2.ts`](../engine/src/routes-v2.ts) · [`routes-plan.ts`](../engine/src/routes-plan.ts) |
| Discovery documents (AgentCard, AgentFacts, catalog, SkillMD) | [`engine/src/discovery/`](../engine/src/discovery/) |
| Chaos harness | [`chaos/src/run.ts`](../chaos/src/run.ts) |
| End-to-end proofs | [`e2e/plan-flow.ts`](../e2e/plan-flow.ts) · [`e2e/product-flow.ts`](../e2e/product-flow.ts) · [`e2e/sandbox-smoke.ts`](../e2e/sandbox-smoke.ts) |
