# The hackathon: event, deadline, tracks, and the submission checklist

This file is about **submitting**. For the state of the code, read [`../AUDIT.md`](../AUDIT.md);
for what to build next, read [`../TASKS.md`](../TASKS.md). For how to deploy and operate
anything, read [`RUNBOOK.md`](RUNBOOK.md).

Everything marked **verified** below was fetched from Devfolio on 2026-08-01. Everything
marked **unverified** could not be confirmed from a public page; treat those as the human's
word and check them against the participant handbook before relying on them.

---

## 1. The event

| Field | Value | Source |
|---|---|---|
| Name | Agentic Commerce Hackathon | verified |
| Host | Devfolio | verified |
| Overview page | https://agentic-commerce.devfolio.co/overview | verified |
| Dates | 31 July – 2 August 2026 | verified |
| Format | Online | verified |
| Duration | 48 hours | stated by the organiser |
| Total prize pool | **$74,300** | verified |
| Team | `__init__ to win it` — Soham + Arshjeet | from [`../README.md`](../README.md) |

The core challenge, in Devfolio's exact words:

> "Most AI products stop after giving an answer. We want to see what happens when the agent
> can finish the job."

> "build a working product where an AI agent can discover, decide and complete a transaction
> using Prava."

---

## 2. The deadline, with the timezone arithmetic

**The hard deadline is 7:00 PM Pacific on Sunday 2 August 2026 — 7:30 AM IST on Monday
3 August. Target having the project published by 5:00 PM Pacific / 5:30 AM IST.**

This was previously an open question in this file, and it is now settled. An earlier revision
told you to treat 3:00 PM PT as the deadline, because a 3 PM figure was circulating and the
7 PM figure could not be confirmed from any public page. **The participant handbook has since
been read directly and is the primary source.** It states:

> Hard deadline: August 2 at 7:00 PM PT / August 3 at 7:30 AM IST.

That agrees exactly with the **public Devfolio schedule page**
(https://agentic-commerce.devfolio.co/schedule), which lists "Hackathon Ends — 02 Aug 2026
(Sun), 07:00 PM, Los Angeles (-07:00 UTC)". Two independent sources, same moment. **There is
no 3 PM deadline. Do not plan around one.**

Los Angeles is on PDT (UTC−7) on 2 August 2026. India Standard Time is UTC+5:30. The offset
between them is 12 hours 30 minutes.

| Moment | Pacific (PDT) | UTC | India (IST) |
|---|---|---|---|
| Hackathon started | Fri 31 Jul, 7:00 PM | Sat 1 Aug, 02:00 | Sat 1 Aug, 7:30 AM |
| **Target: be published by** | **Sun 2 Aug, 5:00 PM** | **Mon 3 Aug, 00:00** | **Mon 3 Aug, 5:30 AM** |
| **Hard deadline (handbook + schedule page)** | **Sun 2 Aug, 7:00 PM** | **Mon 3 Aug, 02:00** | **Mon 3 Aug, 7:30 AM** |

Still publish early. The two-hour gap between the 5 PM PT target and the 7 PM PT deadline is
not slack to spend: Devfolio's publish flow has failed for people before, and a video upload
can stall. Aim to be **done** at 5 PM PT and treat the last two hours as the margin that
absorbs a failed upload, not as working time.

---

## 3. Tracks and prizes

All amounts and titles below are **verified** from https://agentic-commerce.devfolio.co/prizes
on 2026-08-01. The seven track totals sum to exactly $74,300.

| Track | Total | Prize titles, verbatim |
|---|---|---|
| Agentic Commerce Hackathon | $10,800 | "$10,000 (Open): Finalists" · "$800: Best UX" |
| OpenAI | $39,000 | "$30,000: Participation Credits" · "$9,000: Winners & Finalists" |
| Senso | $7,500 | "$7,500: Agent Commerce Discovery & Trust" |
| Linq | $6,000 | "$6,000: iMessage Agent" |
| Visa | $5,000 | "$5,000: Best Visa Intelligent Commerce Implementation" |
| Localhost | $5,000 | "$5,000: Most Startup-Ready Product" |
| **Project Nanda** | **$1,000** | **"$1,000: Best Prava Adapter for the NANDA Town"** |

### 3.1 The NANDA track is the priority

The human running this project cares most about the Project NANDA track. Read the prize title
literally: **"Best Prava Adapter for the NANDA Town"**.

That prize is about a **payments adapter for NANDA Town**, the Python agent simulator. It is
**not** about registering in a NANDA index, and it is not about our AgentFacts document.

Our entry for it is [`../nanda-town-prava/`](../nanda-town-prava/): a real plugin registered
under the entry-point group `nest.plugins.payments` as `prava_mandates`, verified against the
published `nest-core` 0.1.4.

The argument to make, in one paragraph: NANDA Town's bundled `prepaid_credits` plugin is a
pooled internal ledger — agents hold balances and move value between each other, and its
`pay()` is two lines of dictionary arithmetic. Ours never pools. `pay()` maps onto a real
card-network authorization scoped to one merchant and capped at one amount; money leaves a
real card and reaches a real merchant, and the simulator holds no balance at any point.
`balance()` returns remaining authorization headroom, which is a spending cap and not custody
of anything. `refund()` cancels pre-capture and honestly raises `RefundNotSupportedError`
post-capture, rather than pretending a settled card charge can be rolled back. With this
plugin installed, **one agent cannot pay another agent** — that is a deliberate structural
property, not a missing feature.

The evidence pack is [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md). Section 5 is
**SUBMITTED** (SkillMD entry `47063b5f-…`, discovery chain green at
`sutra-gmp.vercel.app`). The demo a judge should watch is
`python scripts/town_scene.py` inside [`../nanda-town-prava/`](../nanda-town-prava/).
Current registry status is also in [`../AUDIT.md`](../AUDIT.md).

**One qualify requirement for this track is still unmet.** The handbook asks entrants to
"submit the relevant pull request" to NANDA Town, and no upstream PR exists yet. Because this
is the track that matters most here, that gap is the single highest-value thing left to close
— see the checklist item in section 5.4.

### 3.2 Judges

Verified from the Devfolio overview page:

- **Prof. Ramesh Raskar** — Founder, Project NANDA; Associate Professor, MIT Media Lab
- **Justin Leung** — Principal, Agentic Commerce, Visa
- **Harshit Marwah** — Startups, OpenAI
- Manjot Pahwa
- Vidhit Gujrathi

Prof. Raskar directs Project NANDA. If the NANDA track matters, the
[`../nanda-town-prava/`](../nanda-town-prava/) plugin and its evidence pack are what he will
look at.

---

## 4. What each judging criterion wants, and what answers it

The criteria below are quoted from the Devfolio site (verified). The right-hand column is what
we point at.

| Criterion (Devfolio's words) | What we point at |
|---|---|
| "Demonstrate functional products that solve clear problems" | A group buys one thing and each person pays their own share from their own card. Nobody fronts money and nobody chases anybody afterwards. Live at https://sutra-gmp.vercel.app |
| "Use agents to perform meaningful actions" | The coordination layer: one sentence becomes typed signals from each participant, real OpenStreetMap venues, an explainable ranking, and then a real cart. [`COORDINATION.md`](COORDINATION.md) |
| "Handle payments transparently" | Two settlement rails, and the honesty rules around them. `charged` means money moved; `settled` means it did not; `verifyReceipt` **fails** a receipt that claims a charge on the non-charging rail. [`../engine/src/rails.ts`](../engine/src/rails.ts), [`../engine/src/receipt.ts`](../engine/src/receipt.ts) |
| "Show potential to become real, sustainable products" | The chaos suite: 60 randomized fault runs, six invariants, all green. The failure taxonomy in [`../README.md`](../README.md) enumerates 36 distinct failures and the answer to each. |
| "Real integration of Prava as a functional component" | `prava_adapter: "sandbox"` on the live `/health`. Real mandate sessions minted against the real sandbox. **Weak spot — see section 4.1.** |
| "Demonstration of an agent completing or enabling a transaction" | **This is the gap.** See section 4.1. |
| "Meaningful work completed during the hackathon" | The pre-existing work disclosure in section 5.7 of this file. |
| Track: "Best Prava Adapter for the NANDA Town" | [`../nanda-town-prava/`](../nanda-town-prava/) plus [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md). See section 3.1 of this file. |
| Track: "Best Visa Intelligent Commerce Implementation" | Prava mints Visa single-use, merchant-scoped, amount-capped credentials; the cap is enforced by the card network, not by our code. Settlement is only closed when `visaConfirmation !== 'FAILURE'`. |
| Track: "Agent Commerce Discovery & Trust" (Senso) | **We have no entry for this track.** Do not claim one. There is no Senso integration anywhere in this repository. Our discovery and receipt work is real and strong (see section 4.2), but it is our own chain — it is not Senso, and presenting it as a Senso entry would be a false claim a judge can disprove with one grep. |
| Track: "Best UX" | The approval page, the participant answer page that needs no account, and the exposure meter on the dashboard. |
| Track: "Most Startup-Ready Product" (Localhost) | [`PRODUCT_AND_MOBILE_ROADMAP.md`](PRODUCT_AND_MOBILE_ROADMAP.md), which marks every item built / partly built / not built. |
| Track: "iMessage Agent" (Linq) | **We have no entry for this track.** Do not claim one. |

### 4.1 The one criterion we do not yet satisfy

"Demonstration of an agent completing or enabling a transaction" is judging criterion number
one, and **no real card has ever been charged** through this system.

Sessions mint correctly against the real Prava sandbox and the poller will commit the group by
itself once a mandate goes active. What is missing is a human opening the hosted approval URL
on a phone and completing the passkey ceremony. No script can do it — that is the security
property of the protocol.

The exact commands and the sandbox test card are in [`RUNBOOK.md`](RUNBOOK.md) section 5.3.
**Do this before writing the submission**, because the submission text changes depending
on whether it worked.

If it does not work in time, say so plainly in the submission's "what didn't work" section.
Claiming a charge that did not happen is exactly the failure mode this codebase is built to
refuse, and a judge who catches it will discount everything else.

### 4.2 The discovery chain and offline-verifiable trust — real work, no track

This is genuinely strong work and it belongs in the general submission. It is **not** an
entry for the Senso track, and it must not be presented as one.

**Discovery.** The engine publishes an A2A **AgentCard**, a NANDA **AgentFacts** document,
an **AI Catalog** entry and a served **`SKILL.md`**. The point is not that four documents
exist — it is that all four are generated from **one endpoint inventory**
([`../engine/src/discovery/endpoints.ts`](../engine/src/discovery/endpoints.ts), consumed by
[`agent-card.ts`](../engine/src/discovery/agent-card.ts),
[`agent-facts.ts`](../engine/src/discovery/agent-facts.ts) and
[`catalog.ts`](../engine/src/discovery/catalog.ts)), so a published document structurally
cannot drift from the API it describes. Hand-maintained discovery documents go stale within
a day; these cannot.

**Trust.** Receipts are Ed25519-signed and hash-chained, and they verify **offline** —
without trusting the UI, the engine, or anything that served them. `verifyReceipt` actively
**fails** a receipt that claims a charge on a non-charging rail
([`../engine/src/receipt.ts`](../engine/src/receipt.ts)), so the evidence layer refuses to
carry the one lie the product would most benefit from telling.

Say this under "meaningful actions" and "handle payments transparently" in the write-up.
Do not attach a track name to it that we did not earn.

---

## 5. Submission checklist

Work top to bottom. Every box is a literal thing to do.

### 5.1 Before you can submit at all

- [ ] Both team members have applied to the hackathon individually and been accepted. Every
      team member must apply individually — this is a Devfolio rule for this event.
- [ ] Both team members have completed the Devfolio **RSVP**.
- [ ] Both team members have completed **check-in**.
- [ ] Only registered team members have contributed to the repository. Anyone who contributed
      but is not registered is a problem — resolve it before submitting.
- [ ] You know which account is the **team admin**. Only the team admin can publish the
      project. The admin asleep at 5 PM Pacific — 5:30 AM IST — is the realistic failure mode
      here, and it is the reason to publish well before the 7 PM PT deadline rather than at it.

### 5.2 Get the product demonstrable

- [ ] https://sutra-gmp.vercel.app loads for a logged-out visitor. Test it in a private window.
- [ ] `curl.exe -s https://engine-production-e6fa.up.railway.app/health` returns
      `"prava_adapter":"sandbox"`.
- [ ] A real Prava sandbox mandate has been approved by a human and a real charge has settled.
      Commands in [`RUNBOOK.md`](RUNBOOK.md) section 5.3. **If this box stays unticked,
      say so explicitly in the submission.**
- [ ] The demo path you will show on video has been walked end to end at least twice, on the
      live site, in a private window.

### 5.3 Record the video

- [ ] The video is **short**. The requirement is a working demo plus a short video.
- [ ] It shows the product working, not slides. Demo-only-with-no-product and
      pitch-deck-only submissions are explicitly not accepted.
- [ ] It shows **Prava** doing something real — the hosted approval page and a mandate being
      approved.
- [ ] It shows more than one person's share, because multi-principal is the entire point.
- [ ] It is uploaded and the link resolves from a private window.

### 5.4 Fill in the Devfolio project

- [ ] **Technologies Used names `Prava` explicitly.** This is checked.
- [ ] The **first screenshot is the one you want as the cover image** — Devfolio uses the first
      screenshot as the cover.
- [ ] Repository link is included, and the repo is accessible to judges.
- [ ] The write-up explains **the user and the problem**: N people want to buy one thing, and
      today one person pays and chases the rest.
- [ ] The write-up explains **how Prava is integrated and what the transaction outcome was**.
      Be specific: mandate setup sessions, hosted passkey approval, `POST
      /v1/mandates/:id/charge` with an idempotency `reference`, and what actually settled.
- [ ] **Track evidence** is included for every track you are entering. For NANDA, link
      [`../nanda-town-prava/`](../nanda-town-prava/) and
      [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md).
- [ ] **UNMET — NANDA track: submit the pull request.** The handbook's NANDA track states the
      qualify bar as: *"Demonstrate a sandbox transaction, handle failures, document the adapter
      and **submit the relevant pull request** and Devfolio project."* **There is currently no
      upstream pull request to NANDA Town** (https://github.com/projnanda/nandatown) from this
      project — the plugin lives only in [`../nanda-town-prava/`](../nanda-town-prava/) in this
      repository. This is a **stated qualify requirement, not an optional extra**: the other
      three clauses are satisfied and this one is not, which means the strongest track entry we
      have is the one most at risk of being ruled out on a technicality. Open the PR against
      `projnanda/nandatown`, then put its URL in the Devfolio submission. Do not write a PR
      link into any document until the PR actually exists.
- [ ] **Pre-existing work is disclosed.** Copy the paragraph in section 5.7 below verbatim.
      "Existing work can be the starting point; it cannot be the entire submission."
- [ ] A short **what worked / what didn't work / what we learned** is written. Draft material
      for this is in section 6 of this file.

### 5.5 Publish

- [ ] The **team admin** clicks **Publish Project**.
- [ ] The project status reads **Submitted**. **A draft is not a submission.** Reload the page
      and read the status with your own eyes.
- [ ] Screenshot the "Submitted" status, as your own receipt.

### 5.6 Do not do these

- [ ] Do **not** submit the Prava production access form at https://tally.so/r/eq8NZE. Prava's
      own instruction is to apply only once sandbox works end to end, and access is revoked
      after judging. Sandbox is the demo of record.
- [ ] Do **not** run `npm run nanda -w cli -- index-register`. NANDA Index v2 registration needs
      a DNS TXT record on a domain we control, and a `.vercel.app` subdomain cannot carry one.
      It is not what the NANDA prize is for.
- [ ] Do **not** point the chaos suite or any bulk test at the Prava sandbox. The team test
      card allows 30 transactions per day.
- [ ] Do **not** force-push to purge `.qa/` from git history before judging. It needs a
      force-push and a teammate is active on the repo. It is a post-judging cleanup.

### 5.7 Pre-existing work disclosure

**This is a mandatory submission item, not a courtesy.** Copy the paragraph below into the
Devfolio submission verbatim. It is required and it is true.

> The concept and the original protocol specification document (`spec/PROTOCOL.md`) existed
> before the event. **All code in this repository was written during the hackathon window.**
> The coordination layer, the settlement rails, the bill parser, the venue discovery, the
> NANDA Town plugin, the web application and the discovery documents were all built during the
> event. `spec/PROTOCOL.md` was extended during the event to cover the settlement rails and the
> coordination phase.

**Git history independently corroborates this**, which is worth knowing if a judge checks.
The first commit in this repository is `03ad256`, dated **2026-08-01 09:15:21 +0530** — after
the kickoff at **Sat 1 Aug, 7:30 AM IST** (Fri 31 Jul, 7:00 PM PDT). There is no commit
before the event started. Verify it in one command:

```bash
git log --reverse --format="%h %ad %s" --date=iso | head -1
```

The disclosure and the history agree: the specification predates the event, the code does not.

---

## 6. Draft material for "what worked, what didn't, what we learned"

These are true and specific. Trim them; do not embellish them.

**What worked.** The commit saga held under randomized fault injection: 60 runs, injected
500s, lost responses and duplicated deliveries, and six invariants held every time — including
"no member charged twice" cross-checked against the mock Prava's own ledger. The deterministic
floor everywhere turned out to matter more than the model: intent extraction, bill parsing and
ranking all work with no API key at all, so nothing in the demo path depends on an LLM being
available.

**What didn't.** No real card was charged. The passkey ceremony needs a human with a phone, and
we ran out of hours before we ran out of code. The `at_venue` rail exists precisely because a
restaurant bill has no merchant Prava can charge, and we chose to ship a rail that honestly
does not move money rather than fake one that appears to.

**What we learned.** Three things, each of which cost real time:

1. **Live documentation lies, and guards built on it block everything.** Prava's API reference
   says a mandate-setup session response carries `authorizeOnly: true`. The live sandbox never
   sends that field. Our client refused to proceed without it, which blocked every single
   approval until the guard was removed.
2. **An OCR mode that reads a receipt as two columns will produce a bill that reconciles
   perfectly against numbers that are all wrong.** Tesseract page-segmentation modes 3, 4, 11
   and 12 tear `2587.50` into `2587.` and an orphaned `50`; the parser then confirms 2587.00
   against a printed 2587.00 and truthfully reports that the arithmetic checks out. Mode 6
   scored 8/8 exact amounts against 0/8 for every other mode. We now detect that signature
   server-side and refuse to split the bill without an explicit `force`.
3. **Silence is not agreement, and encoding that is harder than it sounds.** A ranking factor
   nobody answered has to carry weight zero and say so, not a fabricated 0.5, or the ordering
   quietly becomes a fiction with a confident-looking number attached.

---

## 7. Every relevant link

| What | URL |
|---|---|
| Event overview | https://agentic-commerce.devfolio.co/overview |
| Prizes and tracks | https://agentic-commerce.devfolio.co/prizes |
| Schedule | https://agentic-commerce.devfolio.co/schedule |
| Our live web app | https://sutra-gmp.vercel.app |
| Our live engine health | https://engine-production-e6fa.up.railway.app/health |
| Our repository | https://github.com/Soham109/sutra |
| Our NANDA SkillMD entry | https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85 |
| NANDA SkillMD registry index | https://nandatown.projectnanda.org/api/skills |
| Prava documentation | https://docs.prava.space |
| Prava sandbox hosted approval host | https://sandbox.collect.prava.space |
| Prava production access form — **do not submit** | https://tally.so/r/eq8NZE |
| NANDA Town simulator | https://github.com/projnanda/nandatown |
| AgentFacts schema | https://github.com/projnanda/agentfacts-format |
