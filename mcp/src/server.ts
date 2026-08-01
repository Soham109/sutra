#!/usr/bin/env tsx
// The GMP/1 engine as an MCP server (spec §15): any agent framework that
// speaks MCP can originate group purchases, AND — the NANDA-track half of
// this file — act as a coordination delegate for one human during the phase
// before a cart even exists (list_open_questions, answer_as_delegate,
// get_plan_status). Charging stays engine-side over REST in both halves —
// mirroring Prava's own choice to keep charging off MCP.
//
//   claude mcp add sutra -- npx -w @sutra/mcp tsx src/server.ts
//   env: GMP_API (default http://localhost:4100), ENGINE_API_TOKEN
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

async function call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`engine ${res.status}: ${JSON.stringify(json)}`)
  return json
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

const server = new McpServer({ name: 'sutra-gmp', version: '0.1.0' })

server.tool(
  'create_group_session',
  'Create a GMP/1 group purchase: one cart, N members, a commit policy. Returns per-member approval page URLs — each member passkey-approves a Prava mandate on their own card. The engine charges everyone only when the policy passes, or cancels every mandate.',
  {
    title: z.string().describe('Human title, e.g. "Ratatat — 4 tickets"'),
    merchant_name: z.string().describe('Merchant display name'),
    merchant_url: z.string().default('https://example-merchant.test').describe('Merchant https URL'),
    items: z
      .array(
        z.object({
          name: z.string(),
          unit_amount_cents: z.number().int().nonnegative(),
          qty: z.number().int().positive(),
        }),
      )
      .min(1),
    member_names: z.array(z.string()).min(1).max(20),
    policy: z
      .enum(['all_of', 'quorum'])
      .default('all_of')
      .describe('all_of = everyone or nobody; quorum = at least quorum_m members'),
    quorum_m: z.number().int().positive().optional(),
    deadline_minutes: z.number().int().positive().max(10080).default(60),
  },
  async (args) => {
    const result = await call('/v1/groups', 'POST', {
      title: args.title,
      merchant: { id: 'mcp', name: args.merchant_name, url: args.merchant_url, country_code_iso2: 'US' },
      cart: {
        items: args.items.map((i, idx) => ({
          sku: `mcp-${idx}`,
          name: i.name,
          unit_amount: i.unit_amount_cents,
          qty: i.qty,
          claimants: ['mi_all'],
        })),
        fees: [],
        currency: 'USD',
      },
      members: args.member_names.map((name) => ({ name, role: 'payer' })),
      policy:
        args.policy === 'quorum'
          ? { type: 'quorum', m: args.quorum_m ?? Math.ceil(args.member_names.length / 2) }
          : { type: 'all_of' },
      deadline_minutes: args.deadline_minutes,
    })
    return text(result)
  },
)

server.tool(
  'get_group_status',
  'Full live state of a group session: status, per-member states, decision narrative, event cursor.',
  { group_id: z.string().describe('gs_… id returned by create_group_session') },
  async (args) => text(await call(`/v1/groups/${args.group_id}`)),
)

server.tool(
  'cancel_group',
  'Organizer cancel, pre-commit only. Cancels every mandate — nobody is charged.',
  { group_id: z.string() },
  async (args) => text(await call(`/v1/groups/${args.group_id}/cancel`, 'POST')),
)

// ---------------------------------------------------------------------------
// Delegate tools (GMP/1's multi-principal coordination phase, spec §14-ish).
//
// AP2, ACP, Visa IC and Prava itself all assume one principal granting one
// mandate. When N agents — each representing a different human — need to
// jointly decide on ONE thing to buy, none of them has a primitive for it.
// These three tools are that primitive: they let any MCP-capable agent stand
// in for its human during the BEFORE-the-cart phase (am I in, when am I
// free, where am I coming from, what will I spend), using standing rules that
// human set in advance.
//
// The boundary that makes this safe rather than alarming: a delegate can
// coordinate but it can never pay. `answer_as_delegate` can only produce the
// same signal kinds a human answering a form could — rsvp / availability /
// location / budget / constraint — because that is all `POST
// /v1/participants/:id/delegate-answer` is wired to write. There is no tool
// here, and there will never be one, that approves a Prava mandate. That step
// is a passkey ceremony on the human's own device, off MCP entirely —
// mirroring Prava's own decision to keep charging off MCP (see the header
// comment on this file). A delegate that answered its own payment prompt
// would not be a coordination assistant, it would be a bearer credential with
// extra steps.
// ---------------------------------------------------------------------------

server.tool(
  'list_open_questions',
  'What one plan participant still needs to answer before the group can rank real options — RSVP, availability, location, budget, dietary/other constraints. Call this before answer_as_delegate so a delegate agent knows what is actually being asked rather than guessing. Coordination only: this never exposes anything about money changing hands.',
  {
    participant_id: z.string().describe('pp_… id — the seat one human (or their delegate) holds in a plan'),
  },
  async (args) => {
    const participant = (await call(`/v1/participants/${args.participant_id}`)) as {
      plan: { plan_id: string }
    }
    const questions = await call(
      `/v1/plans/${participant.plan.plan_id}/questions?participant_id=${encodeURIComponent(args.participant_id)}`,
    )
    return text(questions)
  },
)

server.tool(
  'answer_as_delegate',
  "Act as a delegate for one participant: apply their human's standing rules — a pre-set budget ceiling, recurring availability, home location, and dietary/other constraints — and submit whatever those rules actually cover, as ordinary coordination signals (rsvp / availability / location / budget / constraint). Silence is the correct answer to a question the rules never anticipated: anything not covered comes back in `skipped`, with a plain-English `why`, rather than being guessed at. `rules` is optional — pass it to answer with rules this agent already holds in-process, or omit it to use whatever standing rules are already on file (PUT /v1/delegate/rules) for the human behind this participant. IMPORTANT: this can never approve a payment or move money. When the group settles on an option, payment is a passkey ceremony on each human's own device (a Prava mandate) — that step is not exposed over MCP and never will be, the same way Prava itself keeps charging off MCP.",
  {
    participant_id: z.string().describe('pp_… id to answer for'),
    rules: z
      .record(z.unknown())
      .optional()
      .describe('standing rules to use instead of whatever is on file — same shape as PUT /v1/delegate/rules'),
  },
  async (args) =>
    text(
      await call(`/v1/participants/${args.participant_id}/delegate-answer`, 'POST', args.rules ? { rules: args.rules } : {}),
    ),
)

server.tool(
  'get_plan_status',
  'Ranked options for a coordination plan, with the arithmetic that ordered them — time fit, travel fit, budget fit, preference, freshness — and a human-checkable sentence behind every factor. Read this after delegates have answered to see what the group would actually land on. Options are real places or products with real coordinates and prices; nothing here is invented. Choosing an option and paying for it are separate, later, human steps — this tool only reads the board.',
  { plan_id: z.string().describe('pl_… id, from create_group_session-style origination or /v1/agent/plan') },
  async (args) => text(await call(`/v1/plans/${args.plan_id}/options`)),
)

const transport = new StdioServerTransport()
await server.connect(transport)
