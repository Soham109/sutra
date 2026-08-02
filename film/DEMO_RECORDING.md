# Sutra live demo — exact recording and narration plan

This is the product-proof reel that accompanies the authored film. Target **4:20–4:40**. Record
the actions as separate clean clips, then assemble them to this timeline. The demo must remain
credible with the sound muted: every simulated or non-charging surface keeps its truth label on
screen.

## Non-negotiable language

- Card charges are **sequential**, not atomic or simultaneous. Everyone approves before charging
  starts; idempotent recovery and explicit partial outcomes handle failures.
- The Shopify development-store order and every participant transaction are `test: true`. They
  prove adapter mapping, not real payment and not multi-card Shopify Checkout.
- Shopify POS is a cashier handoff. Sutra does not connect to or observe the terminal.
- An online checkout handoff does not remove fronting when the merchant exposes only one card
  field.
- The default NANDA scene and mock Prava approvals are simulated and move no money.
- The at-venue bill rail records agreement with `charged_amount = 0`.
- Use “charged” only where the receipt records money the engine actually moved. For mock/test
  footage, keep **TEST / SIMULATED · NO REAL MONEY** visible even when the state machine says
  charged.

## Recommended main demo — Shopify product, two Prava approvals, one Shopify TEST order

Use this as the final payment proof. The development-store adapter is configured and the products
already exist, so Shopify is now part of the main story rather than a setup appendix.

### What to have open before recording

1. Sutra **Find**, with **Listening Room — Studio Headphones** (₹24,900) selected from
   `sutra-agzdw2mf.myshopify.com`.
2. The group board on desktop.
3. Soham's approval link on Phone A and Arsh's approval link on Phone B.
4. Shopify Admin → Orders in a separate signed-in tab. Do not show app credentials or settings.

### Exact story to show

1. Hold on the real Shopify product facts: title, variant, price, currency and merchant source.
2. Click split and create an `all_of` group for Soham and Arsh.
3. Show both exact shares and caps before either person approves.
4. On separate devices, let each person complete their own Prava sandbox approval.
5. Return to the board and show that one approval cannot commit the other person's share.
6. After both are approved, show the committed signed receipt.
7. Enter the fictional delivery address and click **Create valid Shopify test order**.
8. Hold on the proof card, then click **Verify in Shopify admin**.
9. In Shopify Admin, show the `Test` marker, exact total, address and one labeled test transaction
   per participant.

Say: “Shopify supplied the real product and now receives one coherent test order. Sutra and Prava
preserve who approved each capped share. This is test-only integration proof—not multi-card
Shopify Checkout, and no real money moved.”

## Secondary proof — two devices, real Prava sandbox without Shopify

### What this proves

- two different participant sessions are created through the real Prava sandbox API;
- each person sees only their own items, share and network-enforced cap;
- each person completes their own hosted approval ceremony on their own device;
- Sutra observes both mandates becoming active, applies the group policy and executes the two
  person-scoped sandbox charges sequentially;
- the final receipt records both outcomes, transaction references, rail, hash chain and signature.

The team currently has one Prava sandbox test card. Using it on both devices proves **two separate
human approvals and two separate participant mandates**, not two different physical cards. Say
exactly that. Sandbox value is not production money.

### Private setup — do not record this

The deployed engine is already configured with `PRAVA_ENV=sandbox`. Retrieve
`ENGINE_API_TOKEN` from the Railway engine service, then enter it without echoing or saving it in
shell history:

```zsh
read -s "ENGINE_API_TOKEN?Paste Railway ENGINE_API_TOKEN: "
export ENGINE_API_TOKEN
export GMP_API="https://engine-production-e6fa.up.railway.app"
npm run e2e:proof -- --watch
```

The command prints:

- the polished desktop board URL;
- one shared `2 phones` join URL;
- the two individual Sutra and Prava URLs for diagnosis;
- the polished receipt URL after the group reaches a terminal state.

Create the group only when both devices are ready. Hosted sessions expire quickly, and the team
test card has a 30-transaction daily limit.

### Device preparation

1. Desktop: open the printed `board` URL and begin screen recording.
2. Phone A and Phone B: open the same printed `2 phones` URL.
3. Phone A chooses **Soham**; Phone B chooses **Arsh**.
4. On each device, hold on the Sutra page long enough to show that participant's items, `$46.50`
   share, cap, `all_of` rule and `Prava mandates` consequence.
5. Each person taps **Approve $46.50 with passkey** and completes the hosted Prava sandbox flow.

Sandbox-only card data is in [`../docs/RUNBOOK.md`](../docs/RUNBOOK.md) section 5.3. Never show the PAN, CVV, OTP,
engine token or terminal command in the final recording.

### Exact 100-second recording

| Time | Screen | Action | Narration |
|---:|---|---|---|
| 0:00–0:10 | Desktop board | Show two people and `0/2 approved` | “One purchase normally gives one person the bill. Sutra creates one independently capped approval per person.” |
| 0:10–0:28 | Phone A | Show Soham's exact share, then tap approve | “Soham can authorize only his own $46.50. The approval happens on Prava, not inside Sutra.” |
| 0:28–0:38 | Desktop board | First member becomes approved; group waits | “One approval cannot spend for the other person. The all-of policy remains locked.” |
| 0:38–0:56 | Phone B | Show Arsh's different participant page, then approve | “Arsh independently reviews and approves the second person-scoped mandate on another device.” |
| 0:56–1:12 | Desktop board | Show committing, then both charge events | “Only after both mandates are active does Sutra commit. Charges are sequential and idempotent; failures remain explicit rather than being called atomic.” |
| 1:12–1:30 | Receipt UI | Show committed status, each amount and transaction reference | “The result is a signed, hash-chained receipt recording exactly what the Prava sandbox reported.” |
| 1:30–1:40 | Receipt/footer | Hold on rail and signature | “This is a real sandbox API and hosted-approval proof. No production money moved.” |

Record the two phones separately and place them side-by-side in the edit. Keep the desktop board
visible between approvals so the audience sees that the second person remains independent.

### If the sandbox ceremony fails during judging

Do not switch to Shopify or pretend a mock charge was real. Show a previously captured successful
sandbox clip, then run the deterministic mock path live with a persistent
**SIMULATED · NO REAL MONEY** label. The architecture, approval separation, receipt verification
and failure semantics remain demonstrable without spending the limited sandbox transaction budget.

## One-time setup

### App and verification

```bash
npm install
cp .env.example .env
npm test -w engine
npm run test:widget
npm run build
npm run nanda:test
```

Do not record until those commands pass. Start the app separately:

```bash
npm run dev
```

Use a dedicated demo database/state, an organizer account and three connected friends. Prepare
all invitation tabs before recording; never film account creation, passwords, tokens or loading
waits.

### Shopify development-store configuration — already completed

Do not redo this during recording. The store, app scopes, three published products and Railway
environment are already configured. Keep the steps below only as a recovery checklist if the
adapter ever has to be rebuilt.

1. In a Shopify development store, create one clean product with an active variant and image.
2. Create/install a custom app with an **offline Admin API token**, `write_orders` scope and the
   protected customer-data access necessary to write a shipping address.
3. Configure the root `.env`. Put the public development storefront first in `SHOPIFY_DOMAINS`:

```dotenv
PRAVA_ENV=mock
SHOPIFY_TEST_ORDER_ENABLED=true
SHOPIFY_TEST_STORE=your-store.myshopify.com
SHOPIFY_STOREFRONT_DOMAIN=your-public-storefront.example
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_redacted
SHOPIFY_API_VERSION=2026-07
SHOPIFY_DOMAINS=your-public-storefront.example,allbirds.com,gymshark.com
```

4. Restart `npm run dev`, then check:

```bash
curl -s http://localhost:4100/v1/shopify-test/status
```

Do not continue unless the response says `enabled: true`, names the correct store/front-end
domains, reports a non-production adapter and includes the no-real-money disclosure.

5. Keep Shopify Admin signed in on a separate browser profile. Never expose the `.env`, Admin API
token, app credentials or the status response in the final edit.

### Browser extension

1. Open `chrome://extensions`, enable Developer mode and load the repository's `extension/`
   directory unpacked.
2. In Sutra Settings, create a revocable extension token and enter it in the extension.
3. Open a Shopify product and add at least two lines/quantities to its cart when the storefront
   permits it.
4. The final recording may show the extension popup and current page only. Never show its token
   or Chrome storage.

### Fictional demo identity

Use obvious non-personal delivery data:

```text
Email: demo@example.com
Name: Demo Recipient
Address: 123 Test Street
City: Bengaluru
State: KA
Country: IN
PIN: 560001
```

The address is sent to the development store and deliberately not retained in Sutra. Do not use
a teammate's, judge's or customer's real address.

### Capture settings

- 1920×1080, 100% browser zoom, light theme, hidden bookmarks bar.
- Disable notifications, password-manager prompts and unrelated extensions.
- Keep the browser at one consistent size; crop terminal and Shopify Admin to the same frame.
- Record each clip twice. Start two seconds before the action and hold the result three seconds.
- Record clean screen footage first and voiceover separately. Do not narrate while clicking.
- Use pasted bill text unless `OPENAI_API_KEY` is configured and the photo result was rehearsed.

## Prepare the demo state

Create these as separate states so one failure cannot ruin the whole recording:

1. A plan titled **Dinner Saturday near Koramangala, under ₹800 each**, with four participants
   and one participant answer still ready to submit.
2. A public Shopify shelf search with the configured development-store product visible.
3. A Shopify test-order group with three ordinary payers and `all_of`. Keep advanced
   sponsor/backstop/policy controls for a separate builder clip so the proof remains predictable.
4. The three test approval pages in separate tabs/profiles.
5. The clean TOIT bill text from `engine/test/bill-integrity.test.ts` ready to paste.
6. A terminal ready to run the two focused engine tests and `npm run nanda:scene`.

For a short one-person variant, use the extension on a single product and keep only the organizer as payer. The same flow is valid: one imported cart, one decision, and either one checkout handoff or one Shopify development-store test transaction. Say explicitly that the extension imported context; it did not pay the merchant.

If OpenStreetMap or a public storefront is unavailable, stop and record later. Do not replace a
failed source with invented venues, travel times, prices or stock.

## Exact laptop and phone setup

“Desktop” means the **laptop screen being projected or captured in OBS/QuickTime**. Use one clean
Chrome profile at 1920×1080 with these tabs prepared left-to-right:

1. `https://sutra-gmp.vercel.app` — landing page;
2. `/app` — signed-in dashboard with a pending group, notifications and exposure visible;
3. one prepared `/app/plans/<id>` board and one private `/p/<participantId>` answer tab;
4. `/app/discover` — public product shelf and provenance;
5. a real Shopify product/cart page with the unpacked Sutra extension pinned;
6. the polished Prava sandbox group board printed by `npm run e2e:proof -- --watch`;
7. `/app/bill` with the clean receipt text ready to paste;
8. the final receipt URL printed by the proof script;
9. `/nanda` plus a terminal sized only for the focused tests and `npm run nanda:scene`.

Do not improvise navigation while presenting. Prepare these states before the recording, hide the
bookmarks bar and notifications, and switch tabs with `⌘1`…`⌘9`. The terminal that contains the
engine token is never recorded.

Phone A and Phone B both open the one `2 phones` join URL printed by the proof script. Phone A
chooses Soham; Phone B chooses Arsh. Record each phone locally so their footage can be placed
side-by-side. The projected laptop stays on the Sutra board while each phone completes Prava.

## Recommended 4:30 capability demo — no Shopify store required

### 00:00–00:12 — the problem and thesis

**Laptop:** landing hero, then the dashboard's pending group.

> “Group purchases still assume one card and one owner. Somebody fronts the total and becomes the
> debt collector. Sutra moves the multi-person decision before payment.”

### 00:12–00:30 — product depth in one shot

**Laptop:** dashboard. Briefly frame pending decisions, card exposure, recent receipts and the
notification bell; open People/Circles for one clean two-second cut, then return.

> “This is a working collaboration product, not a payment-form mockup: accounts, friends,
> circles, notifications, live group threads, card exposure, decisions and receipts all share
> one state model.”

### 00:30–00:58 — private planning and explainable ranking

**Laptop:** prepared plan board beside one participant answer tab. Submit the final availability,
location and budget answer; return to the board and hold on a real OpenStreetMap venue moving.

> “A sentence becomes private participant links for availability, location, budget and
> constraints. The shared board reveals who answered—not their private budget. Real OpenStreetMap
> venues re-rank with inspectable distance, availability and aggregate fit. Planning answers can
> shape the plan; they can never authorize money.”

### 00:58–01:10 — plans stay honest

**Laptop:** choose a venue and show the conversion disclosure.

> “An outing budget remains an estimate. The final restaurant amount comes from the real bill;
> Sutra never turns a planning guess into payment consent.”

### 01:10–01:38 — public discovery and the extension

**Laptop:** Find page for six seconds, framing merchant, variant, price, stock signal, source and
confidence. Switch to the real Shopify cart and click the pinned Sutra extension.

In the extension, hold on:

1. merchant and detection strategy;
2. every detected cart line, quantity and total—not just the first product;
3. the participant picker and live per-person estimate;
4. `Everyone confirms` or another visible policy;
5. the disclosure that checkout, address and payment remain merchant-owned.

Click **Create group in Sutra**, then show the resulting group/invitation state.

> “Sutra can search configured public Shopify storefronts or resolve an exact public URL. The
> click-invoked extension goes further: it reads the active product or full cart using Shopify
> cart data, JSON-LD, metadata, microdata and visible totals, then imports every line with its
> provenance. It receives no merchant password, card or checkout authority. Detection is broad;
> automatic ordering still needs a merchant adapter.”

### 01:38–02:00 — exact group mechanics

**Laptop:** product builder or prepared group. Show line-item claims, explicit fees and the split
preview. Briefly open roles and policies.

> “The engine allocates items and fees in minor units, then supports payer, sponsor, backstop and
> observer roles. Policies can require everyone, quorum, weighted approval, a required member or
> veto. Every consent binds one person to their exact items, share, cap, cart hash, rule and rail.”

### 02:00–03:15 — two devices, real Prava sandbox proof

**Laptop:** open the board printed by `e2e:proof`; show `0/2 approved`.

**Phone A:** choose Soham on the shared join link. Hold on items, `$46.50`, cap and all-of rule,
then tap **Approve $46.50 with passkey** and complete Prava's hosted sandbox ceremony off the
laptop capture.

**Laptop:** show Soham become approved while Arsh remains pending.

**Phone B:** choose Arsh, show the separate participant page and complete the second hosted
ceremony.

**Laptop:** hold on `committing`, the two sequential charge events, then `committed`.

> “Now the payment proof. These are two distinct participant sessions on two devices. Soham can
> authorize only Soham's cap; that cannot spend for Arsh. The all-of policy remains locked until
> Arsh independently approves through Prava. Once both sandbox mandates are active, Sutra commits
> and executes the person-scoped charges sequentially. The shared sandbox card proves two human
> approvals and two mandates—not two different physical cards, and not production money.”

### 03:15–03:35 — recovery is part of the product

**Laptop:** focused green test output for crash recovery, idempotency and partial outcomes.

```bash
npm test -w engine -- crash-double-charge.test.ts integration.test.ts --reporter=verbose
```

> “Payment systems fail between requests. Sutra persists every attempt, reconciles unknown
> results before retry and resumes without blindly charging twice. Because real captures are
> sequential, an irreversible mixed result is reported as partial instead of being renamed
> atomic success.”

Keep **DETERMINISTIC FAULT TESTS** visible; do not imply the terminal is a live sandbox failure.

### 03:35–03:55 — bill integrity and non-charging rails

**Laptop:** Bill page. Paste the prepared receipt, parse it, show item/fee reconciliation against
the printed total, assign two lines and hold on the at-venue disclosure.

> “The same decision engine handles real receipts: deterministic text parsing, optional disclosed
> vision upload, printed-total reconciliation, item claimants and exact shares. At a restaurant it
> records who owes what and signs that agreement with `charged_amount` zero. It never calls debt a
> completed venue payment.”

### 03:55–04:12 — portable evidence

**Laptop:** polished receipt from the sandbox proof. Show each participant outcome, charged total,
Prava transaction reference, rail, cart hash, consent chain and Ed25519 verification.

> “Every terminal group ends with a rail-aware, Ed25519-signed, hash-chained receipt. It records
> exactly what the engine moved, including zero on handoff rails, so the evidence survives outside
> the UI.”

### 04:12–04:30 — NANDA, discovery and the moat

**Laptop:** `/nanda`, then the clean final lines of `npm run nanda:scene`. Frame entry-point
discovery, `prava_mandates`, the comparison with `prepaid_credits`, `no_pooled_funds`, and the
AgentCard/AgentFacts/AI Catalog/SkillMD links. Keep **SIMULATED · NO REAL CARD** visible on the
default NANDA scene.

> “GMP/1 also ships as a real `nest.plugins.payments` NANDA Town plugin, with AgentCard,
> AgentFacts, AI Catalog and SkillMD discovery. The simulation proves the interface and
> no-pooled-funds invariant; live mode creates Prava approval URLs and waits for humans. We have
> built the hard group layer: private coordination, exact allocation, multi-principal consent,
> crash-safe execution and portable proof. The remaining constraint is merchant adoption of the
> quote, multi-capture and order-reconciliation adapter—not the group protocol.”

End on:

> “No pooled wallet. No delegated consent. Every handoff named.”

## Recommended capability-cut checklist

- [ ] Dashboard shows accounts/social state, pending decisions, exposure and receipts.
- [ ] Private planning answer changes a real venue ranking without exposing the budget.
- [ ] Plan conversion says estimate, not payment.
- [ ] Find shows public product provenance and confidence.
- [ ] Extension imports every current cart line and visibly names the merchant-checkout boundary.
- [ ] Builder shows item/fee allocation, roles, policies, cap, cart hash and rail.
- [ ] Two phones open different participant seats and complete separate Prava hosted approvals.
- [ ] Laptop board visibly waits at `1/2`, then commits only after `2/2`.
- [ ] Sandbox/test status remains visible; never say two physical cards or production money.
- [ ] Focused tests show idempotent recovery, reconciliation and explicit partial outcomes.
- [ ] Bill matches the printed total and the at-venue result says `charged_amount = 0`.
- [ ] Receipt shows participant outcomes, Prava references, rail, chain and Ed25519 verification.
- [ ] NANDA scene remains labeled simulated and discovery artifacts appear by name.
- [ ] Closing sentence makes merchant adoption the remaining production layer.

## Optional Shopify-adapter cut

The sequence below is only for a separate version where a development store is already ready. It
is not required for the recommended main demo.

### 00:00–00:10 — the problem

**Picture:** Landing hero, then a clean cut to the dashboard's pending group.

**Read:**

> “When a group buys one thing, one person usually fronts the total and becomes the debt
> collector. Sutra moves the group decision before the payment.”

Do not say “nobody fronts” yet; that is only true on a compatible direct-payment/merchant rail.

### 00:10–00:34 — sentence to private constraints

**Picture:** `/app/plan/new`. The sentence is already entered. Submit once and hold on the parsed
time, place, party and budget. Cut to one participant's private answer link.

**Read:**

> “A plan begins as a sentence. Each person gets a private link for availability, location,
> budget and constraints. A planning answer shapes the decision; it can never authorize money.”

**Proof to frame:** participant form, no payment control; structured plan fields; source/degraded
messages if any.

### 00:34–00:55 — explainable re-ranking

**Picture:** Participant answer and organizer board side-by-side. Submit Maya's prepared answer.
Capture the actual venue move/score change and its plain-language reason. Hold on the answer-state
indicator showing Maya responded without displaying her private budget.

**Read:**

> “Private numbers stay private. Real OpenStreetMap venues re-rank as signals arrive, and every
> score explains availability, distance in kilometres and aggregate budget fit. Silence is never
> treated as agreement.”

Never narrate travel minutes; the engine computes geographic distance, not journey time.

### 00:55–01:08 — a plan remains an estimate

**Picture:** Choose a venue on the completed plan and show the conversion panel/disclosure that
the budget is an estimate and the real receipt is handled after the outing.

**Read:**

> “For an outing, the plan stays a plan. An estimated budget is not a final bill and not a
> merchant payment. After the outing, Sutra can split the real receipt.”

### 01:08–01:25 — Shopify shelf

**Picture:** Find page. Search the configured public storefront, select the development-store
product and frame merchant, title, variant, current price, currency, stock signal and provenance.

**Read:**

> “For a product, Sutra searches configured public Shopify stores and preserves the merchant,
> variant, price, currency, stock signal and source confidence.”

Do not call this a universal Shopify index or checkout integration.

### 01:25–01:40 — current-page/cart extension

**Picture:** On the prepared Shopify product/cart page, invoke the extension. Show detected lines,
quantities, total and strategy, then its checkout-handoff disclosure.

**Read:**

> “The load-unpacked Chrome extension can import the active product or cart after a click. It
> sees page facts, not the merchant password: authentication, address and checkout remain with
> the merchant until an adapter exists.”

### 01:40–02:00 — exact allocation, roles and policies

**Picture:** Product builder. Show item claims and explicit shipping/tax fee inputs. Briefly open
the role and policy controls: payer, sponsor, backstop, observer; `all_of`, quorum, weighted,
required and veto. Return to three payers with `all_of` for the test-order proof. Select
**Create a valid Shopify test order**.

**Read:**

> “Items and fees are allocated exactly in minor units. A group can use payers, sponsors,
> backstops and observers, with everyone, quorum, weighted, required-member or veto policies.
> For this proof, three payers must all agree.”

Hold on the card that says **Demo proof · zero real money** and **not multi-card Checkout**.

### 02:00–02:20 — individual test approval

**Picture:** Open the first participant link. Frame exact items, share, personal cap, cart hash,
policy, current group progress and the mock/test label. Approve. Match-cut the other two prepared
tabs approving, then the board reaching committed.

**Read:**

> “Each participant sees one exact decision: their items, share, cap, cart hash and group rule.
> Approval is permission, not a charge. These are simulator approvals for the development-store
> proof, so no card and no real money are involved.”

If filming Prava sandbox instead, a human must complete each hosted passkey ceremony. Never
script, impersonate or crop away the sandbox state.

### 02:20–02:52 — valid Shopify test order and delivery address

**Picture:** On the committed group board, the Shopify proof form is already filled except the
final PIN. Enter `560001`, then click **Create valid Shopify test order**. Hold the proof card:
order number, `TEST`, total, transaction count and store. Click **Verify in Shopify admin**.

In Shopify Admin, slowly show:

1. development-store host and Test-order marker;
2. the same lines and total;
3. fictional delivery address;
4. transaction history with one `Sutra test · <participant>` transaction per share;
5. test-only Sutra order note/attributes.

Keep this caption persistent:

> SHOPIFY DEVELOPMENT-STORE PROOF · ORDER + TRANSACTIONS ARE TEST · ₹0 REAL MONEY

**Read:**

> “After all test shares complete, the organizer adds the recipient and delivery address. The
> configured Admin API adapter creates one valid Shopify test order with `test: true` and one
> visibly labeled `test: true` transaction per participant. Shopify independently displays the
> mapping. This is not its normal multi-card checkout, and no real money moved.”

Do not call the Test/Paid label settlement. It is Shopify's test-ledger state.

### 02:52–03:10 — crash recovery and partial truth

**Picture:** Record only the green test names from:

```bash
npm test -w engine -- crash-double-charge.test.ts integration.test.ts --reporter=verbose
```

Frame `never charges the same card twice on resume`, the event-log recovery assertion, and one
`partial` test. Add a caption: **DETERMINISTIC MOCK TESTS · NO REAL MONEY**.

**Read:**

> “After policy passes, supported card charges execute sequentially. Durable idempotency repairs
> a crash without charging twice; an unknown result is reconciled before retry. If irreversible
> outcomes differ, the group and receipt say partial instead of pretending the payment was
> atomic.”

### 03:10–03:29 — bill integrity and at-venue agreement

**Picture:** `/app/bill`. Paste the CLEAN TOIT fixture, parse, show four item lines plus three fee
lines and **matches the printed total**. Assign two lines to different people and show exact
shares. Hold the `at_venue` disclosure and zero-charged result.

**Read:**

> “A real bill is itemized, its tax and service lines are reconciled to the printed total, and
> each item can have its real claimant. This rail records who owes what; it explicitly charges
> zero. Photo transcription is available only when vision is configured.”

### 03:29–03:43 — signed rail-aware receipt

**Picture:** A terminal receipt. Scroll slowly from member outcomes and rail through cart hash,
consent chain and Ed25519 verification. For a Shopify test/mock receipt keep **TEST · NO REAL
MONEY** visible; for at-venue, frame `charged_amount = 0`.

**Read:**

> “Every terminal group produces an Ed25519-signed, hash-chained receipt. It records the rail,
> exact decision and amount the engine actually moved—even when that amount is zero.”

### 03:43–04:00 — NANDA plugin and discovery artifacts

**Picture A:** Run `npm run nanda:scene`. Crop to entry-point discovery, the comparison with
`prepaid_credits`, `no_pooled_funds` and final PASS lines. Keep this badge persistent:

> SIMULATED PROTOCOL RUN · NO REAL CARD CHARGED

**Picture B:** Quick clean cuts through `/nanda` or the live endpoints for A2A AgentCard,
AgentFacts, AI Catalog and SkillMD.

**Read:**

> “The same protocol is a real `nest.plugins.payments` NANDA Town plugin. The default scene is a
> labeled simulation that proves the interface and no-pooled-funds invariant; live mode creates
> Prava approval URLs and waits for humans. AgentCard, AgentFacts, AI Catalog and SkillMD make the
> capability discoverable. The product is the group-side protocol; production merchant adoption
> is the next layer.”

## Optional Shopify-cut checklist

- [ ] Planning sentence resolves without invented fallback data.
- [ ] Private answer changes the real ranking; no participant budget value appears publicly.
- [ ] Plan-to-outing disclosure says estimate, not final payment.
- [ ] Shopify result shows merchant facts and provenance.
- [ ] Extension shows it was user-invoked and checkout remains separate.
- [ ] Builder shows allocation, roles, policy and the explicit test proof finish line.
- [ ] Participant approval keeps mock/sandbox truth labeling visible.
- [ ] Shopify proof shows Test marker, fictional address, exact total and one labeled test
      transaction per participant.
- [ ] Fault tests show sequential recovery/partial semantics, not “atomic.”
- [ ] Bill reconciliation and `charged_amount = 0` are visible.
- [ ] Receipt shows rail, hash chain and Ed25519 verification.
- [ ] NANDA output keeps `SIMULATED · NO REAL CARD CHARGED` visible.
- [ ] AgentCard, AgentFacts, AI Catalog and SkillMD appear by name.

## Edit and audio rules

- Cut on a click or the exact frame a state changes. Remove waiting; do not speed up UI motion.
- Keep the cursor still while text is read. Never use cursor circles, neon glows or fake browser
  chrome.
- Do not record terminal setup, authentication, secrets, `.env`, errors or personal addresses.
- Use quiet music under the voice. Remove sharp transients; target voice near −16 LUFS integrated
  and below −1 dBTP, then listen on laptop speakers and headphones.
- Caption every spoken claim. Persistent truth badges must not disappear during simulated/test
  results.
- Export the master at 1920×1080/30 fps and keep the original full-resolution clips.

## One-sentence fallback if the Shopify store is not ready

Do not fake the Admin result. Remove that scene and say:

> “The group-side protocol and test-only Shopify adapter are implemented, but this recording does
> not claim a created Shopify order because the configured development-store proof was not
> completed.”
