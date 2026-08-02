# Track evidence

One section per track. Every claim below carries a file, a line, or a live URL a judge can
check in under two minutes. Every citation in this document was read directly from the
repository at commit `68d1468` or verified live against the deployed engine/web app while
writing it — nothing here is copied from another document without being checked.

## Prava overall

**The mandate-per-person consent model, the commit saga, crash-resume, and receipts are all
real and load-bearing, not decorative. The one thing every score here is capped on is that no
human has yet completed a passkey approval on a real Prava sandbox mandate — that gap is not
yet closed, and this document is written so the next sentence can be swapped for a real
transaction id the moment it lands.**

Each member gets their own mandate session, capped at their own share, never a shared or
pooled amount. `engine/src/service.ts:250-253` calls `createMandateSession` per member with
`totalAmount: toDecimalString(m.cap_amount)` — that specific member's cap, computed
independently. The request itself, built in `engine/src/prava/client.ts:82-136`, sets
`merchant_scope: 'listed'` and `max_charges: 1` (`client.ts:111-112`), so the network — not
Sutra's own code — enforces that this credential can be used exactly once, at exactly one
listed merchant.

The commit saga is a real state machine, not a loop that just calls charge and hopes.
`engine/src/service.ts:728-736` emits a `charge.attempted` event per attempt carrying a
durable idempotency reference (`gmp:${g.id}:${member.id}:${entry.source}:${attempt}`) before
the charge call itself goes out, which is what makes crash-resume possible: on restart the
engine replays this event log and reuses the same reference rather than minting a new one
(`spec/PROTOCOL.md` §4.3). That exact behavior is pinned by
`engine/test/crash-double-charge.test.ts`, part of the engine's test suite — run
`npm test -w engine` (PowerShell) to see the current count pass in full.

Receipts are the artifact meant to survive contact with a skeptical judge without requiring
trust in the UI. `engine/src/receipt.ts:103-155` (`verifyReceipt`) recomputes the hash chain,
recomputes `totals.charged` and `totals.owed` from the individual entries rather than trusting
the stored totals, and — the rule that matters most for this track — rejects any receipt
claiming a non-zero charge on a rail that cannot charge at all (`receipt.ts:127-129`: "no card
is charged on this rail"). That is not a passive description; it is an active check that fails
a forged receipt.

Live evidence: `curl https://engine-production-e6fa.up.railway.app/health` returns
`"prava_adapter":"sandbox"` — the deployed engine is pointed at Prava's real sandbox, holding a
real `sk_test_` key, not the offline mock. The web app is live at
https://sutra-gmp.vercel.app.

**The honest gap, stated so it can be swapped.** As of this writing, no completed, human-
approved Prava sandbox charge is documented anywhere in this repository. Every real hosted
approval session minted against `sandbox.collect.prava.space` has stayed pending and was
cancelled, because completing it requires a human tapping their own passkey — no script can do
this (Prava's mandate consent is a passkey ceremony on its own hosted page, `spec/PROTOCOL.md`,
"Consent object"). When that step is
completed, this paragraph should be replaced with the resulting group id, transaction id, and
a link to the verified receipt; nothing else in this section needs to change.

## Visa Intelligent Commerce

**The controls are real, code-verifiable, and enforced by the network rather than by Sutra's
own logic. The attack a judge will make — "you built the controls and deleted the agent" —
has a real, defensible answer that exists nowhere in this repository's other documents before
this one.**

`merchant_scope: 'listed'` and `max_charges: 1` are set on every mandate-setup request
(`engine/src/prava/client.ts:111-112`), and each member's `total_amount` is set to that
member's own capped share, computed independently per member
(`engine/src/service.ts:253`, `client.ts:92`). Settlement is only closed when Prava's own
report says `status === 'completed'` **and** the network did not report
`visaConfirmation: 'FAILURE'` — `engine/src/prava/client.ts:239`, mirrored at the interface
level in `engine/src/prava/adapter.ts:79`. A 200 response that still carries a failed status or
a network-level failure signal is deliberately not treated as settled.

Nothing in the codebase can approve anything. The only route capable of simulating an approval
is registered exclusively when the adapter is the mock (`if (service.prava instanceof
MockPrava)`, `engine/src/routes.ts:468`) — against a real sandbox or production adapter, that
route does not exist. Independently, from the NANDA plugin's side: `approve_member()` looks
for a `/mock/pay/` marker in the approval URL and returns `False` without sending a request at
all when it is missing, which is exactly what happens against a real
`sandbox.collect.prava.space` URL — demonstrated live in `docs/NANDA-EVIDENCE.md` §3.2
(`approve_member(mi_01KYYD9JBBA03254W5E5X0N0M6) -> False`).

One differentiator is honestly narrated rather than exercised: Prava's charge response can
carry a single-use, merchant-locked `credentials` field, and nothing in this engine reads it.
The `ChargeOutcome` and `ReportOutcome` interfaces (`engine/src/prava/adapter.ts:60-81`) do not
even model a `credentials` field — a direct search of `engine/src` for any read of that field
on a charge or report response returns nothing. That is a deliberate PCI-scope decision, not
an oversight, and it means the specific single-use-credential differentiator Visa's own
materials describe is discussed in this project's documentation but not touched by its code.

**The pre-emptive argument.** Visa Intelligent Commerce — like AP2 and like Prava's own
mandate API — is single-principal by construction: one Payment Mandate authorizes against one
payment instrument for one user (`spec/AP2-EXTENSION.md`, "The gap"). The honest answer to
"you deleted the agent" is not that an agent exists somewhere unbuilt; it is that Visa's
controls model, like the rest of the field, has no way to express N principals each
authorizing their own capped share of one purchase at all. GMP/1 is a working reference
implementation of what that extension needs: a shared cart hash across principals, a commit
policy language, and per-principal consent binding that a closed Checkout Mandate and an open
Payment Mandate's existing `payment.budget` constraint already come close to supporting
(`spec/AP2-EXTENSION.md`, "What a multi-principal extension needs," items 1–3). The honest
boundary of that answer: the L3 "member delegate agents deciding within owner-set caps" layer
that would let an agent actually transact is specified and admittedly not built
(`spec/PROTOCOL.md` §9). The controls were not built and the agent deleted — the agent was
never built either, and the multi-principal contribution is to the controls model, not a claim
of agentic autonomy this repository does not have.

## OpenAI

**Five real call sites, each with a deterministic fallback, a key live in production. The
trap is an easy claim to reach for — "nothing in the demo path depends on an LLM being
available" — which is true, principled, and misleading if quoted alone. The honest reframe:
the deterministic floor is a safety property, and several concrete phrases genuinely cannot be
handled without the model.**

1. `engine/src/agent/extract.ts:408-499` (`extractWithOpenAI`) — a sentence becomes structured
   plan slots. The deterministic path it falls back to (`extractDeterministic`, lines 70–140)
   is a fixed keyword table (`CATEGORY_WORDS`, lines 37–51) and an anchored budget regex
   (`matchBudget`, lines 231–242). Reading that table directly shows no entry for "watch the
   match" or "hang after exams" — sentences using those phrases resolve to `kind: 'open'` with
   no category at all under the deterministic path, exactly the examples the file's own sibling
   module names as the reason a model is used here at all (`engine/src/agent/classify.ts:11-14`).
2. `engine/src/agent/classify.ts:57-110` (`classifyCategory`) — free text to one of 21 closed
   venue category ids. Constrained to a fixed enum (`TOOL`, lines 30–48), so the worst a wrong
   answer can do is pick an existing category, never invent one. This is the layer that
   resolves "chai and gossip" to the `cafe` category id — no keyword regex anywhere in the
   deterministic path maps that phrase to anything.
3. `engine/src/messages/classify.ts:82-139` (`classifyIntentWithOpenAI`) — routes an `@sutra`
   chat message to an existing bot intent when the deterministic keyword regexes in `bot.ts`
   already missed it. The file's own header comment names the exact phrases that used to fall
   through to a generic help message before this existed: "who still hasn't paid me?" and "can
   we push it to Sunday?" (lines 10–19).
4. `engine/src/bill/index.ts:135-184` (`transcribeReceipt`) — a photographed receipt becomes a
   verbatim text transcript, explicitly forbidden from doing arithmetic ("Do NOT compute,
   correct, convert, total or omit anything," lines 148–153); the transcript then runs through
   the same deterministic parser a pasted receipt would. This is the one call site where the
   model is not a better version of a deterministic alternative — there is no deterministic
   path for a bill photo at all. Without a key, a photo cannot be split; the caller is told to
   type or paste the text instead (`BillParseError`, code `no_vision_key`, lines 117–123).
5. Free text to a group proposal at the plan-creation route in `engine/src/routes.ts` calls the
   same `extractIntent`/`extractWithOpenAI` path as call site 1.

The trap: the deterministic-fallback architecture above invites the summary "nothing in the
demo path depends on an LLM being available." That sentence is true and is the correct architecture — a model outage must
never block a group from planning dinner — but read alone it sounds like an admission the
model adds nothing. The honest reframe for this track is that the deterministic floor is a
safety property, not a claim of dispensability: bill-photo transcription has no deterministic
equivalent at all, and each of the four text-classification call sites above has a named,
quoted, verifiable phrase — taken directly from this repository's own code comments, not
invented for this document — that the regex layer provably cannot parse and the model
resolves correctly, with every answer re-validated against a closed enum or re-reconciled
against a printed total before anything downstream trusts it.

The key is live in production: `OPENAI_MODEL=gpt-4.1-nano` is configured on the deployed
Railway engine.

## Localhost (startup-ready)

**Zero users, no merchant partner, no paying customer, and no traction data of any kind. The
economic argument this track's own criterion asks for is in `docs/BUSINESS-CASE.md`, not
here.**

For the unit economics, the wedge, the competitive landscape, and the honest "what would kill
it" analysis, see `docs/BUSINESS-CASE.md` in full — it directly addresses this track's own
scoring criterion and should be read as this section's real content. Stated plainly: the case
people most want — one shared online cart — is honestly declared out of scope, and every case
that does work faces UPI, Splitwise, and point-of-sale split tender as incumbents that are, in
several cases, already better.

What is real and checkable in under two minutes, and should be weighed on a separate axis from
market validation: the product surface itself is unusually complete for a 48-hour build.
Accounts, friends, circles, a live group chat thread with an `@sutra` state bot, notifications,
a dashboard reporting pending decisions and per-currency card exposure, receipts, and an
unpacked Chrome extension for importing a merchant page all exist and work (`README.md`,
"Operate as a real group product"). That is evidence of execution speed and product judgment.
It is not evidence anyone besides the two people who built it wants to use it, and this
document should not be read as claiming otherwise.

## NANDA

**The single strongest artifact in the repository: a real registered entry point,
byte-identical baseline traces against the bundled `prepaid_credits` plugin, a 117-pass local
suite plus a 118-pass upstream package run, an honest refund story, and a validated NANDA Town
pull request.**

`nanda-town-prava` registers as a real `nest.plugins.payments` entry point
(`nanda_town_prava.plugin:PravaMandates`, declared in `nanda-town-prava/pyproject.toml`), and
that registration is verified at runtime — not merely asserted — by reading
`importlib.metadata.entry_points` directly in `python scripts/town_scene.py`'s first act
(`docs/NANDA-EVIDENCE.md` §8.3). The strongest single piece of evidence in the whole pack: the
same 100-agent, 10,000-tick marketplace scenario run once against the bundled `prepaid_credits`
plugin and once against `prava_mandates` produces traces that are byte-identical —
`sha256 dd6cdb7a631e...` on both — reproduced again a day later with the identical hash
(`docs/NANDA-EVIDENCE.md` §4.2, §8.1). Swapping a pooled ledger for real card mandates changed
how value moved and left the marketplace's own behavior completely unaffected, which is the
strongest available form of "this is a drop-in adapter," checked rather than claimed.

Conservation invariants — `authorization_conserved`, `no_pooled_funds`, `settlement_conserved`
— report green both in the in-process simulation and against the real deployed engine over
HTTP, including a run where the engine held a real Prava sandbox key
(`docs/NANDA-EVIDENCE.md` §3.2, §4.5). The local package suite passed **117 tests** with one
intentional skip on 2026-08-02. Its upstream-packaged copy passed **118 tests**. Inside the NANDA
Town workspace, the complete repository suite passed **1,429 tests**, with one skipped and one
live test deselected; Ruff, formatting and strict Pyright also passed.
Counts still move, so a judge should run the commands in the pull request rather than trust a
copied number.

The refund story is honest rather than convenient: a pre-capture refund cancels every mandate
and charges nobody; a post-capture refund raises `RefundNotSupportedError` with the actual
remedy attached — a merchant-initiated refund against the recorded transaction id, or a
cardholder chargeback — rather than silently reversing a ledger entry the way the pooled
baseline could (`nanda-town-prava/README.md`, "Refunds: the honest answer").

**Upstream submission completed.** The adapter is submitted as
[`projnanda/nandatown#210`](https://github.com/projnanda/nandatown/pull/210) from the required
`hackathon/soham109-prava-group-mandates` branch. The PR packages the multi-principal plugin,
Town scenario, deterministic fallback, live HTTP path, comparison tooling and 118-test suite.
This closes the previously documented missing-PR qualify item; merge and reviewer acceptance
remain upstream decisions and are not claimed here.

## Senso

**There is no Senso integration anywhere in this repository, and this track should not be
entered.**

The string "Senso" does not appear anywhere else in this repository — no SDK, no API call, no
configuration value, no code path. (`git grep -i senso` outside this file returns nothing.)
The discovery and receipt-verification work that might tempt a claim
here — the A2A AgentCard, the NANDA AgentFacts document, the served `SKILL.md`, and the
Ed25519-signed, hash-chained receipts — is real and genuinely strong, and every part of it is
Sutra's own chain. None of it involves Senso in any way, and presenting it as a Senso entry
would be disprovable by any judge willing to run one grep across the repository. Do not check
this track.
