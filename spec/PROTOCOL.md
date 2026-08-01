# GMP/1 — The Group Mandate Protocol

**Status:** draft-1 · **Authors:** team `__init__ to win it` (Soham, Arshjeet) · Agentic Commerce Hackathon, Aug 2026

## 0. Problem

Every agentic payment protocol shipping today — Google AP2, Stripe ACP, Visa
Intelligent Commerce, Prava — encodes the same shape: **one user grants one
agent one mandate**. Groups are invisible to payments infrastructure. GMP/1
defines how **N principals jointly authorize one coordinated action**, without
pooled funds, without anyone fronting money, and without the coordinator ever
touching a card number.

## 1. Definitions

- **Group mandate** — a set of individual payment mandates, one per member,
  each backed by that member's own card, bound together by a **commit policy**
  and executed by an engine that understands card charges do not roll back.
- **Commit policy** — an expression tree evaluated over member states:

```
policy := all_of
        | quorum(m)
        | weighted(threshold)
        | veto(member, inner)
        | required(member, inner)
        | deadline(t, primary, fallback)
```

- **Consent object** — the tuple (member, cart_hash, cap, mandate_id) a member
  passkey-approves. Consent binds to the cart hash and the cap; neither can be
  exceeded without re-consent.
- **Tolerance** — cap = share × (1 + tolerance_bps/10⁴). Absorbs price drift
  and post-drop re-pro-rating without re-consent, because it was part of the
  consent the member gave.

## 2. Objects

`GroupSession` (id, title, merchant, canonical cart + sha256 hash, policy,
tolerance, straggler_policy, deadline, status, version) ·
`MemberIntent` (id, name, role ∈ {payer, sponsor, backstop, observer}, weight,
share, cap, mandate ids, requote_round, status, version) ·
`Event` (append-only, the single source for SSE, board, replay, receipts, and
crash recovery) · `Receipt` (hash-chained consent objects, Ed25519-signed).

## 3. State machines

**Member:** `invited → viewed → awaiting_approval → approved → charging →
charged`, with exits to `declined` (explicit or external mandate
cancellation), `expired` (deadline), `dropped` (quorum decision / abort),
`failed` (charge declined). `approved → awaiting_approval` only via requote,
which first cancels the stale mandate and increments `requote_round` (cap: 2).

**Group:** `collecting → deciding → committing → committed`, with exits to
`aborted` (policy unsatisfiable / organizer cancel), `expired` (deadline with
policy open), `partial` (straggler policy left a mixed outcome). `deciding` is
instantaneous in this implementation.

## 4. The decision

On every member event and on deadline ticks the engine evaluates the policy
over a version-locked snapshot:

- **satisfied** → lock the approver set, drop everyone else, proceed to commit
  preparation.
- **unsatisfiable** → abort: cancel every mandate; nobody was ever charged.
- **open** → keep collecting (unless the deadline forces expiry).

Monotonicity invariant (property-tested): flipping any member from pending to
approved never turns a satisfied policy unsatisfied.

### 4.1 Commit preparation

1. **Adjust the cart** (tiered carts): extra-tier items claimed only by
   non-locked members leave the cart. Core items stay whole.
2. **Recompute target shares** over the adjusted cart for the locked set
   (fees/tax re-pro-rated, largest-remainder, integer minor units).
3. Each member's charge = min(target, cap) — consent cannot stretch.
4. **Shortfall** = adjusted total − Σ charges. If > 0:
   - allocate across **armed backstops** proportionally to caps (each ≤ cap);
   - else **requote**: over-cap members get a fresh mandate session at the new
     share (round-capped at 2, then abort).

### 4.2 Commit

The point of no return is the first charge call. Sequential, per locked entry:

```
guard: skip if already settled (crash-resume idempotency)
emit charge.attempted(attempt, reference)        reference = f(group, member, source, attempt)
charge mandate (reference = provider idempotency key)
  transport error → retry SAME reference (provider dedupes; can never double-charge)
  exhausted     → state UNKNOWN: park, resume later; unknown is never failed
declined → straggler policy: retry_once | drop_and_continue | halt_partial
minted   → report settlement APPROVED (retry w/ backoff; report failure is
           never re-charged — event log holds the truth)
```

Afterwards: cancel every authorization that was never charged, emit the signed
receipt, transition to `committed` or `partial`.

### 4.3 Crash recovery

On boot the engine replays the event log for every non-terminal group and
re-enters commit from the first entry without a settled outcome. The attempt
counter is reconstructed from `charge.attempted` events; an attempt without a
recorded outcome is redone under its original idempotency reference.

## 5. Roles

**Organizer** creates and may cancel pre-commit. **Payer** approves and pays
their share. **Sponsor** covers a named member's share on the sponsor's card
(one bigger mandate). **Backstop** additionally pre-authorizes a second
one-time mandate up to X, charged only if the shortfall logic fires — a
pre-approved intra-group trust line executed with zero pooled funds: the first
primitive of group credit. **Observer** watches.

## 6. Priority auctions (allocation-only sealed bids)

A contested item (claimants > slots) opens a sealed-bid window. Bids are
priority signals bounded by the member's own maximum; they decide **who gets a
slot, never what anyone pays** — winners pay the merchant price through their
own mandates. Ties break by earliest submission (deterministic and recorded).
At close, the full ranking is revealed in the event log, the cart is rewritten
to the winners, shares recompute, and consent binding decides who must
re-approve. This keeps member-to-member negotiation legal on rails that
prohibit P2P: bids allocate, they never price.

## 7. The receipt

An ordered chain of consent objects — each binding member, cart_hash, cap,
mandate id, and outcome — hash-linked (`prev_hash`), headed, and
Ed25519-signed by the engine. `gmp verify receipt.json` recomputes the chain,
checks totals against entries, and verifies the signature against the printed
public key. Trust the artifact, not the UI.

## 8. Compliance posture

The engine never sees a PAN, never holds funds, never moves funds. Every
dollar flows member card → merchant through a single-use, merchant-locked,
amount-capped network credential minted by the payments provider. The engine
coordinates *authorizations*; it is software in front of a regulated rail,
not a money transmitter.

## 9. Levels (the arc)

L0 one group buying tickets tonight · L1 any app adding group checkout
(30-line widget / REST / MCP) · L2 policies as a language · L3 member
delegate agents deciding within owner-set caps, humans at the root of trust ·
L4 persistent circles with reliability records and standing trust lines on
recurring mandates — group consent quietly becoming group credit.
