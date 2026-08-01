#!/usr/bin/env tsx
// The GMP/1 engine as an MCP server (spec §15): any agent framework that
// speaks MCP can originate group purchases. Charging stays engine-side over
// REST — mirroring Prava's own choice to keep charging off MCP.
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

const transport = new StdioServerTransport()
await server.connect(transport)
