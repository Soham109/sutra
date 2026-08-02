# Where this stands — 1 Aug 2026, late evening

Deadline: **3 PM Pacific, Sun 2 Aug** (treat as real; the public schedule says 7 PM but
the handbook reportedly says 3 PM, and being wrong the other way means not submitting).

Live: web https://sutra-gmp.vercel.app · engine https://engine-production-e6fa.up.railway.app
Tests: **479 engine across 25 files**, 33 widget, `npm run build` clean.

---

## 1. The one thing only you can do

**Approve a real Prava sandbox charge on your phone.** No script can — that is the
protocol's security property. It is judging criterion #1 and it has never been done.

```
npm run e2e:proof -- --watch
```
Card `4622 9431 2323 2440` · CVV `157` · exp `12/30` · OTP `456789`.
Commands in `HANDOFF.md` §3.1. If it does not happen, say so plainly in the submission —
claiming a charge that did not occur is the exact failure this codebase refuses.

## 2. Deploying (this bit the whole day)

Railway's **auto-deploy was dead** — the repo was connected but the trigger was off, so
the engine ran a build from before every fix for hours. It is deploying again now.
The Railway **CLI does not run on this machine at all** (zero output, exit 1) — use the
dashboard. Vercel CLI does work:

```
npx --yes vercel deploy --prod --yes
npx --yes vercel alias set <the-new-deployment-url> sutra-gmp.vercel.app
```

The alias step is **not optional** — `vercel deploy --prod` aliased to `sutra-six.vercel.app`
and left `sutra-gmp.vercel.app` pointing at an old build. Always verify after deploying:

```
curl -s https://engine-production-e6fa.up.railway.app/health   # uptime_s should be small
curl -s https://sutra-gmp.vercel.app/ | grep -c "single-use card number"
```

## 3. How the money actually works — the answer to "are we buying in the app?"

1. Each person approves a **mandate**: a permission. No card touched, nothing on a statement.
2. Rule passes → sutra charges each mandate once.
3. Prava mints a **single-use Visa credential per person** — locked to that one merchant,
   capped at that person's own amount, own dynamic CVV, usable once.
4. Money leaves each person's own card. Nothing pools in sutra; there is no balance
   anywhere in the schema, by design.

**Sutra does not place the order.** One cart paid by four cards only works where the
merchant accepts split tender, and most online checkouts do not. It genuinely works where
each person buys their own thing (a ticket each) and at a venue (the table hands over four
cards). This is now printed at the end of every group, per rail — see
`web/src/components/group/TerminalBanner.tsx`.

**Open finding, deliberately not acted on:** `engine/src/prava/client.ts` reads `status`,
`transactionId` and the error fields off the charge response and **ignores `credentials`
entirely** — we mint a single-use card per person and drop it. Wiring it up is a decision
about PCI scope, not a UI tweak. It is the most interesting thing left on the table.

## 4. Fixed today (all with tests)

| What was wrong | Where |
|---|---|
| A shared restaurant dish became a sealed-bid auction: dropped a real person from a real production group, re-billed the other for the whole cheque | `engine/src/service.ts`, `test/bill-auction.test.ts` |
| Crash between charge and bookkeeping could **charge the same card twice**, or write "failed" into a signed receipt for money that moved | `service.ts`, `test/crash-double-charge.test.ts` |
| Anyone holding a group link could cancel it — logged as "organizer cancelled" while anonymous | `routes.ts`, `test/cancel-authority.test.ts` |
| `/v1/me` returned the caller's own scrypt password hash | `social.ts` |
| Plan participant IDOR: read a stranger's `participant_id`, forge their budget, read it back | `routes-plan.ts`, `test/plan-participant-privacy.test.ts` |
| No rate limiting anywhere | `rate-limit.ts` — keyed per device, not per IP, so one conference NAT cannot throttle the demo |
| A dead product link resolved to a real-looking product ("Bestsellers", ₹99) — Shopify serves soft-404s with HTTP 200 | `catalog/resolver.ts` |
| Gymshark links never worked (its Shopify feed is `text/javascript`, we demanded `application/json`) | `catalog/resolver.ts` |
| Currency hardcoded USD — a UK shop's £38 showed as $38 | `catalog/resolver.ts` |
| Lowercase place names never geocoded, so "dinner in khan market" got an empty board | `agent/extract.ts`, `test/location-phrase.test.ts` |
| Extension returned **relative** URLs rendered into the merchant's DOM — "open the board" 404'd on amazon.com | `routes-v2.ts` |
| The published bookmarklet was built for `localhost:4100` | `widget/build-bookmarklet.mjs` |

Plus: price comparison across stores (per-unit, never mixes currencies, prints its caveats),
group chat with `@sutra`, the "what now / who are we waiting on" panel, the "before you tap"
panel on the approval page, Prava finally named on the landing page, and a live `/health`
badge anyone can verify.

## 4b. 2 Aug — the session limit, and what it left behind

**All six agents died simultaneously** on an API session limit. An auto-commit swept their
half-finished work into `main`. The tree landed with **13 failing tests** and one change
that was worse than a broken test:

`assertLinkedFriends` had been written to refuse **any seat without a `user_id`** — so you
could no longer split with somebody who has no sutra account. That reads like a tightened
security rule and was actually deleting the commonest real case the product has: the person
at the table tonight who is never going to sign up. Pass-the-phone, the QR at dinner, the
bar split — all of it needed exactly what that check forbade.

Fixed and renamed to `assertSeatable`. The line worth drawing is narrower: attaching
somebody else's **account** without their agreement stays refused (their dashboard would
show your group); a **bare name** is allowed and makes a link-only participant.

Tree is green again: **519 tests across 29 files**, both typechecks clean, build clean.

**Lesson for whoever runs agents next:** when several die at once, `git status` first, then
run the full suite before doing anything else. The auto-commit does not care whether the
work was finished.

## 5. In flight — five agents (ALL DIED, see 4b — must be relaunched)

1. **Venue search** — measured live: `restaurant` near Koramangala returns **zero venues**,
   `bar` takes 39s to admit it. This is the flagship demo path and the biggest thing broken.
2. **People everywhere** — one shared picker, friends and circles first, inline friend
   request, typed names still possible but visibly weaker.
3. **Chat, finished properly** — model constrained to classify intent only (never to author
   a fact), pass-the-phone people can post, a real SSE harness pinning the `author_user_id` leak.
4. **User-flow walkthrough** — a stranger clicking through every flow, ranked by confusion.
5. **Remaining lies and dead ends** — dead buttons, copy describing behaviour that does not
   exist, numbers with no source, docs vs reality.

## 6. Known and unfixed

- **Venue search is unreliable** (agent 1 above). Demo around it until that lands.
- An **anonymous** plan organiser loses their "copy link" buttons a few seconds after
  creating a plan. **Log in before creating the plan you demo**, or copy the links immediately.
- The Chrome extension is not on the Web Store — it is "load unpacked".
- Amazon: pasting a link cannot work (no structured data, price rendered in JS). The
  extension's new `buy-action` strategy is the path that reaches it, and it is only
  verifiable in a real browser, not from fetched HTML.

## 7. The plan from here, in order

Work top down. Everything above a line is worth more than everything below it.

1. **Land the five agents in flight** (§5) and act on what they report. Venue search first —
   an empty options board breaks the demo's headline claim.
2. **Get one real sandbox charge** (§1). Everything else is a supporting argument; this is
   the argument.
3. **Re-walk the demo path twice, in a private window, on the live site.** Sign up → one
   sentence → real venues → group → open a member link on a phone → approve. Any step that
   needs explaining out loud is a step to fix.
4. **Make the NANDA scene part of the pitch.** `nanda-town-prava/scripts/town_scene.py` runs
   four town agents through one group purchase with a mid-flight decline and a backstop
   absorbing the shortfall, then shows the bundled `prepaid_credits` plugin failing the same
   scenario because it can only do it by pooling. That contrast IS the $1,000 argument and
   it is currently only in a file nobody has been told to run.
5. **Record the video.** Short, product only, no slides. The two moments worth filming are
   four phones flipping at once, and a bill photo becoming exact lines that reconcile.
6. **Write the submission**, including a plain "what did not work" section. If no card was
   charged, say so there.

Lower priority, only if the above is done:
- Wire Prava's `credentials` through (§3) — decide PCI scope first, deliberately.
- Publish the extension, or accept "load unpacked" and say so.
- Fold the ~10 undocumented endpoints into the README tables.

## 9. NANDA track — fulfilled checklist (re-run 2026-08-01 evening)

The prize is **"Best Prava Adapter for the NANDA Town"** — the Python plugin,
not Index registration. Evidence: [`docs/NANDA-EVIDENCE.md`](docs/NANDA-EVIDENCE.md).

| Check | Result | Command |
|---|---|---|
| Plugin discovered by nest | `prava_mandates` + `prepaid_credits` | `nest plugins list payments` |
| Unit/integration tests | **46 passed, 1 skipped** | `npm run nanda:test` |
| Narrated group-purchase scene | **all checks passed** | `npm run nanda:scene` |
| Baseline vs prepaid_credits | all assertions hold, byte-identical traces | `python scripts/baseline_diff.py` |
| nest HTML reports | regenerated locally (`*.html` gitignored) | `nest report traces/*.jsonl -o report-*.html` |
| Discovery `nanda check` @ production | **all green** | `$env:SUTRA_PUBLIC_URL="https://sutra-gmp.vercel.app"; npm run nanda:check` |
| SkillMD registry | **submitted** id `47063b5f-5000-4c03-8f33-c98555618f85` | curl the registry URL in HANDOFF §3.3 |
| Registry `reachable` badge | still **`null`** — say so, do not invent a badge | — |
| Real card charge via plugin | **not done** — needs human passkey (§1) | `npm run e2e:proof -- --watch` |

**Pitch line for Prof. Raskar:** open a terminal, run `npm run nanda:scene`, watch
four named agents mint mandates, Dev decline mid-flight, Maya's backstop absorb
the shortfall, conservation invariants tick, then prepaid_credits fail the same
purchase by pooling money in the coordinator. That contrast *is* the $1,000 argument.

**Do not** run `nanda index-register`. It is not the prize.

---

## 10. Session progress log (append-only)

### 2026-08-01 ~21:50 IST — critic swarm → concrete fixes
Agents: [empty-state audit](98fe8d6b-30f2-4cfa-8517-ed707a52c61e), [PeoplePicker](89295a21-d89a-48d2-b11f-2b189e63b5ef) (DONE),
[feature brainstorm](786bba22-f699-4bbe-a9ff-f9703b4e9f1c), [UI workflow](b3bf6e45-9548-43ac-bdc5-0d02d3a6f7f7),
[demo stress](21638e3e-c6a3-46cd-830f-83685bb3ef25), [money security](296b6c87-70cb-416e-bf5d-679bcb9941b0),
[proxy elevation](e2bb9f51-4734-4e76-bf36-41cc65d13b96), [judge-harsh](0fda1816-6e09-4845-bb3e-6e592b531a51),
[mobile approve](796bcca4-3e9c-457a-a91c-b2abbab79a2e), [demo wow](ecadb2c0-1f75-4558-b016-2e004bf35c0e),
[landing honesty](0d293a0f-c4fb-4b4b-97bf-223e58e1cfcc), [spec gap](d5c9e248-c520-40df-af71-22da81f3d8d1).

**Shipped this hour (local, not submitted / not deployed):**
- **CRITICAL** `web/src/app/api/[...path]/route.ts` — stop injecting `ENGINE_API_TOKEN` on every
  browser call (only `POST /v1/groups` still gets it). This was reopening cancel / plan-privacy /
  chat membership short-circuits.
- **at_venue honesty:** Ticket branches (Agreed / pay at table); WhatNow H2; join page copy;
  PortalNote gated to `prava_mandates`; group badge `committing` → Sealing; join progress counts `settled`.
- PassThePhone: full-screen CSS + share/copy links (was unstyled / QR-only).
- Plan empty board: don’t blame “no location” when a place already exists.
- Softened “friend is notified / inbox always works” claims (notify never fires on protocol events — still open).

**Still open (do next, ranked):**
1. You: real sandbox passkey charge (`e2e:proof --watch`) — criterion #1.
2. Wire `notifier.notify` on `member.approved` / `group.committed` (or stop claiming push).
3. Plan cancel/choose/convert organiser auth (`routes-plan.ts`).
4. Pin `verifyReceipt` to `/health` public key.
5. Deploy web so live loses fabricated %s / gets rail-honest Ticket.
6. Shell CTA → `/app/plan/new`; collapse group protocol chrome.
