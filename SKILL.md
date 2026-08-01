# sutra — group checkout for agents (GMP/1)

Any agent that can buy something can now sell it to a group. This skill turns
one cart and N humans into N per-member, card-network-enforced Prava mandates
with an atomic-enough commit: everyone is charged in one window, or every
mandate is cancelled and nobody was ever charged. No pooled funds, no one
fronts money, the engine never sees a card number.

## When to use

The user wants to buy something for several people who each pay their own
share: tickets, group dinners, shared gifts, splits of any one-merchant cart.
Do NOT use for single-payer purchases (use Prava directly) or for moving money
between people (GMP/1 never does P2P).

## Base URL and auth

- Base: `GMP_API` (default `http://localhost:4100`)
- Auth: `Authorization: Bearer <ENGINE_API_TOKEN>` — needed only for `POST /v1/groups`.
- All amounts are integer minor units (cents).

## Workflow

1. **Create the group** — `POST /v1/groups`

```json
{
  "title": "Ratatat — 4 tickets",
  "merchant": { "id": "x", "name": "Velvet Ticket Co.", "url": "https://velvet.example", "country_code_iso2": "US" },
  "cart": {
    "items": [{ "sku": "ga", "name": "GA ticket", "unit_amount": 4500, "qty": 4, "claimants": ["mi_all"] }],
    "fees": [{ "name": "fees", "amount": 600 }],
    "currency": "USD"
  },
  "members": [
    { "name": "Soham", "role": "payer" },
    { "name": "Arsh", "role": "backstop", "backstop_cap": 6000 },
    { "name": "Dev", "role": "payer" },
    { "name": "Maya", "role": "payer" }
  ],
  "policy": { "type": "quorum", "m": 3 },
  "deadline_minutes": 60
}
```

Policies: `{"type":"all_of"}` · `{"type":"quorum","m":3}` · `{"type":"weighted","threshold":5}` ·
`{"type":"veto","member":"Name","inner":…}` · `{"type":"required","member":"Name","inner":…}` ·
`{"type":"deadline","at":"<iso>","primary":…,"fallback":…}`.

Response `201`: `group_id`, `board_url`, and `members[]` each with
`approval_page_url`. **Give each member their own URL** (or the QR at
`GET /v1/members/:id/qr.png`). Approval happens on the member's phone with
their own passkey — the agent cannot and must not approve for them.

2. **Watch** — `GET /v1/groups/:id` (poll) or `GET /v1/groups/:id/events?after=<seq>` (SSE).
   Terminal statuses: `committed`, `partial`, `aborted`, `expired`.

3. **Cancel if plans change** — `POST /v1/groups/:id/cancel` (pre-commit only).

4. **Prove it** — `GET /v1/groups/:id/receipt` returns a hash-chained,
   Ed25519-signed consent receipt. Verify offline with `gmp verify receipt.json`.

## Notes for agents

- A member declining under `all_of` aborts everything; under `quorum` the rest
  proceed and an armed backstop can silently absorb the dropped share.
- Contested items (more claimants than qty) open a sealed priority-bid window:
  `POST /v1/members/:id/bid {"sku","amount"}`. Bids allocate slots, never
  change the price.
- `POST /v1/members/:id/hold` / `.../resume` pauses/resumes a member's mandate
  (held shares count as not-approved at decision time).
- The same three operations are exposed over MCP (`@sutra/mcp`):
  `create_group_session`, `get_group_status`, `cancel_group`.
