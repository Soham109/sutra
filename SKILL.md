# sutra — group checkout (GMP/1)

Buy one thing for N people, where each person pays their own share from their own card.

## Base URL
http://localhost:4100

## Endpoints

POST /v1/groups
  Create a group checkout. One cart, N members, one merchant-locked amount-capped payment mandate per member on their own card, all committed together under a policy. Needs `Authorization: Bearer <ENGINE_API_TOKEN>`. All amounts are integer minor units (cents). Returns one private approval URL per member. A resolvable merchant URL alone is **not** enough to reach the card rail — it proves where the item came from, not that the merchant can be charged, so it defaults to `checkout_handoff` (agree the split, then finish at the merchant's own checkout). To actually mint a card mandate per member, pass `"rail": "prava_mandates"` explicitly, as below, against a merchant this deployment is actually configured to charge.
  Example:
    curl -X POST "http://localhost:4100/v1/groups" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer dev-token" \
      -d '{
        "title": "Ratatat - 4 tickets",
        "merchant": { "id": "velvet", "name": "Velvet Ticket Co.", "url": "https://velvet-ticket.example", "country_code_iso2": "US" },
        "cart": {
          "items": [{ "sku": "ga", "name": "GA ticket", "unit_amount": 4500, "qty": 4, "claimants": ["mi_all"] }],
          "fees": [{ "name": "booking fee", "amount": 600 }],
          "currency": "USD"
        },
        "members": [
          { "name": "Soham", "role": "payer" },
          { "name": "Arsh", "role": "backstop", "backstop_cap": 6000 },
          { "name": "Dev", "role": "payer" },
          { "name": "Maya", "role": "payer" }
        ],
        "policy": { "type": "quorum", "m": 3 },
        "rail": "prava_mandates",
        "deadline_minutes": 60
      }'
  Response:
    {
      "group_id": "gs_9c1f4a2b",
      "board_url": "http://localhost:4100/g/gs_9c1f4a2b/board",
      "members": [
        { "member_id": "mi_a1", "name": "Soham", "role": "payer", "share_amount": 4650, "approval_page_url": "http://localhost:4100/a/mi_a1" },
        { "member_id": "mi_b2", "name": "Arsh", "role": "backstop", "share_amount": 4650, "approval_page_url": "http://localhost:4100/a/mi_b2" },
        { "member_id": "mi_c3", "name": "Dev", "role": "payer", "share_amount": 4650, "approval_page_url": "http://localhost:4100/a/mi_c3" },
        { "member_id": "mi_d4", "name": "Maya", "role": "payer", "share_amount": 4650, "approval_page_url": "http://localhost:4100/a/mi_d4" }
      ]
    }

GET /v1/groups/{group_id}
  Read the whole group: status, policy, and every member's share, cap and settlement state. Terminal statuses are `committed`, `partial`, `aborted`, `expired`. Abridged below; the full shape is in openapi.json.
  Example:
    curl "http://localhost:4100/v1/groups/gs_9c1f4a2b"
  Response:
    {
      "group_id": "gs_9c1f4a2b",
      "title": "Ratatat - 4 tickets",
      "status": "collecting",
      "total": 18600,
      "currency": "USD",
      "policy_text": "at least 3 approve",
      "deadline_at": "2026-08-01T19:30:00.000Z",
      "terminal": false,
      "event_cursor": 7,
      "members": [
        { "member_id": "mi_a1", "name": "Soham", "status": "approved", "share_amount": 4650, "cap_amount": 4697, "charged_amount": 0 },
        { "member_id": "mi_d4", "name": "Maya", "status": "invited", "share_amount": 4650, "cap_amount": 4697, "charged_amount": 0 }
      ]
    }

GET /v1/groups/{group_id}/events?after={seq}
  Server-sent event stream of the group timeline from a cursor. Use this instead of polling. Each frame is `event: gmp` with a JSON `data:` payload.
  Example:
    curl -N "http://localhost:4100/v1/groups/gs_9c1f4a2b/events?after=0"
  Response:
    { "seq": 8, "group_id": "gs_9c1f4a2b", "member_id": "mi_d4", "type": "member.approved", "payload": { "cap_amount": 4697 }, "at": "2026-08-01T18:41:02.000Z" }

POST /v1/groups/{group_id}/cancel
  Cancel the whole group before it commits. Every outstanding mandate is cancelled and nobody is charged. Has no effect once the group is terminal. Gated: needs the engine bearer token, a session that created the group, or — for a group with no account behind it — `{"as_member":"<first member's own id>"}` as proof. Anyone else gets `403`.
  Example:
    curl -X POST "http://localhost:4100/v1/groups/gs_9c1f4a2b/cancel" -H "Authorization: Bearer dev-token"
  Response:
    { "group_id": "gs_9c1f4a2b", "status": "aborted", "terminal": true, "decision_note": "cancelled by the organizer" }

GET /v1/groups/{group_id}/receipt
  The signed consent receipt, available once the group is terminal. A hash-chained list of consent objects, Ed25519-signed, carrying the public key needed to check it. Verify offline with `gmp verify receipt.json`.
  Example:
    curl "http://localhost:4100/v1/groups/gs_9c1f4a2b/receipt"
  Response:
    {
      "group_id": "gs_9c1f4a2b",
      "status": "committed",
      "currency": "USD",
      "rail": "prava_mandates",
      "totals": { "charged": 18600 },
      "entries": [
        { "member": "Soham", "cart_hash": "9f2c...", "cap": 4697, "mandate_id": "mnd_71a", "outcome": "charged", "amount": 4650, "prev_hash": "0000..." }
      ],
      "chain_head": "b3d1...",
      "public_key": "4a7e..."
    }

GET /v1/groups/{group_id}/joinable
  Public join view: which member seats are still claimable, for a shared link or an NFC totem. Does not reveal anyone's cap or share.
  Example:
    curl "http://localhost:4100/v1/groups/gs_9c1f4a2b/joinable"
  Response:
    { "group_id": "gs_9c1f4a2b", "title": "Ratatat - 4 tickets", "open_seats": [{ "member_id": "mi_d4", "role": "payer" }] }

GET /v1/members/{member_id}
  One member's own view: their share, their cap, and the approval URL they must open themselves.
  Example:
    curl "http://localhost:4100/v1/members/mi_d4"
  Response:
    { "member_id": "mi_d4", "group_id": "gs_9c1f4a2b", "name": "Maya", "status": "awaiting_approval", "share_amount": 4650, "cap_amount": 4697, "approval_url": "https://pay.prava.example/s/sess_88f", "my_items": [{ "sku": "ga", "name": "GA ticket", "qty": 4 }] }

POST /v1/members/{member_id}/decline
  Record that a member said no. Under `all_of` this aborts the group; under `quorum` the others continue and an armed backstop may absorb the dropped share.
  Example:
    curl -X POST "http://localhost:4100/v1/members/mi_d4/decline"
  Response:
    { "member_id": "mi_d4", "name": "Maya", "status": "declined", "share_amount": 4650 }

POST /v1/members/{member_id}/hold
  Pause a member's mandate. A held share counts as not-approved when the commit policy is evaluated.
  Example:
    curl -X POST "http://localhost:4100/v1/members/mi_d4/hold"
  Response:
    { "member_id": "mi_d4", "name": "Maya", "status": "held" }

POST /v1/members/{member_id}/resume
  Resume a held member.
  Example:
    curl -X POST "http://localhost:4100/v1/members/mi_d4/resume"
  Response:
    { "member_id": "mi_d4", "name": "Maya", "status": "awaiting_approval" }

POST /v1/members/{member_id}/bid
  Sealed priority bid on a contested item (more claimants than slots). Bids decide who gets a slot; they never change what anyone pays. Winners pay the merchant price.
  Example:
    curl -X POST "http://localhost:4100/v1/members/mi_a1/bid" \
      -H "Content-Type: application/json" \
      -d '{ "sku": "front", "amount": 700 }'
  Response:
    { "member_id": "mi_a1", "name": "Soham", "status": "invited", "auction": { "open": true, "closes_at": "2026-08-01T18:50:00.000Z", "contested_items": [{ "sku": "front", "name": "Front row seat", "slots": 2, "claimants": 3, "my_bid": 700 }] } }

POST /v1/agent/plan
  One sentence in, a coordinated plan out. Extracts the intent, geocodes the place, asks each person for what is still missing, and ranks real venues from OpenStreetMap. Set `"dry_run": true` to see what was understood without creating anything.
  Example:
    curl -X POST "http://localhost:4100/v1/agent/plan" \
      -H "Content-Type: application/json" \
      -d '{ "text": "dinner for 4 of us in Bandra on Friday evening, under 800 a head", "participants": [{ "name": "Soham" }, { "name": "Arsh" }, { "name": "Dev" }, { "name": "Maya" }] }'
  Response:
    {
      "understood": { "title": "Dinner in Bandra", "kind": "dining", "ask": ["rsvp", "availability"], "slots": { "where": { "label": "Bandra, Mumbai", "lat": 19.0596, "lng": 72.8295 } } },
      "extractor": "heuristic",
      "uncertainties": ["\"Bandra\" resolved to Bandra, Mumbai"],
      "plan": {
        "plan_id": "pl_4d7e",
        "status": "collecting",
        "option_count": 12,
        "participants": [{ "participant_id": "pp_1", "name": "Soham", "answered": [] }]
      }
    }

POST /v1/plans
  Create a coordination plan explicitly, with your own slots, participants and asks — for when you already know the shape of the plan and do not need POST /v1/agent/plan to work it out from a sentence.
  Example:
    curl -X POST "http://localhost:4100/v1/plans" \
      -H "Content-Type: application/json" \
      -d '{ "title": "Dinner in Bandra", "kind": "dining", "ask": ["rsvp", "availability"], "participants": [{ "name": "Soham" }, { "name": "Arsh" }] }'
  Response:
    { "plan_id": "pl_4d7e", "status": "collecting", "participants": [{ "participant_id": "pp_1", "name": "Soham" }] }

GET /v1/plans/{plan_id}
  Plan state: who has answered, what is still being asked, and the current option list.
  Example:
    curl "http://localhost:4100/v1/plans/pl_4d7e"
  Response:
    { "plan_id": "pl_4d7e", "title": "Dinner in Bandra", "status": "collecting", "responded_count": 1, "participants": [{ "participant_id": "pp_1", "name": "Soham", "answered": ["rsvp"] }] }

GET /v1/plans/{plan_id}/events?after={seq}
  Server-sent event stream of the plan timeline, same shape as the group event stream.
  Example:
    curl -N "http://localhost:4100/v1/plans/pl_4d7e/events?after=0"

GET /v1/participants/{participant_id}
  One participant's own view: their name, what the plan still wants from them, and their own answers so far. The id itself is the credential — no further proof is asked.
  Example:
    curl "http://localhost:4100/v1/participants/pp_1"
  Response:
    { "participant_id": "pp_1", "name": "Soham", "asked": ["availability"], "my_signals": [{ "kind": "rsvp", "in": true }] }

POST /v1/participants/{participant_id}/signal
  Record one person's answer: `rsvp`, `availability`, `location` or `budget`. Answers stay private to the ranker; only the ranking is shared with the group.
  Example:
    curl -X POST "http://localhost:4100/v1/participants/pp_1/signal" \
      -H "Content-Type: application/json" \
      -d '{ "kind": "rsvp", "in": true }'
  Response:
    { "plan_id": "pl_4d7e", "status": "collecting", "responded_count": 1, "participants": [{ "participant_id": "pp_1", "name": "Soham", "answered": ["rsvp"], "rsvp": true }] }

GET /v1/plans/{plan_id}/options
  Ranked real options plus the time windows that actually work for everyone who has answered.
  Example:
    curl "http://localhost:4100/v1/plans/pl_4d7e/options"
  Response:
    {
      "plan_id": "pl_4d7e",
      "best_windows": [{ "start": "2026-08-07T19:00:00.000Z", "end": "2026-08-07T22:00:00.000Z", "available": 4 }],
      "options": [{ "option_id": "op_2", "label": "Bastian", "score": 0.82, "distance_m": 900, "why": ["closest to everyone", "within budget"] }]
    }

POST /v1/plans/{plan_id}/choose
  Lock one option as the group's choice. Only the plan's own organiser may call this: the signed-in principal whose session created the plan, or the engine's own bearer token standing in for one. Anyone else gets `403 {"error":"only the person who started this plan can do that"}` — this is the one step in the coordination flow a stranger agent cannot self-serve past without either a session or the token.
  Example:
    curl -X POST "http://localhost:4100/v1/plans/pl_4d7e/choose" \
      -H "Content-Type: application/json" \
      -d '{ "option_id": "op_2" }'
  Response:
    { "plan_id": "pl_4d7e", "status": "chosen", "chosen_option_id": "op_2" }

POST /v1/plans/{plan_id}/convert
  The handover: turn the chosen plan into a real group checkout. Same organiser requirement as `choose`, above. The rail is decided by where the chosen option came from, not requested here: an OpenStreetMap venue (like this Bandra dinner) always settles `at_venue` — no card is charged through this engine — because a restaurant listing is not a merchant this engine can bill. A chosen product-catalog option instead lands on `checkout_handoff` by default, or `shopify_pos` if the caller asked for it; only `POST /v1/groups` called directly, with `"rail": "prava_mandates"` explicit in the body, ever mints real per-member card mandates.
  Example:
    curl -X POST "http://localhost:4100/v1/plans/pl_4d7e/convert" \
      -H "Content-Type: application/json" \
      -d '{ "unit_amount": 80000, "qty": 4, "currency": "INR" }'
  Response:
    { "group_id": "gs_2b8c", "rail": "at_venue", "members": [{ "member_id": "mi_e5", "name": "Soham", "share_amount": 80000 }] }

PUT /v1/delegate/rules
  Set the standing rules a delegate agent may act on for the signed-in caller: budget ceiling, recurring availability, home location, constraints. Requires being signed in as the human whose rules these are.
  Example:
    curl -X PUT "http://localhost:4100/v1/delegate/rules" \
      -H "Content-Type: application/json" -H "Cookie: sutra_uid=..." \
      -d '{ "budget_ceiling": 80000, "availability": ["evenings"], "location": { "lat": 19.0596, "lng": 72.8295 } }'
  Response:
    { "user_id": "u_1", "rules": { "budget_ceiling": 80000 } }

GET /v1/delegate/rules
  Read the signed-in caller's own standing rules, or null if none are on file.
  Example:
    curl "http://localhost:4100/v1/delegate/rules" -H "Cookie: sutra_uid=..."

GET /v1/plans/{plan_id}/questions?participant_id={participant_id}
  What one plan participant still needs to answer before the group can rank real options. Call before `delegate-answer` so a delegate agent knows what is actually being asked rather than guessing. Never exposes anything about money.
  Example:
    curl "http://localhost:4100/v1/plans/pl_4d7e/questions?participant_id=pp_1"
  Response:
    { "plan_id": "pl_4d7e", "participant_id": "pp_1", "open_questions": ["availability", "budget"], "answered": ["rsvp"] }

POST /v1/participants/{participant_id}/delegate-answer
  Act as a delegate for one participant: apply their human's standing rules and submit whatever those rules actually cover, as ordinary coordination signals. Anything the rules never anticipated comes back in `skipped` with a plain-English `why`, rather than being guessed at. This can never approve a payment or move money — there is no route it calls into that does. Pass `rules` in the body to use rules held in-process instead of whatever is on file via `PUT /v1/delegate/rules`.
  Example:
    curl -X POST "http://localhost:4100/v1/participants/pp_1/delegate-answer" \
      -H "Content-Type: application/json" -d '{}'
  Response:
    { "participant_id": "pp_1", "plan_id": "pl_4d7e", "via": "delegate", "answered": [{ "kind": "budget", "amount": 80000 }], "skipped": [] }

POST /v1/bill/parse
  Parse a restaurant bill from pasted text into itemised lines that reconcile against the printed total. Send `image_base64` instead of `text` for a photo, which needs the engine to be configured with a vision key.
  Example:
    curl -X POST "http://localhost:4100/v1/bill/parse" \
      -H "Content-Type: application/json" \
      -d '{ "text": "2 Margherita  24.00\nPasta  16.00\nService 10%  4.00\nTotal  44.00" }'
  Response:
    {
      "source": "text",
      "currency": "USD",
      "items": [{ "name": "Margherita", "qty": 2, "line_amount": 2400 }, { "name": "Pasta", "qty": 1, "line_amount": 1600 }],
      "fees": [{ "name": "Service 10%", "amount": 400 }],
      "reconciliation": { "printed_total": 4400, "computed_total": 4400, "balanced": true },
      "warnings": [],
      "unparsed_lines": []
    }

POST /v1/bill/split
  A parsed bill plus who claimed what becomes a group on the `at_venue` rail: exact per-person amounts, explicit acceptance from each person, and a signed record. No card is charged through this engine on this rail, and the response says so. Needs a signed-in caller — `401 {"error":"sign in to continue"}` otherwise. POST /v1/bill/parse above needs no auth; this step, the one that actually creates a group, does.
  Example:
    curl -X POST "http://localhost:4100/v1/bill/split" \
      -H "Content-Type: application/json" \
      -H "Cookie: sutra_uid=..." \
      -d '{
        "title": "Sunday lunch",
        "venue": "Trattoria",
        "text": "2 Margherita  24.00\nPasta  16.00\nService 10%  4.00\nTotal  44.00",
        "claimants": [["Soham", "Arsh"], ["Dev"]],
        "members": [{ "name": "Soham" }, { "name": "Arsh" }, { "name": "Dev" }]
      }'
  Response:
    {
      "group_id": "gs_5f0a",
      "rail": "at_venue",
      "disclosure": "No card is charged through sutra on this split. Everyone agrees their exact amount here, then pays the venue directly on their own card.",
      "reconciliation": { "printed_total": 4400, "computed_total": 4400, "ok": true },
      "members": [
        { "member_id": "mi_f6", "name": "Soham", "share_amount": 1320 },
        { "member_id": "mi_g7", "name": "Arsh", "share_amount": 1320 },
        { "member_id": "mi_h8", "name": "Dev", "share_amount": 1760 }
      ]
    }

GET /v1/discover/search?q={query}
  Search real merchant catalogs for something buyable. Prices come from the merchant, never from a model.
  Example:
    curl "http://localhost:4100/v1/discover/search?q=projector&limit=2"
  Response:
    { "query": "projector", "took_ms": 412, "products": [{ "title": "Mini Projector", "price": 24900, "currency": "USD", "url": "https://shop.example/p/mini-projector", "merchant": "shop.example" }], "sources": [{ "kind": "shopify", "label": "shop.example", "count": 1, "ms": 412 }] }

POST /v1/discover/resolve
  Resolve one pasted product URL into a structured, priced cart line.
  Example:
    curl -X POST "http://localhost:4100/v1/discover/resolve" \
      -H "Content-Type: application/json" -d '{ "url": "https://shop.example/p/mini-projector" }'
  Response:
    { "title": "Mini Projector", "price": 24900, "currency": "USD", "url": "https://shop.example/p/mini-projector", "merchant": "shop.example" }

GET /health
  Liveness, and the trust anchor for every receipt: `receipt_public_key`, the hex Ed25519 public key every consent receipt is signed with right now. Fetch this yourself, over your own connection, before trusting a receipt's embedded `public_key` — see step 8.
  Example:
    curl "http://localhost:4100/health"
  Response:
    { "ok": true, "service": "sutra-gmp-engine", "receipt_public_key": "4a7e...", "uptime_s": 137 }

## How the agent should use this
1. Work out what the group is buying. If they already know, skip to step 3. If they do not, call POST /v1/agent/plan with their sentence, collect each person's answer with POST /v1/participants/{participant_id}/signal, read GET /v1/plans/{plan_id}/options, and call POST /v1/plans/{plan_id}/choose. If you are answering on a human's behalf rather than asking them directly, GET /v1/plans/{plan_id}/questions and POST /v1/participants/{participant_id}/delegate-answer are the delegate path — see PUT /v1/delegate/rules above. `choose` and `convert` need you to be the plan's own organiser (signed in as whoever created it, or holding the engine's bearer token) — a stranger agent with neither can read a plan and its ranked options but cannot lock a choice or spend on it, by design.
2. If it is a restaurant bill rather than an online cart, call POST /v1/bill/split instead of POST /v1/groups and stop at step 6. That rail settles at the venue: it produces exact amounts and a signed record, and no card is charged through this engine. Never tell the user they were charged on it. POST /v1/bill/parse needs no credential; POST /v1/bill/split needs a signed-in caller, same as the plan organiser requirement in step 1 — there is no route in this API that creates a group, of either rail, without one of: the engine bearer token, a session, or (cancel only) proof of being the group's first member.
3. Create the checkout: POST /v1/groups with the cart, the members and a policy. Needs `Authorization: Bearer <ENGINE_API_TOKEN>` — this is a server-to-server integration credential, not something published here, the same way an API key is never published alongside the docs that describe what it unlocks. Use `{"type":"all_of"}` when everyone must be in, `{"type":"quorum","m":N}` when the rest can proceed without a straggler, and `{"type":"deadline","at":"<iso>","primary":...,"fallback":...}` when time decides. Amounts are integer minor units.
4. Give every member their own `approval_page_url` from the response, and nobody else's. Each person approves on their own device with their own passkey on the payment provider's page. You cannot approve for them, and you must not try — that approval is the only thing that makes the mandate theirs.
5. Watch GET /v1/groups/{group_id}/events?after={seq}, or poll GET /v1/groups/{group_id}. Stop when `terminal` is true. `committed` means every locked member was charged, `partial` means some were, `aborted` and `expired` mean nobody was charged.
6. Report the outcome with the exact per-person amounts from the members array. If someone declined or was dropped, say so plainly.
7. If plans change before it commits, call POST /v1/groups/{group_id}/cancel. Every outstanding mandate is cancelled and nobody is charged. Same organiser gate as everything else that changes a group: bearer token, the creating session, or `{"as_member": "..."}` proof for an account-less group.
8. To prove what happened, fetch GET /v1/groups/{group_id}/receipt. It is hash-chained and Ed25519-signed and carries its own public key. Recomputing the chain and checking the signature proves internal consistency — that SOME key signed a self-consistent chain — but not that the key is really this engine's: anyone can forge a receipt with their own keypair and embed that key. To actually verify it without trusting this engine or the agent that handed it to you, separately fetch GET /health and compare its `receipt_public_key` against the receipt's `public_key` field before trusting the signature — reject the receipt if they differ. `gmp verify <file>` (in this repo's cli/) does exactly this.
