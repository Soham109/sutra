# Sutra explained from zero

This document assumes you know nothing about payment infrastructure, AI-agent protocols, tokens, proxies, mandates, or NANDA.

## The whole project in ordinary language

Four friends want to buy something together for ₹9,600.

Most websites provide one checkout and one card box. That usually forces one friend to pay the entire ₹9,600 and collect ₹2,400 from everybody else afterward.

On a merchant that supports Sutra's Prava charging rail, Sutra replaces that arrangement with this one:

1. Every person is shown exactly what they are joining and their maximum amount.
2. Every person independently gives permission to use their own card.
3. Sutra checks whether the group's rule has been satisfied.
4. Only then does it attempt the permitted payments.
5. It records exactly what succeeded, failed, or remains uncertain.

Nobody gives their card to the organizer. Nobody deposits money into a shared Sutra wallet. The AI cannot secretly approve a payment for a human.

That is the protocol's main payment achievement. Not every product surface reaches that charging rail today. Restaurant bills, Shopify POS preparation and ordinary online checkout currently use honest agreement/handoff flows that charge nothing through Sutra. The detailed journey map below separates them.

The shortest useful distinction is:

| Part | Plain-English job |
|---|---|
| **Prava** | Safely gets payment permission from one person for one card. |
| **Sutra** | Coordinates several people's separate permissions into one group decision. |
| **GMP/1** | Sutra's rules for how that group decision behaves. |
| **NANDA Town** | A system where agent capabilities can be installed as replaceable plugins. |
| **Sutra's NANDA plugin** | Lets other AI-agent applications request a Sutra group payment. |

## Begin with the problem, not the technology

Suppose Ada, Arsh, Maya and Dev want four tickets costing ₹2,400 each.

The merchant wants ₹9,600. The people want four separate responsibilities of ₹2,400.

Those are different shapes:

```text
What the merchant normally accepts

Ada's card ─────────────── ₹9,600 ───────────────> merchant


What the group actually wants

Ada's card  ── ₹2,400 ──┐
Arsh's card ── ₹2,400 ──┤
Maya's card ── ₹2,400 ──┼────────────────────────> merchant
Dev's card  ── ₹2,400 ──┘
```

Dividing ₹9,600 by four is trivial. The difficult questions are:

- Did every person genuinely agree?
- What amount did each person agree to?
- Was the permission only for this merchant and this purchase?
- What happens if one person declines?
- Can the group proceed with three people instead of four?
- What happens if a card is charged and the server crashes one second later?
- How can the system retry without charging the card twice?
- How can somebody later prove what happened?

Sutra is primarily an answer to those questions. It is not primarily a bill-splitting calculator.

## The product has several different journeys

This is the most important clarification in the whole document.

Sutra does **not** currently treat every plan, product and restaurant bill as one continuous Prava payment. There are several entry points, and they end differently depending on what the merchant can actually support.

```text
START
  │
  ├── Plan an outing or restaurant
  │      │
  │      ├── choose a real venue using estimates
  │      ├── go to the venue
  │      └── after the meal, scan/paste the real bill
  │             └── everyone confirms what they owe
  │                 and pays the venue directly
  │                 (no Prava charge in Sutra)
  │
  ├── Find or import a product
  │      │
  │      ├── configured Shopify test proof
  │      │      └── Prava mock/sandbox mandates + Shopify test order
  │      │          (test only; no real money)
  │      │
  │      ├── confirmed Shopify POS location
  │      │      └── Sutra records shares; cashier charges cards at the counter
  │      │          (Sutra does not control or observe the terminal)
  │      │
  │      └── ordinary online checkout
  │             └── Sutra records the proposed split; group returns to checkout
  │                 (one person may still need to pay the merchant)
  │
  └── Already have a physical bill
         └── scan/paste it, allocate items, confirm exact debts,
             then everybody pays the venue directly
             (no Prava charge in Sutra)
```

The product deliberately chooses a named **finish line** before asking people to agree. A merchant URL alone never proves that Sutra can pay that merchant.

## Journey A: planning a restaurant or outing

Imagine entering:

> Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each.

### What Sutra does during planning

Sutra extracts the intended people, place, time and estimated budget. It creates private participant links so people can answer availability, location and budget questions. It uses those signals to rank real venue options and shows explainable reasons for the ranking.

The plan can answer:

- Who is interested?
- When can people attend?
- Which area works?
- What is each person's approximate budget?
- Which real venues best fit the combined constraints?

### What the estimated budget is not

An estimated budget is not a bill, a card cap, a Prava mandate or permission to charge.

If Maya says her budget is ₹800, that means “use ₹800 while helping us choose.” It does not mean “charge my card ₹800.”

Planning answers therefore do not open Prava, do not create payment credentials and do not move money.

### What happens after the group chooses a venue

For a venue found through OpenStreetMap, Sutra knows the place but does not know the final meal price. It must not invent a total.

The selected venue remains a plan:

```text
place + people + common time = decided
final items + tax + service charge + tip = still unknown
```

The group goes to the restaurant. When the real bill arrives, the group starts the bill journey described below.

### Does the restaurant plan go through Prava?

No—not in the current product.

There is no legitimate merchant-scoped amount to authorize during planning because the final items and total do not exist yet. The current venue flow does not create provisional Prava mandates from people's estimated budgets.

A future integrated restaurant could return a stable live quote or reserved order before payment. Sutra could then freeze that quote and collect fresh payment consent. That merchant integration is not present for ordinary restaurants today.

## Journey B: the real bill arrives after the meal

This journey starts after the goods or meal have already been consumed.

The objective is now different. Sutra is not deciding what to buy. It is determining exactly who owes what on a real receipt.

### Step 1: provide the receipt

The user can:

- paste or type the receipt text; or
- upload a receipt photo when the engine has an `OPENAI_API_KEY` for image transcription.

The text parser works locally without an AI key. Photo transcription first converts the image into text and then sends that text through the same deterministic parser.

### Step 2: Sutra itemises the receipt

Sutra tries to identify:

- item names;
- quantities;
- line amounts;
- taxes and service charges;
- discounts or negative lines;
- the printed subtotal and total;
- the currency;
- lines it could not understand.

It compares the sum of the parsed items and fees with the printed total. This is called **reconciliation**.

If the receipt says ₹1,278 but the parsed lines add to ₹1,228, Sutra stops and warns that ₹50 is missing or misread. It does not quietly divide a suspicious number.

The parser also checks for a specific OCR failure where decimal digits may be torn into another column. A human can override the warning only after checking the paper.

### Step 3: assign each item

The organizer selects who consumed each line item. An item may belong to one person or several people.

For example:

```text
Paneer tikka       Arsh + Maya
Pizza              Ada
Two colas          Dev + Ada
Service charge     shared proportionally
```

Sutra divides shared item lines and distributes fees proportionally based on what each person already owes. Calculations use integer minor units, such as paise, so rounding remains controlled.

### Step 4: create an `at_venue` group

Once the arithmetic is checked and every item is assigned, Sutra creates a group on the `at_venue` rail.

Each participant receives their own link showing the exact amount they owe. They press **accept**, not “approve with Prava.” If the seat is linked to a Sutra account, only that signed-in account can accept it.

### Step 5: what acceptance means

Acceptance means:

> I confirm that this is the amount I owe for this bill.

It does not mean:

> Sutra may charge my card.

No Prava session is created. No mandate is minted. No card is charged through Sutra.

### Step 6: how the restaurant actually gets paid

Every person pays the venue directly using whatever the venue accepts—card, cash, UPI or another method. Sutra does not observe those payments.

Once the selected group policy has enough acceptances, Sutra closes the agreement and creates a signed receipt containing:

- the original bill allocation;
- who accepted which amount;
- what each person owed;
- `charged_amount = 0` through Sutra;
- the `at_venue` rail disclosure;
- the hash chain and digital signature.

That receipt proves the recorded allocation and agreement. It is not proof that the restaurant received the money.

## Journey C: finding or importing a product

Sutra can begin with a product rather than a restaurant plan.

There are two different ways to bring product facts into Sutra.

### In-app discovery

The Discover page searches a configured list of public Shopify storefronts. It can retain:

- product title;
- merchant;
- public URL;
- variants;
- displayed price and currency;
- image;
- public availability or stock signal;
- how the information was discovered;
- confidence in the extraction.

The discovery page can also try to resolve a pasted public product URL.

This is best-effort public catalog reading. It is not access to a customer's private Shopify cart and it is not universal search across every Shopify shop.

### Browser-extension import

The Chrome extension is useful when the user is already looking at a product or cart in their browser.

After the user clicks the extension, it tries several detection strategies, including:

- Shopify cart data when publicly available to the page;
- structured JSON-LD product data;
- Shopify metadata;
- microdata;
- selected text;
- OpenGraph tags;
- visible page totals.

The extension can import the visible product/cart facts into a Sutra group. It can show where each fact came from.

### What the extension cannot do

The extension does not inherit the merchant login, reuse the customer's checkout session, enter an address, submit payment, press the final order button or bypass the merchant's checkout.

It has a limited Sutra device session. It never receives Sutra's engine master token, Prava keys or card data.

The simplest rule is:

> Detection tells Sutra what the user is looking at. It does not prove that Sutra can purchase it.

## What Shopify means in this project

Shopify is a commerce platform used by merchants to publish products, run online checkout, manage orders and sometimes run physical point-of-sale terminals.

“Shopify integration” can mean several very different things. Sutra implements or demonstrates some of them, but not all of them.

### Shopify storefront

The **storefront** is the public shop a customer browses. Sutra can search configured public storefronts and read public product facts.

Reading a storefront does not grant access to Shopify Admin and does not let Sutra place an order.

### Shopify Checkout

**Shopify Checkout** is the merchant-controlled online flow for address, shipping, tax, discounts, payment and order creation.

For an ordinary store, Sutra does not control Shopify Checkout. If the checkout accepts one card, calculating four Sutra shares does not make it accept four cards.

### Shopify POS

**Shopify POS** is Shopify's point-of-sale product used by a merchant's cashier at a physical location.

Some locations can accept multiple partial payments for one in-person order. Sutra can prepare and record each person's agreed share, but the cashier must enter those amounts and take the actual cards at the terminal.

Sutra is not connected to that terminal and cannot verify that the cashier completed the payments.

### Shopify Admin API

The **Admin API** lets an authorized merchant-side application create or manage Shopify records.

Sutra's configured development-store proof can use this API to create a valid Shopify **test order** after the Sutra test group has committed.

That test order can contain:

- the approved cart lines and explicit fee lines;
- a fictional demo shipping/billing address;
- one labeled test transaction per test participant;
- the Sutra group/member references and cart hash;
- `test: true` on the order and transactions.

This proves that N participant outcomes can be mapped into one merchant order record. It does not prove Shopify Checkout accepted several real cards, and it moves no real money.

## The three current product finish lines for products

After a product is discovered or imported, the group must choose how the merchant will actually be paid.

### Finish line 1: configured Prava + Shopify development-store proof

This option appears only when the product belongs to the specifically configured development storefront and the server reports that the test adapter is enabled.

The group flow is:

1. Verify the product, variant, quantity and displayed price.
2. Assign items and known fees to participants.
3. Choose payer, sponsor, backstop or observer roles.
4. Choose the group policy.
5. Create one separate Prava mock/sandbox approval for each paying person.
6. Each person completes their own approval.
7. When the group policy passes, Sutra executes the test charges sequentially.
8. Sutra creates its signed group receipt.
9. The organizer can provide a fictional address and mirror the result into one Shopify Admin test order.

What is real in this demonstration:

- the GMP/1 group engine;
- the separate member sessions and mandates;
- the policy evaluation;
- the sequential execution and recovery logic;
- the Shopify Admin order object;
- the test transaction records;
- the signed receipt and references.

What is not real:

- production money;
- a customer purchase;
- Shopify's normal online checkout accepting multiple cards;
- inventory fulfilment;
- a real shipping address;
- a merchant refund flow.

The bridge is intentionally blocked when Prava is configured for production.

### Finish line 2: Shopify POS handoff

Use this only after confirming that the physical store uses Shopify POS and its cashier can accept split tender.

The flow is:

1. Sutra records the product/cart and exact proposed shares.
2. Each person opens their Sutra link and accepts their amount.
3. No Prava mandate is created and Sutra charges ₹0.
4. Sutra creates a receipt saying **ready for Shopify POS**.
5. At the store, the cashier creates or confirms the actual cart.
6. The cashier enters each partial amount into Shopify POS.
7. Each person presents their card or supported payment method.
8. Shopify's receipt—not Sutra's agreement—is proof of payment.

Shipping, tax, inventory, refunds, exchanges and fulfilment remain Shopify/merchant responsibilities.

### Finish line 3: ordinary online checkout handoff

This is the fallback for a public product URL without a supported payment adapter.

The flow is:

1. Sutra records the cart and proposed shares.
2. Each participant accepts the proposal through their link.
3. Sutra creates an **approved for checkout** receipt with zero charged.
4. The organizer returns to the merchant's authenticated checkout.
5. The merchant calculates final shipping, tax and discounts.
6. The merchant accepts payment and creates the actual order.

No Prava mandate is created on this path. Sutra does not enter the delivery address, place the order or observe payment.

If the online checkout accepts one card, one person may still have to front the final total. Sutra has coordinated the proposed agreement but has not solved merchant-side split tender for that store.

If the final checkout total changes materially, the previous split is only an old quote. The correct future behavior is to update the cart and collect fresh consent, not silently stretch the earlier agreement.

## The sequence the product does not currently perform

The following sequence would be misleading for an ordinary restaurant:

```text
make restaurant plan
→ enter estimated budget
→ approve that estimate through Prava
→ eat
→ receive final bill
→ automatically adjust the earlier Prava approval
```

That is **not** the current implementation.

The current restaurant sequence is:

```text
make restaurant plan
→ use estimates only to choose the venue
→ eat
→ receive the real bill
→ scan/paste and allocate it
→ each person accepts the exact debt
→ each person pays the venue directly
→ Sutra records ₹0 charged and signs the agreement
```

The current configured product-test sequence is:

```text
find/import priced product
→ freeze product cart and exact shares
→ each person authorizes their cap through Prava mock/sandbox
→ policy passes
→ sequential test execution
→ signed Sutra receipt
→ optional Shopify development-store test order
```

These are two different demonstrations serving two different situations.

## What Prava does

Prava is the payment-security layer used by Sutra.

Think of Prava as a trusted security desk between an application and a person's card. Sutra tells the desk:

> Ada may authorize up to ₹2,400 for this named merchant, for this purchase, one time.

Prava shows Ada its own secure approval page. Ada confirms using a passkey. If she approves, Prava gives Sutra a reference to that limited permission.

Sutra receives the permission reference. It does not receive Ada's complete card number.

### What “proxy” means

A **proxy** is something that acts as a controlled middle layer.

Without a payment proxy, an application might handle sensitive card details directly. With Prava as the proxy:

```text
Unsafe mental model
Sutra/AI ── sees card number ──> payment network

Prava model
Sutra/AI ── requests limited permission ──> Prava ── handles card securely
```

The AI works with permission and reference numbers. Prava handles the sensitive payment instrument.

This does **not** mean Prava gives the AI unlimited control. The useful point is the opposite: the middle layer restricts what the AI can do.

### What “token” means

The word **token** is overloaded, but in this project it usually means a temporary piece of proof or a safe reference.

Imagine a coat-check ticket. The ticket refers to a coat, but it is not the coat itself.

A payment token or session token can similarly refer to a payment session without containing the person's raw card number. Tokens can be:

- short-lived;
- limited to one purpose;
- cancelled;
- useless outside the correct session or service.

A token is not automatically money, and it is not automatically permission to charge any amount. Its exact powers depend on the rules attached to it.

This is unrelated to the “tokens” used to measure text processed by an AI model.

### What a “session” means

A **session** is a temporary interaction with a beginning and an expiration time.

For example, Sutra asks Prava to create Ada's approval session. Prava returns a hosted approval URL. Ada opens it, checks the details and approves or leaves. The link eventually expires.

The session is the approval process. It is not the card and it is not necessarily a completed charge.

### What a “mandate” means

A **mandate** is constrained payment permission.

It is similar to a signed instruction saying:

> My card may be used once, at Konkan Coach, for no more than ₹2,400, before this permission expires.

For Sutra, the important constraints are:

- whose authorization it is;
- the merchant;
- the currency;
- the maximum amount, called the **cap**;
- one purchase context;
- one permitted charge;
- an expiration time.

The mandate is more useful than a simple “yes” because it records what the person actually said yes to.

### What a “passkey” means

A **passkey** is a modern way to prove that the person holding a registered device approves an action. The device may ask for Face ID, Touch ID, a fingerprint, or its PIN.

The important security property is not the animation on the screen. It is that Sutra cannot manufacture the person's approval.

- The organizer cannot approve for Maya.
- Sutra cannot approve for Maya.
- An AI agent cannot approve for Maya.
- Maya must complete Prava's hosted approval ceremony herself.

### Approval is not the same as charging

This distinction is essential.

When Ada approves a ₹2,400 mandate, she has given limited permission. Sutra may still be waiting for Arsh, Maya and Dev.

```text
Ada approved     cap ₹2,400
Arsh approved    cap ₹2,400
Maya pending
Dev approved     cap ₹2,400

Group rule: everyone must approve
Current result: do not begin charging
```

Permission is collected first. Charging begins only after Sutra's group rule passes.

## What Sutra adds

Prava secures one person's permission. Sutra coordinates many such permissions.

An analogy is useful:

- Prava is the notary checking each person's individual signed instruction.
- Sutra is the coordinator deciding whether the complete set of instructions satisfies the group's agreement.

### GMP/1

GMP/1 means **Group Mandate Protocol, version 1**.

A protocol is simply an agreed set of rules and message shapes. Traffic lights are a protocol: everybody needs a shared understanding of red, amber and green. GMP/1 defines the shared understanding for a group purchase.

It covers matters such as:

- group members;
- individual shares and caps;
- the exact cart;
- approval states;
- group decision policies;
- sponsors and backstops;
- charging order;
- crash recovery;
- partial outcomes;
- final evidence.

### Group policies

A **policy** is the rule that decides whether the group may proceed.

Examples:

| Policy | Meaning |
|---|---|
| `all_of` | Everybody must approve. |
| `quorum(3)` | Any three approvals are enough. |
| `weighted` | Members have different voting weights; a threshold must be reached. |
| `required(Ada, quorum(3))` | Ada must approve, and three total approvals are required. |
| `veto(Dev, quorum(3))` | Three approvals can pass, unless Dev vetoes. |
| `deadline` | Use one rule before a deadline and a fallback rule afterward. |

These rules govern whether charging may start. They do not allow Sutra to exceed anybody's personal cap.

### Payer, sponsor, backstop and observer

- A **payer** pays their own assigned share.
- A **sponsor** explicitly agrees to pay for a named other person.
- A **backstop** pre-approves a limited extra amount that may cover a shortfall.
- An **observer** can participate in the decision without paying.

A sponsor or backstop is explicit. Sutra does not silently turn one person's ₹2,400 approval into responsibility for everybody else.

### What a cart hash means

A **hash** is a short digital fingerprint calculated from some data.

If the cart contains four specific tickets at a specific price, Sutra calculates a cart hash. Change an important part of the cart and the fingerprint changes.

```text
Cart A ──> hash 7bf1...
Cart A again ──> hash 7bf1...
Cart with a changed price ──> hash 93ac...
```

This binds consent to the cart the person actually saw. Permission for four ₹2,400 tickets must not silently become permission for a different basket.

A hash is not encryption and does not hide the cart by itself. Here it is mainly used to detect changes and link records together.

### Requotes and fresh consent

Suppose four people originally expected to pay ₹2,400 each. One leaves, making the new share ₹3,200.

Sutra cannot stretch an old ₹2,400 permission into ₹3,200. It must:

1. cancel or stop using the old permission;
2. show the new amount;
3. create a new approval session;
4. ask the person to approve again.

The rule is simple: consent may not silently grow.

## Exact flow on the `prava_mandates` charging rail

This section applies only when a trusted server-side capability explicitly selects `prava_mandates`. It does not apply to ordinary restaurant planning, physical bills, Shopify POS handoff or generic online checkout handoff.

In the consumer interface today, the server permits this for the configured Shopify development-store proof when Prava is in mock or sandbox mode. The engine and operator API also support the rail as protocol infrastructure, but a production merchant still needs its own approved adapter.

### 1. Start with a priced merchant cart

The product, variant, quantity, merchant and displayed amount must be known. For the current consumer proof, the product must match the configured development storefront.

### 2. Assign the economic roles

The organizer assigns items and fees and chooses who is a payer, sponsor, backstop or observer. Sutra computes each person's exact share using integer minor units.

### 3. Choose the group rule

The organizer selects a policy such as everyone required or a quorum. The policy is printed on each participant surface so people know the decision rule before approving.

### 4. Freeze the proposal

Sutra records:

- the exact cart;
- the cart hash;
- merchant identity;
- currency;
- each share;
- each maximum cap;
- group policy;
- deadline;
- selected payment rail.

This is the version everybody is being asked to authorize.

### 5. Create one Prava session per paying person

Sutra calls Prava through its API and requests a separate hosted approval session for Ada, Arsh, Maya and Dev.

An **API** is a defined way for two software systems to talk. Sutra sends a precisely shaped request such as “create a one-time ₹2,400 approval session for Ada at this merchant.” Prava returns a precisely shaped response containing identifiers and a hosted approval URL.

The session is created lazily when the member opens their page so its short expiration clock does not run out before the human arrives.

### 6. Every human authorizes independently

Each person opens their own Prava URL on their own device. They inspect the amount and complete the passkey check.

Prava then creates or activates that person's mandate. Sutra polls Prava to learn whether the mandate has become active.

**Polling** means asking periodically, “Has the status changed yet?”

### 7. Sutra evaluates the group rule

Sutra may see:

```text
Ada   approved
Arsh  approved
Maya  declined
Dev   approved
```

- Under `all_of`, the group cannot proceed.
- Under `quorum(3)`, the group may proceed with the approved set if their capped amounts can still cover the purchase.

Passing the policy alone is not enough when the locked members cannot cover the required total inside their individual caps.

### 8. Handle a changed share correctly

If Maya leaves and the remaining people's target shares rise above what they approved, Sutra does not stretch the old mandates. It cancels stale authority, computes the new amount and asks the affected people to approve again.

An already armed capped backstop may cover a shortfall without changing somebody else's original share, but only inside the separately authorized backstop cap.

### 9. Lock the charge plan

Before the first charge, Sutra fixes the selected members and exact charge entries. Unselected authorizations are cancelled. This is the point where a changing discussion becomes a durable execution plan.

### 10. Attempt the permitted charges sequentially

Charges occur one after another. They are not one indivisible bank operation.

For each charge entry, Sutra:

1. records that an attempt is about to happen;
2. creates a durable idempotency reference;
3. asks Prava to charge inside that member's mandate;
4. records the returned transaction reference;
5. reports and checks the payment result;
6. moves to the next entry only when it safely can.

### 11. Deal honestly with failures

Possible final states include:

- **committed:** the required amount was successfully covered;
- **aborted:** the policy became impossible before charging;
- **expired:** approval time ran out;
- **partial:** some irreversible charges succeeded but the complete purchase did not;
- **committing with an unknown charge:** a request may have reached Prava, but Sutra cannot yet prove the result and therefore pauses for reconciliation.

“Unknown” is a safety state, not an embarrassing error to hide.

### 12. Produce the evidence

Sutra creates a rail-aware signed receipt containing the rule, consents, caps, cart hash, owed amounts, charged amounts and transaction references.

For the configured Shopify development proof, the organizer may then mirror the completed **test** outcome into Shopify Admin. That is a separate adapter action after the Sutra group has committed.

## Crash safety and double-charge prevention

This is one of the strongest technical parts of Sutra.

Imagine Sutra sends “charge Ada ₹2,400” to Prava. Prava completes the charge, but Sutra's server crashes before saving the response.

When Sutra restarts, it must not blindly send the same charge again.

### What “idempotency” means

An operation is **idempotent** when repeating the same identified request does not create another independent effect.

Think of a parcel-tracking number attached to the instruction. Sutra generates a durable reference such as:

```text
group-482 / member-Ada / attempt-1
```

After a crash, Sutra asks whether Prava already has a charge with that reference.

- If yes, Sutra adopts the existing result.
- If Prava definitely rejected it, Sutra records the failure.
- If nobody can yet determine the result, Sutra leaves it unknown and reconciles later.

It does not translate “I did not receive the response” into “the charge did not happen.” Those sentences are not equivalent.

### What a “saga” means

A **saga** is a way to coordinate several real-world steps that cannot be wrapped in one database transaction.

A normal database can often undo a set of unfinished edits. A card charge may already have left the system and cannot simply be erased because another card failed.

Sutra therefore uses a carefully recorded sequence, often called a commit saga. Every step is durable, inspectable and resumable. If the final outcome is mixed, Sutra reports a partial result instead of claiming a fictional rollback.

### What “reconciliation” means

**Reconciliation** means comparing Sutra's records with Prava's records until both agree about what actually happened.

It is the payment equivalent of checking a bank statement against your bookkeeping.

## Payment rails and settlement

A **payment rail** is the route or mechanism through which value is supposed to move.

Examples in this project have different meanings:

- `prava_mandates`: Sutra executes person-scoped payment permissions through Prava.
- `at_venue`: Sutra records the group's agreement for payment at the venue; Sutra itself charges ₹0.
- Shopify POS handoff: Sutra prepares the agreed split for a cashier; it does not control the terminal.
- Shopify development-store proof: creates test order and transaction records; no real money moves.

**Settlement** means the payment has reached a sufficiently final confirmed state on the relevant payment system. A button saying “success” is not the definition of settlement.

The receipt records the rail because the same word “completed” must not blur together a real Prava charge, an at-venue agreement and a test Shopify order.

## What exactly works today

The word “works” can mean different things. A feature may work completely in production, work against a real test service, work only as a deterministic simulation, or work as coordination while deliberately stopping before payment.

The following matrix states the current repository boundary plainly.

| Capability | Current status | What actually happens |
|---|---|---|
| Accounts, sign-in and sessions | Implemented product functionality | Users can have accounts and browser sessions. Additional launch hardening such as email verification, password reset and stronger production controls remains documented. |
| Friends and circles | Implemented | Real account-linked participants can be invited and their decisions appear in their own product surfaces. |
| Natural-language plan creation | Implemented | A sentence becomes structured planning intent. AI extraction is optional/configurable; payment facts are never invented. |
| Private participant planning links | Implemented | People can submit availability, place, budget and RSVP signals. Planning input is not payment consent. |
| Real venue discovery | Implemented | OpenStreetMap/Overpass-backed places can be ranked with inspectable factors. This supplies venue facts, not prices or payment support. |
| Public Shopify product discovery | Implemented for configured public stores | Sutra reads public product/variant/price/provenance facts. It does not gain a private cart or checkout authority. |
| Pasted public URL resolution | Implemented on a best-effort basis | Sutra tries to extract public product facts and records how confident it is. A resolved URL is not an ordering integration. |
| Chrome product/cart import | Implemented as a load-unpacked extension | After the user clicks it, the extension imports visible facts. It does not inherit login, address or payment authority and does not place an order. |
| Exact allocations, fees and minor-unit rounding | Implemented | Items and fees are allocated across members using integer money calculations. |
| Group policies | Implemented in the GMP/1 engine | `all_of`, quorum, weighted, required member, veto and deadline behavior are supported by the engine. The NANDA simulator intentionally implements a documented subset. |
| Payer, sponsor, backstop and observer roles | Implemented | Economic responsibility is explicit; backstops require their own cap. |
| Requotes and fresh approval | Implemented | When a required amount exceeds an old cap, stale authority is cancelled and the person must approve the new amount. |
| Text receipt parsing | Implemented and works offline | Typed/pasted lines are parsed, itemised and checked against the printed total without needing an AI key. |
| Receipt-photo transcription | Implemented when vision is configured | Requires `OPENAI_API_KEY`; the transcript is still checked by the deterministic bill parser. |
| At-venue bill agreement | Implemented | People confirm exact debts; Sutra signs the record and reports zero charged. People pay the venue outside Sutra. |
| Shopify POS preparation | Implemented as a handoff | Sutra prepares the split and records agreement. The cashier performs the real split payment; Sutra does not connect to or observe the terminal. |
| Ordinary online checkout preparation | Implemented as a handoff | Sutra records the proposed split and returns users to the merchant. It neither places nor pays the order. |
| Prava mock adapter | Implemented | Full engine state, policies, test charging and failure behavior can be exercised locally without Prava or money. |
| Prava sandbox adapter | Implemented against Prava's API | Sutra can create hosted sandbox approval sessions, observe mandates and execute sandbox charge behavior. Sandbox is not production money. |
| Completed human-approved sandbox proof | Not yet documented as completed in the repository | The repository does not currently contain the final documented evidence of a complete human passkey-approved Prava sandbox charge. Do not imply that evidence exists. |
| Prava production adapter | Code path exists | Real operation requires production credentials, operational controls and a merchant that supports the payment arrangement. |
| Real production merchant accepting Sutra group checkout | Not yet available | There are currently zero documented production merchants with the required adapter. This is the main commercial completion gap. |
| Shopify development-store order proof | **Configured and live in the demo environment** | The store `sutra-agzdw2mf.myshopify.com` has three published demo products. After committed sandbox outcomes, Sutra can create one valid Shopify Admin order and one labeled transaction per participant with `test: true`. No money moves. |
| Real multi-card Shopify online checkout | Not implemented | The development proof is not Shopify Checkout and must not be presented as one. |
| Automatic merchant refunds after capture | Not implemented | The receipt exposes transaction evidence, but post-capture remedy requires merchant/acquirer refund operations. |
| Signed, hash-chained receipts | Implemented | Terminal groups receive rail-aware evidence that can be verified independently for integrity. |
| NANDA Town payments plugin | Implemented and discoverable | The Python package registers as `nest.plugins.payments → prava_mandates`. |
| Default NANDA demonstration | Implemented simulation | It runs deterministically without network, cards or keys and labels its receipts simulated. |
| NANDA live mode | Implemented HTTP path | It calls the Sutra engine and returns human approval links. Completion depends on the engine mode and real human approvals. |

### The strongest honest summary of current payment behavior

- The complete protocol can run locally through the mock adapter.
- Prava API integration and hosted sandbox approval-session support exist.
- The consumer Shopify proof uses mock/sandbox semantics and produces a real Shopify **test** order, not real settlement.
- Restaurant bills, POS and ordinary online checkout are currently coordination/handoff rails; Sutra charges zero on them.
- Fully automatic real-money group checkout requires a production merchant adapter that does not yet exist in the repository.

This does not make the protocol work unimportant. It separates the difficult coordination engine that is built from the merchant adoption and production operations still required.

## What the signed receipt proves

Sutra uses an Ed25519 digital signature.

A **digital signature** lets a verifier check two things:

1. the receipt was signed using Sutra's private signing key;
2. the signed contents have not been changed afterward.

The private key signs. A public key verifies. The public key cannot be used to create a new valid signature.

The receipt is also **hash-chained**: every entry includes the fingerprint of the previous entry. Changing an older event breaks the chain that follows it.

This proves the integrity of the recorded evidence. It does not turn an at-venue ₹0 agreement into proof that a restaurant was paid. The recorded rail and `charged_amount` still matter.

## Sandbox, mock and production

These modes keep development claims honest.

| Mode | Meaning |
|---|---|
| **Mock** | Sutra's local Prava simulator. Useful for automated development; no real Prava payment occurs. |
| **Sandbox** | Prava's test environment. It exercises Prava integration without production money. |
| **Production** | Real configured payment infrastructure and real consequences. |

The same engine can use different adapters for these modes.

An **adapter** is a small translation layer that gives Sutra one consistent interface while the system behind it changes. It is like using the same wall socket shape while the electricity source can be a test generator or the real grid.

## NANDA explained from the beginning

### First: what is an AI agent?

In this context, an **agent** is software that can receive a goal, inspect information, make decisions and call tools or other services to perform actions.

For example, a travel agent might search for a train, compare options and ask a payment service to prepare a purchase.

An agent is not automatically a legal person, a bank account or a cardholder. It can act only through the identities, permissions and tools given to it.

### The problem NANDA is exploring

Most agents currently live inside separate company products. One agent may not know:

- how to discover another agent;
- how to verify its identity;
- which capabilities it offers;
- how to authenticate a request;
- how to decide whether to trust it;
- how to send a structured message;
- how to pay through it;
- how to coordinate a multi-step task;
- how to produce replayable evidence.

NANDA explores open infrastructure for an **Internet of Agents** where these capabilities can interoperate instead of being permanently locked inside one application's private code.

### Project NANDA versus NANDA Town

These names are related but are not interchangeable.

| Name | Meaning |
|---|---|
| **Project NANDA** | The broader research and open-infrastructure effort around networked AI agents. |
| **NANDA Town** | An open-source sandbox for running agents and swapping protocol implementations. |
| **`nest`** | NANDA Town's runtime and command-line engine. It loads scenarios, agents and plugins. |
| **Plugin** | A replaceable implementation of one infrastructure layer. |
| **Scenario** | A repeatable world or experiment containing agents, configuration and actions. |
| **Trace** | A chronological machine-readable record of what the scenario did. |

An easy analogy is aviation:

- Project NANDA studies and develops the air-traffic system.
- NANDA Town is the flight simulator.
- `nest` is the simulator engine.
- A scenario is a particular flight exercise.
- Plugins are replaceable aircraft or navigation components.
- A trace is the flight recorder.

### NANDA Town's infrastructure layers

NANDA Town separates agent infrastructure into twelve replaceable areas:

1. **Transport** — how bytes or messages physically move.
2. **Communication** — how agents format and exchange messages.
3. **Identity** — how an agent is named.
4. **Registry** — how agents and capabilities are listed or discovered.
5. **Authentication** — how a caller proves who it is.
6. **Trust** — how agents evaluate reputation or reliability.
7. **Payments** — how economic value or payment references are represented.
8. **Coordination** — how multiple actors organize a shared task.
9. **Negotiation** — how agents bargain or reach terms.
10. **Memory** — how information persists across interactions.
11. **Privacy** — how sensitive information is protected or selectively revealed.
12. **Data facts** — how factual claims and supporting information are represented.

Sutra primarily plugs into the **payments** layer, while GMP/1 itself also has strong coordination semantics.

### What a plugin means

A **plugin** is replaceable code loaded through an agreed interface.

Think of a wall socket. The appliance expects a standard socket shape and does not need to know the internal design of the power station. NANDA Town scenarios expect a payments interface and can load a plugin that implements it.

The plugin system matters because a scenario should not need to be rewritten every time the underlying payment model changes.

### How NANDA discovers Sutra's plugin

The Sutra package registers itself through Python package metadata under:

```text
nest.plugins.payments → prava_mandates
```

This is called an **entry point**. It is like an installed application registering “I provide a payments plugin named `prava_mandates`.”

When `nest` lists or loads payment plugins, it reads installed metadata rather than relying on a screenshot, a hard-coded import inside NANDA, or a manual copy-and-paste step.

A scenario can therefore select:

```yaml
layers:
  payments: prava_mandates
```

instead of:

```yaml
layers:
  payments: prepaid_credits
```

That proves the package is installed as a genuine replaceable NANDA payments implementation.

## The default NANDA payment model

NANDA Town's default `prepaid_credits` plugin models balances inside the simulation.

For example:

```text
Agent A balance: 100 credits
Agent B balance:  20 credits

Agent A pays Agent B 10 credits

Agent A balance:  90 credits
Agent B balance:  30 credits
```

This is useful for testing agent marketplaces. However, it is a software ledger controlled by the scenario. It is not a human authorizing a real card for an external merchant.

### Why Sutra cannot merely rename credits

A simulated credit balance and a human card mandate have different ownership and safety rules.

| Question | `prepaid_credits` | `prava_mandates` |
|---|---|---|
| Where does value live? | Inside a simulated agent ledger | On each person's separate payment instrument |
| Who authorizes it? | Scenario/software logic | The human cardholder through Prava |
| Who is paid? | Usually another agent | An external merchant |
| Can one agent debit another? | The simulation can model this | Deliberately impossible |
| What does `balance()` mean? | Spendable simulated balance | Remaining authorization headroom exposed for compatibility |
| Is money pooled? | Balances exist inside the simulation | No group wallet or pooled balance |
| What is the final evidence? | Scenario receipt/ledger state | GMP/1 group state plus rail-aware signed evidence |

The plugin supports the surrounding NANDA interface, but it does not pretend card authority behaves exactly like play money.

## What Sutra adds to NANDA

The ordinary NANDA payment interface is shaped around one payer performing one payment. Sutra adds a multi-person operation:

```python
result = await payments.pay_group(
    merchant,
    amount,
    reference,
    principals=[Ada, Arsh, Maya, Dev],
    policy={"type": "quorum", "m": 3},
)
```

A **principal** is a person or entity whose authority matters independently. Ada, Arsh, Maya and Dev are four principals. They are not four sub-accounts controlled by one organizer.

### What `pay_group()` means

`pay_group()` asks the payments layer to create one coordinated purchase involving several independent principals.

Its result can contain:

- one group reference;
- the merchant and amount;
- the group policy;
- one participant record per principal;
- one approval URL per human in live mode;
- current status;
- eventual terminal outcome;
- authorization and receipt evidence.

The call does not mean the agent has approved the cards. It means the agent has prepared the group and received the next human actions.

### Exact live-mode sequence

In live mode:

```text
NANDA scenario or agent
        │
        │ pay_group(...)
        ▼
prava_mandates plugin
        │
        │ authenticated HTTP request
        ▼
Sutra GMP/1 engine
        │
        ├── creates group, cart, members and policy
        ├── returns one member link per principal
        └── waits for humans
                │
                ├── Ada opens her link and approves
                ├── Arsh opens his link and approves
                ├── Maya may decline
                └── Dev opens his link and approves
                        │
                        ▼
                policy evaluation
                        │
                        ▼
             commit / abort / partial / pending
                        │
                        ▼
                signed receipt evidence
```

By default, live `pay()` or `pay_group()` does not block forever waiting for humans. It can return approval URLs and a pending state. The caller can later use `verify_payment(reference)` to ask for the current result.

### What `verify_payment()` means

`verify_payment()` checks what the engine can actually prove for a previously created payment reference.

The plugin reports confirmed only when the engine's signed receipt supports the required charged amount on the charging rail.

Important examples:

| Engine situation | NANDA-facing interpretation |
|---|---|
| Group still collecting or committing | `PENDING` |
| Signed receipt proves enough was charged | `CONFIRMED` |
| Group terminal but receipt is missing | `PENDING`, because the claim is not yet provable |
| Receipt belongs to `at_venue` and charged zero | Not reported as a confirmed card payment |
| Group aborted before capture | `REFUNDED` in NANDA's limited vocabulary, although technically nothing was captured |
| Partial outcome | `FAILED`, with captured details retained separately because NANDA's status enum has no faithful “partial” value |
| Engine cannot be reached | `PENDING`, not a guessed failure |
| Unknown state string | `PENDING`, recorded for diagnosis |

This translation is conservative because NANDA Town's basic status vocabulary is smaller than GMP/1's payment state model.

## Simulated NANDA mode

The default mode is `simulated`.

It runs an in-process Python implementation of the relevant GMP/1 behavior. It needs:

- no network;
- no Sutra engine process;
- no Prava key;
- no card;
- no human passkey tap.

The simulator produces the same broad JSON shapes used by the live client so the plugin code above it follows the same workflow.

It covers core behavior such as:

- share allocation;
- caps;
- `all_of`, quorum, weighted, required and veto policies;
- backstop shortfall absorption;
- commit or abort;
- hash-chained simulated receipt output.

Every simulated receipt is marked `simulated: true` and states that no real card was charged.

### Why simulation is useful

Human passkey approvals cannot be performed reliably inside automated tests, and an agent must never fake them.

Simulation allows developers to test hundreds of deterministic scenarios, failures and policy combinations quickly. It proves the plugin's logic and compatibility. It does not prove a real Prava authorization or real settlement.

### What the simulator does not implement

The Python simulator is intentionally a subset of the full TypeScript GMP/1 engine. It does not silently guess at unsupported behavior.

Documented differences include:

- no deadline-policy implementation in the simulator;
- no full requote-round machinery;
- no sealed-bid priority auction;
- no FX display flow;
- no production merchant settlement.

Unsupported policies raise an error instead of quietly becoming `all_of`.

## Live NANDA mode

Live mode changes the plugin from an in-process simulator to an HTTP client of the actual Sutra engine.

```text
NANDA_PRAVA_MODE=live
GMP_API=http://localhost:4100
ENGINE_API_TOKEN=...
```

The Sutra engine behind that URL may itself use:

- `PRAVA_ENV=mock` for a real HTTP integration against Sutra's local Prava simulator;
- `PRAVA_ENV=sandbox` for Prava hosted sandbox approvals;
- `PRAVA_ENV=production` for production Prava configuration.

The NANDA plugin does not secretly choose the engine's payment environment. It asks the engine, and the engine configuration determines the adapter.

### Human approval remains mandatory

Against Prava sandbox or production, the plugin cannot auto-approve a mandate.

The only auto-approval helper calls a `/mock/pay/.../approve` route that exists only when the Sutra engine is running its `MockPrava` adapter. Point it at a real Prava adapter and the route does not exist.

This makes the inability to approve for a human a code-level boundary, not presentation wording.

## Scenarios, traces and replay

A **scenario** declares which agents and plugins should run and what environment they inhabit. The same marketplace scenario can run once with `prepaid_credits` and again with `prava_mandates`.

A **trace** is a JSONL file—one JSON event per line—recording the scenario's sequence. Traces help with:

- repeatability;
- comparing two plugins;
- investigating failures;
- producing reports;
- replaying agent behavior;
- running validators.

The trace proves that NANDA Town loaded and ran the scenario. Sutra's deeper payment conservation and consent evidence comes from the plugin's authorization records, GMP/1 events, receipts and tests.

One documented limitation is that NANDA Town does not expose its private trace writer directly to payment plugins. Therefore a generic upstream validator that merely counts unavailable debit/credit event types may pass trivially. Sutra does not use that trivial result as its conservation claim; it has its own conservation report and tests.

## What the NANDA integration proves

It proves that:

- `prava_mandates` is packaged as a real discoverable payments plugin;
- NANDA Town can load it through installed entry-point metadata;
- existing scenarios can select it as the payments layer;
- the plugin implements NANDA's expected payment-facing operations;
- the same plugin can run deterministically in simulation or call the real Sutra engine over HTTP;
- the plugin adds a concrete multi-principal `pay_group()` capability;
- approval URLs remain assigned to individual humans;
- failures, unknown states and receipts are translated conservatively;
- emitted structures are checked to avoid leaking API keys, card data or passkeys;
- the behavior is covered by the plugin test suite.

## What the NANDA integration does not prove

It does not prove that:

- the default scenario charged real cards;
- all NANDA agents can now spend real money;
- a software agent can approve a person's card;
- every merchant supports Prava or Sutra;
- simulated credits are equivalent to dollars or rupees;
- NANDA itself provides the GMP/1 group-payment logic;
- Shopify Checkout accepted multiple real cards;
- a terminal partial charge can be automatically refunded.

NANDA supplies the plugin architecture and experimental runtime. Sutra supplies the group-payment semantics and implementation.

## Why NANDA is strategically important

Without NANDA, Sutra could still be a working consumer application and protocol engine. The NANDA integration adds a different kind of evidence: **portability**.

It demonstrates that another compatible agent system does not need to reproduce Sutra's entire website to request a group purchase. It can discover the payments plugin, call a defined operation and receive human approval actions plus verifiable status.

That is the path from:

```text
one Sutra application with special payment logic
```

to:

```text
a reusable multi-person payment capability available to agent ecosystems
```

The impressive claim is therefore not “we used NANDA.” It is:

> We changed NANDA Town's payment semantics from one software-controlled payer to several independently authorized humans, while preserving human control and exposing the capability as a real replaceable plugin.

## Other common words

### Server and client

A **client** asks for something. A **server** receives the request and returns a response.

The browser is a client of Sutra's web server. Sutra's engine is also a client of Prava's server.

### HTTP

HTTP is the common message format used by web systems. A request includes an action, an address, headers and sometimes a body. A response includes a status and data.

### Secret key and publishable key

A **secret key** proves that a trusted server may perform privileged API actions. It must stay on the server.

A **publishable key** is designed for limited browser-side use and cannot replace the server's secret authority.

Neither key is a customer's card number.

### Bearer token

A **bearer token** is a credential sent with an API request. Whoever possesses it may receive its allowed access, so it must be protected. “Bearer” essentially means possession is the proof.

### Transaction ID

A **transaction ID** is the payment system's reference for a specific attempt or result. It helps support, reconciliation and receipts refer to the same event.

### Minor units

Payment calculations often use **minor units**: paise instead of decimal rupees, or cents instead of decimal dollars.

₹12.34 becomes `1234` paise. Integer arithmetic avoids errors caused by computer decimal rounding.

### State machine

A **state machine** is a defined list of statuses and permitted transitions.

For example:

```text
collecting approvals → deciding → committing → committed
                         │             │
                         └→ aborted    └→ partial / unknown
```

It prevents impossible jumps such as charging an unapproved member or quietly changing a completed group back into a pending one.

## What Sutra has genuinely demonstrated

The project contains more than a visual demo. It implements:

- private group planning and explainable options;
- exact per-person allocations and caps;
- independent approval sessions;
- multiple group decision policies;
- payer, sponsor, backstop and observer roles;
- fresh consent when an amount grows;
- crash-resumable sequential charging;
- idempotent recovery and reconciliation;
- explicit partial and unknown outcomes;
- rail-aware signed receipts;
- a reusable NANDA Town payments plugin;
- automated engine, extraction and plugin tests.

The hard achievement is coordinating multiple independent people without giving the organizer or AI control of everybody's money.

## What Sutra must not claim

The trustworthy explanation includes its limits:

- Approval is permission; it is not automatically a completed charge.
- Separate card charges are sequential, not atomic or literally simultaneous.
- A partial result cannot always be rolled back automatically.
- The default NANDA scene is simulated.
- An arbitrary one-card online checkout cannot automatically accept several cards through Sutra.
- Importing a public merchant page does not prove that merchant supports Sutra payment execution.
- The at-venue rail records agreement and reports ₹0 charged by Sutra.
- Shopify development-store transactions are test records and move no real money.
- Production online completion requires a merchant-supported adapter for quoting, reservation, captures, refunds and fulfilment.

## The simplest accurate pitch

> Prava securely lets one person give an AI limited permission to use their card. Sutra adds the missing group layer: it combines several people's independently approved, amount-capped permissions under one group rule without pooling their money or letting one organizer control every card. It safely handles declines, changed shares, crashes and uncertain results, then creates a signed record of what actually happened. The same capability is packaged as a NANDA Town payment plugin so other AI-agent applications can request a multi-person purchase.

## The one idea to remember

Sutra does not ask one person to become the group bank.

It keeps four people's authority separate, coordinates those four authorities under an explicit rule, and tells the truth about the outcome.
