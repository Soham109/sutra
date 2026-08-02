# sutra — the film

A self-playing HTML film. Open `film/index.html`, press Play, screen-record in
one take. Every scene advances on a timer; nothing needs a human to scroll.

**Target: 3 minutes 10 seconds.** A hackathon judge has 40 projects to see.
Anything past four minutes is watched at 2× or abandoned.

Narration is on screen as captions ALWAYS, and optionally spoken through the
browser's own `speechSynthesis`. Captions are the source of truth — if the
voice is off, nothing is lost.

---

## Rules for everyone building a scene

1. **Nothing invented.** Every number, receipt, venue and price on screen is
   either real output from this repo or clearly a fictional character's
   messages. No fake dashboards implying features we do not have.
2. **No claim the product cannot survive.** Especially: sutra does not place a
   merchant order for a shared cart. Scene 8 says so out loud.
3. One accent colour — the brand orange. Everything else is warm paper and ink.
   Tokens are at the top of `web/src/app/globals.css`; the film has its own
   copy so it can be opened as a standalone file.
4. Every scene must be legible **paused**. A judge will pause on a frame.
5. Sound is generated with the Web Audio API — no files, no network. Short,
   soft, never a startle. A mute toggle is always visible.
6. `prefers-reduced-motion` gets a version with no movement, just cuts.

---

## Scene 1 — 0:00–0:28 · THE PROBLEM

**Visual.** A phone, centred, real proportions. A group chat called
"goa trip ✈️". Ada books four bus tickets — a booking confirmation slides in,
₹9,600. She types: *"booked! 2400 each 🙏"*

Then the replies arrive, one at a time, with a soft notification tick:

- **Arsh** — *"sent!"* → a ✓ lands beside his name
- **Maya** — *"paying tonight!"* → 🕐
- **Dev** — *"remind me tomorrow"* → 🕐
- **Priya** — typing… then nothing. The dots fade.

The counter in the corner: **₹2,400 back of ₹9,600.**

Then time passes — the date chip ticks *Tue → Thu → Sun → next Thu*. Ada's
follow-ups pile up: *"hey"*, *"sorry to ask again 😅"*, *"guys?"* Each one is
smaller and greyer than the last. Maya's *"paying tonight!"* is still sitting
there, nine days old.

Final frame: **₹7,200 outstanding. 11 days. 4 reminders.**

**Caption.** "Somebody always pays first. Then they spend a fortnight asking
for it back."

**Note to the builder:** this scene carries the whole film. It should feel
faintly embarrassing to watch. No product, no logo, no interface — just the
thing everyone has lived.

---

## Scene 2 — 0:28–0:40 · THE TURN

The chat desaturates and pulls back. One line, centred:

> **What if nobody had to pay first?**

Beat. Then the sutra mark, and:

> **Everyone approves. Everyone pays. Same moment. Or nobody does.**

**Caption.** "sutra is a payment protocol for more than one person."

---

## Scene 3 — 0:40–1:05 · THE SAME TRIP, DONE PROPERLY

Four phones, side by side. Ada's says *"Goa bus — ₹9,600 · 4 people"*.
She taps **Send everyone their link**.

Three phones light up in sequence with a soft tick. Each shows the approval
page — real layout: **your share, ₹2,400**, the merchant name, "capped at
₹2,400", and a passkey button.

Each taps. A ring fills around each phone.

**The beat that matters:** after the first two approve, hold. Caption reads
**"Nothing has been charged yet."** Let it sit for two full seconds.

Then the fourth approves — and all four flip to **paid** in the same frame,
with one chord.

**Caption.** "Four people. Four cards. One moment. Nobody fronted anything."

---

## Scene 4 — 1:05–1:22 · WHERE A SPLIT COMES FROM

Fast cuts, ~4s each, real UI shapes:

1. **Say it.** Typing *"dinner saturday with arsh and maya near koramangala,
   under ₹800 each"* → it resolves to a real map pin and a ranked list of real
   restaurants. Caption: "Real places from OpenStreetMap. Nothing invented."
2. **Paste a link.** A product URL → title, price, currency, variants read off
   the merchant's own page. Caption: "It reads the merchant's own data."
3. **The extension.** A checkout page with the sutra sheet sliding up over it.
   Caption: "Or split the page you're already on."
4. **Photograph a bill.** A restaurant receipt → itemised lines → a green
   **"₹2,587.50 — matches the printed total"**. Caption: "Read on your device.
   The maths is checked against the paper."

---

## Scene 5 — 1:22–1:42 · PLANNING

The one feature that is not about money.

A plan board. Three people answer on their phones — when they're free, where
they're coming from, what they can spend. The board re-ranks live and prints
its reasons:

- *"Open until 11:30pm."*
- *"12 minutes for Maya, 18 for Arsh."*
- *"Within everyone's budget."*
- Then a card moves: **"Sablewood moved from 3rd to 1st — Maya can now make
  8pm."**

**Caption.** "It says why. Budgets stay private — the ranker sees them, nobody
else does."

---

## Scene 6 — 1:42–2:00 · THE THREAD, AND @sutra

A group thread. People talking normally. Someone types **@sutra who hasn't
answered?** — the bot replies from real state: *"Waiting on Dev. Maya answered
20 minutes ago."*

Then someone types **@sutra just pay for me** and the bot refuses:

> **I can plan, rank and ask — I can never approve or move money. That needs
> your own passkey.**

**Caption.** "The agent does the chasing. It can never do the paying."

**Note:** this refusal is real and tested. It is the most important frame in
the feature tour — hold it a beat longer than the others.

---

## Scene 7 — 2:00–2:25 · NANDA

Two panes, side by side, running the same group purchase.

**Left — `prepaid_credits`** (NANDA Town's bundled plugin): coins slide from
three agents into the organiser's own balance. A counter: **organiser +18,600**.
Stamp: **POOLED**.

**Right — `prava_mandates`** (ours): four separate lines go from four cards
*past* the simulator to a merchant outside it. **organiser +0**, **merchant
18,600**. Stamp: **NO POOLED FUNDS**.

Then real terminal output types on:

```
[PASS] the group reached a terminal, all-or-nothing outcome (committed)
[PASS] Dev declined and was never charged (0)
[PASS] backstop Maya absorbed the shortfall on her own card (5580 of 6000)
[PASS] conservation_report: no_pooled_funds
```

**Caption.** "With our plugin installed, one agent cannot pay another. Money
only leaves a card and reaches a merchant."

---

## Scene 8 — 2:25–2:45 · WHAT IT DOES NOT DO

Plain, no animation. Dark card, white text. This scene wins trust.

> **Where this stops.**
>
> A shared online cart is paid by several cards. Most checkouts have one card
> field — so sutra collects the money, but does not place that order.
>
> It completes end to end when everyone buys their own item, and at a venue,
> where a table has always been able to hand over four cards.
>
> Every charge carries the same group reference. That is the hook a merchant
> would reconcile on. It is a proposal. Nobody has adopted it yet.

**Caption.** "We would rather tell you than have you find out."

---

## Scene 9 — 2:45–3:10 · CLOSE

Receipt, drawn honestly: line per person, the hash chain, the Ed25519
signature, and the settlement disclosure in the right words for the rail.

Then:

> **Nothing pooled. Nothing fronted. Nothing invented.**
>
> sutra-gmp.vercel.app

Final card, small: **626 engine tests · 117 plugin tests · every venue real ·
every price read from the merchant.**

---

## What Soham screen-records afterwards, live, minimally

Keep this to 60–90 seconds. Live proof, not a second tour.

1. `sutra-gmp.vercel.app` — the live health badge showing **Prava sandbox**.
2. Paste one real product link → real title, real price, real currency.
3. `/app/bill` — photograph a real receipt → itemised → "matches the printed
   total".
4. Send yourself a share link, open it on your phone, **tap the passkey and let
   a real sandbox charge land.** Show the receipt afterwards.
5. `python scripts/town_scene.py` — one command, the PASS lines scrolling.

That is the whole live demo. The film does the explaining; the screen recording
does the proving.
