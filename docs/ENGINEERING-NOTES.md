# Engineering notes — the rules and the traps

This file is **permanent engineering knowledge**. Everything in it was learned the hard way:
by shipping something wrong, by reading a live API response that contradicted its own
documentation, or by watching a "harmless improvement" turn a truthful product into a lying
one. It is the part of the old handover documents that does not go stale.

There is no status here, no dates, no to-do list. Operations live in
[`RUNBOOK.md`](RUNBOOK.md). What is below is meant to still be true long after
everything else in this repository has been rewritten.

Line citations were re-verified against the source when this file was written. Code moves;
if a citation has drifted, search for the quoted code rather than trusting the number.

---

## 1. Invariants you must NOT break

These are load-bearing honesty rules. Breaking one turns the product into a liar, and a judge
who catches one will discount everything else.

1. **`charged` means money moved through this engine. `settled` means it did not.**
   [`../engine/src/types.ts`](../engine/src/types.ts) lines 107-110 define them as distinct
   member statuses, with a comment saying so. Settlement rails are declared in
   [`../engine/src/rails.ts`](../engine/src/rails.ts) lines 40-86: only `prava_mandates`
   charges real cards (`charges: true`). `at_venue` exists because a restaurant bill has **no
   merchant Prava can charge** (`charges: false`); `shopify_pos` and `checkout_handoff` are
   likewise `charges: false` because a cashier or a merchant checkout — not this engine — is
   what actually moves the money. On every non-charging rail the engine allocates exact
   amounts, records explicit acceptance, and signs a receipt — and never claims a charge.
   Each rail carries a `settled_verb` and a one-sentence `disclosure`, and every surface must
   use them rather than inventing its own wording.

2. **`verifyReceipt` fails a non-charging receipt that claims a charge.**
   [`../engine/src/receipt.ts`](../engine/src/receipt.ts) lines 127-129:
   ```ts
   if (!capabilityOf(receipt.rail).charges && charged !== 0) {
     errors.push(`${receipt.rail} receipt reports a charged amount — no card is charged on this rail`)
   }
   ```
   `charged` is recomputed from the receipt entries at line 119, not read from `totals`, so a
   forged `totals.charged` cannot slip past. This check was originally hardcoded to
   `receipt.rail === 'at_venue'`; it is now driven by `capabilityOf()` so that every
   non-charging rail is covered automatically as rails are added. Do not narrow it back to a
   single rail name.

3. **An OpenStreetMap venue is always on the `at_venue` rail.**
   [`../engine/src/plan/service.ts`](../engine/src/plan/service.ts) lines 591-595:
   ```ts
   const rail: Rail = option.source === 'overpass'
     ? 'at_venue'
     : opts.rail === 'shopify_pos'
       ? 'shopify_pos'
       : 'checkout_handoff'
   ```
   The decision is made on the option's **source**, not by parsing its URL, because an OSM
   `url` is a map page or a brochure site, never a checkout endpoint. This was a real bug that
   got fixed. Do not "improve" it back into URL sniffing.

   The same reasoning is why a product option no longer defaults to `prava_mandates`: a
   storefront URL proves catalog provenance, not payment capability. Charging is an explicit
   trusted-server choice, and `shopify_pos` is selected only by a human who has confirmed an
   in-person counter.

4. **Never invent a price.** OSM knows where a restaurant is, not what dinner costs.
   [`../engine/src/plan/service.ts`](../engine/src/plan/service.ts) lines 571-578 throw rather
   than guess: *"this option has no price attached — enter the amount, or split the real bill
   once you have it"*. Every Overpass venue is ingested with `price: null`.

5. **A missing signal is never agreement.** In
   [`../engine/src/plan/rank.ts`](../engine/src/plan/rank.ts), a factor that cannot be computed
   is returned by `unscored()` at lines 367-370 with `weight: 0`, so it cannot enter the
   weighted mean:
   ```ts
   /** A factor that could not be computed: neutral value, ZERO weight, stated why. */
   function unscored(key: FactorKey, why: string): ScoreFactor {
     return { key, value: 0.5, weight: 0, why }
   }
   ```
   Silent participants are dropped from the factor's **denominator** and named in the
   human-readable `why` sentence. Silence never counts as a yes and never contributes a
   fabricated 0.5. The alternative — counting the silent as a `no` — was rejected on purpose:
   it penalises every option identically, so it changes no ordering while making every
   displayed fraction misleading.

6. **The ranking is arithmetic, not a model.**
   [`../engine/src/plan/rank.ts`](../engine/src/plan/rank.ts) lines 59-65 define exactly five
   weights, summing to 1.00: `time_fit` 0.35, `travel_fit` 0.25, `budget_fit` 0.25,
   `preference` 0.10, `freshness` 0.05. The file imports only `./geo.js`, `./time.js` and
   `./opening-hours.js` (which itself imports only `./time.js`) — no network, no model client,
   no clock read, `now` is passed in. Each factor carries a sentence rendered verbatim in the
   UI. **No LLM gets a vote in the ordering.**

7. **The LLM only fills slots.**
   [`../engine/src/agent/extract.ts`](../engine/src/agent/extract.ts) lines 501-513: if there
   is no `OPENAI_API_KEY`, or the model call throws, `extractDeterministic` runs.
   ```ts
   /** LLM when a key exists, deterministic otherwise — and on any LLM failure. */
   export async function extractIntent(text: string, now = new Date()): Promise<Extraction> {
     const key = process.env.OPENAI_API_KEY
     if (key) {
       try {
         return await extractWithOpenAI(key, text, now)
       } catch {
         // A model outage must never be the reason a group cannot plan dinner.
         return extractDeterministic(text, now)
       }
     }
     return extractDeterministic(text, now)
   }
   ```
   That is the floor, not a stub — `extractDeterministic` (line 70) is pure regex and date
   arithmetic with no network. Even on the model path, the deterministic pass still runs
   underneath (line 446) and supplies the concrete date maths. The model never picks a venue,
   sets a price, or decides who pays what.

8. **Unknown charge state is never treated as failure.**
   [`../engine/src/service.ts`](../engine/src/service.ts) lines 606-611 leave the group in
   `committing`:
   ```ts
   if (result === 'unknown') {
     // §10.10 — unknown is never failed. Leave the group in committing;
     // the poller re-enters this commit and the shared idempotency
     // reference makes the redo safe.
     return
   }
   ```
   `findChargeByReference` at lines 847-854 fetches the mandate's `charges[]` and matches our
   idempotency `reference`, discarding any charge whose status is `failed`. The reference is
   deterministic — `` `gmp:${g.id}:${member.id}:${entry.source}:${attempt}` `` at line 731 — so
   a redo is safe. Reconciliation is attempted both inside the retry loop and once more before
   the state is declared unknown. **Never guess.**

9. **Currency is never taken from a schema default.** It is inferred from the geocoded country
   ([`../engine/src/routes-plan.ts`](../engine/src/routes-plan.ts) lines 401-420) or from the
   bill's tax regime ([`../engine/src/bill/currency.ts`](../engine/src/bill/currency.ts) lines
   63-79), and the inference is always disclosed as an uncertainty. An explicit currency symbol
   always wins — `inferBillCurrency` returns `basis: 'symbol'` for those and `basis:
   'tax_regime'` for a judgement, and a `null` currency means "nothing in this text says",
   which is deliberately not the same as being told it is dollars.

   Two known soft spots found while verifying this, both worth fixing if you have time:
   `POST /v1/bill/split` applies a tax-regime inference without surfacing the `why`
   ([`../engine/src/routes-v2.ts`](../engine/src/routes-v2.ts) line 567 — it calls
   `inferBillCurrency(...).currency` and discards the guess object), unlike `/v1/bill/parse`
   which pushes `guess.why` into `parsed.warnings` at lines 530-533; and `convertToGroup` has
   an undisclosed `?? 'USD'` fallback at
   [`../engine/src/plan/service.ts`](../engine/src/plan/service.ts) line 570.

---

## 2. Prava integration notes

Our [`../openapi.json`](../openapi.json) matched Prava's live specification when it was last
checked. These fixes are already made. Do not regress them.

- The idempotency field is named **`reference`**.
- **A 4xx error envelope is terminal**, not a transport blip. Retrying it burns the commit
  window and disguises a definite refusal as unknown state.
- `listMandates` must send **`standing_only=true`**. An ordinary checkout creates transient
  per-checkout mandates internally, and picking one of those up reads as an approval that
  never happened.
- **`callback_url` must be https.** A non-https base URL omits the field rather than 400-ing
  the whole session. The **poller**, not the callback, is what actually detects approval —
  Prava has no webhooks.
- Settlement is only settled when `status === 'completed'` **and** `visaConfirmation !== 'FAILURE'`.
- Our mock was deliberately made **less** strict to match reality: Prava clears the idempotency
  key of a *failed* charge, so a failed charge is no longer deduplicated.

**The `authorizeOnly` trap.** Prava's API reference says the Create Session response carries
`authorizeOnly: true` for mandate-setup sessions, and an earlier revision of
[`../engine/src/prava/client.ts`](../engine/src/prava/client.ts) refused to proceed without it.
**The live sandbox never sends that field.** A 201 carries exactly `session_id`,
`session_token`, `expires_at`, `iframe_url`, `order_id` — identically for a `mandate_setup`
body and a plain one. That guard blocked every approval until it was removed. Do not add it
back.

There is also no substitute check available at session-creation time. A mandate does not exist
until the human passkeys, so `GET /v1/mandates?customer_id=…` returns `{"mandates":[]}` for
both kinds of session immediately afterwards. This was verified. The real confirmation is what
the poller already does: a standing mandate appearing `active` for that customer.

**Sessions expire about 15 minutes after creation**, which is why sessions are created lazily
on the member's first open rather than at group creation.

Ambiguities that Prava's own documentation does not resolve, recorded rather than guessed at:
how `purchase_context[].effective_until_minutes` interacts with the one-time 7-day clamp on
`mandate_setup.valid_until`; and what revoking a session does to a still-pending mandate.
`cleanupMemberAuthorizations` therefore attempts **both** the session revoke and the mandate
cancel, and never relies on a side effect.

**Prava production access.** They offer it via a Tally form at https://tally.so/r/eq8NZE.
**Do not submit it.** Their own instruction is to apply only once sandbox works end to end,
and access is revoked after judging anyway. Sandbox is the demo of record.

---

## 3. File ownership map

```
engine/src/service.ts          the commit saga — the hard part, treat with care
engine/src/rails.ts            settlement rails + the honesty model
engine/src/receipt.ts          hash-chained Ed25519 receipts + verifyReceipt
engine/src/server.ts           boot, adapter selection, Shopify shelf, /health
engine/src/poller.ts           the 1.5s approval poller — Prava has no webhooks
engine/src/routes.ts           GMP/1 protocol routes (groups, members, receipts)
engine/src/routes-v2.ts        auth, product, bill, people, circles, dashboard
engine/src/routes-plan.ts      coordination routes (plans, signals, options)
engine/src/protocol/           computeShares, policy algebra, backstops, auctions
engine/src/plan/               coordination: types, store, service, rank, time, geo
engine/src/places/             OpenStreetMap: nominatim, overpass, taxonomy (keyless)
engine/src/bill/               deterministic receipt parser, reconciliation, currency
engine/src/agent/extract.ts    free text → slots (deterministic floor, LLM optional)
engine/src/notify/             RFC 8291 web push, validated against the RFC test vector
engine/src/discovery/          A2A card, AgentFacts, AI catalog, served SKILL.md
engine/src/prava/              client (real REST), mock (offline sim), chaos (fault proxy)
engine/public/                 zero-build HTML surfaces served by the engine itself
web/src/app/api/[...path]/     the Next.js proxy in front of the engine
web/src/app/app/page.tsx       the command centre dashboard
web/src/components/plan/       the participant answer flow and option cards
widget/detect.js               the universal cart detector — one copy, three shells
extension/                     Chrome MV3 extension (detect.js is generated, do not edit)
nanda-town-prava/              the NANDA Town payments plugin (Python)
cli/src/gmp.ts                 demo runs + offline receipt verification
cli/src/nanda.ts               nanda check / skill-submit / index-register
chaos/src/run.ts               randomized fault injection + invariant checker
e2e/                           live end-to-end scripts (plan, product, sandbox, auth, mesh)
```
