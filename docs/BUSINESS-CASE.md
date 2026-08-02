# The business case, argued honestly

This document exists because a judging audit scored the project 5/10 on user value and
market feasibility and 6/10 on "what happens next," and named the exact gaps: no unit
economics, no answer to UPI collect, no honest treatment of the Splitwise overlap, no
chargeback story, and no answer to who pays Sutra. It tries to answer all five without
inventing anything the codebase, the market, or the team's own experience does not
support. There are zero registered users of this product outside the team, zero paying
customers, zero merchant partners beyond one configured Shopify development store, and no
traction data of any kind. That fact is not hidden anywhere in what follows; it is the
starting condition every other claim in this document has to survive.

## The one-line case, and its honest limit

Sutra is infrastructure for one narrow, real moment: N people who must jointly authorize
one purchase, before it happens, at a merchant that will accept per-person capped payment
credentials instead of a single card. That moment is genuinely unserved by any shipping
payment protocol — AP2 v0.2, Stripe ACP, Visa Intelligent Commerce and Prava's own mandate
API are all single-principal by construction (`spec/AP2-EXTENSION.md`, "The gap"). It is
also considerably narrower than "splitting a bill." Most of what people mean by that phrase
is served today by one of two behaviors that already work fine — one person fronts the
card, or the group settles up afterward — and a large share of this document is spent being
precise about where those two behaviors stop being good enough and Sutra's narrower case
starts being worth paying for.

## Who has this problem, and how often

The GMP/1-shaped problem — joint, pre-purchase, per-person-capped consent bound to one
specific merchant checkout — is not the everyday "split the dinner bill" case. That case is
low-stakes, high-trust, and already well served (see the competitive section below). The
shape Sutra actually fits shows up around higher-stakes, lower-frequency group purchases:
event and ticket blocks bought by a friend group, shared travel bookings (a group Airbnb or
a block of flights), one-off big-ticket shared purchases among flatmates or a household,
club and society dues or one-off equipment buys, and workplace or informal-group purchases
where fronting a few hundred dollars is a real ask rather than a rounding error.

No usage data exists to size any of this precisely, because there are no users. What it
depends on is category-specific data nobody on this team has gathered: how often a given
friend group, in a given city, actually buys a block of concert tickets, books a shared trip,
or splits a big one-off purchase in a way that currently forces one person to front real
money. That number is knowable — ticketing platforms and travel sites have it internally —
and it is the first thing a credible next step would go and get, rather than assume.

## The wedge: which working case to attack first, and why

Of the five rows in the README's money-boundary table, exactly one completes an actual
charge: a merchant with a real Sutra/Prava payment adapter. Today that row has zero
production merchants and one test-only merchant (the configured Shopify development store,
`docs/SHOPIFY_FLOW.md` Path C, which explicitly moves no real money). So the only case a
real business can be built on is: get a merchant to accept Prava-mandated group checkout.
Nobody has done that yet. The wedge is therefore a go-to-market bet, not a currently-live
product-market fit, and it should be described that way.

The strongest candidate wedge is event and experience ticketing, for four concrete reasons.
First, it is a purchase groups already coordinate around informally in chat, so the
coordination layer Sutra already built (`docs/COORDINATION.md`) maps onto real behavior
rather than inventing new behavior. Second, per-person ticket prices ($20–300) are high
enough that the processing-fragmentation tax argued below stays a small fraction of the
purchase, unlike a $10 round of coffees. Third, the merchant side has acute, named pain
today: group ticket sales either do not happen because one person will not front $800 for
eight tickets, or they happen with real collection risk when that person cannot get their
friends to pay them back afterward. Fourth, ticketing sits behind a small number of large
platforms rather than millions of independent merchants, which is the shape that makes the
two-sided cold-start problem tractable (see below) — a handful of platform integrations
could reach a large number of consumer groups, rather than needing millions of individual
merchant sign-ups.

Explicitly not the wedge: the restaurant/at-venue case that is the product's own flagship
demo scenario. That is exactly the case where UPI Collect and point-of-sale split tender
already work today, and where Sutra's own `at_venue` rail charges nothing
(`spec/PROTOCOL.md` §10.1). It is the right demo case because it is legible and free to show
without a merchant integration. It is the wrong commercial wedge, because it is the one case
where the incumbents are strictly better than what Sutra ships.

## Why now — two arguments that point in different directions

The protocol-timing argument is real and time-limited: AP2 v0.2 shipped in April 2026 and
was donated to the FIDO Alliance, and standardization of agentic payment mandates is an
active, current process (`spec/AP2-EXTENSION.md`). Multi-principal consent is a documented,
undefended gap in that specification today. Being the working reference implementation of
what a multi-principal extension needs — a shared cart hash across principals, a commit
policy language, consent binding, an atomic-enough commit, backstop absorption, a signed
group receipt, and a settlement-rail declaration (`spec/AP2-EXTENSION.md`, "What a
multi-principal extension needs") — is a real opportunity to influence a standard while it
is still being written. That is evidence of good timing for the protocol contribution. It is
not evidence of a market opening.

The market-timing argument is more cautious, and it should be stated as a caution rather
than a tailwind. Visa Intelligent Commerce and Prava-style merchant-scoped agent payment
credentials are themselves new in 2026. There is no installed base of merchants accepting
them yet. Arriving early means less competition for the multi-principal niche specifically —
but it also means the entire underlying rail this business depends on (agent-issued, capped
card credentials accepted by real merchants at scale) does not exist yet either. Sutra's
timing is downstream of a bet that is not Sutra's to make: whether merchant-side agentic
commerce credentials get adopted broadly in the next one to two years. If that adoption does
not happen, Sutra's addressable market stays at zero regardless of execution quality here.

## Competitive landscape

### UPI Collect — the most dangerous incumbent, and it deserves to be

This is the most dangerous unanswered question a Bangalore-based team can face from a panel
that includes a former Head of Stripe India, and the honest answer starts with a concession.
UPI Collect is real-time, carries no meaningful marginal cost to the consumer, works across
nearly every Indian bank account, and is not credit-limit-constrained the way a card decline
is — it draws from account balance, not a credit line. For the exact scenario this product
demos — four friends splitting a Koramangala dinner bill — UPI Collect, or even a plain
UPI transfer after one person pays, is strictly better than Sutra's own `at_venue` rail
today: it moves real money, instantly, for close to free, into an app every participant
already trusts. Sutra's `at_venue` rail, by contrast, records the exact split and a signed
acceptance, and charges nothing at all — `charged_amount` is always zero on that rail by
protocol design (`spec/PROTOCOL.md` §10.1, §7.3 rule 6). A judge who has used UPI Collect
will correctly notice that, on the single question of whether money moved, Sutra's flagship
demo scenario is a regression from something already free on every Indian phone. That should
be said in the submission before a judge has to say it first.

Where UPI Collect does not reach is where Sutra's actual protocol contribution lives. UPI
Collect has no concept of a shared cart hash, no cross-principal commit policy (quorum, veto,
weighted threshold, required member), and no mechanism to bind N people's consent to one
specific merchant checkout before it happens. It is a peer-to-peer transfer rail. Using it
for an actual group purchase still requires someone to become a temporary custodian —
collect from N friends into one account, then place the order — which reintroduces exactly
the fronting-and-custody risk GMP/1 exists to remove, just compressed from days into minutes
rather than eliminated. UPI Collect also has no commit-or-abort semantics: if three of four
friends pay a collect request and the fourth backs out, the organizer is holding partial
funds with nothing binding them to a merchant transaction, and reconciling that is entirely
manual and entirely on the organizer.

The honest positioning, stated plainly: for low-stakes, high-trust, single-jurisdiction,
pay-a-person-back scenarios, UPI Collect is a better product than anything Sutra ships
today, and Sutra should not claim otherwise in front of this panel. Sutra's case is for the
narrower slice where the purchase must bind to one specific merchant checkout rather than a
peer transfer, where group consent needs real structure beyond "has everyone paid yet," or
where the transaction crosses a currency or a payment rail UPI does not touch. That slice is
real. It is also smaller than "group splits a bill," and most Bangalore dinner splits are not
in it — which is exactly why the wedge section above deliberately does not lead with the
demo's own headline case.

### Splitwise — a real answer, and an honest complication

`spec/PROTOCOL.md` §8 states the claim plainly: on the charging rail, "there is no debt
between members, no ledger of who owes whom." That is a genuine structural difference from
Splitwise, because on `prava_mandates` everybody pays the merchant directly through their own
capped mandate — nobody owes anybody, because nobody borrowed anything.

The complication the audit is right to raise: the `at_venue` rail is, in substance, a
single-event ledger entry. It records `owed_amount` per person against a merchant total,
charges nothing, and issues a receipt (`spec/PROTOCOL.md` §10.3). That is materially a
subset of what Splitwise already does, without the feature that actually makes Splitwise
sticky — netting balances across many events in an ongoing group relationship, so people do
not have to settle every single time. Sutra's `at_venue` receipt is a one-shot object scoped
to a single group session; there is no running cross-group balance, no automatic "you owe
Alex $40 net across six dinners." What Sutra adds on that rail is a cryptographically
tamper-evident, hash-chained, offline-verifiable record of one specific agreement
(`engine/src/receipt.ts:103-155`) — a genuinely different kind of trust object than a row in
an app's database, but a narrower claim than "we beat Splitwise." The honest framing: the
charging rail is where the "no ledger" claim is a structural difference in kind, not an
implementation choice, and it is the only rail on which that comparison should be made.

### Venmo / Zelle

The same shape as UPI Collect, aimed at the US market: peer-transfer rails with a "request
money" or "charge multiple people" feature layered on top. Same structural limits apply — no
shared-cart binding, no commit policy, and either the organizer custodies funds before
spending or fronts and collects after. Zelle in particular settles bank-to-bank with no
reversal mechanism once sent, which is arguably a worse trust position for a large group
purchase than either UPI Collect or a card-mandate rail, because there is no dispute path at
all if the organizer simply does not buy the thing.

### Point-of-sale split tender

Shopify POS, and most modern in-person terminals, already let a cashier split one bill
across several physical cards at the register (`docs/SHOPIFY_FLOW.md` Path A, citing
Shopify's own multiple-partial-payments documentation). For a group standing at the counter
together, this is a complete, zero-software answer today: each person taps their own card,
the terminal charges each amount, done. Sutra's own Path A explicitly does not connect to
the terminal, transmit a cart, or observe the payment — it prepares the split and hands it to
the cashier (`docs/SHOPIFY_FLOW.md`, "Sutra does not connect to the terminal..."). For the
in-person case, Sutra is a convenience layer on top of a capability that already fully works
without it. The honest value-add is "your exact shares and items were computed before you
reached the register," not "this does something POS split tender could not."

### "One person just fronts it" — the real incumbent, and the hardest to beat

This is the behavior every product in this space competes against, including Sutra, and it
wins by default: zero new software, zero new trust placed in a third party, and zero
friction when the group already trusts each other and the amount is small. It stops working
well as ticket size grows, as group trust drops (pickup groups, larger circles, coworkers,
people who have been burned before), or as the fronting person's own credit limit or cash
flow cannot absorb the float until they get paid back. That is the actual segment where
paying for infrastructure starts to make sense — higher ticket, lower trust,
credit-constrained — and it is real, but it is a materially smaller segment than "every group
purchase," and the business case has to be built on that smaller segment, not the whole one.

## Unit economics: the arithmetic, and what it depends on

No number in this section comes from Prava's actual pricing, because Prava's fee schedule is
not published anywhere in this repository or disclosed to this team. Every dollar figure
below is explicitly labeled as an illustrative, industry-typical assumption, chosen only to
make the arithmetic legible, not as a sourced fact about this product's real costs.

**The structural fact worth stating first:** splitting one purchase into N separate
card-network authorizations is intrinsically more processing-fee-expensive than a single
checkout, and the excess cost scales with group size, not with purchase size. Using an
illustrative, industry-typical card-processing rate of 2.9% plus a $0.30 fixed fee per
authorization: a single $600 checkout costs 0.029 × 600 + 0.30 = $17.70 to process. The same
$600 split evenly four ways and charged as four separate $150 mandates costs
4 × (0.029 × 150 + 0.30) = 4 × $4.65 = $18.60 — an extra $0.90. Run the identical group size
against a $40 purchase instead: one checkout costs 0.029 × 40 + 0.30 = $1.46; four $10
mandates cost 4 × (0.029 × 10 + 0.30) = 4 × $0.59 = $2.36 — again an extra $0.90. The excess
cost is the same $0.90 in both cases, because it is driven almost entirely by the three extra
fixed per-transaction fees (3 × $0.30), while the variable-rate component is identical either
way (0.029 × the same total either split or whole). Expressed as a fraction of the purchase,
that fixed $0.90 tax is 0.15% of GMV on the $600 order and 2.25% of GMV on the $40 order —
fifteen times larger, proportionally, on the small order. This is the arithmetic behind the
wedge recommendation above: the fragmentation cost of multi-principal charging is close to
free at event-ticket ticket sizes and structurally punishing at round-of-coffee ticket sizes.
Sutra should not chase small, frequent splits on unit economics grounds alone, independent of
any competitive argument.

**Take-rate arithmetic.** Consider a merchant-side take rate of 1.5% of GMV, in line with
payment-facilitator and BNPL precedent and explicitly not sourced from any signed deal — none
exists. On the $600 event-ticket order above, 1.5% is $9.00 of gross revenue against the
$0.90 fragmentation tax computed above, a workable margin at this ticket size, with the
caveat that whether Sutra or the merchant actually bears that $0.90 depends on a commercial
agreement with Prava that does not exist yet. On the $40 order, 1.5% is $0.60 — less than the
$0.90 fragmentation tax alone, i.e., structurally loss-making before accounting for support,
fraud, or anything else. That is a second, independent confirmation that the business only
works at higher ticket sizes.

**An illustrative monthly figure, explicitly not a forecast.** If a ticketing-platform wedge
reached 5,000 completed group orders a month at an average $400 GMV and a 1.5% take rate,
that is $2,000,000 of monthly GMV and $30,000 of monthly gross revenue. The number 5,000 is
not a projection; it is a number chosen only to make the arithmetic concrete, and there is no
data anywhere that justifies it. Reaching it requires solving the merchant cold-start problem
described below, which has not been attempted.

**CAC.** There is no measured customer-acquisition cost anywhere in this business, because
there are no customers. What it depends on differs sharply by channel. A B2B sales motion
selling group-checkout as a feature to a handful of ticketing or travel platforms carries a
sales-cycle cost plausibly in the low thousands of dollars per merchant relationship,
amortized over however much transaction volume that merchant brings — a number this team has
no basis to estimate without running an actual sales conversation. A consumer viral loop —
every approval link sent to a group member who is not yet a Sutra user — has a plausible
near-zero marginal CAC per organic conversion if even a modest fraction of invitees go on to
organize their own groups, which is the same mechanic that made group-payment products like
Venmo grow. Whether that loop actually converts invitees into repeat organizers, as opposed
to one-time approvers, is completely unproven; the product does not currently require account
creation to approve a share at all (`spec/PROTOCOL.md` §10.3, the pass-the-phone,
account-optional design), which is good for the invitee's friction and unmeasured for
conversion into a return user.

## Who pays Sutra, and how much

Three models are worth naming honestly, and they are not equally credible near-term.

A **merchant take rate** on completed group GMV (the 1.5%-of-GMV model argued above) is the
natural long-run model and the one with the clearest precedent in payment facilitation and
BNPL. It requires exactly the thing this business does not have yet: a merchant relationship.

A **B2B licensing or integration fee**, sold to platforms (ticketing sites, travel booking
platforms, team-management software) as group-checkout infrastructure, is the most credible
near-term model, because it turns the merchant cold-start problem into a sales motion instead
of a chicken-and-egg consumer-acquisition problem: revenue exists from the first signed
platform, before any particular consumer group has to be won over.

A **consumer-facing coordination fee**, charged to the organizer per completed group, is the
weakest of the three. It introduces a new ask at exactly the moment of a payment decision,
competing against a free or near-free default (fronting, or UPI Collect where that applies)
that most groups will take unless the merchant-side value — guaranteed collection, no
chargeback exposure for the merchant — is compelling enough that the merchant, not the
consumer, is willing to pay for it instead.

The recommended sequencing: sell integration to platforms first, evolve toward a blended
merchant take rate once real volume exists, and treat a consumer coordination fee as, at
most, a later supplement rather than a foundation. None of this has been tested with a single
real customer, and that should not be obscured by how confident the arithmetic above sounds.

## The two-sided merchant cold-start problem, and a credible path through it

The honest boundary the money-boundary table draws is exactly the two-sided problem: the
charging rail requires a merchant with a Prava adapter, and there are zero real merchants
today — only one configured Shopify development store that explicitly moves no money
(`docs/SHOPIFY_FLOW.md` Path C). Consumers have no reason to adopt Sutra until merchants they
already want to buy from support it. Merchants have no reason to integrate until there is
consumer volume to justify the engineering cost described in `docs/SHOPIFY_FLOW.md`'s
seven-step "Future production merchant adapter" section — stable quoting, N real captures,
reconciliation, refund and fulfilment event handling.

The credible path is not to solve the general two-sided problem. It is the standard playbook
for exactly this shape of cold start: concentrate on the supply side first. Pick one or a
small number of anchor merchants in the ticketing wedge — platforms that already serve large
numbers of consumer groups through a single integration point — and build the dedicated
adapter described in `docs/SHOPIFY_FLOW.md` for that one relationship, rather than trying to
be a generic merchant-agnostic product from day one. That converts "get every merchant to
adopt an unproven protocol" into "close one sales relationship and build one integration,"
which is a materially smaller and more fundable problem, at the cost of narrowing the product
to whatever that one merchant's category actually needs.

## What would have to be true for this to be a company

A production merchant adapter processing real captures, not test-mode ones. A proven wedge
vertical with organizer pain validated by something more than assumption — interviews,
observed group-purchase volume, or a signed pilot, none of which exist yet. A revenue model
validated against at least one paying merchant or a meaningful share of organizers willing to
pay a coordination fee, rather than the illustrative arithmetic above. A ticket-size mix that
stays concentrated at the higher end, where the unit-economics section shows the fragmentation
tax is a small fraction of GMV, because the same arithmetic shows the business is structurally
unprofitable at small, frequent splits. Evidence that the invite loop actually converts
approvers into repeat organizers, not just one-time acceptors of somebody else's group. A
resolved dispute-and-refund operating procedure, argued honestly below, because "ask the
merchant or open a chargeback" is not an answer a payments business can operate at scale on.
And legal validation, jurisdiction by jurisdiction, of the "not a money transmitter" posture
that `spec/PROTOCOL.md` §8 and `spec/AP2-EXTENSION.md` currently argue only as an engineering
property (authorizations flow member card → merchant through a single-use credential; the
engine never holds funds) — that argument is a sound description of the architecture, and it
is not a compliance opinion, and treating it as one before a lawyer has said so would be
exactly the kind of overclaim this project otherwise avoids.

## What would kill it

Merchant non-adoption, full stop — if no merchant of any size ever integrates a Prava-style
adapter, the charging rail stays a demo forever and the business does not exist. An incumbent
(UPI, Venmo, Zelle) bolting a merchant-checkout-binding feature onto its existing peer-transfer
rail — a materially smaller engineering lift for them, given they already have the
distribution and regulatory relationships, than building multi-principal commit policies from
scratch is for Sutra. Chargeback and dispute costs at scale exceeding whatever take rate is
charged, which is the classic failure mode of marketplace-adjacent payments businesses and is
discussed concretely below because it is not hypothetical here — it is a documented, current
gap. Regulatory reclassification as a money transmitter if pooling ever creeps in under growth
pressure, which is the single most common bad decision growth-stage fintechs make ("let's just
hold the money briefly to make it faster"). And, more mundanely, the high-ticket,
infrequent-purchase niche this document argues is the only economically sound wedge turning
out to be real but simply too small to be a venture-scale business on its own.

## The chargeback and refund story: what the three charged humans actually do next

This is Manjot Pahwa's exact scenario, and it deserves a direct answer rather than a
redirection to how well the mechanics are tested.

**What is genuinely well handled, and should be said first.** Most of the ways a group
purchase could go wrong are caught before any card is charged at all. Policy evaluation locks
the approver set and moves to commit preparation only once the commit policy is satisfied
(`spec/PROTOCOL.md` §4); a shortfall discovered at that point is covered by an armed
backstop's standing mandate or resolved through a requote — a fresh, capped approval request —
before the charging saga starts (`spec/PROTOCOL.md` §4.1, `engine/src/service.ts:529`
`requoteCascade`). A `straggler_policy` of `retry_once`, `drop_and_continue`, or
`halt_partial` (`engine/src/types.ts:136-137`) governs what happens if a charge fails during
the sequential commit itself. A charge whose result is unknown — a lost response, a timeout —
is never treated as a failure; the engine asks Prava for the idempotency reference before
deciding anything, specifically so a retry never becomes a double charge
(`spec/PROTOCOL.md` §4.2, `engine/src/prava/client.ts:182-216` `chargeMandate`, which
distinguishes a terminal 4xx refusal from a transport failure by design). All of this is
tested, not merely asserted, per the crash-resume suite the audit independently verified
(`engine/test/crash-double-charge.test.ts`).

**Where the well-handled mechanics stop.** The scenario the judge describes — card four
declines after cards one through three have already captured — is specifically the case that
survives all of the above: it is a genuine card-network failure (a frozen card, insufficient
funds, a fraud block) striking during the sequential charge loop itself, after the committed
set was already locked and the first captures already landed for real. `straggler_policy`
governs how the engine reacts to that moment; it cannot prevent the moment from happening,
because the failure is the card network, not a coordination bug.

**What the three charged people get today.** A `partial` group status and a signed receipt
whose entries name exactly what each of them was charged, to which merchant, with the
mandate and transaction ids on the record (`spec/PROTOCOL.md` §7.1's `mandate_id` and
`charge_txn_id` fields), and `totals.charged` visibly short of `totals.owed`. That receipt is
real evidence — cryptographically verifiable, offline, without trusting Sutra's own UI
(`engine/src/receipt.ts:103-155`). Evidence is not a remedy.

**What Sutra does not do today, stated plainly.** It does not initiate a refund, contact the
merchant, or file anything on the charged members' behalf. The NANDA plugin's own documented
behavior makes the underlying limit explicit rather than hiding it: a post-capture reversal
raises `RefundNotSupportedError`, and the exception itself carries the only real remedy —
"issue a merchant-initiated refund against the Prava transaction id..., or have the cardholder
open a chargeback" (`nanda-town-prava/nanda_town_prava/plugin.py`, and demonstrated live in
`docs/NANDA-EVIDENCE.md` §3.3, "refund() post-charge"). That is not a limitation specific to
the NANDA plugin; it is a limitation of the underlying Prava charge primitive itself, which
performs a real capture (`engine/src/prava/client.ts:182` `chargeMandate`), not a delayed
authorization that could simply be released. So the same gap sits at the Sutra product layer,
and the honest, uncomfortable answer to "what do the three charged humans do next" is: today,
exactly what that exception message says. Ask the merchant for a refund against the
transaction id already sitting in their receipt, or open a chargeback with their own bank.
There is no automated remedy in the current build, and a payments-literate judge reading that
as unfinished dispute operations, rather than a hidden feature, is reading it correctly.

**What a real product needs to add — named as roadmap, not overstated as built.** Auto-drafting
a merchant refund request from the transaction id and receipt data that already exist
structurally, which would remove most of the manual burden since the underlying record is
already there. Making `halt_partial` — the policy that minimizes blast radius by stopping at
the very first decline instead of continuing to charge more people into an order that will
never ship — the default above some stated ticket-size threshold, because it is the
operationally cheapest failure mode to run a business on, even though it produces more
`partial` outcomes than a more optimistic policy would. And investigating whether Prava, or a
future adapter, could support authorize-then-delayed-capture across all N holds
simultaneously, so a late decline releases an authorization instead of requiring a refund of
money that has already settled at the merchant — this would be a materially different
integration from the single `chargeMandate` capture call that exists today, and it does not
exist in any form in this repository.

**The cost this represents, stated in the terms a payments judge will actually use.**
Chargebacks carry real per-dispute fees charged by the acquirer — commonly cited in the
industry as roughly $15 to $25 per dispute, an illustrative figure and not anything specific
to Prava's own pricing, which is not published. Past a threshold dispute rate — commonly
cited as keeping disputes under roughly 1% of transaction volume to avoid card-network
monitoring programs, again illustrative and not Prava-specific — a business can have its
payment processing put at risk entirely, independent of how good its product is otherwise.
This is a real, currently uncosted operational liability, not a hypothetical one, and any
credible take rate has to price it in from the first transaction rather than discovering it
once volume exists.

## In one paragraph, for a judge reading this on a phone

Zero users, no signed merchant, no validated pricing, and one genuinely unresolved
operational gap in how three charged people get their money back when a fourth person's card
declines mid-commit. Also: a real and narrow wedge in high-ticket, infrequent group purchases
where the unit economics actually work; a specific, arithmetic argument for why small,
frequent splits do not and should not be chased; an honest concession that UPI Collect beats
this product outright on the exact scenario it demos; and a genuine, currently timely protocol
contribution whose entire commercial value depends on a merchant-adoption bet that nobody —
not this team, not the market yet — has actually made.
