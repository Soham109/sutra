# Sutra explained from zero

This assumes no prior knowledge of payments infrastructure, AI-agent protocols, or NANDA.

## The problem, in one example

Four friends want to buy something together for ₹9,600 — ₹2,400 each. Most checkouts offer one card box. Someone pays the full ₹9,600 and chases the other three for ₹2,400 afterward.

```text
What the merchant normally accepts        What the group actually wants

Ada's card ── ₹9,600 ──> merchant         Ada's card  ── ₹2,400 ──┐
                                           Arsh's card ── ₹2,400 ──┤
                                           Maya's card ── ₹2,400 ──┼──> merchant
                                           Dev's card  ── ₹2,400 ──┘
```

Dividing ₹9,600 by four is trivial. The hard questions are: did everyone actually agree, to what amount, for which merchant and purchase — and what happens if one person declines, or a card gets charged right as the server crashes, or someone needs to prove afterward what happened? Sutra is an answer to those questions, not a bill-splitting calculator.

On a merchant that supports Sutra's Prava charging rail, each person sees their own maximum, gives permission on their own card, and only once the group's rule is satisfied does Sutra attempt the permitted charges — recording exactly what succeeded, failed, or is still uncertain. Nobody hands their card to the organizer. No money sits in a Sutra wallet. An AI cannot approve a payment on a human's behalf.

Not every part of the product reaches that charging rail yet. A restaurant bill, a Shopify POS handoff, and an ordinary online checkout all use honest agreement-and-handoff flows that charge nothing through Sutra — they record what was agreed and send the group back to a real payment method. The rest of this document is mostly about that distinction.

| Part | Job |
|---|---|
| Prava | Gets one person's payment permission for one card, safely. |
| Sutra | Coordinates several people's separate permissions into one group decision. |
| GMP/1 | Sutra's rules for how that group decision behaves. |
| NANDA Town | A sandbox where agent capabilities install as replaceable plugins. |
| Sutra's NANDA plugin | Lets other agent applications request a Sutra group payment. |

## The product has several endings, not one

Sutra does not treat every plan, product, and bill as one continuous payment. Where you end up depends on what the merchant can actually support, and the product names that ending before anyone is asked to agree to anything — a merchant URL alone never proves Sutra can charge that merchant.

**Planning a restaurant or outing.** A sentence like "dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each" becomes private links where people answer availability, place, and budget, which rank real OpenStreetMap venues with visible reasons. The stated budget is a planning signal, not a card cap — it never opens Prava, mints a mandate, or moves money. OpenStreetMap knows where a restaurant is, not what dinner costs, so a venue plan cannot itself produce a payable total. The group picks a place, goes, and the real bill starts the next journey.

**The bill arrives.** The user pastes or photographs the receipt (photo transcription needs a vision key; typed text does not). Sutra itemises it — names, quantities, taxes, discounts, currency — and reconciles the sum against the printed total. If ₹1,278 is printed but the lines add to ₹1,228, it stops and says so rather than quietly splitting a number it can't account for; it also checks for the specific OCR failure where a decimal digit gets torn into the wrong column. The organizer assigns each line to whoever ordered it, fees split proportionally, and Sutra creates a group on the `at_venue` rail. Each person's link says "I confirm this is the amount I owe" — not "charge my card." No Prava session, no mandate, no card charge. Everyone pays the venue directly however the venue accepts payment, and once enough people have accepted, Sutra closes the agreement with a signed receipt recording `charged_amount = 0` and the exact allocation. That receipt proves the agreement was reached; it is not proof the restaurant got paid.

**Finding or importing a product.** The Discover page searches configured public Shopify storefronts, or resolves a pasted product URL, keeping title, price, currency, image, and how confident the read was — this is public catalog reading, not a private cart. The Chrome extension, invoked by a click on a page already open in the browser, tries several detection strategies (Shopify cart data, JSON-LD, microdata, visible totals) to pull in facts about what's on screen. It cannot log in as the user, enter checkout, or place an order — detection tells Sutra what someone is looking at, not that Sutra can buy it.

Once a product is in, the group needs a finish line. There are three:

1. **Shopify development-store proof** — only for the one configured demo storefront. Each payer approves a Prava mock/sandbox mandate, the group commits, and Sutra can mirror the result into one real Shopify order with `test: true` and one labeled test transaction per participant. The GMP/1 engine, the separate mandates, and the Shopify order object are real; the money, the shipping address, and Shopify's ordinary multi-card checkout are not.
2. **Shopify POS handoff** — for a confirmed physical counter. Sutra records the exact shares and closes a `charged_amount = 0` receipt saying "ready for Shopify POS"; the cashier then runs Shopify's own split-payment feature and takes each card. Sutra never touches the terminal or observes the payment.
3. **Ordinary online checkout handoff** — the fallback for any other product URL. Sutra records the proposed split with a zero-charged receipt and sends the group back to the merchant's own checkout, where one person may still have to front the total. If the final total changes materially, the old split is just a stale quote and needs fresh consent, not a silent stretch.

The sequence a restaurant plan does **not** do is: take an estimated budget, approve it through Prava, eat, then quietly stretch that approval to match the real bill. That would be inventing a payment authorization from a guess. The actual sequence uses estimates only to pick the venue, then treats the real bill as a separate, later agreement that never touches Prava at all.

## The vocabulary, plainly

**Prava** is the security layer between Sutra and a person's card. Sutra tells it "Ada may authorize up to ₹2,400, once, at this named merchant." Prava shows Ada its own approval page; she confirms with a **passkey** — Face ID, a fingerprint, her device PIN — and Prava hands Sutra back a reference, never the card number. Sutra cannot manufacture that approval, and neither can the organizer or an AI agent; only Ada, on her own device, can complete it. Prava is acting as a **proxy**: the safe middle layer that means Sutra deals in permission references, not raw card data.

A **token** is a short-lived, purpose-limited reference — think of a coat-check ticket, not the coat. A **session** is a bounded interaction with an expiry, like Ada's approval page itself. A **mandate** is the actual constrained permission that results: whose card, which merchant, what currency, the maximum amount (the **cap**), one purchase, one charge, an expiry. It's more useful than a bare "yes" because it records exactly what was agreed to. Giving permission is not the same as being charged — Sutra collects every needed mandate first and only starts charging once its group rule passes.

A **cart hash** is a fingerprint of the exact cart a person approved; change the price or the items and the fingerprint changes, so consent stays bound to what was actually shown. If the share changes later — someone drops out and the remaining three now owe ₹3,200 instead of ₹2,400 — Sutra cannot stretch the old ₹2,400 mandate. It cancels it and asks for fresh approval at the new number. Consent never silently grows.

**GMP/1** (Group Mandate Protocol, version 1) is the shared rulebook for a group purchase: members, shares, caps, approval states, decision **policies** (`all_of` — everyone; `quorum(3)` — any three; `weighted`; `required(Ada) + quorum(3)`; `veto(Dev)`; `deadline` with a fallback), charging order, crash recovery, and final evidence. Roles matter too: a **payer** covers their own share, a **sponsor** explicitly covers someone else's, a **backstop** pre-approves a limited extra amount to cover a shortfall, and an **observer** takes part in the decision without paying. None of this lets Sutra exceed anyone's personal cap, and a sponsor or backstop relationship is always explicit, never inferred.

**Idempotency** means repeating the same identified request doesn't create a second effect. If Sutra's server crashes right after telling Prava to charge Ada, it must not blindly resend that charge on restart. Instead it generates a durable reference per attempt (`group-482 / member-Ada / attempt-1`) and, after any crash or lost response, asks Prava whether a charge with that reference already exists before deciding anything — adopting the result if one exists, recording a failure if Prava definitely refused it, and otherwise leaving the state honestly **unknown** until it can be reconciled. "I didn't get the response" is not the same sentence as "the charge didn't happen." Because a card charge can't be undone the way a database row can, Sutra runs this as a **saga** — a durable, resumable sequence of real-world steps — rather than one atomic transaction, and reports a `partial` outcome rather than a fabricated rollback when the result is genuinely mixed. **Reconciliation** is comparing Sutra's own records against Prava's until both agree.

A **rail** is which mechanism actually moves money: `prava_mandates` (Sutra executes capped card charges through Prava), `at_venue` (Sutra records the agreement and charges ₹0), Shopify POS handoff (cashier-run, Sutra charges ₹0), or the Shopify development-store proof (test order, no real money). **Settlement** means a payment reached a confirmed final state on the actual payment system — not that a button said "success." Every receipt names its rail so a real Prava charge, an at-venue agreement, and a test Shopify order are never confused with each other. **Mock** is Sutra's own offline Prava simulator; **sandbox** is Prava's real test environment with no real money; **production** is the real thing. An **adapter** is the translation layer that lets the same engine code run against any of the three, the way one wall socket shape works whether the electricity comes from a generator or the real grid.

## What actually works today

The full built/partial/not-built inventory — accounts, venue discovery, bill parsing, the four rails, the Prava adapters, receipts — lives in [`README.md`](../README.md) and [`REFERENCE.md`](REFERENCE.md), and is not repeated here. Three facts matter enough to say plainly in this document too: a real, human-approved Prava sandbox charge is now documented — a two-participant ₹18,600 group pass, each person approving their own capped mandate on their own device, sandbox money and not real money (see [`README.md`](../README.md) and [`TRACK-EVIDENCE.md`](TRACK-EVIDENCE.md)); the restaurant, Shopify POS, and ordinary-checkout rails all charge zero through Sutra by design, not as a bug; and a shared online cart with only one card box does not become multi-payer just because Sutra computed several shares — one person may still have to front it, unless a merchant-side adapter exists.

The receipt itself is Ed25519-signed and hash-chained: each entry embeds the previous entry's fingerprint, so an altered older event breaks every entry after it, and the signature proves the contents haven't changed since Sutra signed them. That proves the record's integrity. It does not turn an `at_venue`, ₹0-charged receipt into proof the restaurant got paid — the rail and the charged amount on the receipt still say what actually happened.

## NANDA, briefly

An **agent**, here, is software that takes a goal, looks at information, and calls tools to act — not a bank account, and it can act only through whatever identity and permissions it's actually been given. **Project NANDA** is the broader research effort on networked AI agents; **NANDA Town** is its open-source sandbox for running agents and swapping out protocol implementations, run by a small engine called `nest`. A **plugin** is a replaceable implementation behind an agreed interface — same idea as a wall socket accepting different appliances — and NANDA Town's bundled `payments` plugin, `prepaid_credits`, is an internal ledger: it debits one simulated agent and credits another, inside the scenario, and models a closed toy economy rather than a real payment.

Sutra's package, `nanda-town-prava`, registers itself as a real Python **entry point** — `nest.plugins.payments → prava_mandates` — discoverable the same way any installed plugin is, not hardcoded into NANDA or faked with a screenshot. Swapping one line in a scenario file (`payments: prava_mandates` instead of `payments: prepaid_credits`) is enough to run the identical scenario against it. Unlike the pooled ledger, `pay()` here never moves value between agents — each principal's own consent mints a real, merchant-scoped, capped Prava mandate, `balance()` reports remaining authorization headroom rather than custody of anything, and an agent structurally cannot pay another agent, because there is no rail for it.

The plugin adds a genuinely new operation, `pay_group(merchant, amount, reference, principals=[...], policy=...)`, which prepares a GMP/1 group and returns one approval link per human principal rather than approving anything itself. It runs in two modes: **simulated** (the default — an in-process Python approximation of GMP/1, no network, no key, every receipt marked `simulated: true`, useful for fast automated testing but not evidence of a real charge) and **live** (a real HTTP client against a running Sutra engine, which may itself be pointed at Sutra's mock adapter, Prava's sandbox, or Prava's production — the plugin never chooses that for itself). In live mode a human passkey is still the only thing that can complete an approval; the one auto-approval helper only exists against Sutra's own mock adapter and simply does not exist as a route against a real Prava adapter. Full evidence, transcripts, and what was and wasn't verified live in [`NANDA.md`](NANDA.md).

## What Sutra must not claim

Approval is permission, not a completed charge. Separate members' charges are sequential with idempotent recovery, never atomic or literally simultaneous. A partial outcome cannot always be rolled back automatically — the receipt reports it honestly instead. Importing a public merchant page does not prove that merchant supports Sutra payment execution. The at-venue rail records agreement and reports ₹0 charged by Sutra, always. Shopify development-store transactions are test records that move no real money. A production, fully automatic shared online checkout needs a merchant-supported adapter for quoting, capture, refunds, and fulfilment that does not exist in this repository yet — post-capture refunds specifically are not supported on any rail today; the remedy is a merchant-initiated refund or a cardholder chargeback.

## The idea to remember

Sutra does not ask one person to become the group's bank. It keeps everyone's authority separate, coordinates it under a rule the group agreed to in advance, and tells the truth about the outcome — including when the outcome is partial, unknown, or still waiting on a human.
