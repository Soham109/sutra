# Screenshots

Every image in [`docs/screenshots/`](screenshots/) is a real capture of the live product at
`https://sutra-gmp.vercel.app`, taken by [`docs/screenshots/capture.mjs`](screenshots/capture.mjs).
Nothing is staged: the script registers a throwaway account, drives the actual UI (typing,
clicking, waiting on real network responses) to create a real bill split and a real link split
with real bare-name friends, approves some shares and leaves others pending, settles one group,
and screenshots each screen as it actually rendered. No image was edited after capture beyond
lossless-ish PNG palette compression to hit the size budget.

Regenerate everything with:

```bash
node docs/screenshots/capture.mjs
```

Point it at a different deployment with `SUTRA_URL=https://your-deploy.example npm exec node docs/screenshots/capture.mjs`
(defaults to production). Each run creates a fresh throwaway account (`rohandesai<timestamp>`) so
re-running never collides with a previous one.

Captured: **2 Aug 2026**, against production (web `sutra-gmp.vercel.app`, engine
`engine-production-e6fa.up.railway.app`), account `Rohan Desai` / `@rohandesai639383`.

## Index

Two names exist for most images: the descriptive one this script writes, and a short alias
the README links to. Both files are byte-identical copies.

| # | File (+ README alias) | Shows | Theme |
|---|---|---|---|
| 1 | `01-landing-light.png` | The landing page, top of page, logged out. | light |
| 2 | `02-dashboard-light.png` (`dashboard.png`) | The signed-in dashboard with real data: 1 pending approval, 2 groups, an exposure figure, and a "waiting on others" panel listing both the bill split (2 of 3 approved) and the link split (0 of 3). | light |
| 3 | `03-discover-search-light.png` (`discover.png`) | `/app/discover` after a real search for "merino tee" — 2 real Allbirds results, live prices, source-strip timing. | light |
| 4 | `04-bill-parsed-light.png` (`bill-split.png`) | `/app/bill` with a real receipt pasted and parsed: itemised lines, the green "the maths checks out" reconciliation, three real (bare-name) people seated and their per-person totals. | light |
| 5 | `05-group-midflight-light.png` (`group-thread.png`) | The bill-split group page mid-flight (2 of 3 accepted, 1 pending) — consent thread, event log, cart, invite panel. **See the caveat below — this page is showing a real product bug, not a capture artefact.** | light |
| 6 | `06-approval-pending-light.png` | `/a/:memberId` for the still-pending member (Arjun) — the screen most people ever see, mid-decision. | light |
| 7 | `07-receipt-settled-light.png` (`receipt.png`) | The signed receipt for the same group once all three accepted and it settled: consent chain, hash links, the "public key matches the live engine" verification panel. | light |
| 8 | `08-nanda-light.png` | `/nanda` — the four-endpoint discovery chain (all green, fetched live by the browser) and the `prava_mandates` vs `prepaid_credits` contrast section. | light |
| 9 | `09-plan-board-light.png` (`plan.png`) | The plan board for "Dinner tomorrow with Arjun and Kavya near Koramangala" — 7 real venues from OpenStreetMap, ranked, in ~5s. | light |
| 10 | `10-dashboard-dark.png` | The dashboard again, in dark theme, captured after the bill split settled — now also showing a populated "Settled" chart and receipt row. | dark |
| 11 | `11-landing-dark.png` | The landing page in dark theme, same framing as #1. | dark |

`extension.png` (linked from the README) was **not captured** — see "Not captured" below.

## An important caveat on #5 / `group-thread.png`

This screenshot is real and unedited, and it is showing a genuine bug, not a stale capture.
At the moment it was taken, member `Arjun Mehta` had not yet accepted; `Rohan Desai` and
`Kavya Menon` had — confirmed by the receipt captured 90 seconds later (`07`), which correctly
shows all three settled at essentially the same timestamp. But the group war-room page
(`/app/groups/:id`) header, consent thread and member panel all say **"0/3 approved"** and
**"Waiting on Rohan Desai, Arjun Mehta and Kavya Menon"** — i.e. it never registers the two
acceptances that had already happened, even though the raw event log lower on the same page
correctly lists both `member.accepted` entries.

Root cause: [`web/src/components/group/derive.tsx`](../web/src/components/group/derive.tsx)
replays the event log through a `switch (e.type)` to compute each member's live status. It has
a `case 'member.approved':` (the card-rail mandate event) but **no `case 'member.accepted':`**
(the `at_venue`/bill-split rail's acceptance event, emitted by `acceptShare()` in
[`engine/src/service.ts`](../engine/src/service.ts)). Every bill split's live group page is
affected — the "who has approved" thread and the N-of-M count stay frozen at their
pre-acceptance status for the life of the group, on every device watching it, live and on
reload, until the group finally terminates and the terminal banner (which reads different
data) takes over. The member's own `/a/:memberId` page and the final receipt are both correct;
only this shared war-room view is wrong. This did not affect the dashboard (`02`/`10`), which
reads a separate, non-live `/v1/my/dashboard` aggregate and correctly showed "2 of 3 approved"
throughout.

This screenshot is left as captured, per the brief ("if a screen looks bad, that is a finding
to report, not something to hide"). Before using `group-thread.png` in anything judge-facing,
either fix the missing case (mirror `case 'member.approved'`, mapping to
`m.status = 'approved'`, reading the amount off the event's `amount` field rather than
`share`/`cap`) and recapture, or swap in a different image.

## Not captured

- **`extension.png`** — the Chrome extension needs a real Chrome instance with the unpacked
  extension loaded and a real merchant page open (`document.title`, DOM scraping, the
  content-script cart detector). That is a fundamentally different harness from a headless
  Puppeteer session driving the web app, and this script does not attempt it. Faking a browser
  chrome around a cropped product page would not be a real capture, so nothing was written.
  Cut the link from the README, or capture it by hand from a real loaded-unpacked session.

## What else was checked and looked fine

- The `/app/discover` search, the receipt reconciliation, and the plan board's venue search
  (7 real OpenStreetMap results in ~5s for "near Koramangala") all worked cleanly on this run —
  STATUS.md's note that venue search was unreliable earlier in the day did not reproduce.
- The receipt's Ed25519 signature panel reported "Public key matches the live engine" for real,
  against the deployed engine's `/health` key, not a canned string.
