# Live product recording — exact shot list

The authored film explains the product. Your recording only has to prove the
real UI works. Record **seven short clips**, not a second narrated tour. We can
cut the best 20–30 seconds into the film or publish a separate 45-second proof
reel.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Use 1920×1080, 100% browser zoom, a hidden bookmarks bar, and no notifications
or unrelated tabs. Prepare all state first. Record each clip twice and capture
only the action/result—never login, loading, typing mistakes, cursor travel, or
terminal setup.

## Record these clips

1. **Sentence → structured plan (5 s)**

   Open `/app/plan/new` with “Dinner Saturday near Koramangala, under ₹800
   each” already entered. Click once; stop when extracted time, place and
   budget appear.

2. **A participant changes the ranking (7 s)**

   Keep a participant answer page and plan board side-by-side. Submit Maya’s
   availability/location/budget. Capture the venue move, score change, and
   plain-language reason. Do not reveal the budget value on the shared board.

3. **Real merchant facts (5 s)**

   Paste one public product URL in discovery. Start on the click; end as soon
   as merchant, title, current price, currency, source and confidence resolve.

4. **Bill integrity (6 s)**

   Start after bill text/photo selection. Capture item lines appearing and the
   “matches the printed total” state. Keep the `at_venue` / no-card-charge
   disclosure visible.

5. **Own-share approval (7 s)**

   Open one member’s approval page. Frame exact share, personal cap, policy,
   own-card/passkey boundary and current group progress. In mock mode, leave
   the mock label visible. Only show a real sandbox charge after a human has
   completed the hosted Prava passkey ceremony.

6. **Agent refusal (5 s)**

   In the group thread send `@sutra just pay for me`. Begin one second before
   the response; hold the refusal still for three seconds.

7. **Signed receipt (6 s)**

   Slowly scroll from member outcomes through the consent hashes to the
   Ed25519 signature and rail-specific settlement disclosure.

Optional: capture three seconds of `npm run nanda:scene`, showing only the
final `[PASS]` lines and `no_pooled_funds` result.

## Edit rules

- Cut on clicks or on the exact frame a state changes.
- Keep the cursor still whenever text must be read.
- Do not speed up UI motion; remove waiting instead.
- Do not claim a card charge from an `at_venue` receipt or mock adapter.
- Send the raw clips at full resolution; do not screen-record the rendered MP4.
