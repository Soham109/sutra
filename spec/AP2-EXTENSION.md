# Multi-principal mandates: a gap in AP2 v0.2 (and ACP, and Visa IC)

*A positioning memo. [GMP/1](PROTOCOL.md) is the existence proof.*

**Revised against AP2 v0.2.** The first version of this memo argued against
AP2 v0.1's three-mandate chain (Intent Mandate → Cart Mandate → Payment
Mandate). The current specification does not define that chain: it defines two
mandate types, each in two forms. AP2 v0.2.0 shipped on **28 April 2026**,
Google donated the protocol to the **FIDO Alliance**, and standardisation
continues in FIDO's Agentic Authentication and Payments technical working
groups. Everything below is checked against the current specification at
[ap2-protocol.org](https://ap2-protocol.org/ap2/specification/); our
positioning did not change, but the surface it attaches to did.

## What AP2 v0.2 actually defines

Two mandate types, each in an **open** and a **closed** form, carried as
selective-disclosure JWTs:

| Mandate | Closed `vct` | Open `vct` |
|---|---|---|
| Checkout Mandate — the specific items and purchase details negotiated with the merchant | `mandate.checkout.1` | `mandate.checkout.open.1` |
| Payment Mandate — authorization against a specific payment instrument | `mandate.payment.1` | `mandate.payment.open.1` |

A **closed** mandate carries authorization for one finalized transaction. An
**open** mandate carries the user's *constraints* ahead of time, so an agent
can execute autonomously inside them — the `cnf` claim (RFC 7800) binds the
agent's public key, which is what makes "human not present" safe to specify at
all. Open-mandate constraints are an extension point; the ones defined today
are:

- **Payment:** `payment.allowed_payees`, `payment.allowed_payment_instruments`,
  `payment.allowed_pisps`, `payment.amount_range`, `payment.budget`,
  `payment.agent_recurrence`, `payment.execution_date`.
- **Checkout:** `checkout.allowed_merchants`, `checkout.line_items`.

Money in v0.2 is integer **minor units** ("integer minor units, according to
the ISO-4217 spec") with an ISO-4217 three-letter `currency` code — 19900 USD
is $199.00. That agrees exactly with how GMP/1 has represented money from the
start, and it is worth checking against any v0.1-era implementation before
assuming the field means the same thing.

## The gap

Take the whole of that surface and count the principals. **Every one of these
mandate types is single-principal.** A Checkout Mandate is signed by *the*
user. A Payment Mandate authorizes against *a* payment instrument. An open
Payment Mandate's `cnf` binds *the* agent that user delegated to. There is
nowhere in v0.2 to express *"these four people are each authorizing part of one
purchase, and it happens for all of them or none of them."*

Stripe's ACP and Visa Intelligent Commerce make the same assumption. So, for
that matter, does Prava, which is what we built on.

Real purchases are frequently plural: flatmates, friend groups, families,
clubs, DAOs with debit cards. Today these groups act through a workaround — one
person fronts the money and becomes an unlicensed, unsecured, socially awkward
creditor to their friends. Every splitting app administers the debt this
workaround creates; none removes the workaround.

## The nearest existing analogue, and why it is not enough

`payment.budget` on an **open** Payment Mandate is the closest thing AP2 v0.2
has to our per-member cap. It is a cumulative spending limit tracked across the
closed mandates derived from it, which is genuinely the same *kind* of object
as GMP/1's `cap = ⌈share × (1 + tolerance)⌉`: a ceiling the principal set in
advance, enforced below them rather than by the agent asking.

What it cannot express is the part that makes a group hard:

1. **A shared cart hash across principals.** `checkout.line_items` constrains
   one user's acceptable line items. Four people approving *the same cart* need
   the same cart digest inside four different mandates, and a change to it must
   invalidate exactly the members whose consent no longer covers their share —
   not all of them, and not none of them.
2. **A joint commit condition.** There is no object anywhere in AP2 that says
   "execute all of these or none of them". Each mandate stands alone.
3. **The failure semantics of executing several of them together.** Card
   charges do not roll back. Four independent authorizations charged in
   sequence is not four-fifths of a group purchase; it is three people charged
   for something that did not happen.

## What a multi-principal extension needs

From building GMP/1 on Prava, the minimal set:

1. **A group intent object** — one cart, N principals, each with a share
   binding (item claims + pro-rata rules in integer minor units, which v0.2
   now agrees with).
2. **A commit policy language** — `all_of | quorum(m) | weighted(t) |
   veto(who, p) | required(who, p) | deadline(t, p, fallback)` — evaluated over
   member consent states, with a monotonicity guarantee: an added approval can
   never invalidate a satisfied policy.
3. **Consent binding** — each principal's signature covers (cart_hash, cap,
   merchant scope, expiry). Any change beyond the cap requires re-consent from
   *that* member alone, not from the group. This is the smallest addition to
   AP2: a closed Checkout Mandate already binds a cart, and an open Payment
   Mandate already binds a budget. What is missing is that the cart is *shared*
   and the budget is *a share of it*.
4. **A crash-safe sequential commit** — charges are not atomic and do not roll
   back, so the layer needs decoupled approve-then-charge (AP2's mandates
   already have this shape), per-charge idempotency references, an
   unknown-is-never-failed reconciliation rule, straggler policies, and an
   append-only decision log.
5. **Delegated shortfall absorption** — a standing, capped, pre-signed
   commitment by member B to absorb member A's dropped share (the *backstop*).
   This is the primitive that makes a group robust to individual failure, and
   it is the first primitive of group credit, executed without pooled funds.
   Note that this is expressible *almost* in AP2 terms today: it is an open
   Payment Mandate with a `payment.budget` and a `payment.allowed_payees`
   constraint, whose trigger condition is another principal's failure — and
   that trigger has no home in the current spec.
6. **A signed group receipt** — the ordered consent chain, hash-linked and
   engine-signed, so any member (or regulator) can verify who consented to what
   without trusting the coordinator's UI.
7. **A settlement rail declaration.** Not every group purchase has a merchant
   the network can charge. A protocol that only models the chargeable case
   pushes the other case into the UI layer, where it becomes a claim that money
   moved when it did not. GMP/1 carries the rail in the receipt and makes a
   false claim cryptographically detectable (see [PROTOCOL.md](PROTOCOL.md) §10
   and §7.3).

## Why the coordinator is not a money transmitter

In GMP/1 every unit of money on the charging rail flows member card → merchant
through a single-use, merchant-locked, amount-capped network credential. The
coordinator holds authorizations, not funds. An AP2 extension that keeps this
property inherits the same clean compliance posture; one that introduces a
pooled group balance does not, and would need a licence in most jurisdictions
it operates in.

## Proposal

Reserve, in a future AP2 revision:

- a `principals[]` array and a `commit_policy` object on the **Checkout
  Mandate**, so one negotiated cart can carry N signers;
- a per-principal **Payment Mandate** referencing the shared cart digest, with
  its existing `payment.budget` constraint doing the work of the per-member cap
  (this needs no new constraint type);
- one new open-mandate constraint type for conditional shortfall absorption —
  a budget that may only be drawn against on another named principal's failure.

We are not proposing that AP2 adopt GMP/1's wire format. We are proposing that
the multi-principal case is a real, common, currently unrepresentable one, and
offering a working reference implementation of the semantics on Prava's mandate
rail — including quorum drops, backstop absorption, requote cascades,
sealed-bid slot allocation, non-charging settlement, and signed consent
receipts, all under a chaos harness that demonstrates no-double-charge and
abort-means-zero-charges under injected faults.

## What this repository does *not* do

To be unambiguous: **sutra issues no AP2 mandate and consumes none.** It speaks
Prava's mandate API. This document is a positioning argument about a gap in
AP2, not a claim of AP2 interoperability. Bridging the two would mean emitting
a closed Checkout Mandate per member over the shared cart hash, and that is
unbuilt.

*Contact: team `__init__ to win it`.*

## Sources

- [AP2 specification (v0.2)](https://ap2-protocol.org/ap2/specification/)
- [Checkout Mandate](https://ap2-protocol.org/ap2/checkout_mandate/)
- [Payment Mandate](https://ap2-protocol.org/ap2/payment_mandate/)
- [google-agentic-commerce/AP2 releases](https://github.com/google-agentic-commerce/AP2/releases) — v0.2.0, 28 April 2026
- [FIDO Alliance — building the trust layer for agentic payments](https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/)
