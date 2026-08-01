# Multi-Principal Mandates: a gap in AP2 (and ACP, and Visa IC)

*A one-page positioning memo. GMP/1 is the existence proof.*

## The gap

Google's Agent Payments Protocol (AP2) formalizes the mandate chain
**Intent Mandate → Cart Mandate → Payment Mandate**, each cryptographically
signed by *the user*. Singular. Stripe's ACP and Visa Intelligent Commerce
make the same assumption: exactly one principal authorizes exactly one
payment credential for one coordinated action.

Real purchases are frequently plural: flatmates, friend groups, families,
clubs, DAOs with debit cards. Today these groups act through a workaround —
one person fronts the money and becomes an unlicensed, unsecured, socially
awkward creditor to their friends. Every splitting app administers the debt
this workaround creates; none removes the workaround.

## What a multi-principal extension needs

From building GMP/1 on Prava, the minimal set:

1. **A group intent object** — one cart, N principals, each with a share
   binding (item claims + pro-rata rules in integer minor units).
2. **A commit policy language** — `all_of | quorum(m) | weighted(t) |
   veto(who, p) | required(who, p) | deadline(t, p, fallback)` — evaluated
   over member consent states, with a monotonicity guarantee (an added
   approval can never invalidate a satisfied policy).
3. **Consent binding** — each member's signature covers (cart_hash, cap,
   merchant scope, expiry). Cap = share × (1 + tolerance). Any change beyond
   the cap requires re-consent from that member alone, not the group.
4. **An atomic-enough commit** — charges do not roll back, so the layer needs:
   decoupled approve-then-charge (AP2's mandates already have this shape),
   per-charge idempotency references, an unknown-is-never-failed reconciliation
   rule, straggler policies, and an append-only decision log.
5. **Delegated shortfall absorption** — a standing, capped, pre-signed
   commitment by member B to absorb member A's dropped share (the "backstop").
   This is the primitive that makes the group robust to individual failure —
   and it is the first primitive of group credit, executed without pooled funds.
6. **A signed group receipt** — the ordered consent chain, hash-linked and
   engine-signed, so any member (or regulator) can verify who consented to
   what without trusting the coordinator's UI.

## Why the coordinator is not a money transmitter

In GMP/1 every dollar flows member card → merchant through a single-use,
merchant-locked, amount-capped network credential. The coordinator holds
authorizations, not funds. An AP2 extension that keeps this property inherits
the same clean compliance posture.

## Proposal

Reserve a `principals[]` array plus `commit_policy` object in the AP2 Cart
Mandate, with per-principal Payment Mandates referencing the shared
cart_hash. GMP/1 (github: sutra) is a working reference implementation of the
semantics on Prava's mandate rail — including quorum drops, backstop
absorption, requote cascades, sealed-bid slot allocation, and signed consent
receipts, all under a chaos harness that proves no-double-charge and
abort-means-zero-charges under injected faults.

*Contact: team `__init__ to win it`.*
