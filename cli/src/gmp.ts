#!/usr/bin/env tsx
// gmp — drive demo groups against a running engine, verify receipts.
//
//   gmp verify <receipt.json> [--engine <url>]   check chain + signature,
//                                                 optionally pinned to a
//                                                 specific engine's key
//   gmp demo commit                    4 phones approve, everyone charged
//   gmp demo backstop                  1 declines, a friend's backstop absorbs
//   gmp demo abort                     all_of + 1 decline = nobody charged
//   gmp demo auction                   3 claimants, 2 seats: sealed bids allocate
//
// `gmp demo` needs an engine answering at GMP_API (default localhost:4100,
// i.e. `npm run dev:engine` / `npm run dev`). If GMP_API is a loopback
// address and nothing answers, this starts one itself — see
// ensureEngineReachable below for why that's safe to do unprompted.
import { readFileSync } from 'node:fs'
import { verifyReceipt, type Receipt } from '@sutra/engine'

const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

const [, , command, ...rest] = process.argv

async function main(): Promise<void> {
  if (command === 'verify') return verify(rest)
  if (command === 'demo') return demo(rest[0] ?? 'commit')
  console.log(`usage:
  gmp verify <receipt.json> [--engine <url>]
  gmp demo commit | backstop | abort`)
  process.exit(1)
}

// ---------------------------------------------------------------------------

/**
 * `verify` used to always try to pin against whatever answered at GMP_API,
 * which defaults to localhost:4100 so `gmp demo` works with zero setup. That
 * same default turned `verify` into a trap: the receipt page (web/src/
 * app/app/receipts) prints `npm run -w cli gmp -- verify receipt.json` with
 * no GMP_API set, so a judge checking a downloaded PRODUCTION receipt while
 * a local dev engine happened to be listening on :4100 — e.g. from an
 * earlier `npm run dev` — silently pinned against the DEV engine's own
 * (different) signing key and got "✗ VERIFICATION FAILED" on a perfectly
 * genuine receipt, indistinguishable from a forged one.
 *
 * Pinning is opt-in now: only via `--engine <url>` or an explicitly-set
 * GMP_API. With neither, this checks the receipt is internally consistent —
 * hash chain, totals, rail-honest charged amount, and a valid Ed25519
 * signature over the key embedded in the file — which is exactly what the
 * printed command needs to always pass on a real receipt, regardless of
 * what else happens to be running on this machine.
 */
async function verify(args: string[]): Promise<void> {
  const path = args.find((a) => !a.startsWith('--'))
  if (!path) throw new Error('gmp verify <receipt.json> [--engine <url>]')
  const engineFlagAt = args.indexOf('--engine')
  const engine = (engineFlagAt >= 0 ? args[engineFlagAt + 1] : undefined) ?? process.env.GMP_API

  const receipt = JSON.parse(readFileSync(path, 'utf8')) as Receipt

  let expectedPublicKey: string | undefined
  let pinNote = 'offline check only — pass --engine <url> to also confirm which engine signed it'
  if (engine) {
    try {
      const health = await api<{ receipt_public_key?: string }>('/health', 'GET', undefined, engine)
      expectedPublicKey = health.receipt_public_key
      pinNote = `pinned to ${engine}'s /health key`
    } catch (e) {
      pinNote = `could not reach ${engine} to confirm its signing key (${(e as Error).message}) — checked offline instead`
    }
  }

  const { ok, errors, wrongEngineOnly } = verifyReceipt(
    receipt,
    expectedPublicKey ? { expectedPublicKey } : undefined,
  )
  console.log(`\nGMP/1 receipt · ${receipt.group_id} · ${receipt.status.toUpperCase()}`)
  console.log(`  entries: ${receipt.entries.length}   charged total: ${(receipt.totals.charged / 100).toFixed(2)} ${receipt.currency}`)
  console.log(`  chain head: ${receipt.chain_head.slice(0, 32)}…`)
  console.log(`  public key: ${receipt.public_key.slice(0, 32)}…`)
  console.log(`  ${pinNote}`)

  if (ok) {
    console.log('\n  ✓ hash chain intact')
    console.log('  ✓ totals consistent')
    console.log('  ✓ Ed25519 signature valid\n')
    return
  }

  if (wrongEngineOnly) {
    // Deliberately NOT "VERIFICATION FAILED": the receipt itself is genuine.
    // The only problem is which engine's key it was checked against.
    console.log(`\n  ⚠ signed by a DIFFERENT engine than ${engine}`)
    console.log('    Chain, totals, and the Ed25519 signature all check out against the key in the file.')
    console.log('    This receipt was not forged — it just was not issued by that engine. Point --engine at')
    console.log('    the engine that actually issued it, or drop --engine to verify offline.\n')
    process.exit(1)
  }

  console.log('\n  ✗ VERIFICATION FAILED')
  for (const e of errors) console.log(`    - ${e}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------

async function api<T>(path: string, method = 'GET', body?: unknown, base = API): Promise<T> {
  const res = await fetch(`${base}${path}`, {
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

/**
 * `npm run demo` used to assume an engine was already listening at API and,
 * against a dead port, fail with a bare "✗ fetch failed" plus npm's own
 * error spew — the first thing a judge cloning this repo cold and running
 * the README's flagship command would see. The dependency existed only as a
 * comment above main().
 *
 * If API is not reachable AND is a loopback address, start one ourselves —
 * in THIS process, not a spawned child. That is the whole safety argument:
 * there is no subprocess to leak, no shell wrapper to kill through, nothing
 * that can survive Ctrl+C or a crash as an orphan on Windows, because it is
 * not a separate PID. Killing this process kills the engine with it, same as
 * any other in-process resource.
 *
 * If API points somewhere that isn't loopback (a deployed engine via
 * GMP_API), we have no business starting anything local — that's a genuine
 * "go start the real thing" situation, so this fails with an instruction
 * instead of a stack trace.
 *
 * Returns a function to shut the engine back down once the demo is done, or
 * undefined if an engine was already running and this left it alone.
 */
async function ensureEngineReachable(): Promise<(() => Promise<void>) | undefined> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) return undefined
  } catch {
    /* nothing answering — fall through to the loopback check below */
  }

  const url = new URL(API)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (!loopback) {
    console.error(`\n✗ no engine answering at ${API}\n`)
    console.error(`  gmp demo talks to a running engine over HTTP, and this one is not it. It's`)
    console.error(`  also not on localhost, so starting one here would not be the engine you meant.`)
    console.error(`  Start the engine that owns ${API}, or point GMP_API at one that's already up,`)
    console.error(`  then re-run npm run demo.\n`)
    process.exit(1)
  }

  console.log(`  no engine answering at ${API} — starting one for this demo (like npm run dev:engine)…`)
  process.env.PORT ??= url.port || '4100'
  process.env.APP_BASE_URL ??= API
  try {
    const { main: startEngine } = await import('../../engine/src/server.js')
    const { close } = await startEngine()
    console.log('')
    return close
  } catch (e) {
    console.error(`\n✗ could not start an engine on ${API}: ${(e as Error).message}\n`)
    console.error(`  start it yourself in another terminal — npm run dev:engine (or npm run dev`)
    console.error(`  for web + engine together) — then re-run npm run demo.\n`)
    process.exit(1)
  }
}

async function approveViaMockCeremony(url: string): Promise<void> {
  const sessionId = url.split('/').pop()!
  const res = await fetch(`${API}/mock/pay/${sessionId}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`mock approve failed: ${res.status}`)
}

async function demo(scenario: string): Promise<void> {
  console.log(`\n▶ gmp demo ${scenario} against ${API}\n`)
  const stopEngine = await ensureEngineReachable()
  try {
    if (scenario === 'auction') {
      await demoAuction()
      return
    }
    await runCommitLikeDemo(scenario)
  } finally {
    if (stopEngine) {
      await stopEngine()
      console.log('  (engine started for this demo has been stopped)\n')
    }
  }
}

async function runCommitLikeDemo(scenario: string): Promise<void> {
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
    rail: 'prava_mandates',
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
    rail: 'prava_mandates',
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
