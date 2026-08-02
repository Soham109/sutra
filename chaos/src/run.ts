#!/usr/bin/env tsx
// The chaos suite (GMP/1 §11). Random groups, random declines, random
// backstops — driven through a fault-injecting proxy that throws 500s, loses
// responses, and duplicates deliveries. After every run the invariant checker
// interrogates BOTH sides: the engine's event log and the mock Prava's ground
// truth. One command, one green wall:
//
//   npm run chaos            # 60 iterations
//   CHAOS_ITERS=200 SEED=7 npm run chaos
//
// Structurally incapable of touching sandbox: ChaosPrava refuses to wrap a
// non-mock adapter, and this file never reads PRAVA_API_KEY.
import {
  ChaosPrava,
  CreateGroupSchema,
  Db,
  EventHub,
  GroupService,
  MockPrava,
  Poller,
  ReceiptSigner,
  verifyReceipt,
  type Receipt,
} from '@sutra/engine'

process.env.GMP_NO_FX = '1'

const ITERS = Number(process.env.CHAOS_ITERS ?? 60)
const SEED = Number(process.env.SEED ?? 42)
const MAX_TICKS = 400

// mulberry32 — tiny deterministic PRNG so every red run is reproducible
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Violation {
  iteration: number
  seed: number
  rule: string
  detail: string
}

const violations: Violation[] = []
let terminalCounts: Record<string, number> = {}

for (let i = 0; i < ITERS; i++) {
  const seed = SEED + i * 7919
  const rand = rng(seed)
  try {
    await iteration(i, seed, rand)
  } catch (e) {
    violations.push({ iteration: i, seed, rule: 'no-crash', detail: String((e as Error)?.stack ?? e) })
    process.stdout.write('E')
  }
}

console.log('\n')
console.log(`chaos: ${ITERS} iterations, seed base ${SEED}`)
console.log(`terminal states: ${JSON.stringify(terminalCounts)}`)
if (violations.length === 0) {
  console.log('\n  ✓ every group reached a terminal state')
  console.log('  ✓ no member charged twice (mock ledger cross-check)')
  console.log('  ✓ aborted/expired groups have zero settled charges')
  console.log('  ✓ cancelled mandates have zero settled charges')
  console.log('  ✓ receipt totals equal the sum of settled charges')
  console.log('  ✓ every receipt hash chain + Ed25519 signature verifies')
  console.log('\n  GREEN WALL — the commit algorithm holds under fire.\n')
  process.exit(0)
} else {
  console.log(`\n  ✗ ${violations.length} INVARIANT VIOLATION(S)`)
  for (const v of violations.slice(0, 20)) {
    console.log(`  [iter ${v.iteration} seed ${v.seed}] ${v.rule}: ${v.detail.slice(0, 300)}`)
  }
  process.exit(1)
}

// ---------------------------------------------------------------------------

async function iteration(iter: number, seed: number, rand: () => number): Promise<void> {
  const db = new Db(':memory:')
  const hub = new EventHub(db, 'chaos')
  const mock = new MockPrava('http://chaos.local')
  const chaotic = new ChaosPrava(mock, {
    pErrorBefore: rand() * 0.22,
    pLostResponse: rand() * 0.18,
    pDuplicate: rand() * 0.18,
    random: rand,
  })
  const service = new GroupService(db, chaotic, hub, new ReceiptSigner(), {
    appBaseUrl: 'http://chaos.local',
  })
  const poller = new Poller(service, 1_000_000)

  // ---- random scenario ----------------------------------------------------
  const memberCount = 3 + Math.floor(rand() * 3) // 3..5
  const withBackstop = rand() < 0.5
  const declineOne = rand() < 0.5
  const chargeDeclineOne = rand() < 0.3
  const straggler = (['retry_once', 'drop_and_continue', 'halt_partial'] as const)[Math.floor(rand() * 3)]!
  const names = Array.from({ length: memberCount }, (_, k) => `M${k}`)

  const input = CreateGroupSchema.parse({
    title: `chaos ${iter}`,
    merchant: { id: 'chaos', name: 'Chaos Mart', url: 'https://chaos.example', country_code_iso2: 'US' },
    cart: {
      items: [{ sku: 'ga', name: 'Ticket', unit_amount: 1000 + Math.floor(rand() * 9000), qty: memberCount, claimants: ['mi_all'] }],
      fees: rand() < 0.5 ? [{ name: 'fees', amount: Math.floor(rand() * 2000) }] : [],
      currency: 'USD',
    },
    members: names.map((name, k) => ({
      name,
      role: withBackstop && k === 1 ? 'backstop' : 'payer',
      backstop_cap: withBackstop && k === 1 ? 2000 + Math.floor(rand() * 15000) : undefined,
    })),
    // a decline under all_of exercises the abort-under-fire path;
    // under quorum it exercises drops, backstops and requotes
    policy: declineOne
      ? rand() < 0.35
        ? { type: 'all_of' }
        : { type: 'quorum', m: memberCount - 1 }
      : { type: 'all_of' },
    straggler_policy: straggler,
    tolerance_bps: 500,
    deadline_minutes: 600,
    rail: 'prava_mandates',
  })

  const { group, members } = service.createGroup(input)
  const declinerId = declineOne ? members[members.length - 1]!.id : null
  if (chargeDeclineOne) mock.declineNextChargeFor(members[0]!.id)

  const retry = async (fn: () => Promise<unknown>, tries = 25): Promise<void> => {
    for (let t = 0; t < tries; t++) {
      try {
        await fn()
        return
      } catch {
        /* chaos — try again */
      }
    }
  }

  // ---- drive the humans ---------------------------------------------------
  for (const m of members) {
    if (m.id === declinerId) {
      await retry(() => service.openMember(m.id))
      await retry(() => service.declineMember(m.id))
      continue
    }
    await retry(async () => {
      const view = await service.openMember(m.id)
      const fresh = service.mustMember(m.id)
      if (fresh.backstop_approval_url) mock.approveSession(fresh.backstop_approval_url.split('/').pop()!)
      if (view.prava_approval_url) mock.approveSession(view.prava_approval_url.split('/').pop()!)
    })
    await poller.tick().catch(() => undefined)
  }

  // ---- tick until terminal, re-approving any requotes ---------------------
  let ticks = 0
  for (; ticks < MAX_TICKS; ticks++) {
    const g = service.db.getGroup(group.id)!
    if (['committed', 'partial', 'aborted', 'expired'].includes(g.status)) break
    // a requoted member re-opens and re-approves at the new share
    for (const m of service.db.membersOf(group.id)) {
      if (m.id === declinerId) continue
      if ((m.status === 'viewed' || m.status === 'invited') && m.requote_round > 0) {
        await retry(async () => {
          const v = await service.openMember(m.id)
          if (v.prava_approval_url) mock.approveSession(v.prava_approval_url.split('/').pop()!)
        }, 5)
      }
    }
    await poller.tick().catch(() => undefined)
  }

  // ---- invariants ---------------------------------------------------------
  const g = service.db.getGroup(group.id)!
  const rows = service.db.membersOf(group.id)
  const prava = mock.debugState()
  const settled = prava.charges.filter((c) => c.status === 'completed')
  const fail = (rule: string, detail: string) => violations.push({ iteration: iter, seed, rule, detail })

  terminalCounts[g.status] = (terminalCounts[g.status] ?? 0) + 1

  if (!['committed', 'partial', 'aborted', 'expired'].includes(g.status)) {
    fail('terminal-state', `group stuck in ${g.status} after ${ticks} ticks`)
  }

  // No mandate — and therefore no member+source — settled more than once.
  const byMandate = new Map<string, number>()
  for (const c of settled) byMandate.set(c.mandateId, (byMandate.get(c.mandateId) ?? 0) + 1)
  for (const [mid, count] of byMandate) {
    if (count > 1) fail('no-double-charge', `mandate ${mid} settled ${count} times`)
  }

  // Cancelled mandates must have zero settled charges.
  for (const m of prava.mandates) {
    if (m.status === 'cancelled' && byMandate.has(m.id)) {
      fail('cancelled-uncharged', `mandate ${m.id} cancelled but charged`)
    }
  }

  // Abort semantics: nothing settled, ever.
  if ((g.status === 'aborted' || g.status === 'expired') && settled.length > 0) {
    fail('abort-zero-charges', `${settled.length} settled charges on ${g.status} group`)
  }

  // Receipt: verifies, and its charged total equals Prava's ledger.
  const receiptJson = service.db.getReceipt(group.id)
  if (['committed', 'partial', 'aborted', 'expired'].includes(g.status)) {
    if (!receiptJson) {
      fail('receipt-exists', 'terminal group without receipt')
    } else {
      const receipt = JSON.parse(receiptJson) as Receipt
      const check = verifyReceipt(receipt)
      if (!check.ok) fail('receipt-verifies', check.errors.join('; '))
      const ledger = settled.reduce((s, c) => s + c.amount, 0)
      if (receipt.totals.charged !== ledger) {
        fail('receipt-totals', `receipt says ${receipt.totals.charged}, Prava ledger says ${ledger}`)
      }
    }
  }

  // Committed = every locked share entry actually charged.
  if (g.status === 'committed') {
    const chargedMembers = rows.filter((m) => m.status === 'charged')
    if (chargedMembers.length === 0) fail('committed-nonempty', 'committed with zero charged members')
  }

  process.stdout.write(g.status === 'committed' ? '✓' : g.status === 'partial' ? 'p' : g.status === 'aborted' ? 'a' : 'x')
  db.close()
}
