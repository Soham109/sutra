// Verbatim captured stdout from this repo's own scripts. Nothing here is
// reworded — every line below is exactly what the interpreter printed, byte
// for byte, aside from JS template-literal escaping of the two lines that
// contain a Windows path separator. Reproduce any of it with the command
// printed at the top of its block.
//
// Source: nanda-town-prava/scripts/town_scene.py and
// nanda-town-prava/scripts/baseline_diff.py, run from a clean checkout with
// the venv in nanda-town-prava/.venv (`pip install -e ".[dev]"` builds the
// same one). Both scripts are `simulated` mode: zero network, zero keys,
// deterministic — see nanda-town-prava/README.md, "live vs simulated".

export const SCENE_COMMAND = 'cd nanda-town-prava && python scripts/town_scene.py'

export const SCENE_TRANSCRIPT = `mode: simulated

=== ACT 0: plugin discovery — a real nest.plugins.payments entry point?
  nest.plugins.payments entry points on this interpreter: {
  "prava_mandates": "nanda_town_prava.plugin:PravaMandates"
}
  [PASS] prava_mandates is a real entry point, not a builtin fallback — resolves to nanda_town_prava.plugin:PravaMandates — nanda_town_prava.plugin:PravaMandates
  PluginRegistry resolves these names for layer='payments': ['prava_mandates', 'prepaid_credits']
  [PASS] the bundled prepaid_credits still resolves too — this plugin adds an option, it does not remove one
  [PASS] registry.resolve('payments', 'prava_mandates') is this package's class

=== ACT 1: the town ==================================================
  Four named agents, one purchase: tickets at velvet-tickets, $186.00.
  Soham organizes. Arsh and Dev are in. Maya isn't going, but she'll
  stand behind the card if the group comes up short.

=== ACT 2: mint the mandates =========================================
  group_id=g_000001  policy=quorum(2 of 3)  cart=$186.00
  each principal's own mandate, capped at their own number:
  Soham    role=payer     status=awaiting_approval cap=6510 charged=0
  Arsh     role=payer     status=awaiting_approval cap=6510 charged=0
  Dev      role=payer     status=awaiting_approval cap=6510 charged=0
  Maya     role=backstop  status=awaiting_approval cap=0 backstop_cap=6000 charged=0
  [PASS] four mandate sessions minted, none approved yet — collecting
  [PASS] every principal's cap is their own — nobody's cap depends on anybody else's

=== ACT 3: the passkey ceremony ======================================
  -> Maya arms her backstop mandate — standing by, not charged yet.
  -> Soham taps his passkey.
  -> Dev has second thoughts mid-flight and DECLINES.
  [PASS] the group is still open after Dev's decline (quorum(2) is still reachable) — collecting
  -> Arsh taps her passkey — quorum(2) is met. The engine decides now.

=== ACT 4: resolution: backstop absorbs, group commits ===============
  Why a backstop and not a requote: _simulator.py implements backstop
  shortfall absorption but not GMP/1 requote rounds (README, Limitations #9).
  A real requote cascade is proven separately, over HTTP, in
  scripts/live_check.py::check_requote and docs/NANDA.md §2.
  Soham    role=payer     status=charged           cap=6510 charged=6510
  Arsh     role=payer     status=charged           cap=6510 charged=6510
  Dev      role=payer     status=declined          cap=6510 charged=0
  Maya     role=backstop  status=charged           cap=0 backstop_cap=6000 charged=5580
  decision: 'policy satisfied; 2 principal(s) charged on their own cards'
  verify_payment -> PaymentStatus.CONFIRMED
  [PASS] group committed despite a mid-flight decline — committed
  [PASS] Dev was never charged
  [PASS] Soham and Arsh were each capped at the number they consented to, not the larger redistributed share — Soham charged=6510 cap=6510
  Maya's backstop_cap was 6000; the shortfall actually drawn from her card was 5580.
  [PASS] Maya's backstop card absorbed exactly the shortfall the other two couldn't cover
  [PASS] the merchant received the full cart — 18600 == 18600
  [PASS] verify_payment is CONFIRMED

  signed-shaped receipt (simulated engine: hash-chained, not Ed25519-signed —
  a real signature from the deployed engine is in docs/NANDA.md §2):
    settlement_disclosure: SIMULATED. No card was charged and no money moved. This receipt was produced by the in-process GMP/1 simulator so the plugin can run with no network and no keys. Amounts shown as charged are what the card network would have been asked to authorize.
    chain_head: 8b2e81e1a85913dde913ccd286405b3e929eb64e4c9dcf15ff5a3312219b426e
      Soham    charged=6510   outcome=charged   hash=b885a230a204… chained-from-prev=OK
      Arsh     charged=6510   outcome=charged   hash=d8e6882f3adf… chained-from-prev=OK
      Dev      charged=0      outcome=declined  hash=09f09843d831… chained-from-prev=OK
      Maya     charged=5580   outcome=charged   hash=8b2e81e1a859… chained-from-prev=OK
  [PASS] the receipt chain is unbroken from the genesis hash to chain_head

  conservation_report():
    authorization_conserved: True
    no_pooled_funds: True
    settlement_conserved: True
  [PASS] authorization_conserved — no unit of authorized headroom invented or lost
  [PASS] no_pooled_funds — no agent's headroom ever exceeds what it started with
  [PASS] settlement_conserved — every captured unit lands at exactly one merchant

=== ACT 5: for contrast: the same decline, no backstop to catch it ===
  -> all_of this time — nobody backstops. Soham and Arsh approve. Dev declines.
  decision: 'policy became unsatisfiable — no card was charged'
  verify_payment -> PaymentStatus.REFUNDED
  [PASS] the group cancels — not partial, not committed — aborted
  [PASS] nobody was ever charged, including the two who already approved — 0
  [PASS] verify_payment is REFUNDED
  In this simulator case the policy fails before commit, so every simulated charge remains zero.
  That is the pre-commit cancellation path shown, not a claim of atomic real-card settlement.

=== ACT 6: the structural property: an agent cannot pay an agent =====
  Arsh's headroom before: 1000
  -> Soham calls payments.pay(AgentId('Arsh'), Money(amount=500), ref) — no error, no refusal exception. Watch what actually happens to Arsh.
  Arsh's headroom after:  1000
  where the 500 actually went: conservation_report()['merchants'] = {'Arsh': 500}
  [PASS] Arsh's own headroom never moved — she was not paid — 1000 == 1000
  [PASS] the 500 was captured against a merchant record named 'Arsh', not credited to agent Arsh's wallet
  [PASS] no_pooled_funds holds — Arsh was not credited by Soham's payment
  There is no rail for agent-to-agent credit on this plugin. Money leaves a card and
  lands at a merchant; it does not land in another agent's simulator balance.

=== ACT 7: the same purchase against the bundled prepaid_credits =====
  -> Can prepaid_credits even express pay_group()?
  hasattr(PrepaidCredits(...), 'pay_group') = False
  organizer.pay_group() -> AttributeError: 'PrepaidCredits' object has no attribute 'pay_group'
  [PASS] prepaid_credits cannot express a group purchase — no such method exists
  -> The only tool it gives you is repeated pay(): each principal pays the
  -> organizer directly, and the organizer forwards the pool to the merchant.
  Soham's own balance before anyone pays in: 0
  Soham's own balance after three principals pay him:  18600
  [PASS] Soham — a coordinator, not a merchant — was credited by three other agents' payments — 18600 == 18600
  Soham then forwards the pool: pay(velvet-tickets, 18600) — no cap, no consent trail per principal, just a balance transfer he was fully able to make alone.

  side by side, the same $186.00 group purchase:
  can express pay_group() at all                          :
      prepaid_credits : no — AttributeError
      prava_mandates  : yes — pay_group()
  who holds funds before the merchant is paid             :
      prepaid_credits : the coordinator's own simulator balance (18600 credits)
      prava_mandates  : nobody — cards only
  an agent credited by another agent's payment            :
      prepaid_credits : yes — Soham, +18600
      prava_mandates  : never
  could Soham unilaterally spend the pooled 18600 himself :
      prepaid_credits : yes, trivially
      prava_mandates  : no rail
  per-principal consent enforced by                       :
      prepaid_credits : nothing — it's one balance transfer
      prava_mandates  : a mandate cap per principal, enforced at the card network

==================================================================
all checks passed`

export const BASELINE_COMMAND = 'cd nanda-town-prava && python scripts/baseline_diff.py'

export const BASELINE_TRANSCRIPT = `
=== the only difference between the two scenarios =================
  - # SPDX-License-Identifier: Apache-2.0
  - # Marketplace scenario: buyers and sellers exchange goods.
  - description: "50 buyers and 50 sellers trading products with varying prices."
  -   payments: prepaid_credits
  -   trace: ./traces/marketplace.jsonl
  + description: "50 buyers and 50 sellers, paying on real card mandates instead of a pooled ledger."
  +   payments: prava_mandates # <- the only change from the baseline
  +   trace: ./traces/prava.jsonl

=== prepaid_credits — the built-in pooled ledger ==================
{
  "plugin": "PrepaidCredits",
  "agents": 100,
  "starting_total_in_simulator": 100000,
  "final_total_in_simulator": 100000,
  "agents_ending_richer_than_they_started": 49,
  "value_credited_to_agents": 16675,
  "value_debited_from_agents": 16675,
  "receipts": 266,
  "value_that_left_a_card": 0,
  "value_that_reached_a_merchant": 0,
  "merchants_paid": 0
}

=== prava_mandates — real card mandates ===========================
{
  "plugin": "PravaMandates",
  "agents": 100,
  "starting_total_in_simulator": 100000,
  "final_total_in_simulator": 83325,
  "agents_ending_richer_than_they_started": 0,
  "value_credited_to_agents": 0,
  "value_debited_from_agents": 16675,
  "receipts": 266,
  "value_that_left_a_card": 16675,
  "value_that_reached_a_merchant": 16675,
  "merchants_paid": 49,
  "authorization_still_on_hold": 0
}

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

=== the traces ====================================================
  traces\\marketplace.jsonl: 513030 bytes, 2200 events
  traces\\prava.jsonl: 513030 bytes, 2200 events
  sha256 baseline: dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
  sha256 prava   : dd6cdb7a631e153a3ed9260ddb5fc6a0178f95d76960788f20ac839fcf000edf
  byte-identical : True

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

all assertions hold`

export const TEST_COMMAND = 'cd nanda-town-prava && pytest -q'
export const TEST_SUMMARY = `........................................................................ [ 61%]
.................s............................                           [100%]
117 passed, 1 skipped in 0.37s`

export const PLUGINS_COMMAND = 'cd nanda-town-prava && nest plugins list payments'
export const PLUGINS_OUTPUT = `payments:
  - prava_mandates
  - prepaid_credits`

// Two separate packages: nest-core is the Nanda Town simulator/CLI itself
// (a peer, not a dependency of this plugin — see nanda-town-prava/README.md,
// "Install"); `pip install -e .` is what registers `prava_mandates` as a
// `nest.plugins.payments` entry point on this interpreter. Act 0 of the
// scene imports `nest_core.plugins.PluginRegistry` directly, so both are
// required for `town_scene.py` to run at all, not just for `nest` the CLI.
export const SETUP_COMMAND = 'pip install "nest-core[plugins]" && pip install -e ".[dev]"'
