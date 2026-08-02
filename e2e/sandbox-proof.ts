#!/usr/bin/env tsx
/**
 * Proof against the REAL Prava sandbox, not the simulator.
 *
 *   GMP_API=https://engine-production-e6fa.up.railway.app \
 *   ENGINE_API_TOKEN=... npx tsx e2e/sandbox-proof.ts
 *
 * Creates a group, mints a real Prava mandate session per member, and prints
 * the hosted approval URLs. Approval itself needs a human with a passkey and a
 * sandbox test card — that is the whole point of the protocol and the one step
 * no script may perform. Re-run with --watch to poll until the mandates go
 * active, then the engine commits on its own.
 */
const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`)
  return json as T
}

const money = (m: number) => `$${(m / 100).toFixed(2)}`

async function main() {
  const health = await call<{ prava_adapter: string; app_base_url: string }>('/health')
  const appBase = health.app_base_url.replace(/\/$/, '')
  console.log(`\nengine   ${API}`)
  console.log(`adapter  ${health.prava_adapter}`)
  if (health.prava_adapter !== 'sandbox') {
    console.log('\n\x1b[33m! not pointed at the Prava sandbox — set PRAVA_ENV=sandbox\x1b[0m')
  }

  const group = await call<{
    group_id: string
    board_url: string
    members: { member_id: string; name: string; share_amount: number; approval_page_url: string }[]
  }>('/v1/groups', 'POST', {
    title: 'Ratatat — 2 tickets',
    merchant: {
      id: 'velvet',
      name: 'Velvet Ticket Co.',
      url: 'https://velvet.example.com',
      country_code_iso2: 'US',
    },
    cart: {
      items: [{ sku: 'ga', name: 'GA ticket', unit_amount: 4500, qty: 2, claimants: ['mi_all'] }],
      fees: [{ name: 'booking fee', amount: 300 }],
      currency: 'USD',
    },
    members: [{ name: 'Soham' }, { name: 'Arsh' }],
    policy: { type: 'all_of' },
    deadline_minutes: 180,
    rail: 'prava_mandates',
  })

  console.log(`\ngroup    ${group.group_id}`)
  console.log(`board    ${group.board_url}`)
  console.log(`2 phones ${appBase}/j/${group.group_id}`)
  console.log('          Open this same join link on both devices; each person chooses their own seat.\n')

  for (const m of group.members) {
    const view = await call<{
      status: string
      cap_amount: number
      approval_url: string | null
    }>(`/v1/members/${m.member_id}/open`, 'POST')

    console.log(`${m.name}`)
    console.log(`  share ${money(m.share_amount)}   cap ${money(view.cap_amount)}   status ${view.status}`)
    console.log(`  sutra      ${m.approval_page_url}`)
    console.log(`  Prava      ${view.approval_url ?? '(none)'}\n`)
  }

  console.log('Open the shared 2 phones link on both devices and choose one different seat on each.')
  console.log('Each Sutra approval page redirects that person to their own Prava hosted ceremony.')
  console.log('The poller notices the mandate going active and commits the group by itself.\n')

  if (!process.argv.includes('--watch')) return

  console.log('watching…  (ctrl-c to stop)\n')
  for (let i = 0; i < 240; i++) {
    const g = await call<{
      status: string
      members: { name: string; status: string; charged_amount: number }[]
    }>(`/v1/groups/${group.group_id}`)
    const line = g.members.map((m) => `${m.name}=${m.status}`).join('  ')
    process.stdout.write(`\r  [${g.status}] ${line}          `)
    if (['committed', 'partial', 'aborted', 'expired'].includes(g.status)) {
      console.log(`\n\n  terminal: ${g.status}`)
      const charged = g.members.reduce((s, m) => s + m.charged_amount, 0)
      console.log(`  charged through the card network: ${money(charged)}`)
      console.log(`  receipt UI: ${appBase}/app/receipts/${group.group_id}`)
      console.log(`  receipt API: ${API}/v1/groups/${group.group_id}/receipt\n`)
      return
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log('\n  still collecting after 12 minutes — nobody approved.\n')
}

main().catch((e) => {
  console.error(`\n\x1b[31m✗ ${(e as Error).message}\x1b[0m\n`)
  process.exit(1)
})
