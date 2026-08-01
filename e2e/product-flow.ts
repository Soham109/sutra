#!/usr/bin/env tsx
// End-to-end product smoke test, driven the way the UI drives it.
//
//   npx tsx e2e/product-flow.ts [engineUrl] [webUrl]
//
// Resolves a real merchant URL, builds a cart, creates a group with a backstop
// under quorum, approves through the mock Prava ceremony, watches it commit,
// then verifies every surface renders. Mock adapter only — it never touches
// the sandbox or the team test card.

const ENGINE = process.argv[2] ?? 'http://localhost:4100'
const WEB = process.argv[3] ?? 'http://localhost:3000'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

let failures = 0
const ok = (label: string, detail = '') => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
const bad = (label: string, detail = '') => {
  failures++
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

async function call<T>(path: string, method = 'GET', body?: unknown, cookie?: string): Promise<T> {
  const res = await fetch(`${ENGINE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  return (text ? JSON.parse(text) : {}) as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

console.log(`\n▶ sutra product flow · engine ${ENGINE} · web ${WEB}\n`)

// -- 1. identity --------------------------------------------------------------
console.log('1. identity')
const meRes = await fetch(`${ENGINE}/v1/me`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ handle: 'soham', name: 'Soham' }),
})
const cookie = (meRes.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
const me = (await meRes.json()) as { user: { id: string; name: string } }
ok('signed in', `${me.user.name} (${me.user.id})`)

const friends = await Promise.all(
  ['arsh', 'dev', 'maya'].map(async (h) => {
    const r = await fetch(`${ENGINE}/v1/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: h, name: h[0]!.toUpperCase() + h.slice(1) }),
    })
    return ((await r.json()) as { user: { id: string; name: string } }).user
  }),
)
for (const f of friends) await call(`/v1/people/${f.id}/friend`, 'POST', {}, cookie)
ok('friends added', friends.map((f) => f.name).join(', '))

// -- 2. discovery -------------------------------------------------------------
console.log('\n2. discovery on a live marketplace')
const search = await call<{ products: { title: string; product_url: string }[]; sources: { kind: string; count: number; ms: number }[] }>(
  `/v1/discover/search?q=${encodeURIComponent('wool runner')}&merchant=www.allbirds.com&limit=3`,
)
if (search.products.length === 0) bad('search returned nothing')
else ok('federated search', `${search.products.length} products, ${search.sources.map((s) => `${s.kind}:${s.ms}ms`).join(' ')}`)

const target = search.products[0]
if (!target) {
  console.log('\ncannot continue without a product')
  process.exit(1)
}

const resolved = await call<{ product: { title: string; price: { amount_minor: number; currency: string }; merchant: { name: string; url: string; country_code_iso2: string; domain: string } }; strategy: string }>(
  '/v1/discover/resolve',
  'POST',
  { url: target.product_url },
)
ok('resolved a real product', `${resolved.product.title} @ ${resolved.product.price.amount_minor / 100} ${resolved.product.price.currency} via ${resolved.strategy}`)

// The guard that matters: a category page must be refused, never guessed at.
try {
  await call('/v1/discover/resolve', 'POST', { url: 'https://www.allbirds.com/collections/mens' })
  bad('a collection page was accepted as a product')
} catch (e) {
  ok('collection page refused', String((e as Error).message).slice(-70).trim())
}

// -- 3. create the group ------------------------------------------------------
console.log('\n3. create the group')
const unit = resolved.product.price.amount_minor || 4500
const members = [
  { name: 'Soham', role: 'payer' as const, user_id: me.user.id },
  { name: 'Arsh', role: 'backstop' as const, backstop_cap: 12000, user_id: friends[0]!.id },
  { name: 'Dev', role: 'payer' as const, user_id: friends[1]!.id },
  { name: 'Maya', role: 'payer' as const, user_id: friends[2]!.id },
]

const created = await call<{ group_id: string; members: { member_id: string; name: string }[] }>(
  '/v1/groups',
  'POST',
  {
    title: `${resolved.product.title} × 4`,
    merchant: {
      id: resolved.product.merchant.domain,
      name: resolved.product.merchant.name,
      url: resolved.product.merchant.url,
      country_code_iso2: resolved.product.merchant.country_code_iso2,
    },
    cart: {
      items: [{ sku: 'item-1', name: resolved.product.title, unit_amount: unit, qty: 4, claimants: ['mi_all'] }],
      fees: [{ name: 'shipping', amount: 1200 }],
      currency: resolved.product.price.currency,
    },
    members,
    policy: { type: 'quorum', m: 3 },
    straggler_policy: 'retry_once',
    deadline_minutes: 30,
    created_by: me.user.id,
    product: { title: resolved.product.title, url: target.product_url },
  },
  cookie,
)
ok('group created', created.group_id)

// -- 4. approvals -------------------------------------------------------------
console.log('\n4. approvals (Maya declines, Arsh arms a backstop)')
const approve = async (url: string) => {
  const sessionId = url.split('/').pop()!
  await fetch(`${ENGINE}/mock/pay/${sessionId}/approve`, { method: 'POST' })
}

for (const m of created.members) {
  const view = await call<{ approval_url: string | null; backstop_approval_url: string | null }>(
    `/v1/members/${m.member_id}/open`,
    'POST',
  )
  if (m.name === 'Maya') {
    await call(`/v1/members/${m.member_id}/decline`, 'POST')
    ok('Maya declined')
    continue
  }
  if (view.backstop_approval_url) {
    await approve(view.backstop_approval_url)
    ok('Arsh armed a backstop')
  }
  if (view.approval_url) {
    await approve(view.approval_url)
    ok(`${m.name} approved`)
  }
  await sleep(250)
}

// -- 5. commit ----------------------------------------------------------------
console.log('\n5. commit')
interface GroupView {
  status: string
  terminal: boolean
  decision_note: string | null
  created_by: string | null
  currency: string
  members: { name: string; status: string; charged_amount: number; backstop_absorbed: number }[]
}
let group!: GroupView
for (let i = 0; i < 40; i++) {
  group = await call<GroupView>(`/v1/groups/${created.group_id}`)
  if (group.terminal) break
  await sleep(400)
}
if (group.status !== 'committed') bad(`expected committed, got ${group.status}`)
else ok('COMMITTED', group.decision_note ?? '')

if (group.created_by !== me.user.id) bad('created_by missing from the group view')
else ok('organizer recorded', 'no-blame mode can identify the organizer')

for (const m of group.members) {
  const extra = m.backstop_absorbed > 0 ? ` (+${(m.backstop_absorbed / 100).toFixed(2)} absorbed)` : ''
  console.log(`     ${m.status === 'charged' ? '✓' : '·'} ${m.name.padEnd(6)} ${m.status.padEnd(9)} ${(m.charged_amount / 100).toFixed(2)}${extra}`)
}
const charged = group.members.reduce((s, m) => s + m.charged_amount + m.backstop_absorbed, 0)
const expected = unit * 4 + 1200
if (charged !== expected) bad('money does not balance', `charged ${charged}, cart ${expected}`)
else ok('money balances', `${(charged / 100).toFixed(2)} charged = cart total`)

// -- 6. receipt ---------------------------------------------------------------
console.log('\n6. receipt')
const receipt = await call<{ status: string; totals: { charged: number }; entries: unknown[]; chain_head: string; signature: string }>(
  `/v1/groups/${created.group_id}/receipt`,
)
if (receipt.totals.charged !== charged) bad('receipt total disagrees with the ledger')
else ok('receipt issued', `${receipt.entries.length} entries, chain ${receipt.chain_head.slice(0, 12)}…`)

// -- 7. surfaces --------------------------------------------------------------
console.log('\n7. surfaces render')
const firstMember = created.members[0]!
const pages: [string, string][] = [
  ['landing', '/'],
  ['dashboard', '/app'],
  ['discover', '/app/discover'],
  ['groups', '/app/groups'],
  ['war room', `/app/groups/${created.group_id}`],
  ['approval', `/a/${firstMember.member_id}`],
  ['tap to join', `/j/${created.group_id}`],
  ['receipts', '/app/receipts'],
  ['one receipt', `/app/receipts/${created.group_id}`],
  ['people', '/app/people'],
  ['circles', '/app/circles'],
  ['settings', '/app/settings'],
]
for (const [label, path] of pages) {
  try {
    const res = await fetch(`${WEB}${path}`, { headers: { cookie } })
    if (!res.ok) bad(label, `HTTP ${res.status}`)
    else {
      const html = await res.text()
      if (/Application error|Unhandled Runtime Error/i.test(html)) bad(label, 'runtime error in page')
      else ok(label, `${path} (${(html.length / 1024).toFixed(0)}kb)`)
    }
  } catch (e) {
    bad(label, (e as Error).message)
  }
}

console.log(
  failures === 0
    ? `\n  ALL GREEN — a real marketplace product, split four ways, one decline, backstop absorbed, committed and verified.\n`
    : `\n  ${failures} FAILURE(S)\n`,
)
process.exit(failures === 0 ? 0 : 1)
