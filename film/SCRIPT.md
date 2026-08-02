# Sutra demo film — final script

The final is a deterministic 1920×1080 HTML film rendered at 30 fps. It is
**1:45**, has embedded captions, a generated musical bed, and can accept a
human master voiceover without changing picture timing.

## Story

The film has one argument:

> A group should not need a temporary lender. Each person can approve only
> their own share, and the group can still make one coordinated decision.

Every shot carries one dominant idea and one proof element. The UI is a quiet
light editorial system: warm paper, black type, thin rules, white cards, and
one orange accent. No glow, glass, fake browser chrome, or decorative charts.

## Final timeline

| Time | Chapter | What changes on screen |
|---:|---|---|
| 00:00–00:11 | The temporary lender | Ada’s chat fills with delays while ₹7,200 remains on her card. |
| 00:11–00:18 | The reversal | Four people approve into one explicit `all_of(4)` decision rail. |
| 00:18–00:34 | Four cards, one decision | Four personal share cards approve independently; nothing charges before the last required yes. |
| 00:34–00:51 | Coordinate first | Sentence/link/page/bill inputs resolve into a plan; Maya’s answer changes venue order and score. |
| 00:51–01:03 | Agent boundary | `@sutra` answers from real state, then refuses a payment instruction because only a passkey can consent. |
| 01:03–01:19 | NANDA × Prava | `prepaid_credits` pooling is compared with `prava_mandates`; terminal invariants arrive as proof. |
| 01:19–01:30 | Shopify boundary | Live catalog, development-store test order proof, Shopify POS handoff, and the ordinary online-checkout boundary. |
| 01:30–01:45 | Receipt and close | Exact entries, hash chain and Ed25519 signature resolve into the final promise. |

## Truth rules

- Do not claim a completed human-approved Prava sandbox charge unless one has
  actually been recorded.
- A physical bill uses the `at_venue` rail: it can settle agreement, not charge
  the venue.
- An ordinary shared online cart with one card field is not placed by Sutra.
- Shopify POS is a cashier handoff, not a direct Sutra integration or proof of payment.
- In the configured development-store proof, Sutra explicitly collects a fictional demo address and creates a Shopify order with `test: true`; no real money moves.
- In ordinary online handoff, delivery address, shipping, tax and final payment stay in Shopify checkout until a merchant adapter exists.
- NANDA simulated output remains clearly described as protocol/plugin proof.
- Captions and receipts use “charged” only for a rail capable of moving money.

## Build

```bash
npm run film:voice
node film/make-sfx.mjs
npm run film:render
npm run film:assemble -- --out sutra-demo-final.mp4
```

If `film/voiceover.wav`, `.m4a`, or `.mp3` exists, assembly uses it instead of
the generated line-by-line voice. See [`VOICEOVER.md`](VOICEOVER.md).
