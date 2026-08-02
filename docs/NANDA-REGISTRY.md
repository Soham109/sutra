# NANDA registry & AgentFacts — what we actually have, verified

Everything below was checked live against real endpoints on **2026-08-02**. Every
claim is marked **VERIFIED** (I ran the command myself, pasted below) or
**UNVERIFIED** (I could not confirm it and say so rather than guess). This
document is scoped to the NANDA **Index/registry/AgentFacts** surface only.

**This is not the $1,000 prize track.** The prize is titled "Best Prava Adapter
for the NANDA Town" and is judged on the Python plugin in
[`nanda-town-prava/`](../nanda-town-prava/), documented separately in
[`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md). This document answers a different, honest
question directly: is sutra in the NANDA Index? The answer is no, and this is exactly
what sutra is and is not in instead.

---

## 1. What Project NANDA actually is (verified)

Project NANDA — Networked AI Agents in Decentralized Architecture — is an MIT
Media Lab project led by **Prof. Ramesh Raskar** (Camera Culture Group),
building infrastructure for what it calls the "Internet of AI Agents" /
"Agentic Web."

The project's own mission statement, from its MIT Media Lab group page
(**VERIFIED**, fetched 2026-08-02):

> "Imagine billions of specialized AI agents collaborating across a
> decentralized architecture. Each performs discrete functions while
> communicating seamlessly, navigating autonomously, socializing, learning,
> **earning and transacting on our behalf**."

That page also lists a research theme explicitly on point for this project:
"agent-mediated commerce, pricing, and incentive design," with an expected
outcome of "early models for agent-based interaction, exchange, pricing, and
reputation." So the commerce framing sutra is built around is genuinely inside
NANDA's stated scope — that overlap is real. Source:
https://www.media.mit.edu/groups/nanda/overview/

The technical architecture is described in a small set of papers on arXiv
(**PARTIALLY VERIFIED** — I could read the abstracts live; the PDF/HTML bodies
would not render through my tooling, so anything below the abstract level is
sourced from search-engine summaries of the paper, not a direct read, and is
flagged as such):

- **"Beyond DNS: Unlocking the Internet of AI Agents via the NANDA Index and
  Verified AgentFacts"** — https://arxiv.org/abs/2507.14263. Abstract-level,
  confirmed: the NANDA Index is pitched as a "DNS for agents" — a lightweight,
  horizontally scalable resolver mapping an agent handle to a dynamic,
  cryptographically verifiable **AgentFacts** record, supporting multi-endpoint
  routing, load balancing, privacy-preserving access, and "sub-second
  revocation and key rotation." It proposes a **"quilt-like index"** that
  federates both NANDA-native agents and third-party agents/registries into
  one discovery surface. I could not independently confirm the exact
  cryptographic mechanism (what signs an AgentFacts record, who verifies it,
  where the signature lives) from the abstract alone — **UNVERIFIED** at the
  mechanism level.
- **"Using the NANDA Index Architecture in Practice: An Enterprise
  Perspective"** — https://arxiv.org/abs/2508.03101 — a follow-up on real
  deployments. Not read in depth.
- The GitHub org **github.com/projnanda** (**VERIFIED** — I listed it live)
  contains `nanda-index-v2` and `nanda-registry-server-repo` (the Index
  server, TypeScript), `agentfacts-format` (the schema), `adapter` ("Building
  the Internet of Agents," the primary Python SDK), `nandatown` (the Python
  agent simulator — the actual prize track), `research` (papers), and
  `civic-agents`.

**Four architectural layers**, per search-engine summary of the papers
(**UNVERIFIED** beyond this summary — I did not read primary text confirming
this taxonomy): discovery, identity, federation, interoperability. Section 5
below scores sutra against each.

---

## 2. Three different things this repo/ecosystem calls "NANDA" — do not conflate them

| # | What | Where | Verified live |
|---|---|---|---|
| 1 | **NANDA Index** — the canonical org-level registry the arXiv paper describes | `https://api.nandaindex.org` | Reachable, OpenAPI title "NANDA Index Server 2.0.0" |
| 2 | **NANDA Town SkillMD registry** — a lighter, no-auth listing (site copy references a "NandaHack x HCLTech" hackathon and an "Audience Choice Award," suggesting this is a hackathon-adjacent directory, not the formal Index) | `https://nandatown.projectnanda.org/api/skills` | Reachable, we have one entry here |
| 3 | **NANDA Town, the Python agent simulator** (`nest-core` / `nandatown` package) — the actual thing the $1,000 prize judges | `nanda-town-prava/` in this repo | Out of scope for this document — see [`NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md) |

This document is about **#1 and #2 only**. Do not read anything below as a
claim about #3.

---

## 3. Our actual status — verified live, 2026-08-02

### 3a. NANDA Index (`api.nandaindex.org`) — **we are not in it**

```
$ curl -s "https://api.nandaindex.org/api/v1/search?q=sutra"
{"query":"sutra","count":0,"results":[]}
HTTP 200

$ curl -s "https://api.nandaindex.org/api/v1/index/sutra"
{"error":"NOT_FOUND","detail":"org \"sutra\" not found"}
HTTP 404
```

I also pulled the full index (`GET /api/v1/index`) and counted it directly:
**250 org records**, none of them `sutra` (spot-checked; the two queries above
already prove absence more directly). This independently confirms the
long-standing team claim that `nanda index-register` was never run — I did not
just re-quote that claim, I checked it myself against the live API.

**Why not, confirmed by reading the code**: `cli/src/nanda.ts` `indexRegister()`
(lines ~432–522) requires a NANDA account, creates an org record, then
requires a **DNS TXT domain-verification challenge** on a domain you control
(`POST /api/v1/orgs/:org_id/domain-challenge` → `verify-domain`). I confirmed
these are real, live endpoints by fetching the Index's own OpenAPI document
(`GET /docs/json`, HTTP 200, title "NANDA Index Server 2.0.0"):

```
/api/v1/orgs                          [post]
/api/v1/orgs/{org_id}                 [get, put, delete]
/api/v1/orgs/{org_id}/domain-challenge [post]
/api/v1/orgs/{org_id}/verify-domain    [post]
/api/v1/orgs/{org_id}/reactivate       [post]
/api/v1/orgs/{org_id}/suspend          [delete]
```

`sutra-gmp.vercel.app` is a subdomain of `vercel.app` — we do not control that
zone, so we cannot add a TXT record to it. This matches the reason the team had
already recorded, and I verified it is architecturally correct, not just asserted.

### 3b. NANDA Town SkillMD registry — **we are in it, with an honest `null` badge**

```
$ curl -s "https://nandatown.projectnanda.org/api/skills/47063b5f-5000-4c03-8f33-c98555618f85"

{"skill":{
  "id":"47063b5f-5000-4c03-8f33-c98555618f85",
  "name":"sutra — group checkout (GMP/1)",
  "author":"sutra",
  "description":"Buy one thing for N people, where each person pays their own share from their own card. ...",
  "source_type":"url",
  "source_url":"https://sutra-gmp.vercel.app/skill.md",
  "endpoints":"GET https://sutra-gmp.vercel.app/skill.md\nGET https://sutra-gmp.vercel.app/.well-known/agent-card.json\nGET https://sutra-gmp.vercel.app/.well-known/agent-facts.json\nGET https://sutra-gmp.vercel.app/api/agents\nGET https://sutra-gmp.vercel.app/v1/discover/search?q=projector",
  "tags":"payments, agentic-commerce, group-checkout, split-payment, multi-principal, mandates, bill-splitting, gmp1, prava, nanda",
  "reachable":null,
  "created_at":"2026-08-01T13:29:23.374Z"
}}
HTTP 200
```

`reachable` is still literally `null` — **not** `true`, **not** `false`. The
registry has not recorded a probe result. All five declared endpoints do
return 200 when I fetch them directly (see §3c), so if the registry ever
probes, it should pass — but I found no NANDA documentation defining what
triggers a probe or what `reachable` semantics actually are beyond what this
repo's own code comments infer. **That inference is UNVERIFIED against any
NANDA source** — treat it as our team's plausible guess, not a confirmed fact.

Registry-wide count, checked against the 2026-08-01 claim of 273:

```
$ curl -s https://nandatown.projectnanda.org/api/skills
{"count":273, "skills":[{"id":"47063b5f-5000-4c03-8f33-c98555618f85", ...
```

**Count is still 273, our entry is still first in the list, unchanged since
2026-08-01.** This means the prior session's claims about this registry check
out exactly — I verified them independently rather than trusting the earlier
write-up, and found no drift, staleness, or error in them.

### 3c. The discovery chain the SkillMD entry points at — all live

```
GET https://sutra-gmp.vercel.app/.well-known/agent-facts.json   200  application/json
GET https://sutra-gmp.vercel.app/agent-facts.json               200  application/json
GET https://sutra-gmp.vercel.app/.well-known/agent-card.json    200  application/json
GET https://sutra-gmp.vercel.app/api/agents                     200  application/json
GET https://sutra-gmp.vercel.app/skill.md                       200  text/markdown
GET https://sutra-gmp.vercel.app/health                         200  application/json
```

`/health` at time of check: `{"ok":true,"prava_adapter":"sandbox","uptime_s":72}`
— a recent restart, consistent with active deployment today; not a concern for this
document.

### 3d. NANDA Town simulator — out of scope

`nanda-town-prava/**` is not investigated here — it is its own track with its own
evidence. See [`docs/NANDA-EVIDENCE.md`](NANDA-EVIDENCE.md).

---

## 4. AgentFacts: field by field against the real spec

**Spec source used**: `https://raw.githubusercontent.com/projnanda/agentfacts-format/main/agentfacts_schema.json`.
I re-downloaded it live and byte-diffed it against the vendored copy at
`engine/test/fixtures/agentfacts_schema.json` — **identical** (md5
`8406ffdc6ffb26a9808a39970b09dfb2` on both, after normalizing line endings).
**No drift** since the code comment's claimed 2026-08-01 fetch. This is a
direct verification, not a re-quote of the code's own comment.

**Provenance note on that repo** (**VERIFIED**, worth knowing, not a defect):
`agentfacts-format` is genuinely inside `github.com/projnanda`, but it is a
minor repo there — 7 stars, 6 forks, no description, a single commit (17 June
2025, author `pradyumnachari`, message "Add files via upload"). It's the
correct source to cite; it is not a heavily-governed one.

**Curiosity, also verified, also not a defect in our code**: the schema's own
`$id` is `https://agentfacts.org/schema/v1`. That domain, visited today, is
**not** Project NANDA — it resolves to an unrelated third-party standard
("AgentFacts — the Universal KYA Standard," attributed to Jared Grogan /
Universitas AI, a different 10-category framework). We didn't choose that
`$id` — projnanda's own schema file did — but a judge who types that URL into
a browser to "check the spec" lands on the wrong spec. Worth flagging in the
pitch if AgentFacts comes up, so it doesn't read as our mistake in the moment.

### What we serve, checked against `required` (top level: `id`, `agent_name`,
`label`, `description`, `version`, `provider`, `endpoints`, `capabilities`,
`skills`)

Fetched live: `https://sutra-gmp.vercel.app/.well-known/agent-facts.json` → HTTP 200.

| Field | Schema status | Our document | Verdict |
|---|---|---|---|
| `id` | required | `https://sutra-gmp.vercel.app/.well-known/agent-facts.json` | present |
| `agent_name` | required | `urn:ai:agent:sutra-gmp.vercel.app:sutra` | present |
| `label` | required | `sutra — group checkout (GMP/1)` | present |
| `description` | required | present, one paragraph | present |
| `version` | required | `0.1.0` | present |
| `provider.name`, `provider.url` | required | `sutra`, `https://sutra-gmp.vercel.app` | present |
| `provider.did` | optional | absent | **gap** |
| `endpoints.static` | required | 28 URLs, all rooted at our own base | present |
| `endpoints.adaptive_resolver` | optional | absent | gap, low priority |
| `capabilities.modalities`, `.authentication.methods` | required | present | present |
| `capabilities.streaming`, `.batch` | optional | `true`, `false` | present |
| `capabilities.authentication.requiredScopes` | optional | `[]` | present |
| `skills[]` (≥1, each with `id`/`description`/`inputModes`/`outputModes`) | required | 6 skills, all four sub-fields present each | present |
| `skills[].supportedLanguages`, `.latencyBudgetMs` | optional | present on all 6 | present |
| `skills[].maxTokens` | optional | absent on all 6 | gap, cosmetic |
| `documentationUrl` | optional | points at `/skill.md` | present |
| `jurisdiction` | optional | absent | gap |
| `evaluations` (whole block: `performanceScore`, `availability90d`, `lastAudited`, `auditTrail`, `auditorID`) | optional | **entirely absent** | **the real gap — see §5** |
| `telemetry.enabled`, `.retention` | optional | `false`, `'none'` | present, deliberately minimal |
| `telemetry.sampling`, `.metrics.*` | optional | absent | gap, low priority |
| `certification` (whole block) | optional | **entirely absent** | gap |

No wrong-typed fields found anywhere — every field present matches the
schema's declared type by direct inspection.

**Every schema-required field is present.** The gaps are all in the *optional*
trust/verification vocabulary: `evaluations`, `certification`, `provider.did`.
That is not incidental — those three are exactly the fields that operationalize
"**Verified**" in the paper's own title ("Verified AgentFacts"). We pass the
schema; we do not reach for the parts of it that would make the document
independently trustworthy rather than merely well-formed.

**`x-payments`**: confirmed by reading every property in the schema myself —
there genuinely is no payment vocabulary anywhere in AgentFacts v1, matching
the code's own comment in `engine/src/discovery/agent-facts.ts`. The schema
does not set `additionalProperties: false` anywhere, so a namespaced `x-`
extension is valid against it. `engine/test/discovery.test.ts` tests the
document both with and without the extension present.

**Test suite, run live just now** (PowerShell, per this repo's own documented
Git-Bash caveat):

```
$ npx vitest run engine/test/discovery.test.ts --root engine
 Test Files  1 passed (1)
      Tests  36 passed (36)
```

36/36 passing right now, including the ajv-backed schema validation and the
"every declared field the real schema marks required" check. This is real
regression protection against the AgentFacts document drifting from the spec.

---

## 5. Does sutra engage with NANDA's actual vision, or decorate?

Scored against the four layers the papers describe (discovery, identity,
federation, interoperability — see §1's caveat on that taxonomy):

- **Discovery — real.** The A2A card, AgentFacts, AI catalog and SkillMD are
  genuinely served, genuinely reachable (verified live, §3c), genuinely
  schema-valid (verified, §4), and genuinely regression-tested (36/36, just
  run). This is authentic engagement with "how does another agent find and
  parse this one."

- **Identity — thin, mostly gesture.** AgentFacts's identity primitives are a
  URN string and a name/URL pair; there is no DID (`provider.did` is present
  in the schema, absent in our document), and there is no NANDA Index org
  record (verified absent, §3a) — which is the mechanism the paper's own
  abstract ties "cryptographically verifiable" and "sub-second revocation and
  key rotation" to. What we serve is an unsigned static JSON file. Nothing
  cryptographically binds it to our domain the way the Index's DNS-TXT
  `verify-domain` flow would. Anyone could stand up an identical-looking
  AgentFacts document under a different domain claiming to be us, and nothing
  in this layer would tell an agent otherwise.

- **Federation ("quilt") — absent, and I checked directly rather than
  assuming.** `GET /api/ard/agents` on the live Index genuinely aggregates
  third-party catalogs — I saw real entries sourced from Cisco's
  `agntcy`/`outshift.io` AI catalog in the response — so the quilt is real
  infrastructure, not vaporware. Sutra is not part of it: not resolvable via
  `/api/v1/resolve`, not found via `/api/v1/search`, absent from the raw
  `/api/v1/index` dump. We are, at best, one row in a secondary,
  hackathon-adjacent skill directory that a judge would need to specifically
  know to check.

- **Interoperability — the one genuinely strong piece.** Rather than
  overloading the AgentFacts schema (which has no extension point) with
  payment semantics, the team built the `x-payments` block as an honestly
  labeled, namespaced, non-standard proposal, and *separately* declared the
  same facts through the A2A card's actual, standardized extension mechanism
  (`capabilities.extensions`, dereferenceable at
  `/.well-known/extensions/gmp-1.json` — confirmed present in
  `engine/src/discovery/agent-card.ts` / `routes.ts`). That is real,
  spec-respecting engineering, not decoration — it fills a real gap in
  AgentFacts (verified in §4: there is genuinely no payment vocabulary) without
  pretending the fix is standard.

**Honest verdict.** Nothing in this registry surface is fabricated — the
`reachable: null` is reported as `null`, the Index absence is reported as
absence, no invented badge, no invented performance score. But by the same
standard the rest of this codebase holds itself to, the honest read is that
this layer is **shallow real, not deep real**: it correctly serves a
spec-valid static document and lists it in a lightweight directory. It does
not reach NANDA's actual differentiator — verifiable, federated identity
anchored by the Index — and the codebase's own comments already say this
plainly (see the `x-payments` docstring in `agent-facts.ts`, which is
unusually candid about exactly this limitation). The genuine, deep engagement
with NANDA's vision in this repo is in `nanda-town-prava/` and in GMP/1
itself, not in the registry paperwork documented here.

---

## 6. Prioritised gap list — what fits in the rest of the day

Context that shapes every recommendation below: this track is judged on the
Python plugin, not Index registration, and NANDA Index registration requires
a DNS TXT record on a domain we control,
which does not exist in the time remaining even before considering it isn't
what's judged.

1. **Do not spend hackathon hours on NANDA Index registration.** Confirmed
   architecturally infeasible in the remaining window (§3a) and confirmed
   not the judging criterion. This is a "don't," not a task — but it's worth
   stating plainly so nobody re-litigates it under deadline pressure.

2. **(Optional, ~10 min, external side effect — did not do this myself)**
   Re-run `nanda skill-submit` (`cli/src/nanda.ts`) once, to see whether the
   registry probes and flips `reachable` from `null` to `true`. Caveat: the
   registry's API is a bare `POST`, with no update/PATCH path visible in the
   code — a second submission may create a **second** listing rather than
   updating the existing one (`id 47063b5f-...`). That's a real risk to a
   clean evidence trail (two near-duplicate `sutra` rows for a judge to find),
   so this is a decision for the team, not something to do unilaterally from a
   research pass.

3. **(Cheap, ~15–20 min, real spec gap closed)** Add `provider.did` using
   `did:web:sutra-gmp.vercel.app` — a real, resolvable DID method (resolves via
   a `.well-known/did.json` on the same domain), not a synthetic identifier.
   This is the cheapest change that closes an actual, verified gap (§4) rather
   than a cosmetic one. Low priority given the prize criterion, but the
   highest-value item on this list if there is slack time left before
   submission.

4. **Do not populate `evaluations` or `certification` with invented numbers.**
   The schema invites a `performanceScore` / `auditTrail` / certification
   block, but there is no real audit and no real 90-day uptime history behind
   one (`/health` showed `uptime_s: 72` at last check — the process restarts on
   every redeploy). This codebase's own stated ethic — "never invent a price,"
   "no claim without a source" ([`ENGINEERING-NOTES.md`](ENGINEERING-NOTES.md)
   invariants 4 and 9) — argues directly against
   filling this slot with a plausible-looking synthetic number. If pursued at
   all, it should wait for a real measurement window, not the next few hours.

5. **The honest summary of this whole registry surface, stated plainly**: sutra is
   not in the NANDA Index and not part of the ARD/quilt federation (both verified
   absent, live, today). It **is** listed in the lighter SkillMD directory with an
   honestly-`null` reachable badge. The real engagement with what Project NANDA is
   building is in the Python `nanda-town-prava` plugin, not in this registry
   surface — stating that plainly is worth more than any registry field this
   document could add.

---

## Sources cited in this document

- https://www.media.mit.edu/groups/nanda/overview/ — NANDA mission, research themes (fetched live)
- https://arxiv.org/abs/2507.14263 — "Beyond DNS: Unlocking the Internet of AI Agents via the NANDA Index and Verified AgentFacts" (abstract-level only, see §1 caveat)
- https://arxiv.org/abs/2508.03101 — "Using the NANDA Index Architecture in Practice: An Enterprise Perspective" (not read in depth)
- https://github.com/projnanda — org repo listing (fetched live)
- https://github.com/projnanda/agentfacts-format — schema repo, provenance (fetched live)
- https://raw.githubusercontent.com/projnanda/agentfacts-format/main/agentfacts_schema.json — schema, byte-diffed against our vendored copy (fetched live)
- https://api.nandaindex.org (`/docs/json`, `/api/v1/search`, `/api/v1/index`, `/api/v1/index/sutra`, `/api/ard/agents`) — the real NANDA Index, queried live
- https://nandatown.projectnanda.org (`/api/skills`, `/api/skills/47063b5f-5000-4c03-8f33-c98555618f85`) — the SkillMD registry, queried live
- https://sutra-gmp.vercel.app (`/.well-known/agent-facts.json`, `/agent-facts.json`, `/.well-known/agent-card.json`, `/api/agents`, `/skill.md`, `/health`) — our own live deployment, queried live
- `agentfacts.org` — visited live to confirm it is **not** affiliated with Project NANDA (see §4)
