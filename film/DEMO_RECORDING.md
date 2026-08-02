# Sutra demo recording runbook

Use this as the recording order. The rendered MP4 is intentionally not stored
in Git; rebuild the film locally after replacing or regenerating narration.

## Deliverables

1. **Cinematic product film** — the story-led film in `film/`.
2. **Live product proof** — a separate 60–90 second browser recording.
3. **Optional payment proof** — only when the real Prava sandbox and a human
   passkey are available.

Do not screen-record playback of the cinematic film. Render it and upload the
resulting MP4 directly so it stays sharp and the audio is not captured twice.

## Before recording

```bash
cp .env.example .env
npm install
npm run dev
```

The web app runs at `http://localhost:3000`; the engine runs at
`http://localhost:4100`. Keep `PRAVA_ENV=mock` for the safe product walkthrough.

- Record at 1920×1080 and 100% browser zoom.
- Hide bookmarks, notifications, passwords, API keys and unrelated tabs.
- Log in **before** creating the plan so participant links remain available.
- Create the full demo once, then rehearse the exact recording path twice.
- Keep a completed group open in a backup tab in case a live lookup is slow.

## Live recording: 60–90 seconds

### 1. Start with one sentence

Open `http://localhost:3000/app/plan/new` and enter:

> Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each.

Show the extracted time, people, place and budget. Create the plan.

### 2. Show coordination, not a form

On `/app/plans/:id`, show:

- participant invite links;
- availability, location and budget signals;
- ranked real venues; and
- the plain-language reason for each ranking.

Open one `/p/:participantId` link in a private window or on a phone. Submit that
person's RSVP, availability, area and budget, then return to the plan board and
show the ranking update.

### 3. Show the payment invariant

Convert the plan into a group. Open one member's `/a/:memberId` page and pause
long enough to show:

- their exact share;
- their personal cap;
- their own card; and
- the passkey approval boundary.

Say: **“Approval charges nothing. The group settles only when every required
member has committed.”**

In mock mode, demonstrate the state transition without claiming a real charge.

### 4. Show the agent boundary

Open `/app/groups/:id`. Show the group status and thread, then ask:

> @sutra just pay for me

Hold on the refusal. The important proof is that the agent can coordinate and
explain state, but cannot approve or move money for a member.

### 5. End on the receipt

Open `/app/receipts/:id`. Show the signed consent chain, member outcomes and the
settlement disclosure. End with:

> Nothing pooled. Nothing fronted. Nothing invented.

## Optional NANDA proof

Run this in a clean terminal and record its narrated protocol scene:

```bash
npm run nanda:scene
```

Use it after the browser walkthrough, not instead of the human-facing story.

## Real sandbox proof

Only use this section when `PRAVA_ENV=sandbox` and `PRAVA_API_KEY` is configured
locally. Never display or paste the key into the recording.

First run the single-charge smoke test:

```bash
npx tsx e2e/sandbox-smoke.ts
```

For the proof flow:

```bash
npm run e2e:proof -- --watch
```

The script pauses for a human to complete the passkey ceremony. Do not describe
the walkthrough as a real card charge unless this sandbox flow has completed.

## Final edit

- Open with the strongest 5–8 seconds of the cinematic film.
- Cut to the live one-sentence plan and participant response.
- Spend most of the time on own-card approval, all-or-nothing settlement and
  the agent refusal.
- Finish on the signed receipt and Sutra closing frame.
- Remove loading, typing mistakes, setup, login and dead air.
