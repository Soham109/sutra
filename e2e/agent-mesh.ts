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
 * Six real things happen, none of them mocked:
 *
 *  1. Discovery   — an agent reads sutra's own published A2A card and AI
 *                    catalog and learns what it can do FROM THE DOCUMENTS,
 *                    not from anything hardcoded in this script.
 *  2. Origination — that agent creates a real group plan via the documented
 *                    coordination API (POST /v1/plans), signed in as the one
 *                    human whose authority the plan is actually created under.
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
 *  6. The refusal  — step 5 shows the boundary by omission (this script never
 *                    calls the human-only route). Step 6 attempts it: a real
 *                    merchant forces the prava_mandates rail, and an agent —
 *                    holding the affected human's OWN session cookie, not a
 *                    stranger's — tries to accept a card-mandate share
 *                    directly. The engine refuses, over real HTTP, with a real
 *                    400 and a real reason. That refusal is asserted, not
 *                    narrated: see check() below.
 *
 * Style matches e2e/plan-flow.ts: same env vars, same call() shape, same
 * terminal formatting, extended with a check()/[PASS]/[FAIL] harness (the
 * same register as nanda-town-prava/scripts/live_check.py) so this script
 * ends with a clear verdict and a nonzero exit code on any failure, not just
 * on a thrown setup error. GMP_API/ENGINE_API_TOKEN drive every OPERATIONAL
 * call exactly like plan-flow.ts — except organiser-gated calls (choose,
 * convert, the mandate-rail group, its cancel), which use Priya's own cookie
 * instead of assuming ENGINE_API_TOKEN is the real operator secret for
 * whatever engine this happens to be pointed at (see the comment at the
 * first such call, step 4). DISCOVERY_BASE is separate on purpose — step 1
 * is reading sutra's own public documents, which is a different question
 * from which engine this script happens to be driving.
 */
import { decideAvailability, decideRsvp, decideSignals, type StandingRules } from '../engine/src/delegate/rules.js'
import type { SignalKind, SignalPayload, Slots } from '../engine/src/plan/types.js'

const DISCOVERY_BASE = process.env.DISCOVERY_BASE ?? 'https://sutra-gmp.vercel.app'
const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

function step(n: number, title: string) {
  console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`)
}

// PASS/FAIL harness, same register as nanda-town-prava/scripts/live_check.py's
// check()/head(): a label, a boolean, an optional reason, printed as it
// happens rather than batched — and unlike a bare `throw`, one failed
// assertion does not stop the rest of the run from being witnessed. Nonzero
// exit iff anything below is FAIL; see the summary at the end of main().
let failures = 0
function check(label: string, ok: boolean, detail = ''): boolean {
  const tag = ok ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m'
  console.log(`   ${tag} ${label}${detail ? `\n         ${detail}` : ''}`)
  if (!ok) failures++
  return ok
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

/**
 * For the one HTTP call in this whole script we WANT to fail: fetch directly
 * and never throw on a non-2xx. Everything else here treats a bad status as
 * a setup error worth stopping for; this is the opposite case, where success
 * would be the alarming outcome and the caller needs the real status code and
 * body to assert on, not a caught exception whose message might happen to match.
 */
async function attempt<T>(path: string, method: string, body?: unknown, cookie?: string): Promise<{ status: number; body: T }> {
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
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T }
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

  // social.ts's assertSeatable() (a real, live guard, not something this demo
  // relopens): Priya may not attach Arsh's or Maya's ACCOUNT to a plan until
  // they have mutually agreed to know her — "anyone could seat a stranger by
  // id and have the group show up in that stranger's dashboard" otherwise.
  // Arsh and Maya ask first; Priya asking back completes it immediately
  // (requestFriend sees the pending row and accepts instead of re-asking).
  await call('/v1/people/' + priya.id + '/friend', 'POST', {}, arsh.cookie)
  await call('/v1/people/' + priya.id + '/friend', 'POST', {}, maya.cookie)
  await call('/v1/people/' + arsh.id + '/friend', 'POST', {}, priya.cookie)
  await call('/v1/people/' + maya.id + '/friend', 'POST', {}, priya.cookie)
  console.log('   Arsh and Maya each asked Priya first; Priya asking back closed both — real mutual rows, not a shortcut')

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

  // routes-plan.ts's IDOR fix (seatingAccounts check) now refuses to seat real
  // user_ids into a plan anonymously — POST /v1/plans 401s "sign in to invite
  // people with accounts" without a cookie. That is a real, live tightening
  // this script has to honour, not a bug in it: correctly, an agent cannot
  // originate a plan naming real accounts on nobody's authority. So Priya's
  // own agent — signed in as Priya, holding only her cookie — is the one that
  // originates this plan. That is also the more honest NANDA story: not "an
  // operator token conjures a plan," but "one principal's agent starts it and
  // invites the others," same as a human would.
  const plan = await call<{
    plan_id: string
    title: string
    ask: SignalKind[]
    participants: { participant_id: string; name: string; user_id: string | null }[]
  }>(
    '/v1/plans',
    'POST',
    {
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
    },
    priya.cookie,
  )
  console.log(`   POST /v1/plans → ${plan.plan_id}  "${plan.title}"  \x1b[2m(originated by Priya's own agent, signed in as her)\x1b[0m`)
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
  console.log()
  for (const m of mesh) {
    const local = decideSignals(m.rules, situation)
    const pid = seat(m.human.name)
    // open_questions is drawn straight from plan.ask (delegate/routes.ts), so
    // it is really SignalKind[] on the wire — typed that way here (this was
    // string[] before, which is why a standalone strict tsc pass on this file
    // flagged expectOpen.has(k) below; engine/tsconfig.json never covered
    // e2e/**, so nothing had caught it until now).
    const q = await call<{ open_questions: SignalKind[] }>(`/v1/plans/${plan.plan_id}/questions?participant_id=${pid}`)
    const expectOpen = new Set(local.skipped.map((s) => s.kind))
    const matches = q.open_questions.length === expectOpen.size && q.open_questions.every((k) => expectOpen.has(k))
    check(
      `${m.human.name}: GET /v1/plans/:id/questions agrees with decideSignals()`,
      matches,
      matches ? '' : `engine open=${JSON.stringify(q.open_questions)}, decideSignals skipped=${JSON.stringify([...expectOpen])}`,
    )
  }

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
  // requirePlanOrganiser (routes-plan.ts) accepts EITHER the operator bearer
  // token OR the plan's own creator's cookie. This script's ENGINE_API_TOKEN
  // defaults to the local dev secret and has no reason to match whatever real
  // token a deployed engine actually holds — it is not this script's secret
  // to assume. Priya's own cookie is the portable proof of organiser
  // authority: it works identically pointed at localhost or at production,
  // because it is real authority, not a guessed shared key.
  await call(`/v1/plans/${plan.plan_id}/choose`, 'POST', { option_id: winner.option.option_id }, priya.cookie)
  console.log(`   chose: ${winner.option.title}`)

  // ===========================================================================
  step(5, 'The boundary — coordination is done; the money step returns to the humans')
  // ===========================================================================

  const perHead = 65_000 // OSM has no price for a restaurant; a human supplies the real bill amount here
  const group = await call<{
    group_id: string
    rail: string
    members: { member_id: string; name: string; share_amount: number }[]
  }>(
    `/v1/plans/${plan.plan_id}/convert`,
    'POST',
    {
      unit_amount: perHead,
      currency: planSlots.currency,
      policy: { type: 'all_of' },
    },
    priya.cookie,
  )

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

  // ===========================================================================
  step(6, 'The forbidden thing — an agent tries to move a card mandate directly, and the engine refuses')
  // ===========================================================================
  console.log(
    "   Steps 1–5 landed on the at_venue rail because a real OpenStreetMap restaurant has no\n" +
      "   merchant for Prava to charge (step 5's own comment explains why) — so accept() there is a\n" +
      '   human\'s explicit consent to an amount, not a card mandate, and there is nothing money-shaped\n' +
      '   to forbid an agent from on that specific rail. To attempt the ACTUAL forbidden thing — an\n' +
      '   agent trying to move a real card mandate forward without a passkey — this step gives the same\n' +
      '   three humans a second, real-merchant purchase, on the prava_mandates rail, where a mandate\n' +
      '   always exists to be forbidden from.',
  )

  console.log('\n   resolving a real product — the same discovery path an agent would use on any storefront:')
  const search = await call<{ products: { title: string; product_url: string }[] }>(
    `/v1/discover/search?q=${encodeURIComponent('wool runner')}&merchant=www.allbirds.com&limit=1`,
  )
  const target = search.products[0]
  if (!target) throw new Error('discover/search returned nothing — cannot demonstrate the mandate rail without a real product')
  const resolved = await call<{
    product: {
      title: string
      price: { amount_minor: number; currency: string }
      merchant: { name: string; url: string; country_code_iso2: string; domain: string }
    }
  }>('/v1/discover/resolve', 'POST', { url: target.product_url })
  const unit = resolved.product.price.amount_minor || 4500 // some product feeds omit price; a fallback keeps the demo from stalling on that, same as e2e/product-flow.ts
  console.log(`     GET  /v1/discover/search  → "${resolved.product.title}"`)
  console.log(`     POST /v1/discover/resolve → ${money(unit, resolved.product.price.currency)} at ${resolved.product.merchant.domain}`)

  // A fresh group, same three real accounts, a real merchant this time —
  // POST /v1/groups directly (not via a plan) because the point of this step
  // is the mandate rail's own boundary, not the coordination layer again.
  // Priya's cookie again (see the note on step 4's choose/convert): the
  // "human path" branch of POST /v1/groups (routes.ts) accepts a signed-in
  // creator in place of the operator token, and Priya, Arsh and Maya are
  // already real mutual friends from step 2, so assertSeatable needs nothing new.
  const mandateGroup = await call<{ group_id: string; members: { member_id: string; name: string }[] }>(
    '/v1/groups',
    'POST',
    {
      title: `${resolved.product.title} — same three, a real merchant this time`,
      merchant: {
        id: resolved.product.merchant.domain,
        name: resolved.product.merchant.name,
        url: resolved.product.merchant.url,
        country_code_iso2: resolved.product.merchant.country_code_iso2,
      },
      cart: {
        items: [{ sku: 'item-1', name: resolved.product.title, unit_amount: unit, qty: 3, claimants: ['mi_all'] }],
        currency: resolved.product.price.currency,
      },
      members: [
        { name: priya.name, role: 'payer', user_id: priya.id },
        { name: arsh.name, role: 'payer', user_id: arsh.id },
        { name: maya.name, role: 'payer', user_id: maya.id },
      ],
      policy: { type: 'all_of' },
    },
    priya.cookie,
  )

  const mandateFull = await call<{ rail: string; members: { member_id: string; name: string }[] }>(`/v1/groups/${mandateGroup.group_id}`)
  check('a real merchant forces the prava_mandates rail (rails.ts: railFor)', mandateFull.rail === 'prava_mandates', `rail=${mandateFull.rail}`)
  console.log(`   group ${mandateGroup.group_id} on the "${mandateFull.rail}" rail — ${mandateFull.members.length} members, each owes their own card`)

  const arshMandate = mandateFull.members.find((m) => m.name === arsh.name)
  if (!arshMandate) throw new Error("Arsh has no seat on the mandate-rail group — cannot attempt the forbidden call")

  console.log(`\n   \x1b[31mattempting the forbidden thing: POST /v1/members/${arshMandate.member_id}/accept\x1b[0m`)
  console.log(`   \x1b[31musing ARSH'S OWN session cookie — not a stranger's script, Arsh's own signed-in agent,\x1b[0m`)
  console.log(`   \x1b[31mtrying to complete his own money step without ever touching a Prava passkey…\x1b[0m`)

  const forbidden = await attempt<{ error: string }>(`/v1/members/${arshMandate.member_id}/accept`, 'POST', {}, arsh.cookie)
  console.log(`   → HTTP ${forbidden.status}  ${JSON.stringify(forbidden.body)}`)
  check(
    'refused — a card-mandate share cannot be accepted through this route, by anyone, ever',
    forbidden.status === 400 && /card mandate/i.test(forbidden.body.error ?? '') && /prava/i.test(forbidden.body.error ?? ''),
    forbidden.body.error,
  )

  // Confirm this is a STRUCTURAL rail refusal, not a lucky ordering: service.ts's
  // acceptShare() checks capabilityOf(rail).mandates before it ever reads the
  // member's own status, so the refusal above holds whether or not a Prava
  // session even exists yet. Minting one for real means one live call to
  // engine/src/prava — and the team is holding a hard 30-transactions/day
  // sandbox cap for the one real passkey charge that actually matters (see
  // .env, HANDOFF §3.1). Spending that budget on a refusal that has already
  // made its point, against a live production key, would be a worse decision
  // than the one this whole step exists to illustrate — so this script does
  // not make it, and says so out loud rather than doing it quietly.
  const health = (await fetch(`${API}/health`).then((r) => r.json())) as { prava_adapter?: string }
  if (health.prava_adapter === 'mock') {
    await call(`/v1/members/${arshMandate.member_id}/open`, 'POST', {})
    const opened = await call<{ approval_url: string | null }>(`/v1/members/${arshMandate.member_id}`)
    console.log(`\n   opened Arsh's member for real: a Prava mandate session now exists —`)
    console.log(`   \x1b[2m${opened.approval_url}\x1b[0m`)
    // On the mock adapter the "hosted ceremony" is deliberately simulated ON
    // this same engine (there is no external sandbox to point at locally) —
    // so the right invariant isn't "a different host," it's "a different KIND
    // of route": /mock/pay/… is the simulated passkey page, gated behind
    // `service.prava instanceof MockPrava` (routes.ts), not a business-logic
    // endpoint this script could complete headlessly. On a real Prava key the
    // URL is genuinely external — see the sandbox transcript for that case.
    check(
      "approval_url is the (mock) hosted-ceremony page, not an accept-style API route",
      !!opened.approval_url && opened.approval_url.includes('/mock/pay/'),
      opened.approval_url ?? '(none)',
    )
    const stillForbidden = await attempt<{ error: string }>(`/v1/members/${arshMandate.member_id}/accept`, 'POST', {}, arsh.cookie)
    check(
      'still refused with a live session sitting right there — the refusal is about the rail, not the state',
      stillForbidden.status === 400 && /prava/i.test(stillForbidden.body.error ?? ''),
      `HTTP ${stillForbidden.status} ${JSON.stringify(stillForbidden.body)}`,
    )
    console.log("   \x1b[2mThis script does not call /mock/pay/…/approve either — that route stands in for a human\x1b[0m")
    console.log('   \x1b[2mclicking a real Prava page, and it only exists at all on the mock adapter (routes.ts §"mock\x1b[0m')
    console.log('   \x1b[2mPrava hosted ceremony"). No such route exists once the engine holds a real Prava key.\x1b[0m')
  } else {
    console.log(`\n   \x1b[2mskipping POST /v1/members/${arshMandate.member_id}/open here — that call would mint a real\x1b[0m`)
    console.log(`   \x1b[2mmandate session against Prava's "${health.prava_adapter}" adapter, and this run is not\x1b[0m`)
    console.log(`   \x1b[2mspending any of the team's capped sandbox quota on a refusal that already made its point.\x1b[0m`)
  }

  // Leave no live group dangling on a shared engine, whichever adapter this ran against.
  // Cancel authority is the same organiser check as choose/convert — Priya's cookie again.
  await call(`/v1/groups/${mandateGroup.group_id}/cancel`, 'POST', {}, priya.cookie).catch(() => undefined)

  // ===========================================================================
  console.log(`\n${'─'.repeat(78)}`)
  console.log(
    failures === 0
      ? `\x1b[32mALL CHECKS PASSED\x1b[0m — coordination happened end to end over real HTTP; the money boundary held under a real attempt to cross it.`
      : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m — see [FAIL] lines above.`,
  )
  console.log(`${'─'.repeat(78)}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((e) => {
  console.error(`\n\x1b[31m✗ ${(e as Error).message}\x1b[0m\n`)
  process.exit(1)
})
