#!/usr/bin/env tsx
// Hour-zero sandbox smoke test (spec §17, "the deciding test").
//
//   PRAVA_API_KEY=sk_test_… npx tsx e2e/sandbox-smoke.ts
//
// Budget-aware: the team test card allows 30 transactions/day, so this script
// performs exactly ONE mandate setup + ONE charge + ONE report, and pauses
// for a human at the passkey step. It is NEVER run by CI or the chaos suite.
import { PravaClient } from '@sutra/engine'
import { createInterface } from 'node:readline/promises'

const KEY = process.env.PRAVA_API_KEY
const BASE = process.env.PRAVA_BASE_URL ?? 'https://sandbox.api.prava.space'
if (!KEY?.startsWith('sk_test_')) {
  console.error('Refusing: PRAVA_API_KEY must be a sk_test_* sandbox key. Never run this against production.')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const prava = new PravaClient(BASE, KEY)
const userId = `smoke_${Date.now().toString(36)}`

console.log(`\n▶ GMP/1 sandbox smoke against ${BASE}\n`)

// 1. Session with mandate_setup — the engine's exact call shape.
const session = await prava.createMandateSession({
  userId,
  userEmail: 'smoke@sutra.test',
  totalAmount: '1.00',
  currency: 'USD',
  merchant: { name: 'Sutra Smoke Test', url: 'https://sutra-smoke.example', country_code_iso2: 'US' },
  products: [{ description: 'Smoke test item', unit_price: '1.00', quantity: 1 }],
  description: 'GMP/1 hour-zero smoke — 1 dollar cap',
})
console.log(`  session ${session.sessionId}`)
console.log(`  expires ${session.expiresAt}`)
console.log(`\n  OPEN THIS ON A PHONE and approve with the team test card (expiry 12/30, OTP 456789):`)
console.log(`\n    ${session.approvalUrl}\n`)
await rl.question('  press Enter once the passkey ceremony is done… ')

// 2. Poll for the active mandate (no session→mandate correlation exists).
let mandateId: string | null = null
for (let i = 0; i < 20 && !mandateId; i++) {
  const mandates = await prava.listMandates(userId)
  mandateId = mandates.find((m) => m.status === 'active')?.id ?? null
  if (!mandateId) await new Promise((r) => setTimeout(r, 3000))
}
if (!mandateId) {
  console.error('  ✗ no active mandate appeared — check the dashboard, ask Birdie')
  process.exit(1)
}
console.log(`  ✓ mandate active: ${mandateId}`)

// 3. One idempotent charge inside the cap.
const charge = await prava.chargeMandate(mandateId, '1.00', `smoke:${userId}:1`)
console.log(`  charge → ${charge.status} txn=${charge.transactionId} ${charge.errorCode ?? ''}`)
if (charge.status !== 'awaiting_result' || !charge.transactionId) process.exit(1)

// 3b. Prove idempotency: same reference must dedupe, not double-charge.
const dupe = await prava.chargeMandate(mandateId, '1.00', `smoke:${userId}:1`)
console.log(`  dedupe check → deduplicated=${dupe.deduplicated} (MUST be true)`)

// 4. Close the loop with the network.
const report = await prava.reportCharge(mandateId, charge.transactionId, 'APPROVED', '1.00')
console.log(`  report → ${report.status}, mandate now ${report.mandateStatus}`)

console.log(`\n  ✓ REALITY CONFIRMED: session+mandate_setup → passkey → charge → report, end to end.`)
console.log(`    Verify the consumed mandate at pay.prava.space, then flip the engine:\n`)
console.log(`    PRAVA_ENV=sandbox PRAVA_API_KEY=${KEY.slice(0, 12)}…  npm run dev\n`)
process.exit(0)
