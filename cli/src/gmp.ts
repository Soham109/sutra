#!/usr/bin/env tsx
// gmp — drive demo groups against a running engine, verify receipts.
//
//   gmp verify <receipt.json>          check hash chain + Ed25519 signature
//   gmp demo commit                    4 phones approve, everyone charged
//   gmp demo backstop                  1 declines, a friend's backstop absorbs
//   gmp demo abort                     all_of + 1 decline = nobody charged
//   gmp demo auction                   3 claimants, 2 seats: sealed bids allocate
//
// Demo commands need the engine running in mock mode (npm run dev).
import { readFileSync } from 'node:fs'
import { verifyReceipt, type Receipt } from '@sutra/engine'

const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

const [, , command, arg] = process.argv

async function main(): Promise<void> {
  if (command === 'verify') return verify(arg)
  if (command === 'demo') return demo(arg ?? 'commit')
  console.log(`usage:
  gmp verify <receipt.json>
  gmp demo commit | backstop | abort`)
  process.exit(1)
}

// ---------------------------------------------------------------------------

function verify(path: string | undefined): void {
  if (!path) throw new Error('gmp verify <receipt.json>')
  const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt
  const { ok, errors } = verifyReceipt(receipt)
  console.log(`\nGMP/1 receipt · ${receipt.group_id} · ${receipt.status.toUpperCase()}`)
  console.log(`  entries: ${receipt.entries.length}   charged total: ${(receipt.totals.charged / 100).toFixed(2)} ${receipt.currency}`)
  console.log(`  chain head: ${receipt.chain_head.slice(0, 32)}…`)
  console.log(`  public key: ${receipt.public_key.slice(0, 32)}…`)
  if (ok) {
    console.log('\n  ✓ hash chain intact')
    console.log('  ✓ totals consistent')
    console.log('  ✓ Ed25519 signature valid\n')
  } else {
    console.log('\n  ✗ VERIFICATION FAILED')
    for (const e of errors) console.log(`    - ${e}`)
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

interface CreatedGroup {
  group_id: string
  board_url: string
  members: { member_id: string; name: string; role: string; share_amount: number }[]
}

interface MemberView {
  member_id: string
  status: string
  approval_url: string | null
  backstop_approval_url: string | null
}

interface GroupView {
  status: string
  terminal: boolean
  decision_note: string | null
  members: { member_id: string; name: string; status: string; charged_amount: number; backstop_absorbed: number }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function approveViaMockCeremony(url: string): Promise<void> {
  const sessionId = url.split('/').pop()!
  const res = await fetch(`${API}/mock/pay/${sessionId}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`mock approve failed: ${res.status}`)
}

async function demo(scenario: string): Promise<void> {
  console.log(`\n▶ gmp demo ${scenario} against ${API}\n`)
  if (scenario === 'auction') return demoAuction()

  // commit: all_of, everyone approves. backstop: quorum(3) — the decline
  // happens FIRST so the quorum decision sees it. abort: all_of, the decline
  // lands LAST for maximum drama (three active mandates get cancelled).
  const policy = scenario === 'backstop' ? { type: 'quorum', m: 3 } : { type: 'all_of' }

  const group = await api<CreatedGroup>('/v1/groups', 'POST', {
    title: 'Ratatat — 4 tickets',
    merchant: { id: 'demo', name: 'Velvet Ticket Co.', url: 'https://velvet-ticket.example', country_code_iso2: 'US' },
    cart: {
      items: [{ sku: 'ga', name: 'GA ticket', unit_amount: 4500, qty: 4, claimants: ['mi_all'] }],
      fees: [{ name: 'fees', amount: 600 }],
      currency: 'USD',
    },
    members: [
      { name: 'Soham', role: 'payer' },
      { name: 'Arsh', role: 'backstop', backstop_cap: 6000 },
      { name: 'Dev', role: 'payer' },
      { name: 'Maya', role: 'payer' },
    ],
    policy,
    straggler_policy: 'retry_once',
    deadline_minutes: 30,
  })

  console.log(`  group ${group.group_id}`)
  console.log(`  board: ${group.board_url}\n`)

  const decliner = scenario === 'commit' ? null : group.members[3]! // Maya
  const order =
    scenario === 'backstop'
      ? [group.members[3]!, group.members[0]!, group.members[1]!, group.members[2]!]
      : group.members

  for (const m of order) {
    const view = await api<MemberView>(`/v1/members/${m.member_id}/open`, 'POST')
    if (decliner && m.member_id === decliner.member_id) {
      await api(`/v1/members/${m.member_id}/decline`, 'POST')
      console.log(`  ✗ ${m.name} DECLINED`)
      await sleep(300)
      continue
    }
    if (view.backstop_approval_url && scenario === 'backstop') {
      await approveViaMockCeremony(view.backstop_approval_url)
      console.log(`  ⛑ ${m.name} armed backstop`)
    }
    if (view.approval_url) {
      await approveViaMockCeremony(view.approval_url)
      console.log(`  ✓ ${m.name} approved (passkey simulated)`)
    }
    await sleep(300)
  }

  process.stdout.write('\n  waiting for the engine to decide')
  let g: GroupView
  for (;;) {
    g = await api<GroupView>(`/v1/groups/${group.group_id}`)
    if (g.terminal) break
    process.stdout.write('.')
    await sleep(500)
  }

  console.log(`\n\n  ══════ ${g.status.toUpperCase()} ══════`)
  console.log(`  ${g.decision_note ?? ''}\n`)
  for (const m of g.members) {
    const extra = m.backstop_absorbed > 0 ? `  (+ absorbed $${(m.backstop_absorbed / 100).toFixed(2)} as backstop)` : ''
    const amt = m.charged_amount > 0 ? `charged $${(m.charged_amount / 100).toFixed(2)}` : 'not charged'
    console.log(`  ${m.status === 'charged' ? '✓' : '·'} ${m.name.padEnd(8)} ${m.status.padEnd(10)} ${amt}${extra}`)
  }

  const res = await fetch(`${API}/v1/groups/${group.group_id}/receipt`)
  if (res.ok) {
    const receipt = (await res.json()) as Receipt
    const check = verifyReceipt(receipt)
    console.log(`\n  receipt: ${check.ok ? '✓ chain + signature verified' : '✗ INVALID: ' + check.errors.join('; ')}`)
    console.log(`  receipt page: ${API}/g/${group.group_id}/receipt`)
  }
  console.log(`  replay:       ${group.board_url}\n`)
}

async function demoAuction(): Promise<void> {
  const group = await api<CreatedGroup>('/v1/groups', 'POST', {
    title: 'Last two front-row seats',
    merchant: { id: 'demo', name: 'Velvet Ticket Co.', url: 'https://velvet-ticket.example', country_code_iso2: 'US' },
    cart: {
      items: [{ sku: 'front', name: 'Front row seat', unit_amount: 9000, qty: 2, claimants: ['Soham', 'Arsh', 'Dev'] }],
      fees: [],
      currency: 'USD',
    },
    members: [
      { name: 'Soham', role: 'payer' },
      { name: 'Arsh', role: 'payer' },
      { name: 'Dev', role: 'payer' },
    ],
    policy: { type: 'all_of' },
    auction_window_seconds: 300,
    deadline_minutes: 30,
  })
  console.log(`  group ${group.group_id} — 3 claimants, 2 seats`)
  console.log(`  board: ${group.board_url}\n`)

  const bids: Record<string, number> = { Soham: 700, Arsh: 150, Dev: 300 }
  for (const m of group.members) {
    await api(`/v1/members/${m.member_id}/bid`, 'POST', { sku: 'front', amount: bids[m.name] ?? 0 })
    console.log(`  ⚖ ${m.name} sealed a bid (amount hidden until reveal)`)
    await sleep(200)
  }
  console.log('\n  all claimants bid → window closes early, allocation reveals on the board')
  await sleep(800)

  const view = await api<GroupView>(`/v1/groups/${group.group_id}`)
  for (const m of view.members) {
    console.log(`  ${m.status === 'dropped' ? '✗' : '✓'} ${m.name.padEnd(8)} ${m.status === 'dropped' ? 'lost the slot — out, not charged' : `won a seat — owes $${(m.charged_amount || 0) === 0 ? '90.00' : ''}`}`)
  }

  for (const m of group.members) {
    const v = await api<MemberView>(`/v1/members/${m.member_id}/open`, 'POST')
    if (v.approval_url) {
      await approveViaMockCeremony(v.approval_url)
      console.log(`  ✓ ${m.name} approved the merchant price (bids never price, only allocate)`)
    }
    await sleep(200)
  }

  process.stdout.write('\n  waiting for the engine to decide')
  let g: GroupView
  for (;;) {
    g = await api<GroupView>(`/v1/groups/${group.group_id}`)
    if (g.terminal) break
    process.stdout.write('.')
    await sleep(500)
  }
  console.log(`\n\n  ══════ ${g.status.toUpperCase()} ══════`)
  for (const m of g.members) {
    const amt = m.charged_amount > 0 ? `charged $${(m.charged_amount / 100).toFixed(2)}` : 'not charged'
    console.log(`  ${m.status === 'charged' ? '✓' : '·'} ${m.name.padEnd(8)} ${m.status.padEnd(10)} ${amt}`)
  }
  console.log(`\n  replay the reveal: ${group.board_url}\n`)
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}`)
  process.exit(1)
})
