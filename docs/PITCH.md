# Sutra pitch and claim guide

## Two-minute pitch

Splitting a bill is easy. Splitting a purchase is not. When four people buy one thing, one
person becomes the lender: they place the order, front the total and chase everyone later.
Payment agents inherit the same one-user, one-authorization assumption.

Sutra coordinates the group before money moves. A sentence becomes private participant links for
availability, location, budget and constraints; the shared board reveals who answered, not their
budget. Real OpenStreetMap venues rank on inspectable factors. The model may structure the
sentence, but never invents a venue, price or payment fact.

Sutra then searches configured public Shopify stores, resolves a public URL, or imports the
active product/cart with its click-invoked Chrome extension. It preserves merchant, variant,
price and provenance. Import is not checkout: the extension never inherits login or orders.

The group assigns exact items and fees with payer, sponsor, backstop and observer roles. Policies
include everyone, quorum, weighted, required and veto. Each person sees their items, share, cap,
cart hash and rule. Planning answers never become payment consent.

GMP/1 binds those approvals to one decision. On a supported Prava rail, approval is permission,
not a charge. After policy passes, person-scoped charges execute sequentially with durable
idempotency. Unknown is reconciled before retry; an irreversible mixed result remains partial.
Sutra pools no money and the organizer gains no authority over another card.

Every rail says what happened. A reconciled restaurant bill reports zero charged; Shopify POS is
a cashier handoff. Our configured development-store proof mirrors completed **test** approvals
through the Admin API into a valid `test: true` order, one labeled test transaction per person
and a delivery address. No money moves, and it is not multi-card Checkout.

Every terminal group ends with an Ed25519-signed, hash-chained, rail-aware receipt. The same
protocol ships as a real `nest.plugins.payments` NANDA Town plugin, alongside live A2A AgentCard,
AgentFacts, AI Catalog and SkillMD discovery artifacts. The moat is multi-principal consent,
safe recovery and portable evidence—not bill arithmetic.

## Live-demo spine

1. **Product depth:** dashboard → pending decisions, card exposure, accounts/friends/circles,
   notifications, live group thread and prior receipts.
2. **Plan:** sentence → private participant answers → real OpenStreetMap venues re-rank with
   inspectable reasons while budgets remain private.
3. **Discover:** public Shopify shelf → product/variant facts, merchant, stock signal, provenance
   and confidence.
4. **Import:** click the load-unpacked extension on an active product or full cart. Show every
   detected line and quantity, detection strategy, participants and policy. Hold on the explicit
   boundary: the extension receives no login, address, card or checkout authority.
5. **Shape:** assign items and fees in minor units; show payer, sponsor, backstop and observer,
   then `all_of`, quorum, weighted, required-member and veto policies.
6. **Two-device payment proof:** use `npm run e2e:proof -- --watch`; open its shared join link on
   two phones, show the first participant's capped Prava sandbox approval, the board waiting at
   `1/2`, then the second participant's independent approval and the sequential committed result.
   The shared test card proves two human approvals and two person-scoped mandates, not two physical
   cards or production money.
7. **Failure semantics:** show the crash/idempotency and partial-outcome tests, or their receipt
   states; never describe sequential card charges as atomic.
8. **Bill:** paste the known receipt text, show printed-total reconciliation, assign lines and
   hold on `charged_amount = 0` for the at-venue rail.
9. **Evidence:** show the Prava sandbox receipt with participant references, rail, hash chain and
   Ed25519 verification; then the deterministic NANDA scene with its persistent
   `SIMULATED · NO REAL CARD CHARGED` label and AgentCard/AgentFacts/AI Catalog/SkillMD artifacts.
10. **Optional merchant mapping:** only when a development store is already configured, append the
    Shopify `test: true` Admin order. It is not required for the main proof.

## Exact claim card

### Safe claims

- “Sutra turns private group constraints into an explainable shortlist grounded in real place
  and merchant data.”
- “Sutra searches configured public Shopify storefronts and can import the active product/cart
  page after a user click.”
- “Sutra computes exact minor-unit allocations, supports payer/sponsor/backstop/observer roles,
  and binds every consent to a cap, cart hash and group policy.”
- “The charge saga is sequential, idempotent and crash-resumable; unknown is reconciled and
  irreversible mixed outcomes remain partial.”
- “Shopify POS itself supports cashier-operated split payments. Sutra prepares an agreement for
  that handoff; it does not connect to the terminal.”
- “The configured development-store adapter creates a real Shopify **test order record** with
  `test: true`, a test transaction record per participant and a delivery address.”
- “That Shopify proof moves no real money and does not exercise multi-card Shopify Checkout.”
- “GMP/1 already supplies the group-side protocol. Production online completion additionally
  needs a merchant adapter for a stable quote, order reservation, captures and reconciliation.”
- “The NANDA plugin is discoverable through the real `nest.plugins.payments` entry point; the
  default scene is deterministic simulation and labels its receipts `simulated: true`.”
- “Every terminal receipt records the rail and the amount the engine actually moved, including
  zero.”

### Claims to avoid

| Do not say | Say instead |
|---|---|
| “Charges are atomic,” “the same moment,” or “everyone pays or nobody does.” | “Everyone approves before sequential charging starts; idempotent recovery and explicit partial outcomes handle failures.” |
| “Sutra integrates with Shopify POS.” | “Sutra prepares the exact split for a cashier-operated Shopify POS handoff.” |
| “Shopify accepted four cards online.” | “The Admin API mirrored four labeled test outcomes into one `test: true` development-store order.” |
| “The Shopify order proves payment.” | “It proves order/transaction mapping in a test store; every transaction is test-only and no money moved.” |
| “Prava is built on Shopify.” | “Prava payment credentials, Shopify commerce APIs and Sutra coordination are separate layers.” |
| “The extension can order from any merchant.” | “It can detect/import many public pages; automatic ordering needs a merchant-specific adapter and authentication.” |
| “Nobody fronts money” on an ordinary online handoff. | “No fronting is achievable on supported direct-payment or merchant-adapter rails; a one-card checkout still has a payer.” |
| “The bill scanner always works.” | “Pasted text is deterministic; photo transcription is available when vision is configured.” |
| “The NANDA scene charged real cards.” | “The default NANDA scene simulates the protocol; live mode creates hosted approvals and waits for humans.” |
| “Every receipt proves payment.” | “Every terminal receipt proves the recorded decision and rail; only non-zero `charged_amount` proves money the engine moved.” |

## Roadmap sentence for judges

> We have built the hard group side: private constraints, exact allocation, independent caps,
> multi-principal policy, crash-safe execution and signed evidence. The development-store bridge
> proves how N participant outcomes map into one merchant order, but it is deliberately test-only.
> Production online completion requires a merchant-supported adapter for stable quoting,
> reservation, real capture, order reconciliation, refunds and fulfilment events.
