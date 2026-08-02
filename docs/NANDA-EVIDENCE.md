# NANDA Town × Prava — evidence

What the adapter is, what was run against a real engine, what the numbers say
against the built-in baseline, and what remains unverified.

Everything below is a transcript of a command that was actually executed on
2026-08-01. Where something failed, the failure is here too, with the fix.
**Re-run in full on 2026-08-02 — see §8 for what was reconfirmed
byte-for-byte, what changed (an entry-point check was added to the one-command
scene), and a stale number found in two *other* files that this document
does not own.**

## Upstream contribution — submitted August 2, 2026

The reusable group-mandates adapter is submitted to NANDA Town as
[`projnanda/nandatown#210`](https://github.com/projnanda/nandatown/pull/210), from the required
branch `hackathon/soham109-prava-group-mandates`.

Before submission, the contribution passed the exact upstream gates:

```text
uv run ruff check .             All checks passed
uv run ruff format --check .    259 files already formatted
uv run pyright                  0 errors, 0 warnings
uv run pytest -q                1429 passed, 1 skipped, 1 deselected
pytest plugin package only      118 passed
```

The PR is evidence of submission, not evidence of merge or endorsement; those remain with the
upstream maintainers.

## What this plugin is, in one paragraph

> Nanda Town's bundled `prepaid_credits` is a pooled ledger: `pay()` moves a
> balance between two agents, and has no `pay_group()` at all — a
> coordinator can only fake a group purchase by having each principal pay
> them directly, pooling funds in their own balance before forwarding it:
> the exact custody `prava_mandates` refuses. Our plugin registers as a real
> `nest.plugins.payments` entry point and inverts the model: `pay_group()`
> mints one merchant-scoped, amount-capped mandate per principal, then
> charges each sequentially with idempotent recovery so the group ends either
> fully committed or every mandate cancelled, and never credits one agent from
> another's payment. Run `python scripts/town_scene.py`: it discovers the
> entry point, mints four mandates, watches one principal decline mid-flight
> and a backstop absorb the shortfall, prints a hash-chained receipt with
> three conservation invariants ticking, then runs the same purchase against
> `prepaid_credits` and watches it pool $186 in a coordinator's balance
> instead. No pooled funds, no card touched by the agent, nobody fronts
> money.

146 words. Every clause above is what `python scripts/town_scene.py` (§8.3)
actually prints, in the order it prints it — nothing here is aspirational.

---

## 1. What this is

A Nanda Town `payments` plugin that charges **real cards on the card network**
through [Prava](https://prava.space) mandates and the GMP/1 group-mandate
engine, instead of moving balances in a pooled internal ledger.

| | |
|---|---|
| Package | [`nanda-town-prava/`](../nanda-town-prava) |
| Entry-point group | `nest.plugins.payments` |
| Registered name | `prava_mandates` |
| **Entry point** | `nanda_town_prava.plugin:PravaMandates` |
| Declared in | [`nanda-town-prava/pyproject.toml`](../nanda-town-prava/pyproject.toml) |
| Scenario | [`nanda-town-prava/bench.yaml`](../nanda-town-prava/bench.yaml) — the stock `marketplace`, one line changed |

```yaml
layers:
  payments: prava_mandates   # instead of prepaid_credits
```

```
$ nest plugins list payments

payments:
  - prava_mandates
  - prepaid_credits
```

Source of the three things a judge will want to read:

- [`nanda_town_prava/plugin.py`](../nanda-town-prava/nanda_town_prava/plugin.py) — the `Payments` implementation and `pay_group()`
- [`nanda_town_prava/client.py`](../nanda-town-prava/nanda_town_prava/client.py) — the stdlib-only HTTP client for the GMP/1 engine
- [`nanda_town_prava/_simulator.py`](../nanda-town-prava/nanda_town_prava/_simulator.py) — the in-process engine that makes `simulated` mode work with no network

---

## 2. The thesis, stated precisely

Nanda Town's built-in `prepaid_credits` is a pooled ledger. `pay()` is two
lines ([`nest_plugins_reference/payments/prepaid_credits.py`][pc], lines 81-82):

```python
self._balances[self._agent_id] = payer_balance - amount.amount
self._balances[to] = self._balances.get(to, 0) + amount.amount
```

Value never crosses a boundary, so it is trivially conserved. That is a model
of a closed economy, not of a payment.

`prava_mandates` inverts it:

> **`pay()` never moves pooled funds.** Each principal's consent mints a Prava
> mandate scoped to one merchant and capped at one amount, charged once. Money
> leaves a real cardholder's card and arrives at a real merchant. The
> simulator holds no balance, fronts nothing, and never sees a card number.

Two consequences, both load-bearing:

1. **An agent cannot pay another agent.** There is no rail for it. The payee's
   simulator balance is never credited, because the money is not in the
   simulator — it is at the merchant.
2. **`balance()` is not a wallet.** It returns remaining *authorization
   headroom*: a spending cap. Authorizing reserves the cap, capturing converts
   part of it into a charge, going terminal releases the rest back to the same
   agent. No agent's headroom is ever raised by another agent's payment.

Section 4 puts numbers on both claims.

[pc]: ../nanda-town-prava/.venv/Lib/site-packages/nest_plugins_reference/payments/prepaid_credits.py

---

## 3. `live` mode against a real engine, over a real socket

Until today, `live` mode was covered only by tests that inject a fake
transport. `GmpHttpClient`'s request path had never touched a socket. The
harness that fixes that is
[`nanda-town-prava/scripts/live_check.py`](../nanda-town-prava/scripts/live_check.py).

```bash
export GMP_API=https://engine-production-e6fa.up.railway.app
export ENGINE_API_TOKEN=...            # never printed, never committed
python scripts/live_check.py
```

It asks `GET /health` which Prava adapter the engine is running and grades
itself accordingly, because the two cases have genuinely different correct
answers. It was run against both.

### 3.1 What broke the first time — and the fix

The first run against the deployed engine failed. The multi-principal group
never committed:

```
=== 3. four principals, four cards, four passkeys, ONE purchase ====
  group_id : gs_01KYYBTDQ746C3C5D4G7F0N5X1
  status   : collecting
  per-member state from the engine:
    Soham    role=payer    status=viewed     share=6200 cap=6510 charged=0
    Arsh     role=payer    status=viewed     share=6200 cap=6510 charged=0
    Dev      role=payer    status=viewed     share=6200 cap=6510 charged=0
    Maya     role=backstop status=dropped    share=4650 cap=4883 charged=0
  verify_payment -> PaymentStatus.PENDING
  [FAIL] group committed — collecting
  [FAIL] verify_payment is CONFIRMED
  [FAIL] captured equals the cart total — 0
```

The engine's own event stream said exactly what happened
(`GET /v1/groups/{id}/events`):

```
member.approved  Soham  share 4650 cap 4883  mdt_957b86cc41dd91ed
member.approved  Arsh   share 4650 cap 4883  mdt_ba679ee02c277118
member.approved  Dev    share 4650 cap 4883  mdt_0bb122611900f681
member.dropped   Maya
member.requoted  Soham  new_share 6200  round 1
member.requoted  Arsh   new_share 6200  round 1
member.requoted  Dev    new_share 6200  round 1
```

This is the **requote cascade**, GMP/1 §4.1 and [`spec/PROTOCOL.md`](../spec/PROTOCOL.md):
`quorum(3)` of four was satisfied by the first three approvals, the fourth
member was dropped, the cart was re-divided across the survivors (4650 → 6200
each), and 6200 exceeds the 4883 cap they had already consented to. Consent
cannot stretch, so the engine **cancelled their mandates** and put them back
to `viewed` at a new cap of 6510, waiting for a fresh passkey tap
([`engine/src/service.ts`](../engine/src/service.ts), `requoteCascade`).

The plugin opened each mandate session exactly once and then polled a group
that could never move again. It would have polled forever.

This was invisible before today for a specific reason: `_simulator.py`
implements a subset of GMP/1 and **does not implement requote rounds** — the
README said so. So `simulated` mode and the whole test suite were structurally
incapable of finding it. Only a real engine could.

**The fix** — [`plugin.py`](../nanda-town-prava/nanda_town_prava/plugin.py),
`_drive_members()`:

- Session minting is now re-entrant. Any member the engine reports as
  `invited` or `viewed` gets a session minted (or re-minted), whether that is
  the first round or a requote. On a real rail this is the same human tapping
  their passkey a second time at the new number; in mock mode it is a second
  auto-approval.
- `_await_terminal()` calls it on every poll while the group is non-terminal,
  instead of polling passively.
- `Authorization.requote_rounds` records what happened, so a requote is
  reported rather than swallowed.
- `_reserve()` was made delta-based and idempotent — it previously debited an
  agent's headroom on every call, which was harmless when called once and a
  double-debit the moment it was called on each poll. `reserved` now ratchets
  to the **peak** authorization the network held across rounds.
- `_caps_from_view()` replaced a cap sum that excluded backstops with one that
  excludes members whose mandate the engine has already cancelled (`declined`,
  `expired`, `dropped`, `failed`) and adds an armed backstop's standing offer.
  The old rule under-counted the hold; the new one matches what the card
  network is actually holding.

Regression tests, on a fake engine that reproduces the cascade
([`tests/conftest.py`](../nanda-town-prava/tests/conftest.py) `RequotingEngine`):

- `tests/test_group_payment.py::test_a_requote_cascade_is_followed_to_a_commit`
- `tests/test_group_payment.py::test_a_requoted_principal_gets_a_new_approval_url`

A second, smaller fix came out of the same run: `conservation_report()` audited
every agent in the shared engine bundle, including agents belonging to a
different handle's ledger, and reported a phantom `headroom_drift` of -98800.
It is now scoped to the ledger the handle can actually see.

### 3.2 Deployed engine, `prava_adapter: sandbox` — a real Prava key

Between the two runs, the deployed engine was switched from `PRAVA_ENV=mock`
to a real Prava **sandbox** key. That turned out to be the single most useful
thing that happened today, because it is the run in which you watch the plugin
try to approve a mandate and fail.

```
engine  : https://engine-production-e6fa.up.railway.app
token   : present
run id  : 154808

=== 1. GET /health =================================================
  {
  "ok": true,
  "service": "sutra-gmp-engine",
  "prava_adapter": "sandbox",
  "app_base_url": "https://sutra-gmp.vercel.app",
  "receipt_public_key": "b71838a635e97a8f8104e95213bbf3b718f64d89c13d645a8ab6245ca1f8de94",
  "uptime_s": 305
}
  [PASS] engine reachable over HTTPS
  adapter = 'sandbox': a REAL Prava key. Approval URLs are Prava's own hosted
  ceremony, nothing below can be approved without a human, and the correct
  answer to every charge question is PENDING.

=== 2. single principal: pay() -> verify_payment() =================
  receipt: ref=live-single-154808 payer=buyer-0 payee=velvet-tickets amount=1200 credits
  group_id     : gs_01KYYD9JB0W45277W5D2B5B213
  board_url    : https://sutra-gmp.vercel.app/g/gs_01KYYD9JB0W45277W5D2B5B213/board
  approval_urls: {
  "buyer-0": "https://sandbox.collect.prava.space?session=ses_01KYYD9KTW5XW63MC5T2KABYYM"
}
  reserved=1260 captured=0 released=0 outstanding=1260
  group_status=collecting rail=None simulated=False
  mandate ids  : {}
  txn ids      : {}
  elapsed      : 8.86s
  verify_payment -> PaymentStatus.PENDING
  [PASS] simulated flag is False in live mode
  [PASS] the approval URL is Prava's own hosted ceremony — https://sandbox.collect.prava.space?session=ses_01KYYD9KTW5XW63MC5T2KABYYM
  approve_member(mi_01KYYD9JBBA03254W5E5X0N0M6) -> False
  [PASS] the plugin cannot approve a real mandate — False
  [PASS] verify_payment is PENDING, waiting on a human — PaymentStatus.PENDING
  [PASS] nothing was captured — 0
  [PASS] never CONFIRMED without a receipt — None
  conservation_report: {
  "reserved": 1260,
  "captured": 0,
  "released": 0,
  "outstanding": 1260,
  "merchant_credited": 0,
  "authorization_conserved": true,
  "no_pooled_funds": true,
  "settlement_conserved": true,
  "headroom_consistent": true,
  "headroom_drift": {},
  "agents_credited_by_others": [],
  "merchants": {}
}
  [PASS] authorization_conserved
  [PASS] no_pooled_funds
  [PASS] settlement_conserved
  [PASS] headroom_consistent

=== 3. four principals, four cards, four passkeys, ONE purchase ====
  group_id : gs_01KYYD9W3H73D445X7Q2A2A462
  board_url: https://sutra-gmp.vercel.app/g/gs_01KYYD9W3H73D445X7Q2A2A462/board
  total    : 18600 USD
  status   : collecting
  one approval URL per principal — each taps their own passkey on their own phone:
    Soham    -> https://sandbox.collect.prava.space?session=ses_01KYYD9X92EW9VGJRNAP1FGMCY
    Arsh     -> https://sandbox.collect.prava.space?session=ses_01KYYD9YH8P70KS5RGHXZNX86S
    Dev      -> https://sandbox.collect.prava.space?session=ses_01KYYD9ZPNBT4SDTXS5PKJVGPN
    Maya     -> https://sandbox.collect.prava.space?session=ses_01KYYDA0SPT82Y7J0NZK3WM6P5
  per-member state from the engine:
    Soham    role=payer    status=awaiting_approval  share=4650 cap=4883 charged=0 requote_round=0
    Arsh     role=payer    status=awaiting_approval  share=4650 cap=4883 charged=0 requote_round=0
    Dev      role=payer    status=awaiting_approval  share=4650 cap=4883 charged=0 requote_round=0
    Maya     role=payer    status=awaiting_approval  share=4650 cap=4883 charged=0 requote_round=0
  verify_payment -> PaymentStatus.PENDING
  reserved=19532 captured=0 released=0
  organizer headroom=100000 (it is not a principal, so it fronts nothing)
  [PASS] four members were created
  [PASS] four distinct approval URLs — 4 distinct
  [PASS] organizer's own headroom untouched — 100000
  [PASS] every approval URL is Prava's own hosted ceremony
  approve_member(mi_01KYYD9W3M60257133G4P565Y3) -> False
  [PASS] the plugin cannot approve a real mandate — False
  [PASS] verify_payment is PENDING, waiting on four humans — PaymentStatus.PENDING
  [PASS] nothing was captured — 0
  conservation_report: {
  "reserved": 20792,
  "captured": 0,
  "released": 0,
  "outstanding": 20792,
  "merchant_credited": 0,
  "authorization_conserved": true,
  "no_pooled_funds": true,
  "settlement_conserved": true,
  "headroom_consistent": true,
  "headroom_drift": {},
  "agents_credited_by_others": [],
  "merchants": {}
}
  [PASS] no agent was credited by another
  [PASS] settlement_conserved across the boundary
  [PASS] headroom_consistent

=== 4. quorum(3) of 4 + a backstop — the GMP/1 requote cascade =====
  [SKIP] requote cascade — a requote needs a second round of passkey taps, and
  this engine holds a real Prava key. Covered on the mock adapter and by
  tests/test_group_payment.py::test_a_requote_cascade_is_followed_to_a_commit

=== 5. unknown states over a real socket ===========================
  stub engine on http://127.0.0.1:50975 (real socket, deliberately wrong)
  engine said status='quantum_superposition', member status='levitating'
  verify_payment -> PaymentStatus.PENDING
  unknown_states recorded: ('quantum_superposition', 'member:levitating')
  [PASS] unrecognised group status is PENDING, not FAILED
  [PASS] unrecognised group status is recorded
  [PASS] unrecognised member status is recorded

  GET https://engine-production-e6fa.up.railway.app/v1/groups/g_this_group_does_not_exist -> engine returned HTTP 404: {"error":"group g_this_group_does_not_exist not found"}
  [PASS] a nonexistent group 404s cleanly — 404
  receipt for a nonexistent group -> None (404 is not an error here)
  unreachable engine (127.0.0.1:1) -> verify_payment = PaymentStatus.PENDING
  [PASS] unreachable engine is PENDING, never FAILED

=== 6. refund() pre-charge — cancels every mandate, charges nobody =
  group_id=gs_01KYYDAC47E4A3Y1M405M03167 status=collecting reserved=4410 captured=0
  nobody has tapped a passkey; approval URLs are still outstanding:
    buyer-1 -> https://sandbox.collect.prava.space?session=ses_01KYYDAD4DG6Z6YHNVY022B9N5
  can_refund -> True: pre-capture: cancelling releases every mandate and charges nobody
  [PASS] can_refund says yes before capture
  after refund(): group status=aborted decision_note='organizer cancelled'
    buyer-1  status=dropped    charged=0
  verify_payment -> PaymentStatus.REFUNDED
  headroom back to 100000
  [PASS] engine group is aborted — aborted
  [PASS] nothing was captured — 0
  [PASS] verify_payment is REFUNDED
  [PASS] headroom fully released — 100000

=== 7. refund() post-charge — refuses, and says why ================
  [SKIP] post-charge refund — nothing was captured on this adapter, because no
  human tapped a passkey. Covered on the mock adapter and by
  tests/test_refund_honesty.py

=== cleanup: cancelling the groups this run opened ===============
  cancelled gs_01KYYD9JB0W45277W5D2B5B213 (PaymentStatus.REFUNDED)
  cancelled gs_01KYYD9W3H73D445X7Q2A2A462 (PaymentStatus.REFUNDED)

==================================================================
adapter: sandbox
all checks passed against a live engine over HTTP
```

Read the two lines that matter:

```
approve_member(mi_01KYYD9JBBA03254W5E5X0N0M6) -> False
[PASS] the plugin cannot approve a real mandate — False
```

`approve_member()` looks for the `/mock/pay/` marker in the approval URL. The
URL it got was `https://sandbox.collect.prava.space?session=...`, so it
returned `False` without sending a request at all
([`client.py`](../nanda-town-prava/nanda_town_prava/client.py), lines 258-269).
There is no code path in this package that can approve a real mandate. A
human's passkey is the only thing that can, and that is the security property,
not a gap.

The pre-charge `refund()` in check 6 is a real cancellation on a real rail: it
called `POST /v1/groups/{id}/cancel` on the deployed engine holding a real
Prava sandbox key, and the engine cancelled the mandate session. Nobody was
ever charged. The cleanup step then cancelled the two other groups the run had
opened, so no live session was left dangling.

### 3.3 Mock adapter, full commit path

The charging half of the protocol needs an adapter that can stand in for the
passkey tap, which only `MockPrava` can. Since the deployed engine now holds a
real key, this half was run against a local engine started with
`PRAVA_ENV=mock` — still real HTTP through `GmpHttpClient`, still a real
socket, just on loopback.

```bash
PORT=4198 APP_BASE_URL=http://127.0.0.1:4198 PRAVA_ENV=mock \
  ENGINE_API_TOKEN=local-mock-token npx tsx engine/src/server.ts &

GMP_API=http://127.0.0.1:4198 ENGINE_API_TOKEN=local-mock-token \
  python scripts/live_check.py
```

```
=== 1. GET /health =================================================
  {
  "ok": true,
  "service": "sutra-gmp-engine",
  "prava_adapter": "mock",
  "app_base_url": "http://127.0.0.1:4198",
  "receipt_public_key": "b6fa8939ed494e9c3925f009be498ce77028878c59fab164fdd9762782351db4",
  "uptime_s": 17
}
  [PASS] engine reachable over HTTPS
  adapter = 'mock': the engine's own Prava simulator. No real card is charged
  anywhere below, and auto-approval can stand in for the passkey tap.

=== 2. single principal: pay() -> verify_payment() =================
  receipt: ref=live-single-154914 payer=buyer-0 payee=velvet-tickets amount=1200 credits
  group_id     : gs_01KYYDBHNQ77B3H7Z0K4X64552
  approval_urls: {
  "buyer-0": "http://127.0.0.1:4198/mock/pay/sess_8d90f5c7dc09f8d2"
}
  reserved=1260 captured=1200 released=60 outstanding=0
  group_status=committed rail=prava_mandates simulated=False
  mandate ids  : {"buyer-0": "mdt_b390f0ef5857c3ef"}
  txn ids      : {"buyer-0": "txn_e7a26da9568dae0d"}
  elapsed      : 0.25s
  verify_payment -> PaymentStatus.CONFIRMED
  [PASS] simulated flag is False in live mode
  [PASS] group committed — committed
  [PASS] verify_payment is CONFIRMED
  [PASS] receipt rail is prava_mandates — prava_mandates
  [PASS] captured covers the cart — 1200
  [PASS] a real charge txn id exists
  conservation_report: {
  "reserved": 1260, "captured": 1200, "released": 60, "outstanding": 0,
  "merchant_credited": 1200,
  "authorization_conserved": true, "no_pooled_funds": true,
  "settlement_conserved": true, "headroom_consistent": true,
  "headroom_drift": {}, "agents_credited_by_others": [],
  "merchants": {"velvet-tickets": 1200}
}
  [PASS] authorization_conserved
  [PASS] no_pooled_funds
  [PASS] settlement_conserved
  [PASS] headroom_consistent

=== 3. four principals, four cards, four passkeys, ONE purchase ====
  group_id : gs_01KYYDBHY8G4A1Z636S2T672Q5
  total    : 18600 USD
  status   : committed
  one approval URL per principal — each taps their own passkey on their own phone:
    Soham    -> http://127.0.0.1:4198/mock/pay/sess_1293bab140f035e9
    Arsh     -> http://127.0.0.1:4198/mock/pay/sess_e11e2765f4877818
    Dev      -> http://127.0.0.1:4198/mock/pay/sess_549c8883ddbb5e5e
    Maya     -> http://127.0.0.1:4198/mock/pay/sess_eb39e438dfefb697
  per-member state from the engine:
    Soham    role=payer    status=charged   share=4650 cap=4883 charged=4650 requote_round=0
    Arsh     role=payer    status=charged   share=4650 cap=4883 charged=4650 requote_round=0
    Dev      role=payer    status=charged   share=4650 cap=4883 charged=4650 requote_round=0
    Maya     role=payer    status=charged   share=4650 cap=4883 charged=4650 requote_round=0
  verify_payment -> PaymentStatus.CONFIRMED
  reserved=19532 captured=18600 released=932
  organizer headroom=100000 (it is not a principal, so it fronts nothing)
  receipt.rail   : prava_mandates
  receipt.totals : {"quoted": 18600, "charged": 18600, "owed": 18600}
  receipt.status : committed
  [PASS] four members were created
  [PASS] four distinct approval URLs — 4 distinct
  [PASS] organizer's own headroom untouched — 100000
  [PASS] group committed — committed
  [PASS] verify_payment is CONFIRMED
  [PASS] captured equals the cart total — 18600
  [PASS] one distinct mandate per principal
  [PASS] no agent was credited by another
  [PASS] settlement_conserved across the boundary
  [PASS] headroom_consistent

=== 4. quorum(3) of 4 + a backstop — the GMP/1 requote cascade =====
  group_id : gs_01KYYDBJ60P3B4W2H3F0W4Q0Z5   status: committed
  decision : 'quorum 3 met with 3 approvals; locked 3 member(s)'
  per-member state from the engine:
    Soham    role=payer    status=charged   share=6200 cap=6510 charged=6200 requote_round=1
    Arsh     role=payer    status=charged   share=6200 cap=6510 charged=6200 requote_round=1
    Dev      role=payer    status=charged   share=6200 cap=6510 charged=6200 requote_round=1
    Maya     role=backstop status=dropped   share=4650 cap=4883 charged=0    requote_round=0
  verify_payment -> PaymentStatus.CONFIRMED
  requote_rounds recorded by the plugin: {"Soham": 1, "Arsh": 1, "Dev": 1}
  reserved=19532 captured=18600 released=932 outstanding=0
  [PASS] the engine really did requote — {"Soham": 1, "Arsh": 1, "Dev": 1}
  [PASS] group committed after the requote — committed
  [PASS] verify_payment is CONFIRMED
  [PASS] the merchant got the whole cart — 18600
  [PASS] authorization_conserved across a requote
  [PASS] no_pooled_funds
  [PASS] settlement_conserved

=== 5. unknown states over a real socket ===========================
  stub engine on http://127.0.0.1:53677 (real socket, deliberately wrong)
  engine said status='quantum_superposition', member status='levitating'
  verify_payment -> PaymentStatus.PENDING
  unknown_states recorded: ('quantum_superposition', 'member:levitating')
  [PASS] unrecognised group status is PENDING, not FAILED
  [PASS] unrecognised group status is recorded
  [PASS] unrecognised member status is recorded

  GET http://127.0.0.1:4198/v1/groups/g_this_group_does_not_exist -> engine returned HTTP 404: {"error":"group g_this_group_does_not_exist not found"}
  [PASS] a nonexistent group 404s cleanly — 404
  receipt for a nonexistent group -> None (404 is not an error here)
  unreachable engine (127.0.0.1:1) -> verify_payment = PaymentStatus.PENDING
  [PASS] unreachable engine is PENDING, never FAILED

=== 6. refund() pre-charge — cancels every mandate, charges nobody =
  group_id=gs_01KYYDBN6Y22D6H486W6X745A4 status=collecting reserved=4410 captured=0
  nobody has tapped a passkey; approval URLs are still outstanding:
    buyer-1 -> http://127.0.0.1:4198/mock/pay/sess_b1a96f79c785a6b1
  can_refund -> True: pre-capture: cancelling releases every mandate and charges nobody
  [PASS] can_refund says yes before capture
  after refund(): group status=aborted decision_note='organizer cancelled'
    buyer-1  status=dropped    charged=0
  verify_payment -> PaymentStatus.REFUNDED
  headroom back to 100000
  [PASS] engine group is aborted — aborted
  [PASS] nothing was captured — 0
  [PASS] verify_payment is REFUNDED
  [PASS] headroom fully released — 100000

=== 7. refund() post-charge — refuses, and says why ================
  can_refund -> False: 1200 USD already captured — a settled card charge does not roll back on this rail
  [PASS] can_refund says no after capture
  RefundNotSupportedError: refund not supported on the prava_mandates rail: 1200 USD was already captured for live-single-154914. A settled card charge does not roll back. Remedy: issue a merchant-initiated refund against the Prava transaction id on the authorization record, or have the cardholder open a chargeback.
    .ref=live-single-154914 .captured=1200 .currency=USD
    .remedy=issue a merchant-initiated refund against the Prava transaction id on the authorization record, or have the cardholder open a chargeback
    transaction ids to refund against: {"buyer-0": "txn_e7a26da9568dae0d"}
  [PASS] refund() raises RefundNotSupportedError after capture
  [PASS] the exception carries the captured amount — 1200
  verify_payment is still PaymentStatus.CONFIRMED — the charge stands
  [PASS] still CONFIRMED after a refused refund

==================================================================
adapter: mock
all checks passed against a live engine over HTTP
```

The same suite ran green against the **deployed** engine while it was still on
the mock adapter (run id 153009, `https://engine-production-e6fa.up.railway.app`,
group `gs_01KYYC8SXGB492X0T1J3816284`, four mandates, `charged 18600`,
Ed25519 signature 128 hex chars, chain head
`837c2eba40c2b0f3981a51775049dfec4df92732016abe33314c4b9298cab4a5`). That run
predates the `conservation_report` scoping fix in §3.1 by one commit, so the
transcript reproduced above is the local one, which is current.

### 3.4 On the unknown-state check

The deployed engine has eight group statuses and this plugin knows all eight
([`engine/src/types.ts`](../engine/src/types.ts) `GroupStatus`), so it cannot
emit an unrecognised one. Check 5 therefore does two things:

- Stands up a stdlib HTTP server on `127.0.0.1` that answers with
  `status: "quantum_superposition"` and a member status of `"levitating"`.
  Real sockets, real `GmpHttpClient`, deliberately wrong engine. Both are
  recorded in `authorization(ref).unknown_states` and both resolve to
  `PENDING`.
- Asks the **real** engine for a group it has never heard of, and for an
  engine that is simply gone (`127.0.0.1:1`). Both are `PENDING`.

Unknown is never `FAILED`. GMP/1 §4.2: an unresolved charge may well have
landed, and calling it failed is how a retry becomes a double charge.

### 3.5 About auto-approval

`NANDA_PRAVA_AUTO_APPROVE_MOCK=1` (or `auto_approve=True`) stands in for the
passkey tap. It works by POSTing to `/mock/pay/{session}/approve`, a route the
engine registers **only** when its adapter is `MockPrava`
([`engine/src/routes.ts`](../engine/src/routes.ts), line 241:
`if (service.prava instanceof MockPrava)`). §3.2 above is that claim being
tested against an engine holding a real key: the marker is absent from the
approval URL, `approve_member()` returns `False` without sending anything, and
the mandate stays pending. This is documented rather than hidden because it is
the load-bearing safety property of the whole package.

---

## 4. The baseline diff: `prepaid_credits` vs `prava_mandates`

Harness: [`nanda-town-prava/scripts/baseline_diff.py`](../nanda-town-prava/scripts/baseline_diff.py).
It runs the marketplace scenario twice in process through `ScenarioRunner` and
then reads the ledger each plugin was left holding.

```bash
nest scenarios cp marketplace ./baseline.yaml
python scripts/baseline_diff.py
```

### 4.1 The scenarios differ by one line

```
$ diff <(sed 's/#.*//' baseline.yaml) <(sed 's/#.*//' bench.yaml)
4c15
< description: "50 buyers and 50 sellers trading products with varying prices."
---
> description: "50 buyers and 50 sellers, paying on real card mandates instead of a pooled ledger."
25c36
<   payments: prepaid_credits
---
>   payments: prava_mandates
49c60
<   trace: ./traces/marketplace.jsonl
---
>   trace: ./traces/prava.jsonl
```

Same seed (42), same 100 agents, same 10000 ticks, same everything else.

### 4.2 The traces are byte-identical

```
=== the traces ====================================================
  traces\marketplace.jsonl: 513030 bytes, 2200 events
  traces\prava.jsonl: 513030 bytes, 2200 events
  sha256 baseline: dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
  sha256 prava   : dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
  byte-identical : True
```

Not "the same length" — the same bytes. Swapping a pooled ledger for real card
mandates changes how value moves, not whether the marketplace works.

### 4.3 The reports differ by one line, which is the filename

```
$ nest report ./traces/marketplace.jsonl -o ./report-baseline.html
$ nest report ./traces/prava.jsonl        -o ./report-prava.html
$ diff report-baseline.html report-prava.html
30c30
< <p>Source: <code>marketplace.jsonl</code> &mdash; 2200 events</p>
---
> <p>Source: <code>prava.jsonl</code> &mdash; 2200 events</p>
```

Every metric is identical, on both runs:

```
agent_count 100  deal_rate 0.5320  delivery_rate 1.0000  dropped_count 0
duration 0  mean_latency 0  mean_rounds_to_deal 1.0226  message_count 2000
rejection_rate 0.4680  success_rate 1.0000  throughput 0  unique_pairs 467
```

### 4.4 The upstream validators pass identically

```
=== upstream validators, over both traces =========================
  marketplace_no_double_sell
    prepaid_credits: PASS — checked 266 sales
    prava_mandates : PASS — checked 266 sales
  marketplace_all_responded
    prepaid_credits: PASS — all 500 requests answered
    prava_mandates : PASS — all 500 requests answered
  marketplace_price_agreement
    prepaid_credits: PASS —
    prava_mandates : PASS —

  identical results: True
  all pass         : True
```

They are identical because the traces are identical. That is the strongest
available form of "drop-in", and it is checked rather than asserted.

### 4.5 What actually changed — the numbers

```
=== what actually changed =========================================
                                                prepaid_credits   prava_mandates
  value moved between agents in the simulator             16675                0
  agents ending richer than they started                     49                0
  value debited from agents                               16675            16675
  credits still pooled inside the simulator              100000            83325
  value that left a real card                                 0            16675
  value that reached a merchant outside                       0            16675
  distinct merchants paid                                     0               49
  payments executed                                         266              266
```

The same 266 payments. The same 16,675 credits leaving buyers. Then the paths
diverge completely:

- **`prepaid_credits`**: all 16,675 lands in 49 other agents' balances. The
  pool is still 100,000 — value was conserved because it never left the box.
  Nothing reached any merchant, because there is no merchant.
- **`prava_mandates`**: **zero** agents end richer than they started. The pool
  drops to 83,325 because 16,675 of authorization headroom was consumed by
  real charges, and all 16,675 is credited to 49 merchants *outside* the
  simulator. No agent was ever credited by another agent's payment — there is
  no rail for that.

The plugin's own invariants over the same run:

```
  conservation_report():
  {
    "reserved": 17629,
    "captured": 16675,
    "released": 954,
    "outstanding": 0,
    "merchant_credited": 16675,
    "authorization_conserved": true,
    "no_pooled_funds": true,
    "settlement_conserved": true,
    "headroom_consistent": true,
    "headroom_drift": {},
    "agents_credited_by_others": [],
    "merchants": "<49 merchants, 16675 total>"
  }
  largest merchant credits: [('seller-9', 620), ('seller-22', 583), ('seller-15', 476)]
```

17,629 of authorization was minted; 16,675 of it was captured and 954 released
back to the same buyers who reserved it, leaving nothing on hold.

```
=== assertions ====================================================
  [PASS] both traces are byte-identical
  [PASS] both traces pass the same upstream validators identically
  [PASS] prepaid_credits conserves value INSIDE the simulator — 100000 == 100000
  [PASS] prepaid_credits moved value between agents — 16675
  [PASS] prava_mandates credited NO agent from another agent's payment — 0
  [PASS] prava_mandates moved every unit out of the simulator — 16675 == 16675
  [PASS] prepaid_credits moved nothing to any merchant
  [PASS] prava_mandates leaves no authorization on hold
  [PASS] prava_mandates: authorization_conserved
  [PASS] prava_mandates: no_pooled_funds
  [PASS] prava_mandates: settlement_conserved
  [PASS] prava_mandates: headroom_consistent

all assertions hold
```

### 4.6 The conservation validator, honestly

Upstream's `validate_streaming_conservation` scans a trace for
`payment_debited` / `payment_credited` events and checks they balance. It
would pass on our trace. It would pass **trivially**, `0 == 0`, and it would do
the same for `prepaid_credits`. We did not earn that pass and do not claim it.

Three checked facts behind that statement:

1. **No plugin can write trace lines.** `AgentContext` holds the `TraceWriter`
   privately and passes plugins only `ctx.plugins`. There is no plugin→trace
   hook.
2. **Our traces contain exactly four event kinds**, counted from both files:
   ```
   baseline {'start': 100, 'send': 1000, 'receive': 1000, 'stop': 100}
   prava    {'start': 100, 'send': 1000, 'receive': 1000, 'stop': 100}
   ```
   Neither `payment_debited` nor `payment_credited` appears in either.
3. **The validator is not in the published package anyway.** `nest-core`
   0.1.4 exports 18 `validate_*` functions and `validate_streaming_conservation`
   is not among them; `grep` finds neither event name anywhere in `nest_core`
   or `nest_plugins_reference`. It exists only on unreleased git HEAD.

So the conservation evidence in §4.5 is **ours**, not upstream's: it is
`conservation_report()`, the assertions in `baseline_diff.py`, and
[`tests/test_conservation.py`](../nanda-town-prava/tests/test_conservation.py).
Labelled as such deliberately.

### 4.7 Test suite

```
$ pytest -q
46 passed, 1 skipped in 0.08s
```

The skip is `tests/test_no_secret_material.py`'s cross-check against
upstream's `_empic_secret_violations`, which does not exist in 0.1.4. It skips
rather than silently passing.

---

## 5. Registry submission — SUBMITTED

**Status (re-verified 2026-08-01 evening): submitted, discovery chain green at
the public origin, `nanda check` ready.**

Earlier in the day this section said "NOT SUBMITTED" because
`APP_BASE_URL=https://sutra-gmp.vercel.app` pointed every discovery URL at an
origin that only proxied `/api/*`. That is fixed: `web/next.config.ts` now
rewrites `/.well-known/*`, `/skill.md`, `/api/agents`, `/agent-facts.json`,
`/health`, `/openapi.json` and `/v1/*` to the engine, so the advertised base
and the reachable base are the same host.

```
$ env:SUTRA_PUBLIC_URL="https://sutra-gmp.vercel.app"; npm run nanda -w cli -- check

▶ nanda check — https://sutra-gmp.vercel.app

  ✓ /.well-known/agent-card.json — A2A card, 6 skills
  ✓ /.well-known/agents/sutra.json — A2A card, 6 skills
  ✓ /.well-known/extensions/gmp-1.json — extension URI dereferences
  ✓ /.well-known/agent-facts.json — AgentFacts, required fields present
  ✓ /agent-facts.json — AgentFacts, required fields present
  ✓ /api/agents — AI Catalog specVersion 1.0, 3 entries
  ✓ catalog entry "sutra" → 200
  ✓ catalog entry "sutra-agent-facts" → 200
  ✓ catalog entry "sutra-skillmd" → 200
  ✓ /skill.md — text/markdown, base URL matches

  ✓ all discovery documents reachable and consistent
  ready to submit: nanda skill-submit
```

SkillMD registry entry (already live):

| | |
|---|---|
| id | `47063b5f-5000-4c03-8f33-c98555618f85` |
| name | `sutra — group checkout (GMP/1)` |
| source_url | `https://sutra-gmp.vercel.app/skill.md` |
| created_at | `2026-08-01T13:29:23.374Z` |
| `reachable` | **`null`** — registry has not recorded a probe. Do not claim a green badge. All five declared endpoints return 200 when fetched directly. |

```powershell
curl.exe -s https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85
```

### 5.1 Historical note — what blocked submission earlier

The diagnosis that used to fill this section is still true as history: until
the Vercel rewrites landed, an agent that followed SkillMD's `Base URL` to
`sutra-gmp.vercel.app` got 404 on every discovery hop even though Railway
served them. Option B in the old write-up (proxy discovery through Next.js,
keep `APP_BASE_URL` on the product origin) is what shipped. Do not re-point
`APP_BASE_URL` at the Railway host — that would send approval links to the
engine's fallback HTML instead of the real app.

### 5.2 What was NOT submitted (still correct)

**NANDA Index v2 registration was not attempted** (`nanda index-register`).
It needs a NANDA account and a DNS TXT challenge on a domain we control. It
is also **not** what the "$1,000: Best Prava Adapter for the NANDA Town"
prize judges — that prize is the Python plugin in
[`nanda-town-prava/`](../nanda-town-prava/), documented in
[`NANDA-REGISTRY.md`](NANDA-REGISTRY.md).

---

## 6. What we did NOT verify

Read this section. It is the reason to trust the rest of the file.

1. **No real card was charged. Anywhere.** The deployed engine now holds a real
   Prava **sandbox** key, and §3.2 shows real hosted-ceremony sessions being
   minted at `sandbox.collect.prava.space` — but every one of them stayed
   `pending` and was cancelled, because approving requires a human passkey and
   nothing in this package can do that. Sandbox is not production either. The
   end-to-end claim "a card was debited and a merchant was paid" is verified
   only against `MockPrava`, which is our own simulator.
2. **The charging half of the protocol was proven on loopback, not on the
   deployed host, at the moment of writing.** It was green against
   `https://engine-production-e6fa.up.railway.app` earlier the same day while
   that engine was still on the mock adapter (run 153009, §3.3), but that
   transcript predates the `conservation_report` scoping fix. The current-code
   mock transcript is the local one.
3. **SkillMD registry submission is done** (entry
   `47063b5f-5000-4c03-8f33-c98555618f85`). See §5. The registry `reachable`
   field is still `null` — do not claim a green badge. **NANDA Index v2 was
   not attempted** (`nanda index-register`); it needs a DNS TXT challenge and
   is not the prize criterion.
5. **No human ever approved a mandate in any of these runs.** The passkey
   ceremony is the one step this package structurally cannot exercise, so the
   `approved → charging → charged` transition on a real rail is unproven by us.
6. **The requote cascade is verified on the mock adapter and in tests, not on a
   real rail.** A real requote needs two rounds of human taps.
7. **`_simulator.py` is not the engine.** It implements a subset of GMP/1 —
   `all_of`, `quorum`, `weighted`, `required`, `veto`, backstop absorption,
   abort on unsatisfiable — and it does **not** implement requote rounds,
   deadline policies, sealed-bid auctions, or FX display. §3.1 is what that
   gap cost. Two further fidelity divergences found today, both real:
   - the real engine gives a `backstop` member a **share** of the cart
     (`computeShares` excludes only `observer`); `_simulator.py` gives it a
     share of zero.
   - the real engine's `at_venue` rail exists; `_simulator.py` models it only
     through the test fixtures.
   Do not treat a `simulated` run as evidence about the protocol.
8. **Credits are not dollars.** `NANDA_PRAVA_CREDIT_MINOR_UNITS` defaults to
   1:1 and is a declared assumption. Every figure in §4.5 is in credits, not
   currency.
9. **The 16,675 in §4.5 is a `simulated`-mode run.** The marketplace scenario
   was not run in `live` mode: 266 payments against a real engine is not
   something to point at a rate-limited sandbox, and `live` mode blocks on a
   human by design.
10. **Upstream's adversarial payments validators were never run against real
    upstream code.** `validate_streaming_conservation`,
    `validate_empic_escrow_conservation` and `validate_empic_no_secret_material`
    are not in `nest-core` 0.1.4. `tests/test_no_secret_material.py`
    re-implements the secret scan locally and **skips** the upstream
    cross-check rather than pretending to pass it.
11. **Agent-to-agent payment is impossible with this plugin, by design.** A
    scenario whose premise is agents trading value with each other is
    modelling something this rail cannot represent. That is a limitation, and
    it is the same sentence as the thesis.

---

## 7. Reproducing all of it

```bash
cd nanda-town-prava
uv venv --python 3.12 .venv
uv pip install "nest-core[plugins]"
uv pip install -e ".[dev]"

.venv/Scripts/nest plugins list payments      # prava_mandates is discovered
.venv/Scripts/python -m pytest -q             # 46 passed, 1 skipped

# baseline diff — no network, no keys
.venv/Scripts/nest scenarios cp marketplace ./baseline.yaml
.venv/Scripts/python scripts/baseline_diff.py

# live mode — needs a running engine
GMP_API=https://engine-production-e6fa.up.railway.app \
ENGINE_API_TOKEN=... \
.venv/Scripts/python scripts/live_check.py
```

Verified on CPython 3.12.13 / Windows, against `nest-core` 0.1.4 from PyPI and
the engine at commit `a5e103c`.

---

## 8. Re-verified — 2026-08-02

Every command below was actually run today, from a clean shell, against the
already-installed `.venv`. Nothing here is described secondhand.

### 8.1 Byte-for-byte reproduction — and the test count moved mid-session

```
$ python scripts/baseline_diff.py   |   sha256 baseline: dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
                                     |   sha256 prava   : dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
                                     |   byte-identical : True
```

Same sha256 as §4.2 and §4.7, unchanged since 2026-08-01 — seed 42 makes the
whole marketplace run deterministic, so an identical hash a day later on the
same code is the strongest form of "this reproduces" available.

`pytest -q` is a different story, on purpose: `nanda_town_prava/plugin.py`
had an uncommitted, in-flight change during this exact re-verification (see
§8.6) — a genuine concurrency fix, landed together with a new
`tests/test_concurrency.py`. Run early in this session, before that test
file existed:

```
$ pytest -q
46 passed, 1 skipped in 0.10s
```

Run again minutes later, after `tests/test_concurrency.py` landed (5 new
tests):

```
$ pytest -q
51 passed, 1 skipped in 0.10s
```

Run again a few minutes after *that*, mid-edit on a second new file,
`tests/test_baseline_comparison.py` — caught genuinely red, not smoothed
over:

```
$ pytest -q
FAILED tests/test_baseline_comparison.py::test_prepaid_credits_cap_is_only_the_plugins_own_if
1 failed, 56 passed, 1 skipped in 0.17s
```

That failure was a bug in the new test's own setup (two `PrepaidCredits`
handles sharing one balances dict — the second handle's `initial_balance`
argument is ignored once the dict already has an entry for that agent, so
the test's "dishonest handle pays past its funded balance" premise never
got the inflated balance it assumed), not a bug in anything this document
covers. It was not touched here — out of scope, and not this package's
plugin. Three consecutive runs one minute later were clean at 57 passed, 1
skipped. Minutes after *that*, a fourth new file landed —
`tests/test_conservation_property.py`, a hand-rolled property test
(parametrized random seeds, not a new dependency — no `hypothesis`) that
drives `pay_group()` through many randomised principal counts, weights,
policies and approve/decline orders and checks conservation holds on every
one — adding 60 more individually-reported cases in one file:

```
$ pytest -q
117 passed, 1 skipped in 0.68s
```

**The true local package count as of this document's last edit is 117 passed, 1 skipped —
not 46, and it moved four times and broke once, transiently, while this one
section was being written.** Treat no number here as permanent, including
117: this package was under active, fast-moving concurrent development in
the exact window this evidence was gathered, and it is very likely higher
by the time anyone reads this. The only number a judge should trust is the
one their own `pytest -q` prints, at the moment they print it.

### 8.2 `nanda-town-prava/README.md` and this file: audited, corrected

The README's "Verified" section points at "re-run `pytest -q` for the true
count" rather than a hand-copied number, and names the trail — 44, then 46,
then 51, then 57, then 117, all within one week — as evidence the suite is
genuinely growing, not being guessed at. This file's own §4.7 and §7 above
are left at **46 passed, 1 skipped**, deliberately: those sections are a
dated, 2026-08-01 transcript, and rewriting a transcript to match a later
run would misrepresent what actually printed that day. §8.1 is where the
current truth lives, including the number moving four times while it was
being written.

Both files already correctly said the SkillMD registry submission is
**"SUBMITTED"** (§5) before this re-verification — that claim needed no fix.
The general rule this section argues for: wherever a document quotes a test
count, prefer pointing the reader at the command (`pytest -q`, `npm test -w engine`)
over hand-copying a number that keeps moving.

### 8.3 The one-command scene now proves entry-point registration too

A gap in the "one command" claim: `python scripts/town_scene.py` narrated
the group purchase and the `prepaid_credits` contrast, but never itself
checked that `prava_mandates` is a *real* `nest.plugins.payments` entry
point — that lived only in the README's separate `nest plugins list
payments` snippet, a manual step a judge could skip. Fixed today: an **ACT
0** now opens every run of `town_scene.py` (both modes), reading
`importlib.metadata.entry_points(group="nest.plugins.payments")` directly —
the exact call `nest_core.plugins.PluginRegistry._discover_entry_points`
makes — plus a resolve through that same `PluginRegistry` to confirm the
bundled `prepaid_credits` is still there too, unshadowed. Zero network, zero
keys, zero subprocess.

```
=== ACT 0: plugin discovery — a real nest.plugins.payments entry point? ==
  nest.plugins.payments entry points on this interpreter: {
  "prava_mandates": "nanda_town_prava.plugin:PravaMandates"
}
  [PASS] prava_mandates is a real entry point, not a builtin fallback — resolves to nanda_town_prava.plugin:PravaMandates
  PluginRegistry resolves these names for layer='payments': ['prava_mandates', 'prepaid_credits']
  [PASS] the bundled prepaid_credits still resolves too — this plugin adds an option, it does not remove one
  [PASS] registry.resolve('payments', 'prava_mandates') is this package's class
```

The rest of the scene (Acts 1-7) is unchanged and still ends `all checks
passed`, exit `0`. `python scripts/town_scene.py --mode live` carries the
same ACT 0 first.

### 8.4 `--mode live` today, honestly, with no token

This machine does not hold `ENGINE_API_TOKEN` for the deployed engine —
`secrets.env` is not present in this working copy. Rather than skip the live
path or fake a result, it was run anyway, exactly as a judge without the
token would run it:

```
$ python scripts/town_scene.py --mode live
mode: live

=== ACT 0: plugin discovery ... ===
  [PASS] prava_mandates is a real entry point ...
  [PASS] the bundled prepaid_credits still resolves too ...
  [PASS] registry.resolve(...) is this package's class ...

=== ACT 1: the town, live ============================================
  engine : https://engine-production-e6fa.up.railway.app
  token  : ABSENT — POST /v1/groups will 401
  GET /health ...
  {
    "ok": true, "service": "sutra-gmp-engine", "prava_adapter": "sandbox",
    "app_base_url": "https://sutra-gmp.vercel.app",
    "receipt_public_key": "b71838a635e97a8f8104e95213bbf3b718f64d89c13d645a8ab6245ca1f8de94",
    "uptime_s": 18
  }
  [PASS] engine reachable over HTTPS
  adapter = 'sandbox': a REAL Prava key ...

=== ACT 2: mint the mandates — real HTTP, real GMP/1 engine ==========
  [FAIL] pay_group() completes against the live engine — EngineHTTPError: engine returned HTTP 401: {"error":"missing or invalid [redacted]

  The engine is reachable (health check above proves it) and the request
  was answered, not dropped — this is a real, honest HTTP 401/403, not a
  crash. ...

  Acts 2-5 need a real authenticated session against this exact host to go
  further. Continuing to the mode-independent acts.
=== ACT 6 ... === (unaffected — no network)
=== ACT 7 ... === (unaffected — no network)

==================================================================
1 FAILED:
  - pay_group() completes against the live engine
```

`echo $?` → `1`. This is the exact behaviour the script was designed to
produce, and it is what §3.2's `approve_member(...) -> False` proves from the
other side: **nothing in this package can write to `POST /v1/groups`, or
approve a mandate, without credentials a human controls.** The `receipt_public_key`
above (`b71838a6...`) is byte-identical to the one recorded in §3.2 on
2026-08-01 — the deployed engine's signing identity has not changed. The
engine's `uptime_s` (18s) shows it had just been redeployed by unrelated
in-flight work on `engine/` at the moment of this run; a bare `curl /health`
run seconds earlier in the same session returned a transient 502
mid-redeploy, then a plain retry — and this script's own `GET /health` a few
seconds later — succeeded. Recorded here rather than silently rerun until
clean, because a judge hitting a redeploying host should see that it looks
like this, not a laundered success.

Separately confirmed working end to end today: `npm run nanda:test` (`46
passed, 1 skipped`) and `npm run nanda:scene` from the repo root — both are
thin wrappers around this same `.venv` and `town_scene.py`
(`scripts/nanda-run.mjs`), so a judge who prefers `npm` gets the identical
scene, including ACT 0.

### 8.5 Registry entry, still live

```
$ curl -s https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85
{"skill":{"id":"47063b5f-5000-4c03-8f33-c98555618f85", ... "reachable":null,
"created_at":"2026-08-01T13:29:23.374Z"}}

$ SUTRA_PUBLIC_URL=https://sutra-gmp.vercel.app npm run nanda -w cli -- check
▶ nanda check — https://sutra-gmp.vercel.app
  ✓ /.well-known/agent-card.json — A2A card, 6 skills
  ✓ /.well-known/agents/sutra.json — A2A card, 6 skills
  ✓ /.well-known/extensions/gmp-1.json — extension URI dereferences
  ✓ /.well-known/agent-facts.json — AgentFacts, required fields present
  ✓ /agent-facts.json — AgentFacts, required fields present
  ✓ /api/agents — AI Catalog specVersion 1.0, 3 entries
  ✓ catalog entry "sutra" → 200 application/json; charset=utf-8
  ✓ catalog entry "sutra-agent-facts" → 200 application/json; charset=utf-8
  ✓ catalog entry "sutra-skillmd" → 200 text/markdown; charset=utf-8
  ✓ /skill.md — text/markdown, base URL matches, 236 lines
  ✓ all discovery documents reachable and consistent
  ready to submit: nanda skill-submit
```

Same entry, same id, `reachable` still `null` — §5's claim stands unchanged.
Do not report a green reachability badge; the registry has still not
recorded a probe of its own.

### 8.6 The plugin source changed under this re-verification, and it still holds

`nanda_town_prava/plugin.py` picked up a fix for a real concurrency bug during this
re-verification window (`pay_group` and `pay` reserving headroom without a lock, so
two concurrent calls for the same agent could both pass the cap check before either
commits its reservation, over-authorizing). Per this document's scope, that source
file was not touched here. §8.1's `pytest` and `baseline_diff.py` runs above, and
§8.3's `town_scene.py` run, were both executed **against the fixed code**, after
the change landed, and both are still fully green. Reported, not edited.
