#!/usr/bin/env tsx
/**
 * The NANDA-track demo: a mesh of delegate agents, each representing a
 * different human, jointly coordinating ONE plan that no single-principal
 * protocol (AP2, ACP, Visa IC, or Prava's own mandate API) has a primitive
 * for. GMP/1 is that primitive; this script is the proof it works end to end
 * against a real, running engine.
 *
 *   npm run e2e:agent-mesh                                    (engine on :4100)
 *   GMP_API=https://engine-production-e6fa.up.railway.app npx tsx e2e/agent-mesh.ts
 *
 * Five real things happen, none of them mocked:
 *
 *  1. Discovery   — an agent reads sutra's own published A2A card and AI
 *                    catalog and learns what it can do FROM THE DOCUMENTS,
 *                    not from anything hardcoded in this script.
 *  2. Origination — that agent creates a real group plan via the documented
 *                    coordination API (POST /v1/plans).
 *  3. The mesh     — three delegate agents answer for three real, separately
 *                    registered humans, each from DIFFERENT standing rules:
 *                    one budget-constrained, one weekday-only, one vegetarian
 *                    with no home address on file. At least one of them
 *                    correctly REFUSES to answer a question its rules never
 *                    anticipated — silence, not a guess.
 *  4. Ranking      — real OpenStreetMap venues, scored with the same pure
 *                    arithmetic the product UI renders, against exactly what
 *                    the delegates said.
 *  5. The boundary — the money step hands back to the humans. N real passkey
 *                    URLs, one per person, and this script — like every
 *                    delegate above it — cannot complete a single one of
 *                    them. That line is deliberate; see docs/AGENT-MESH.md.
 *
 * Style matches e2e/plan-flow.ts: same env vars, same call() shape, same
 * terminal formatting. GMP_API/ENGINE_API_TOKEN drive every OPERATIONAL call
 * (plan creation, signals, ranking, convert) exactly like plan-flow.ts.
 * DISCOVERY_BASE is separate on purpose — step 1 is reading sutra's own
 * public documents, which is a different question from which engine this
 * script happens to be driving.
 */
import { decideAvailability, decideRsvp, decideSignals, type StandingRules } from '../engine/src/delegate/rules.js'
import type { SignalKind, SignalPayload, Slots } from '../engine/src/plan/types.js'

const DISCOVERY_BASE = process.env.DISCOVERY_BASE ?? 'https://sutra-gmp.vercel.app'
const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

function step(n: number, title: string) {
  console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`)
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND'])
const money = (minor: number, cur: string) =>
  ZERO_DECIMAL.has(cur.toUpperCase()) ? `${cur} ${minor}` : `${cur} ${(minor / 100).toFixed(2)}`

// ---------------------------------------------------------------------------
// HTTP helpers — same shape as e2e/plan-flow.ts's call(), extended with an
// optional per-request session cookie so three DIFFERENT humans can each act
// as themselves (PUT their own standing rules) in the same script run.
// ---------------------------------------------------------------------------

async function call<T>(path: string, method = 'GET', body?: unknown, cookie?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return json as T
}

async function discover<T>(path: string): Promise<T> {
  const res = await fetch(`${DISCOVERY_BASE}${path}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`GET ${DISCOVERY_BASE}${path} → ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

/** Same idiom as e2e/auth-check.ts: read the session cookie a register/login response set. */
function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

interface Human {
  id: string
  name: string
  cookie: string
}

/** A fresh, real account per run — same throwaway-account idiom as e2e/auth-check.ts. */
async function registerHuman(idx: number, first: string): Promise<Human> {
  const suffix = `${Date.now().toString(36)}${idx}`
  const email = `${first.toLowerCase()}+${suffix}@agentmesh.sutra.test`
  const handle = `${first.toLowerCase()}${suffix}`.slice(0, 30)
  const password = `agent-mesh-demo-passphrase-${suffix}`
  const res = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, handle, name: first }),
  })
  const body = (await res.json().catch(() => ({}))) as { user?: { id: string } }
  if (!res.ok || !body.user) throw new Error(`register ${first} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
  return { id: body.user.id, name: first, cookie: cookieFrom(res) }
}

function describeSignal(s: SignalPayload): string {
  switch (s.kind) {
    case 'rsvp':
      return s.in ? 'IN' : 'OUT'
    case 'availability': {
      const w = s.windows[0]
      return w ? `free ${w.start.slice(11, 16)}–${w.end.slice(11, 16)} UTC (${w.start.slice(0, 10)})` : 'anytime'
    }
    case 'location':
      return `${s.place.label} (${s.place.lat.toFixed(4)},${s.place.lng.toFixed(4)})`
    case 'budget':
      return `ceiling ${money(s.ceiling_minor, s.currency)}`
    case 'constraint':
      return `“${s.text}”`
    case 'vote':
      return `${s.score > 0 ? '+1' : s.score < 0 ? '-1' : '0'} on ${s.option_id}`
  }
}

async function main() {
  console.log(`\x1b[2mdiscovery: ${DISCOVERY_BASE}   engine api: ${API}\x1b[0m`)

  // ===========================================================================
  step(1, 'Discovery — an agent that has never heard of sutra reads its own documents')
  // ===========================================================================

  const card = await discover<{
    name: string
    description: string
    url: string
    skills?: { id: string; name: string }[]
  }>('/.well-known/agent-card.json')
  const catalog = await discover<{ entries: { identifier: string; displayName: string }[] }>('/api/agents')

  console.log(`   GET ${DISCOVERY_BASE}/.well-known/agent-card.json`)
  console.log(`     "${card.name}" — ${card.description.slice(0, 130).trim()}…`)
  console.log(`     the card's own declared API base: ${card.url}`)
  console.log(`     skills this agent found — read from the document, not hardcoded here:`)
  for (const s of card.skills ?? []) console.log(`       · ${s.id.padEnd(24)} ${s.name}`)

  console.log(`   GET ${DISCOVERY_BASE}/api/agents`)
  console.log(`     ${catalog.entries.length} catalog entries: ${catalog.entries.map((e) => e.identifier).join(', ')}`)

  const learnedSkill = (card.skills ?? []).find((s) => s.id === 'coordinate_group_plan')
  if (!learnedSkill) throw new Error('the agent card no longer advertises coordinate_group_plan — nothing to originate from')
  console.log(
    `   \x1b[32m→ learned "${learnedSkill.name}" from the card itself — that is the skill this run is about to use.\x1b[0m`,
  )

  // ===========================================================================
  step(2, 'Origination — the agent creates a group plan via the documented API')
  // ===========================================================================

  console.log('   registering the three humans this plan will need real answers from…')
  const [priya, arsh, maya] = await Promise.all([registerHuman(0, 'Priya'), registerHuman(1, 'Arsh'), registerHuman(2, 'Maya')])
  console.log(`     ${priya.name} (${priya.id})`)
  console.log(`     ${arsh.name} (${arsh.id})`)
  console.log(`     ${maya.name} (${maya.id})`)

  // Next Saturday, UTC — deterministic, and lands inside a weekday-only
  // delegate's blackout, which step 3 depends on.
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7))
  const day = d.toISOString().slice(0, 10)
  const planSlots: Slots = {
    category: 'restaurant',
    when: { earliest: `${day}T18:00:00.000Z`, latest: `${day}T23:00:00.000Z`, hint: 'saturday evening' },
    radius_m: 8_000,
    currency: 'INR',
    budget_ceiling_minor: 70_000,
  }
  const ask: SignalKind[] = ['rsvp', 'availability', 'location', 'budget', 'constraint']

  const plan = await call<{
    plan_id: string
    title: string
    ask: SignalKind[]
    participants: { participant_id: string; name: string; user_id: string | null }[]
  }>('/v1/plans', 'POST', {
    title: 'Dinner — three delegates, one plan',
    intent_text: `dinner ${day} (saturday), somewhere everyone still standing can agree on, under ${money(planSlots.budget_ceiling_minor!, planSlots.currency)} each`,
    kind: 'venue',
    slots: planSlots,
    ask,
    participants: [
      { name: priya.name, user_id: priya.id },
      { name: arsh.name, user_id: arsh.id },
      { name: maya.name, user_id: maya.id },
    ],
  })
  console.log(`   POST /v1/plans → ${plan.plan_id}  "${plan.title}"`)
  console.log(`     asking every participant for: ${plan.ask.join(', ')}`)
  console.log(`     window: ${day} 18:00–23:00 UTC · budget ${money(planSlots.budget_ceiling_minor!, planSlots.currency)}/head · category "${planSlots.category}"`)

  const seat = (name: string) => plan.participants.find((p) => p.name === name)!.participant_id

  // ===========================================================================
  step(3, 'The mesh — three delegate agents, three different standing rules, one human each')
  // ===========================================================================
  console.log(
    '   \x1b[2mEach delegate below only ever runs decideSignals() — a pure function over its own human\'s\x1b[0m',
  )
  console.log(
    '   \x1b[2mstanding rules and this plan. It cannot approve a payment: that verb does not exist here.\x1b[0m',
  )

  const priyaRules: StandingRules = {
    auto_rsvp: { max_share_minor: 80_000, categories: ['restaurant'] },
    availability: { weekday_evenings: true }, // Mon–Fri only — this plan is a Saturday
    home: { label: 'HSR Layout', lat: 12.9116, lng: 77.6412, source: 'manual' },
    budget_ceiling_minor: 80_000,
    currency: 'INR',
  }
  const arshRules: StandingRules = {
    auto_rsvp: { max_share_minor: 200_000, categories: ['restaurant'], not_on: ['saturday', 'sunday'] },
    availability: { weekday_evenings: true },
    home: { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, source: 'manual' },
    budget_ceiling_minor: 200_000,
    currency: 'INR',
  }
  const mayaRules: StandingRules = {
    auto_rsvp: { max_share_minor: 150_000, categories: ['restaurant'] },
    availability: { windows: [{ days: ['saturday', 'sunday'], from: '12:00', to: '23:00' }] },
    budget_ceiling_minor: 150_000,
    currency: 'INR',
    constraints: ['vegetarian'],
    // deliberately no `home` — this is the delegate that correctly refuses `location`
  }

  const mesh: { human: Human; label: string; rules: StandingRules }[] = [
    { human: priya, label: 'budget-constrained (caps spend, weekday-evening availability only)', rules: priyaRules },
    { human: arsh, label: 'weekday-restricted (never Saturday or Sunday)', rules: arshRules },
    { human: maya, label: 'vegetarian, no home address on file', rules: mayaRules },
  ]

  const situation = { ask: plan.ask, slots: planSlots }

  for (const m of mesh) {
    await call('/v1/delegate/rules', 'PUT', m.rules, m.human.cookie)
    console.log(`\n   \x1b[1m${m.human.name}\x1b[0m — ${m.label}`)

    const pid = seat(m.human.name)
    const result = await call<{ answered: SignalPayload[]; skipped: { kind: string; why: string }[] }>(
      `/v1/participants/${pid}/delegate-answer`,
      'POST',
      {},
    )

    // The wire signals carry no "why" (SignalPayload has no room for one — see
    // rules.ts). Skipped entries already carry their reason; for the ones the
    // delegate DID answer, ask the same pure decideRsvp / decideAvailability
    // the engine itself ran, purely to print the reasoning behind an accept
    // or a decline. This is not narration invented for the demo — it is the
    // real function, called a second time, on the same inputs.
    const rsvpWhy = m.rules.auto_rsvp ? decideRsvp(m.rules, planSlots).why : undefined
    const availWhy = m.rules.availability ? decideAvailability(m.rules, planSlots).why : undefined
    const whyFor = (kind: string): string | undefined => (kind === 'rsvp' ? rsvpWhy : kind === 'availability' ? availWhy : undefined)

    for (const kind of plan.ask) {
      const sig = result.answered.find((s) => s.kind === kind)
      const skip = result.skipped.find((s) => s.kind === kind)
      if (sig) {
        const why = whyFor(kind)
        console.log(`     ${kind.padEnd(12)} → ${describeSignal(sig)}${why ? `  \x1b[2m(${why})\x1b[0m` : ''}`)
      } else if (skip) {
        console.log(`     \x1b[33m${kind.padEnd(12)} → refused — ${skip.why}\x1b[0m`)
      }
    }
  }

  // A consistency check, not narration: what the engine actually recorded
  // (fetched fresh, over HTTP) must match what decideSignals says it should
  // have — that IS the claim this whole demo is making.
  for (const m of mesh) {
    const local = decideSignals(m.rules, situation)
    const pid = seat(m.human.name)
    const q = await call<{ open_questions: string[] }>(`/v1/plans/${plan.plan_id}/questions?participant_id=${pid}`)
    const expectOpen = new Set(local.skipped.map((s) => s.kind))
    const matches = q.open_questions.length === expectOpen.size && q.open_questions.every((k) => expectOpen.has(k))
    if (!matches) {
      throw new Error(
        `${m.human.name}: GET /v1/plans/:id/questions disagrees with decideSignals() — engine says open=${JSON.stringify(q.open_questions)}, decideSignals says skipped=${JSON.stringify([...expectOpen])}`,
      )
    }
  }
  console.log(`\n   \x1b[32m→ verified: GET /v1/plans/:id/questions agrees with decideSignals() for all three delegates.\x1b[0m`)

  // ===========================================================================
  step(4, 'Ranking — real OpenStreetMap venues, scored against what the delegates actually said')
  // ===========================================================================

  const ranked = await call<{
    best_windows: { window: { start: string; end: string }; count: number }[]
    options: {
      option: { option_id: string; title: string; subtitle: string | null; url: string | null; source: string }
      score: { score: number | null; excluded: string | null; confidence: number; factors: { key: string; value: number; why: string }[] }
    }[]
  }>(`/v1/plans/${plan.plan_id}/options`)

  const best = ranked.best_windows[0]
  console.log(
    best
      ? `   best common window: ${best.window.start.slice(11, 16)}–${best.window.end.slice(11, 16)} UTC, ${best.count} can make it`
      : '   no window suits everyone who is attending',
  )
  console.log(`   ${ranked.options.length} real venues on the board (OpenStreetMap, around ${priya.name}'s and ${arsh.name}'s stated locations)\n`)

  for (const [i, r] of ranked.options.slice(0, 5).entries()) {
    const pct = r.score.score === null ? ' —– ' : `${Math.round(r.score.score * 100)}%`.padStart(4)
    console.log(`   ${String(i + 1).padStart(2)}. ${pct}  ${r.option.title}`)
    if (r.option.subtitle) console.log(`         \x1b[2m${r.option.subtitle.slice(0, 78)}\x1b[0m`)
    for (const f of r.score.factors) {
      console.log(`         \x1b[2m${f.key.padEnd(11)} ${(f.value * 100).toFixed(0).padStart(3)}%  ${f.why}\x1b[0m`)
    }
    if (r.score.excluded) console.log(`         \x1b[31mexcluded: ${r.score.excluded}\x1b[0m`)
    console.log()
  }

  const winner = ranked.options.find((o) => !o.score.excluded)
  if (!winner) throw new Error('every option was excluded — nothing for the group to converge on')
  await call(`/v1/plans/${plan.plan_id}/choose`, 'POST', { option_id: winner.option.option_id })
  console.log(`   chose: ${winner.option.title}`)

  // ===========================================================================
  step(5, 'The boundary — coordination is done; the money step returns to the humans')
  // ===========================================================================

  const perHead = 65_000 // OSM has no price for a restaurant; a human supplies the real bill amount here
  const group = await call<{
    group_id: string
    rail: string
    members: { member_id: string; name: string; share_amount: number }[]
  }>(`/v1/plans/${plan.plan_id}/convert`, 'POST', {
    unit_amount: perHead,
    currency: planSlots.currency,
    policy: { type: 'all_of' },
  })

  // Which human-only step this rail actually uses. A real OpenStreetMap venue
  // has no merchant Prava can charge, so plan/service.ts's convertToGroup
  // deliberately routes it to `at_venue`, not `prava_mandates` — see the
  // comment on that function. This is not this script picking the boring
  // rail; it is the honest consequence of choosing a real place over an
  // invented product. Either rail keeps the same boundary: only the human
  // completes their own step, on their own device.
  const groupFull = await call<{ rail_capability: { mandates: boolean; disclosure: string } }>(`/v1/groups/${group.group_id}`)
  const usesMandates = groupFull.rail_capability.mandates

  // groupView() (GET /v1/groups/:id) deliberately does not carry a per-member
  // approval URL — memberView() (GET /v1/members/:id) does, because that URL
  // is the one thing meant for exactly one person to hold. Any per-member
  // session is minted lazily, on first open (service.ts openMember: "the
  // 15-minute session clock starts only when the human is present") — so
  // each member has to be "opened" first, the same as a human clicking their
  // own link would trigger. Note what this script does NOT do anywhere below:
  // call POST /v1/members/:id/accept or complete a Prava session. Both exist.
  // Neither is called. That is the boundary, demonstrated by omission.
  const members = await Promise.all(
    group.members.map(async (m) => {
      await call(`/v1/members/${m.member_id}/open`, 'POST', {})
      return call<{ member_id: string; name: string; status: string; share_amount: number; approval_url: string | null }>(
        `/v1/members/${m.member_id}`,
      )
    }),
  )

  console.log(`   group ${group.group_id} on the "${group.rail}" rail — ${members.length} real principal(s), not one`)
  console.log(`   \x1b[2m${groupFull.rail_capability.disclosure}\x1b[0m`)
  console.log(`   \x1b[33mNo delegate above, and no agent anywhere in this script, can complete any of the following.\x1b[0m`)
  console.log(
    usesMandates
      ? `   \x1b[33mEach is a passkey ceremony on that person's own device:\x1b[0m\n`
      : `   \x1b[33mEach person still has to open this and accept their own exact amount by hand:\x1b[0m\n`,
  )
  for (const m of members) {
    console.log(`     ${m.name.padEnd(8)} owes ${money(m.share_amount, planSlots.currency)}  status=${m.status}`)
    console.log(
      `       \x1b[2m${m.approval_url ?? (usesMandates ? '(no approval url yet)' : `POST /v1/members/${m.member_id}/accept — a human action this script deliberately never calls`)}\x1b[0m`,
    )
  }
  console.log(
    `\n   \x1b[2mThis script holds three real session cookies and zero payment credentials. That is not an\x1b[0m`,
  )
  console.log(
    `   \x1b[2momission — SignalPayload (../engine/src/plan/types.ts) has no payment-shaped variant, and\x1b[0m`,
  )
  console.log(`   \x1b[2mneither POST /v1/participants/:id/delegate-answer nor any MCP tool can produce one.\x1b[0m`)
  console.log(`\n\x1b[32m   N humans, N delegate agents, one engine — and the mandate is still theirs alone to sign.\x1b[0m\n`)
}

main().catch((e) => {
  console.error(`\n\x1b[31m✗ ${(e as Error).message}\x1b[0m\n`)
  process.exit(1)
})
