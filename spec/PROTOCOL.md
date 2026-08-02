# GMP/1 — The Group Mandate Protocol

**Status:** draft-2 · **Authors:** team `__init__ to win it` (Soham, Arshjeet) · Agentic Commerce Hackathon, Aug 2026

Reference implementation: [`engine/src/`](../engine/src/). Where a section
names a file, that file is the normative source and this document is the
summary.

Companions: [`docs/COORDINATION.md`](../docs/COORDINATION.md) documents in full
the pre-protocol phase that §11 summarises ·
[`spec/AP2-EXTENSION.md`](AP2-EXTENSION.md) positions GMP/1 against AP2 v0.2.

## 0. Problem

Every agentic payment protocol shipping today — Google AP2, Stripe ACP, Visa
Intelligent Commerce, Prava — encodes the same shape: **one user grants one
agent one mandate**. Groups are invisible to payments infrastructure. GMP/1
defines how **N principals jointly authorize one coordinated action**, without
pooled funds, without anyone fronting money, and without the coordinator ever
touching a card number.

A second problem falls out of the first. Some group purchases have no merchant
the payment provider can charge at all — a restaurant bill is the obvious case.
GMP/1 handles those on a **separate settlement rail** that performs every part
of the protocol except moving money, and is required to say so in the artifact
it produces (§10).

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
- **Tolerance** — cap = ⌈share × (1 + tolerance_bps/10⁴)⌉. Absorbs price drift
  and post-drop re-pro-rating without re-consent, because it was part of the
  consent the member gave. Rounded **up**, so the cap always covers the drift
  it was sized for ([`protocol/money.ts`](../engine/src/protocol/money.ts)).
- **Settlement rail** — which mechanism can actually discharge a member's
  obligation on this GroupSession, and therefore what the words *charged* and
  *settled* are permitted to mean about it. Two rails are defined in §10.

## 2. Objects

`GroupSession` (id, title, merchant, canonical cart + sha256 hash, policy,
tolerance, straggler_policy, deadline, **rail**, origin, status, version) ·
`MemberIntent` (id, name, role ∈ {payer, sponsor, backstop, observer}, weight,
share, cap, mandate ids, charged_amount, requote_round, status, version) ·
`Event` (append-only, the single source for SSE, board, replay, receipts, and
crash recovery) · `Receipt` (hash-chained consent objects, Ed25519-signed).

`rail` is fixed at creation from evidence about the merchant (§10.2) and is
never changed afterwards. Every surface, every event and the receipt read it.

## 3. State machines

**Member:** `invited → viewed → awaiting_approval → approved → charging →
charged`, with exits to `declined` (explicit or external mandate
cancellation), `expired` (deadline), `dropped` (quorum decision / abort),
`failed` (charge declined). `approved → awaiting_approval` only via requote,
which first cancels the stale mandate and increments `requote_round` (cap: 2).

On a rail that cannot charge, the tail of that path is different: approval is
an explicit acceptance rather than a passkey ceremony, and the terminal state
is **`settled`**, not `charged`:

```
invited → viewed → awaiting_approval → approved → settled
```

`settled` is a distinct status on purpose. A member who is `settled` has agreed
their exact amount and owes it to the venue directly; no card was charged
through this engine, and no surface, event or receipt is permitted to say
otherwise. `MEMBER_TERMINAL` contains both; `isSettled(status)` is the
predicate for "this member's obligation is discharged, on whichever rail
carried it" ([`types.ts`](../engine/src/types.ts)).

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

A member who is `approved` but **on hold** counts as pending, not as approved.
A live sealed-bid auction defers every decision until it closes, because slots
must be allocated before shares — and therefore consent — are final.

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
  4xx error envelope → TERMINAL refusal. No charge exists; fail this entry now.
                       Retrying a definite "no" burns the window and disguises
                       it as unknown.
  transport error   → ASK before retrying: fetch the mandate's charges[] and
                       look for our reference. If it is there the charge landed;
                       adopt its transaction id and never reissue.
  retries exhausted
  AND nothing found → state UNKNOWN: park, resume later; unknown is never failed
declined → straggler policy: retry_once | drop_and_continue | halt_partial
minted   → report settlement APPROVED (retry w/ backoff; report failure is
           never re-charged — event log holds the truth). Settlement is only
           closed when the provider says status "completed" AND the network did
           not report visaConfirmation "FAILURE".
```

Afterwards: cancel every authorization that was never charged, emit the signed
receipt, transition to `committed` or `partial`.

**On a non-charging rail** (§10) this whole saga is skipped. Committing means
the allocation is final and every locked member has agreed their number: each
one moves to `settled` with `charged_amount = 0`, the group moves to
`committed`, and the receipt is issued with `rail: "at_venue"` and a total
charged of zero. There is no card to touch, so there is nothing to make atomic.

### 4.3 Crash recovery

On boot the engine replays the event log for every non-terminal group and
re-enters commit from the first entry without a settled outcome. The attempt
counter is reconstructed from `charge.attempted` events; an attempt without a
recorded outcome is redone under its original idempotency reference. A
`charge.unknown` event is deliberately **not** an outcome, so a resumed commit
reuses the same reference rather than starting a fresh attempt.

## 5. Roles

**Organizer** creates and may cancel pre-commit. **Payer** approves and pays
their share. **Sponsor** covers a named member's share on the sponsor's card
(one bigger mandate); the sponsored member becomes an observer. **Backstop**
additionally pre-authorizes a second one-time mandate up to X, charged only if
the shortfall logic fires — a pre-approved intra-group trust line executed with
zero pooled funds: the first primitive of group credit. **Observer** watches.

Backstops are a property of the charging rail. On a non-charging rail no
backstop mandate is minted and no absorption can occur, because there is no
charge to absorb.

## 6. Priority auctions (allocation-only sealed bids)

A contested item (claimants > slots) opens a sealed-bid window. Bids are
priority signals bounded by the member's own maximum; they decide **who gets a
slot, never what anyone pays** — winners pay the merchant price through their
own mandates. Ties break by earliest submission (deterministic and recorded).
At close, the full ranking is revealed in the event log, the cart is rewritten
to the winners, shares recompute, and consent binding decides who must
re-approve. This keeps member-to-member negotiation legal on rails that
prohibit P2P: bids allocate, they never price.

While the window is open the stream reports only that a bid landed, never how
much. The window closes early once every claimant of every contested item has
bid.

## 7. The receipt

An ordered chain of consent objects, hash-linked (`prev_hash`), headed, and
Ed25519-signed by the engine over the canonical JSON of everything but the
signature. `gmp verify receipt.json` recomputes the chain, checks totals
against entries, and verifies the signature against the printed public key.
Trust the artifact, not the UI.

### 7.1 Entry fields

| Field | Meaning |
|---|---|
| `kind` | `consent` or `backstop` |
| `member_id`, `name`, `role` | who |
| `cart_hash` | what they consented to |
| `cap_amount` | the ceiling their consent carried |
| `quoted_share` | what they were quoted |
| `charged_amount` | **money this engine actually moved.** Non-zero only for a member whose status is `charged`, or for an absorbed backstop |
| `owed_amount` | what this person agreed to pay. On the charging rail this equals what was charged; on a non-charging rail it is the whole obligation, and `charged_amount` is 0 |
| `mandate_id`, `charge_txn_id` | the provider handles, or null |
| `outcome` | `charged` · `settled_at_venue` · `absorbed` · `not_charged:<status>` |
| `prev_hash`, `hash` | the chain |

`charged_amount` and `owed_amount` are separate fields precisely so that a
receipt cannot express "they owe this" and "we charged this" with the same
number when only one of them is true.

### 7.2 Receipt fields

Beyond the entries: `gmp_version`, `group_id`, `title`, `merchant`, `currency`,
`cart_hash`, `policy`, `decision_narrative`, `status`, `issued_at`,
`chain_head`, `public_key` (raw 32-byte Ed25519 key, hex), `signature`, plus:

- **`rail`** — which settlement rail carried this, and therefore what
  `charged` is capable of meaning here.
- **`settlement_disclosure`** — one sentence, copied from the rail's own
  definition, stated inside the artifact itself so a receipt read in isolation
  (printed, emailed, handed to a judge) cannot be mistaken for proof of a
  payment it never claimed to make.
- **`totals`** — `{ quoted, charged, owed }`.

### 7.3 Verification rules

`verifyReceipt()` ([`receipt.ts`](../engine/src/receipt.ts)) fails a receipt if
any of the following hold:

1. an entry's `prev_hash` does not equal the previous entry's `hash`;
2. an entry's `hash` does not match the sha256 of its own canonical JSON;
3. `chain_head` does not equal the final entry's hash;
4. `totals.charged` ≠ Σ `charged_amount`;
5. `totals.owed` ≠ Σ `owed_amount`;
6. **`rail` is `at_venue` and the charged total is not zero**;
7. the signature is missing, or does not verify under `public_key`.

Rule 6 is the load-bearing one for §10. The rail is not decoration: a receipt
from a non-charging rail that claims money moved is exactly the forgery this
chain exists to make detectable, and it is detectable offline by anyone holding
the file.

## 8. Compliance posture

The engine never sees a PAN, never holds funds, never moves funds.

On the charging rail, every unit of money flows member card → merchant through
a single-use, merchant-locked, amount-capped network credential minted by the
payments provider. The engine coordinates *authorizations*; it is software in
front of a regulated rail, not a money transmitter.

On the non-charging rail the posture is stronger still, because no instrument
is created at all: the engine produces an allocation, a set of explicit
acceptances, and a signed record. Each person then pays the venue on their own
card at the venue's own terminal. There is no debt between members, no ledger
of who owes whom, and nothing for the engine to settle later — which is exactly
what distinguishes this from a bill-splitting app.

## 9. Levels (the arc)

L0 one group buying tickets tonight · L1 any app adding group checkout
(widget / REST / MCP) · L2 policies as a language · L3 member delegate agents
deciding within owner-set caps, humans at the root of trust · L4 persistent
circles with reliability records and standing trust lines on recurring
mandates — group consent quietly becoming group credit.

L0–L2 are implemented. L3 and L4 are not; see
[`docs/PRODUCT_AND_MOBILE_ROADMAP.md`](../docs/PRODUCT_AND_MOBILE_ROADMAP.md).

---

## 10. Settlement rails

Normative. Implementation: [`engine/src/rails.ts`](../engine/src/rails.ts).

### 10.1 The two rails

| | `prava_mandates` | `at_venue` |
|---|---|---|
| `charges` | true | **false** |
| `mandates` | true | **false** |
| `needs_merchant` | true | false |
| Member consent | passkey approval of a merchant-scoped, amount-capped mandate on the provider's hosted page | explicit acceptance of an exact amount, recorded before the card machine arrives |
| Terminal member status | `charged` | `settled` |
| `settled_verb` (the only verb a surface may use) | "charged" | "settled at the venue" |
| Receipt `charged_amount` | the amount charged | always 0 |
| Receipt `owed_amount` | the amount charged | the whole obligation |

Each rail carries a one-sentence `disclosure`. It is copied verbatim into the
receipt, returned by `POST /v1/bill/split`, and published in the engine's
discovery documents; the bill splitter shows the same sentence to the organiser
before the group is created. The member approval page does not reprint the
capability string verbatim; it states the same consequence in the rail's own
words directly above the accept button ("No card is charged here. You pay
{merchant} directly."), so no member can agree to an amount without having
read what does and does not happen to their card.

The verbs are not interchangeable: neither surface is allowed to borrow the
other's language.

### 10.2 Rail selection

`railFor({ merchantUrl, requested })`:

1. an explicitly requested rail wins;
2. no merchant URL → `at_venue`;
3. a URL that does not parse → `at_venue`;
4. a hostname of `localhost` or ending in `.test` → `at_venue` (the schema's
   placeholder default is not a merchant);
5. otherwise → `prava_mandates`.

Two callers request `at_venue` explicitly, and both have a real reason:

- **Bill splitting.** A photographed or pasted restaurant bill has no merchant
  the provider can charge. `POST /v1/bill/split` sets the rail directly and
  gives the group a merchant URL on a `.test` host, so even the inference would
  agree ([`routes-v2.ts`](../engine/src/routes-v2.ts)).
- **A venue chosen from OpenStreetMap.** Its `url` is an OSM node page or the
  restaurant's brochure site — neither takes payment. Letting that resolve to
  the card rail would put a group on a path that ends in a charge that cannot
  happen, so `convertToGroup` forces `at_venue` whenever the chosen option's
  source is `overpass`, on the source rather than on whether the URL parses
  ([`plan/service.ts`](../engine/src/plan/service.ts)).

An unrecognised rail string resolves to `prava_mandates` — the strict rail —
rather than to the permissive one.

### 10.3 The non-charging lifecycle

1. `openMember` mints nothing. There is no merchant to scope a mandate to and
   no card ceremony to send anyone to, so no approval URL exists. The member
   moves to `awaiting_approval` and `member.awaiting_acceptance` is emitted
   with their exact amount.
2. `acceptShare` records their consent: status `approved`, event
   `member.accepted`. This is the whole of their consent on this rail, and it
   is deliberately a different act from a passkey mandate so the receipt can
   never blur the two. Calling it on a charging-rail group is refused.
3. The ordinary policy evaluation of §4 runs unchanged.
4. On commit, each locked member moves to `settled` with `charged_amount = 0`
   and `member.settled { owed, rail }` is emitted; the group moves to
   `committed` and emits `group.committed { rail, charged: false }`.
5. The receipt is issued with `rail: "at_venue"`, `totals.charged = 0`,
   `totals.owed` equal to the sum of the agreed amounts, and rule 7.3(6) makes
   any later tampering with those numbers detectable.

**Implementation status, stated plainly:** step 2 is reachable over HTTP at
`POST /v1/members/:id/accept` ([`engine/src/routes.ts`](../engine/src/routes.ts)),
it is live on the deployed engine, and the member approval page calls it — the
button reads *"That's right — I owe {amount}"* and never borrows the card
rail's language. The whole lifecycle runs end to end from a browser.

The route carries a consent guard, and the reason is worth stating. A member id
is a bearer capability by design — you get a personal link and need no account —
but `GET /v1/groups/:id` hands out every member's id to anyone who can read the
board, so knowing an id is not evidence of being that person. On this rail the
output is a **signed receipt stating that someone agreed to owe money**. So if a
seat belongs to an account, only that account (or the service token) may accept
it; a seat with no account behind it stays link-only, which is the whole
pass-the-phone design and cannot be tightened without deleting it. A
tamper-evident record of a consent that never happened is the one lie this
codebase exists to refuse.

---

## 11. The coordination phase (pre-protocol, NOT part of GMP/1)

**This section is non-normative and describes a layer that sits above the
protocol.** Nothing in it is GMP/1. An implementation of GMP/1 that has no
coordination layer at all is complete; an agent that speaks only `/v1/groups`
is a first-class client. The boundary matters because `/v1/groups` is the
contract other systems integrate against, and it must not acquire product
opinions.

GMP/1 begins when a group already knows what it is buying. Real groups do not
start there — they start at *"movie this weekend?"* and spend an hour deciding
when, where, and whether anyone can actually make it. The coordination phase is
that hour, made into an object.

### 11.1 Objects

`Plan` (intent text, kind ∈ {venue, product, bill, open}, slots, the list of
signal kinds it is asking for, status, deadline, chosen option, resulting
group_id, rail) · `PlanParticipant` · `Signal` (append-only) ·
`PlanOption` (with the raw source response retained for provenance) ·
plan-scoped events, mirroring the protocol's event log so the two halves of a
story render as one thread.

Status: `gathering → options → deciding → converted`, with exits to
`cancelled` and `expired`.

### 11.2 What it does

Free text → structured slots (a model may propose them; it never commits to
them, never picks a venue, never sets a price and never invents a coordinate)
→ invited participants answer typed **signals** (`rsvp`, `availability`,
`location`, `budget`, `vote`, `constraint`) → real options are fetched from
named sources (OpenStreetMap via Nominatim + Overpass, a storefront search, or
a resolved product URL) → options are ordered by a pure, explainable scorer
whose every factor carries a sentence a human can check against the data → the
group picks one.

The arithmetic, the interval algebra, the geography, and the exact factor
weights are documented in [`docs/COORDINATION.md`](../docs/COORDINATION.md).

### 11.3 The handover

`convertToGroup` is the only interface between the two layers, and it is
one-directional. It produces an ordinary `CreateGroupInput`:

- **cart** — one core line item, `sku = plan-<option_id>`, priced at the amount
  the group supplied (the chosen option's price if it had one), quantity equal
  to the number of people going, claimed by everyone;
- **members** — every participant who did not RSVP *out*, all `payer`,
  weight 1;
- **policy, tolerance, deadline, no_blame** — supplied by the caller,
  defaulting to `all_of` / 500 bps / 60 minutes;
- **rail** — `at_venue` if the chosen option came from Overpass, else
  `prava_mandates` (§10.2);
- **origin** — `"plan"`, and a `product` provenance block carrying the plan id,
  option id, source, place and URL.

From that call onward the protocol engine owns the object and the coordination
layer never touches it again. The plan is marked `converted` and holds the
group id.

Two refusals are worth stating because they are where a coordination layer
would normally start guessing:

- **No price, no group.** OpenStreetMap knows where a restaurant is; it never
  knows what dinner costs. If the chosen option has no price and the caller
  supplies no amount, `convert` fails with *"this option has no price attached
  — enter the amount, or split the real bill once you have it"* rather than
  inventing a number.
- **Nobody going, no group.** If every participant RSVP'd out, `convert` fails.
