#!/usr/bin/env node
// Seed the judge-facing demo account with a lived-in, *honest* history.
//
//   DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/seed-demo.mjs
//
// Optional env:
//   SUTRA_ENGINE   engine origin      (default: the Railway production engine)
//   SUTRA_URL      web origin, links  (default: https://sutra-gmp.vercel.app)
//   SEED_PASSWORD  password for the supporting demo accounts this creates
//
// ---------------------------------------------------------------------------
// WHAT THIS SEEDS
//
//   1. Five supporting accounts (Ananya, Rohit, Kabir, Meera, Dev) that are
//      real registered users, mutually friended with the demo account, so the
//      People page, the friend picker and Circles are populated with people
//      rather than placeholders.
//   2. Four FINISHED bill splits on the `at_venue` rail — a brewpub dinner, a
//      bar tab, an airport taxi and a grocery run — every share accepted by
//      its own account, so each one commits and produces a real Ed25519-signed,
//      hash-chained receipt.
//   3. One group that FELL THROUGH: a friend declines, `all_of` becomes
//      unsatisfiable, the group aborts. Judges poke at failure states.
//   4. Two LIVE groups: a birthday dinner someone else organised where the
//      demo account still owes an answer (so "needs you" is non-empty on the
//      very first screen), and a product split built from a REAL product
//      resolved out of live federated search, waiting on two other people.
//   5. Two PLANS built from natural sentences, extracted and geocoded by the
//      live agent endpoint and populated with real OpenStreetMap venues, with
//      real availability / location / budget signals behind the ranking.
//   6. Real conversation in the group and plan threads, including `@sutra`
//      mentions the bot answers from actual group/plan state.
//
// ---------------------------------------------------------------------------
// THE HONESTY CONSTRAINT — read before editing this file
//
// This script must never claim money moved when it did not.
//
//   * The `prava_mandates` rail charges real cards and requires a human
//     passkey ceremony on Prava's hosted page. No script can complete it, and
//     this one does not try. Nothing here writes a `charged_amount`, forges a
//     receipt, or touches a mock/dev-auth backdoor.
//   * Every settled member seeded here is on a NON-CHARGING rail (`at_venue`
//     or `checkout_handoff`). The engine writes `charged_amount: 0` for them
//     and the receipt says "settled at the venue" / "approved for checkout" —
//     which is the literal truth for those rails, by design.
//   * Every acceptance is a real `POST /v1/members/:id/accept` made by the
//     account that seat belongs to, signed in with its own password. The
//     engine refuses to let one account accept another's share, and this
//     script does not work around that.
//
// If you extend this file and find yourself about to record a charge, stop.
//
// ---------------------------------------------------------------------------
// RE-RUNNING
//
// Idempotent where the API allows it: accounts are logged into if they already
// exist, friendships and circles are checked before they are made, and groups
// and plans are matched by title / intent text and skipped if already present.
// Thread messages are matched on their exact text and not re-posted.
//
// NOT idempotent, because the API has no way to express it: nothing can be
// deleted, and `created_at` is always "now" — the engine offers no way to
// backdate a group, so a fresh seed reads as one busy evening rather than a
// month of history.
// ---------------------------------------------------------------------------

const ENGINE = (process.env.SUTRA_ENGINE ?? 'https://engine-production-e6fa.up.railway.app').replace(/\/$/, '')
const APP = (process.env.SUTRA_URL ?? 'https://sutra-gmp.vercel.app').replace(/\/$/, '')

const DEMO_EMAIL = process.env.DEMO_EMAIL
const DEMO_PASSWORD = process.env.DEMO_PASSWORD
// Supporting accounts only. Deliberately not the judge account's password, and
// the judge account's credentials are never written into this repository.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'sutra-demo-passphrase-2026'

if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD for the account being seeded.')
  console.error('  DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/seed-demo.mjs')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// HTTP
//
// One User-Agent per persona on purpose. The engine's rate limiter keys on
// IP + User-Agent (engine/src/rate-limit.ts) so that a whole table behind one
// NAT address is not treated as a single caller. Six people seeding from six
// "devices" is exactly the shape that limiter was written for; without this a
// single script registering five accounts trips the 5/minute auth ceiling.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const notes = []
const note = (msg) => {
  console.log(`   ! ${msg}`)
  notes.push(msg)
}

async function http(actor, method, path, body, { timeout = 60_000, tolerate = [] } = {}) {
  const headers = {
    'content-type': 'application/json',
    'user-agent': actor?.ua ?? 'sutra-seed/1.0 (setup)',
  }
  if (actor?.token) headers.authorization = `Bearer ${actor.token}`

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ENGINE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text }
    }
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 12_000
      note(`rate limited on ${method} ${path} — waiting ${wait / 1000}s`)
      await sleep(wait)
      continue
    }
    if (!res.ok && !tolerate.includes(res.status)) {
      throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 400)}`)
    }
    return { status: res.status, body: json, setCookie: res.headers.get('set-cookie') ?? '' }
  }
}

const sessionFrom = (setCookie) => {
  const m = /sutra_session=([^;]+)/.exec(setCookie)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

/** The demo account itself. Its seat is labelled with a human first name —
 *  the engine has no profile-update route, so the account's own display name
 *  cannot be changed from here, but a member seat's label is the organiser's
 *  to choose and "test owes ₹812.00" reads like unfinished software. */
const ME = {
  key: 'me',
  seat: 'Soham',
  ua: 'sutra-seed/1.0 (soham)',
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
}

const FRIENDS = [
  { key: 'ananya', seat: 'Ananya Iyer', handle: 'ananyaiyer', name: 'Ananya Iyer' },
  { key: 'rohit', seat: 'Rohit Menon', handle: 'rohitmenon', name: 'Rohit Menon' },
  { key: 'kabir', seat: 'Kabir Shah', handle: 'kabirshah', name: 'Kabir Shah' },
  { key: 'meera', seat: 'Meera Pillai', handle: 'meerapillai', name: 'Meera Pillai' },
  { key: 'dev', seat: 'Dev Sharma', handle: 'devsharma', name: 'Dev Sharma' },
].map((f) => ({
  ...f,
  ua: `sutra-seed/1.0 (${f.key})`,
  email: `${f.handle}@demo.sutra.app`,
  password: SEED_PASSWORD,
}))

const cast = { me: ME }
for (const f of FRIENDS) cast[f.key] = f

// ---------------------------------------------------------------------------
// Accounts and friendships
// ---------------------------------------------------------------------------

async function signIn(actor) {
  const login = await http(actor, 'POST', '/v1/auth/login', { email: actor.email, password: actor.password }, { tolerate: [401] })
  if (login.status === 200) {
    actor.token = sessionFrom(login.setCookie)
    actor.id = login.body.user.id
    return 'signed in'
  }
  if (!actor.handle) throw new Error(`could not sign in as ${actor.email} — check DEMO_PASSWORD`)
  const reg = await http(actor, 'POST', '/v1/auth/register', {
    email: actor.email,
    password: actor.password,
    handle: actor.handle,
    name: actor.name,
  })
  actor.token = sessionFrom(reg.setCookie)
  actor.id = reg.body.user.id
  return 'registered'
}

async function friendsOf(actor) {
  const me = await http(actor, 'GET', '/v1/me')
  return me.body.friends ?? []
}

async function ensureFriendship(a, b) {
  const existing = await friendsOf(a)
  if (existing.some((f) => f.id === b.id)) return 'already'
  const asked = await http(a, 'POST', `/v1/people/${b.id}/friend`)
  if (asked.body.state === 'friends' || asked.body.state === 'already') return asked.body.state
  await http(b, 'POST', `/v1/people/${a.id}/accept`)
  return 'made'
}

async function ensureCircle(owner, { name, emoji, members }) {
  const list = await http(owner, 'GET', '/v1/circles')
  if ((list.body.circles ?? []).some((c) => c.name === name)) return 'already'
  await http(owner, 'POST', '/v1/circles', {
    name,
    emoji,
    member_ids: members.map((m) => m.id),
  })
  return 'created'
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function myGroups(actor) {
  const r = await http(actor, 'GET', '/v1/my/groups')
  return r.body.groups ?? []
}

/**
 * A real bill through the real parser. The parse is checked for balance BEFORE
 * anything is created: the engine reconciles items + charges against the
 * printed total, and a split built on a bill that does not reconcile would be
 * asking people to agree to a number nobody can verify.
 */
async function billSplit(organiser, spec) {
  const parsed = await http(organiser, 'POST', '/v1/bill/parse', { text: spec.text })
  const rec = parsed.body.reconciliation
  if (!rec?.balanced) {
    throw new Error(`bill "${spec.title}" does not reconcile: ${rec?.note ?? 'no reconciliation'}`)
  }
  const created = await http(organiser, 'POST', '/v1/bill/split', {
    title: spec.title,
    venue: spec.venue,
    text: spec.text,
    claimants: spec.claimants,
    members: spec.members.map((m) => ({ name: m.seat, user_id: m.id })),
    deadline_minutes: spec.deadline_minutes ?? 10_080,
  })
  return {
    group_id: created.body.group_id,
    rail: created.body.rail,
    reconciliation: created.body.reconciliation,
    members: created.body.members,
  }
}

/** Open the link the way a person does, then agree to the exact amount. */
async function accept(actor, memberId) {
  await http(actor, 'POST', `/v1/members/${memberId}/open`)
  await sleep(250)
  await http(actor, 'POST', `/v1/members/${memberId}/accept`)
}

async function open(actor, memberId) {
  await http(actor, 'POST', `/v1/members/${memberId}/open`)
}

const ACTIONABLE = new Set(['invited', 'viewed', 'awaiting_approval'])

/**
 * Bring a group forward from wherever it actually is, rather than from where
 * this script assumed it would be. Re-reads live member state and only acts on
 * seats that still have something to do, so a second run is a no-op instead of
 * a pile of 409s.
 */
async function advance(groupId, plan) {
  const g = (await http(ME, 'GET', `/v1/groups/${groupId}`)).body
  for (const step of plan) {
    const seat = g.members.find((m) => m.name === step.actor.seat)
    if (!seat) {
      note(`no seat for ${step.actor.seat} on ${groupId}`)
      continue
    }
    if (!ACTIONABLE.has(seat.status)) continue
    if (step.does === 'accept') await accept(step.actor, seat.member_id)
    else if (step.does === 'decline') await decline(step.actor, seat.member_id)
    else if (step.does === 'open' && seat.status === 'invited') await open(step.actor, seat.member_id)
    // 'nothing' — deliberately left alone; this is the action waiting on a human.
  }
}

async function decline(actor, memberId) {
  await http(actor, 'POST', `/v1/members/${memberId}/open`)
  await sleep(250)
  await http(actor, 'POST', `/v1/members/${memberId}/decline`)
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

async function thread(scope, id, lines) {
  const existing = await http(lines[0].by, 'GET', `/v1/${scope}/${id}/messages`, undefined, { tolerate: [403] })
  const already = new Set((existing.body.messages ?? []).map((m) => m.text))
  for (const line of lines) {
    if (already.has(line.text)) continue
    await http(line.by, 'POST', `/v1/${scope}/${id}/messages`, { text: line.text })
    // The bot answers inline on a mention; give the thread a human cadence.
    await sleep(line.text.includes('@sutra') ? 1200 : 400)
  }
}

// ---------------------------------------------------------------------------
// Bills. Each one is checked against the live parser before it is used.
// ---------------------------------------------------------------------------

const BILLS = {
  toit: `TOIT BREWPUB — 100 Feet Road, Indiranagar
2 x Toit Red Pint .............. ₹640.00
1 x Basil Smash ................ ₹420.00
Chilli Cheese Toast ............ ₹345.00
Peri Peri Fries ................ ₹285.00
2 x Tandoori Chicken Platter ... ₹1180.00
Subtotal ....................... ₹2870.00
CGST 2.5% ......................  ₹71.75
SGST 2.5% ......................  ₹71.75
TOTAL .......................... ₹3013.50`,

  bar: `THE PERMIT ROOM, Church Street
3 x Kokum Kombucha Highball .... ₹1170.00
2 x Chilli Cheese Bomb ......... ₹560.00
1 x Mutton Sukka Fry ........... ₹485.00
Service charge 5% ............... ₹110.75
GST .............................. ₹99.68
TOTAL .......................... ₹2425.43`,

  taxi: `NAMMA YATRI
Indiranagar to Kempegowda Intl Airport
Base fare ...................... ₹1240.00
Night surcharge ................. ₹180.00
Airport toll .................... ₹150.00
TOTAL .......................... ₹1570.00`,

  groceries: `NAMDHARI'S FRESH — Koramangala 5th Block
Milk 1L x 4 ..................... ₹276.00
Brown Bread ...................... ₹65.00
Eggs (12) ....................... ₹128.00
Bananas 1kg ...................... ₹78.00
Paneer 400g ..................... ₹190.00
Filter Coffee Powder 500g ....... ₹410.00
Dishwash Liquid ................. ₹185.00
TOTAL .......................... ₹1332.00`,

  concert: `PHOENIX MALL OF ASIA — BOX OFFICE
4 x Bacardi NH7 Weekender GA ... ₹9600.00
Booking fee ..................... ₹480.00
TOTAL ........................ ₹10080.00`,

  birthday: `SMOKE HOUSE DELI, Lavelle Road
1 x Slow Roast Lamb ............. ₹745.00
2 x Wild Mushroom Risotto ..... ₹1090.00
1 x Burrata Salad ............... ₹625.00
3 x Cold Brew ................... ₹570.00
1 x Chocolate Fondant ........... ₹395.00
Service charge .................. ₹171.25
GST 5% .......................... ₹171.25
TOTAL .......................... ₹3767.50`,
}

// ---------------------------------------------------------------------------
// Time and place. Real coordinates only — these are the neighbourhoods people
// would actually be travelling from, and the ranker prints the distances it
// computed from them.
// ---------------------------------------------------------------------------

const PLACES = {
  indiranagar: { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, country_code: 'IN', source: 'manual' },
  domlur: { label: 'Domlur', lat: 12.9609, lng: 77.6387, country_code: 'IN', source: 'manual' },
  koramangala: { label: 'Koramangala', lat: 12.9352, lng: 77.6245, country_code: 'IN', source: 'manual' },
  hsr: { label: 'HSR Layout', lat: 12.9116, lng: 77.6474, country_code: 'IN', source: 'manual' },
  jayanagar: { label: 'Jayanagar', lat: 12.9141, lng: 77.6101, country_code: 'IN', source: 'manual' },
}

/** The next given weekday, at a UTC hour/minute. 0 = Sunday. */
function nextWeekday(dow, hour, minute = 0) {
  const d = new Date()
  d.setUTCHours(hour, minute, 0, 0)
  const delta = (dow - d.getUTCDay() + 7) % 7 || 7
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString()
}
// Bengaluru is UTC+5:30, so an evening there is early afternoon UTC.
const SAT = (h, m) => nextWeekday(6, h, m)
const SUN = (h, m) => nextWeekday(0, h, m)

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

async function myPlans(actor) {
  const r = await http(actor, 'GET', '/v1/my/plans')
  return r.body.plans ?? []
}

/**
 * One sentence in, a real plan out.
 *
 * `/v1/agent/plan` is asked to READ the sentence (`dry_run: true`) — that is
 * the live extractor and the live Nominatim geocode, unchanged — and the plan
 * is then created from exactly what it understood. Going through `/v1/plans`
 * for the create rather than letting the agent route do it buys one thing the
 * agent route hard-codes away: a deadline longer than 24 hours, so a seeded
 * plan is still live when a judge opens it tomorrow.
 *
 * `category` is the one slot pinned by hand, and only when the extractor
 * proposed something the venue taxonomy does not know. An unrecognised
 * category makes places/index.ts fall back to a substring search on the venue
 * NAME, and "venue" duly matched every "…Avenue" in Koramangala — a board of
 * car dealerships and a police chowky offered as brunch. The extractor only
 * ever proposes slots and the organiser confirms them (that is what the
 * "check what Sutra understood" step in the UI is), so correcting one before
 * creating is the ordinary path, not a thumb on the scale. Everything on the
 * board is still whatever OpenStreetMap actually returns.
 */
// engine/src/places/taxonomy.ts, CATEGORIES[].id — anything not in here makes
// resolveCategory() return null and the search degrade to a name match.
const KNOWN_CATEGORIES = new Set([
  'cinema', 'restaurant', 'cafe', 'bar', 'fast_food', 'ice_cream', 'nightclub', 'karaoke', 'bowling',
  'theatre', 'music_venue', 'arcade', 'escape_room', 'museum', 'park', 'gym', 'swimming', 'hotel',
  'theme_park', 'casino', 'library',
])

async function planFromSentence(organiser, { text, participants, ask, category, deadline_minutes = 20_160 }) {
  const read = await http(organiser, 'POST', '/v1/agent/plan', { text, dry_run: true }, { timeout: 90_000 })
  const understood = read.body.understood
  const extracted = understood.slots.category
  const corrected = KNOWN_CATEGORIES.has(extracted) ? extracted : category
  if (corrected !== extracted) {
    console.log(`      category "${extracted}" is not in the venue taxonomy — searching as "${corrected}"`)
  }
  const created = await http(
    organiser,
    'POST',
    '/v1/plans',
    {
      title: understood.title,
      intent_text: text,
      kind: understood.kind,
      slots: { ...understood.slots, category: corrected },
      ask,
      participants,
      deadline_minutes,
    },
    { timeout: 120_000 },
  )
  return { plan: created.body, understood, uncertainties: read.body.uncertainties ?? [] }
}

/**
 * Repair an existing plan that is searching on an unrecognised category. Same
 * reasoning as the correction in planFromSentence; this is the re-run path,
 * and it is also exactly what the board's own "Search again" button does.
 */
async function ensurePlanCategory(plan, category) {
  if (!plan?.plan_id) return plan
  if (KNOWN_CATEGORIES.has(plan.slots?.category)) return plan
  console.log(`      re-searching "${plan.title}" as "${category}" (was "${plan.slots?.category}")`)
  await http(ME, 'POST', `/v1/plans/${plan.plan_id}/options/refresh`, { slots: { category } }, { timeout: 120_000 })
  return (await myPlans(ME)).find((p) => p.plan_id === plan.plan_id) ?? plan
}

async function signal(participantId, payload) {
  await http(null, 'POST', `/v1/participants/${participantId}/signal`, payload, { timeout: 60_000 })
}

const seatOf = (plan, name) => plan.participants.find((p) => p.name === name)?.participant_id

// ---------------------------------------------------------------------------

async function main() {
  console.log(`sutra demo seed → ${ENGINE}\n`)
  const made = { groups: [], plans: [], receipts: [] }

  // --- 1. accounts --------------------------------------------------------
  console.log('1/8  accounts')
  console.log(`   ${ME.email}: ${await signIn(ME)}  (${ME.id})`)
  for (const f of FRIENDS) {
    console.log(`   ${f.name} @${f.handle}: ${await signIn(f)}  (${f.id})`)
  }

  // --- 2. friendships and circles ------------------------------------------
  console.log('\n2/8  friendships and circles')
  for (const f of FRIENDS) {
    console.log(`   Soham ↔ ${f.name}: ${await ensureFriendship(ME, f)}`)
  }
  // Ananya organises one of the splits below, so she needs her own friendships.
  for (const other of [cast.rohit, cast.kabir]) {
    console.log(`   Ananya ↔ ${other.name}: ${await ensureFriendship(cast.ananya, other)}`)
  }

  console.log(
    `   circle "Indiranagar Regulars": ${await ensureCircle(ME, {
      name: 'Indiranagar Regulars',
      emoji: '🍻',
      members: [cast.ananya, cast.rohit, cast.kabir],
    })}`,
  )
  console.log(
    `   circle "Flat 402": ${await ensureCircle(ME, {
      name: 'Flat 402',
      emoji: '🏠',
      members: [cast.meera, cast.dev],
    })}`,
  )

  // --- 3. finished history, with receipts ----------------------------------
  //
  // Every one of these is on the at_venue rail: exact allocation, explicit
  // per-person acceptance, a signed record — and no claim that a card was
  // charged, because none was.
  console.log('\n3/8  finished splits (at_venue → signed receipts)')

  const FINISHED = [
    {
      title: 'Friday at Toit',
      venue: 'Toit Brewpub, Indiranagar',
      text: BILLS.toit,
      organiser: ME,
      members: [ME, cast.ananya, cast.rohit, cast.kabir],
      // Positional, one entry per parsed item line.
      claimants: [
        ['Soham', 'Rohit Menon'], // 2 × Toit Red
        ['Ananya Iyer'], // Basil Smash
        ['Soham', 'Ananya Iyer', 'Rohit Menon', 'Kabir Shah'], // Chilli cheese toast
        ['Soham', 'Ananya Iyer', 'Rohit Menon', 'Kabir Shah'], // Fries
        ['Soham', 'Ananya Iyer', 'Rohit Menon', 'Kabir Shah'], // 2 × Tandoori platter
      ],
    },
    {
      title: 'Permit Room, Church Street',
      venue: 'The Permit Room, Church Street',
      text: BILLS.bar,
      organiser: ME,
      members: [ME, cast.meera, cast.dev],
      claimants: [
        ['Soham', 'Meera Pillai', 'Dev Sharma'],
        ['Soham', 'Dev Sharma'],
        ['Meera Pillai'],
      ],
    },
    {
      title: 'Airport run — 5am flight',
      venue: 'Namma Yatri',
      text: BILLS.taxi,
      organiser: ME,
      members: [ME, cast.kabir, cast.meera],
      claimants: [
        ['Soham', 'Kabir Shah', 'Meera Pillai'],
        ['Soham', 'Kabir Shah', 'Meera Pillai'],
      ],
    },
    {
      title: 'Flat 402 groceries',
      venue: "Namdhari's Fresh, Koramangala",
      text: BILLS.groceries,
      organiser: ME,
      members: [ME, cast.meera, cast.dev],
      claimants: [
        ['Soham', 'Meera Pillai', 'Dev Sharma'], // milk
        ['Soham', 'Dev Sharma'], // bread
        ['Soham', 'Meera Pillai', 'Dev Sharma'], // eggs
        ['Meera Pillai'], // bananas
        ['Soham', 'Meera Pillai'], // paneer
        ['Soham', 'Meera Pillai', 'Dev Sharma'], // coffee
        ['Soham', 'Meera Pillai', 'Dev Sharma'], // dishwash
      ],
    },
  ]

  for (const spec of FINISHED) {
    let groupId = (await myGroups(ME)).find((g) => g.title === spec.title)?.group_id ?? null
    if (groupId) {
      console.log(`   "${spec.title}" already exists — ${groupId}`)
    } else {
      const g = await billSplit(spec.organiser, spec)
      groupId = g.group_id
      console.log(`   "${spec.title}" ${groupId} — ${g.reconciliation.note}`)
    }
    await advance(groupId, spec.members.map((m) => ({ actor: m, does: 'accept' })))
    // Settlement is synchronous once the policy is satisfied, but re-read
    // rather than assume it.
    await sleep(700)
    const state = await http(ME, 'GET', `/v1/groups/${groupId}`)
    if (state.body.status !== 'committed') {
      note(`"${spec.title}" ended at ${state.body.status}, not committed`)
    }
    const receipt = await http(ME, 'GET', `/v1/groups/${groupId}/receipt`, undefined, { tolerate: [404] })
    if (receipt.status !== 200) note(`"${spec.title}" produced no receipt`)
    else {
      made.receipts.push({ title: spec.title, group_id: groupId, chain_head: receipt.body.chain_head })
      console.log(`      ${state.body.status} · receipt chain head ${String(receipt.body.chain_head).slice(0, 12)}…`)
    }
    made.groups.push({ title: spec.title, id: groupId, state: state.body.status })
  }

  // --- 4. a split that fell through ----------------------------------------
  console.log('\n4/8  a split that fell through (a real decline, a real abort)')
  {
    const spec = {
      title: 'NH7 Weekender tickets',
      venue: 'Phoenix Mall of Asia box office',
      text: BILLS.concert,
      members: [ME, cast.ananya, cast.rohit, cast.kabir],
      claimants: [['Soham', 'Ananya Iyer', 'Rohit Menon', 'Kabir Shah']],
      deadline_minutes: 10_080,
    }
    let groupId = (await myGroups(ME)).find((g) => g.title === spec.title)?.group_id ?? null
    if (!groupId) groupId = (await billSplit(ME, spec)).group_id
    await advance(groupId, [
      { actor: ME, does: 'accept' },
      { actor: cast.ananya, does: 'accept' },
      // Kabir cannot make the date. On `all_of` that is terminal, and the
      // engine aborts the whole group rather than quietly settling the rest.
      { actor: cast.kabir, does: 'decline' },
    ])
    await sleep(600)
    const state = await http(ME, 'GET', `/v1/groups/${groupId}`)
    console.log(`   ${groupId} → ${state.body.status} (${state.body.decision_note ?? 'no note'})`)
    made.groups.push({ title: spec.title, id: groupId, state: state.body.status })
  }

  // --- 5. live: someone else's dinner, waiting on the demo account ----------
  console.log('\n5/8  live — a dinner Ananya organised, waiting on you')
  const spec5 = {
    title: "Ananya's birthday dinner",
    venue: 'Smoke House Deli, Lavelle Road',
    text: BILLS.birthday,
    members: [cast.ananya, ME, cast.rohit, cast.kabir],
    claimants: [
      ['Soham', 'Rohit Menon'], // lamb
      ['Ananya Iyer', 'Kabir Shah'], // 2 × risotto
      ['Ananya Iyer'], // burrata
      ['Soham', 'Rohit Menon', 'Kabir Shah'], // 3 × cold brew
      ['Ananya Iyer'], // fondant — the birthday one
    ],
    deadline_minutes: 10_080,
  }
  let birthdayId = (await myGroups(ME)).find((g) => g.title === spec5.title)?.group_id ?? null
  if (!birthdayId) birthdayId = (await billSplit(cast.ananya, spec5)).group_id
  await advance(birthdayId, [
    { actor: cast.ananya, does: 'accept' },
    { actor: cast.rohit, does: 'accept' },
    // Soham's seat is deliberately untouched: this is the action waiting on the
    // demo account when a judge signs in. Kabir has looked but not answered.
    { actor: cast.kabir, does: 'open' },
    { actor: ME, does: 'nothing' },
  ])
  console.log(`   ${birthdayId} — Ananya and Rohit in, Soham and Kabir outstanding`)
  made.groups.push({ title: spec5.title, id: birthdayId, state: 'collecting' })

  // --- 6. real products from federated search -------------------------------
  //
  // Both land on `checkout_handoff`. Reading a merchant page proves where a
  // product came from; it does not prove that merchant can charge three cards
  // for one order. The rail says exactly that, and so does the receipt.
  //
  // One deliberate rule here: the demo account never ends up sitting in
  // `approved` on a live group. The dashboard's exposure meter buckets ANY
  // approved share as "could still be charged … the merchant can take it, up
  // to your cap, without asking again" (engine/src/routes-v2.ts, the
  // `authorized` bucket), which is only true on `prava_mandates`. Leaving the
  // demo account approved-but-uncommitted on a non-charging rail would put a
  // card-authorisation claim on screen that no mandate backs. So: either the
  // group commits (→ `agreed_not_charged`, which is the truth), or the demo
  // account's own seat is still outstanding (→ it shows up as an action).
  console.log('\n6/8  real products from federated search')

  async function productGroup({ title, query, pick, members, tolerance_bps = 200 }) {
    let groupId = (await myGroups(ME)).find((g) => g.title === title)?.group_id ?? null
    if (groupId) return groupId
    const found = await http(ME, 'GET', `/v1/discover/search?q=${encodeURIComponent(query)}&limit=8`, undefined, { timeout: 60_000 })
    const product = (found.body.products ?? []).find(
      (p) => p.price?.amount_minor > 0 && (!pick || pick.test(p.title)),
    )
    if (!product) {
      note(`federated search for "${query}" returned nothing usable — skipped "${title}" rather than invent a product`)
      return null
    }
    const created = await http(ME, 'POST', '/v1/groups', {
      title,
      merchant: {
        id: product.merchant.domain,
        name: product.merchant.name,
        url: product.merchant.url,
        country_code_iso2: product.merchant.country_code_iso2,
      },
      cart: {
        items: [
          {
            sku: product.id,
            name: product.title,
            unit_amount: product.price.amount_minor,
            qty: 1,
            tier: 'core',
            claimants: ['mi_all'],
          },
        ],
        fees: [],
        currency: product.price.currency,
      },
      members: members.map((m) => ({ name: m.seat, user_id: m.id })),
      policy: { type: 'all_of' },
      tolerance_bps,
      deadline_minutes: 10_080,
      rail: 'checkout_handoff',
      origin: 'discover',
      product: { ...product, checkout_mode: 'checkout_handoff' },
    })
    console.log(`   ${created.body.group_id} — ${product.title.slice(0, 62)}…`)
    return created.body.group_id
  }

  // Finished: everybody agreed, so the group is locked and the receipt says
  // "approved for checkout" — an agreement, explicitly not a payment.
  const speakerId = await productGroup({
    title: 'Party speaker for Flat 402',
    query: 'party speaker',
    members: [ME, cast.meera, cast.dev],
  })
  if (speakerId) {
    await advance(speakerId, [ME, cast.meera, cast.dev].map((m) => ({ actor: m, does: 'accept' })))
    await sleep(600)
    const state = await http(ME, 'GET', `/v1/groups/${speakerId}`)
    console.log(`   party speaker → ${state.body.status}`)
    made.groups.push({ title: 'Party speaker for Flat 402', id: speakerId, state: state.body.status })
    if (state.body.terminal) made.receipts.push({ title: 'Party speaker for Flat 402', group_id: speakerId })
  }

  // Live: a surprise gift, so Ananya is deliberately not on it. Rohit is in,
  // Kabir has not answered, and neither has the demo account.
  const giftId = await productGroup({
    title: 'Birthday gift for Ananya',
    query: 'smart watch',
    pick: /Smartwatch|Smart Watch/i,
    members: [ME, cast.rohit, cast.kabir],
  })
  if (giftId) {
    await advance(giftId, [
      { actor: cast.rohit, does: 'accept' },
      { actor: cast.kabir, does: 'open' },
      { actor: ME, does: 'nothing' },
    ])
    console.log('   birthday gift → Rohit in, Soham and Kabir outstanding')
    made.groups.push({ title: 'Birthday gift for Ananya', id: giftId, state: 'collecting' })
  }

  // --- 7. plans ------------------------------------------------------------
  console.log('\n7/8  plans (live extraction, live geocode, real OSM venues)')
  const existingIntents = new Set((await myPlans(ME)).map((p) => p.intent_text))

  const DINNER_TEXT =
    'Dinner one evening this week with Ananya, Rohit and Kabir near Indiranagar, Bangalore, under 900 each'
  let dinnerPlan = null
  if (existingIntents.has(DINNER_TEXT)) {
    console.log('   dinner plan already exists — skipped')
    dinnerPlan = (await myPlans(ME)).find((p) => p.intent_text === DINNER_TEXT)
  } else {
    const { plan, understood, uncertainties } = await planFromSentence(ME, {
      text: DINNER_TEXT,
      ask: ['rsvp', 'availability', 'location', 'budget'],
      category: 'restaurant',
      participants: [
        { name: ME.seat, user_id: ME.id, role: 'organizer' },
        { name: cast.ananya.seat, user_id: cast.ananya.id },
        { name: cast.rohit.seat, user_id: cast.rohit.id },
        { name: cast.kabir.seat, user_id: cast.kabir.id },
      ],
    })
    dinnerPlan = plan
    console.log(`   ${plan.plan_id} "${plan.title}" — anchor ${understood.slots.where?.label ?? 'none'}, ${plan.option_count} option(s)`)
    for (const u of uncertainties) console.log(`      · ${u}`)

    const answers = [
      { seat: ME.seat, place: PLACES.indiranagar, budget: 90_000, window: [SAT(13, 30), SAT(17, 30)] },
      { seat: cast.ananya.seat, place: PLACES.domlur, budget: 100_000, window: [SAT(14, 0), SAT(17, 0)] },
      { seat: cast.rohit.seat, place: PLACES.koramangala, budget: 80_000, window: [SAT(13, 0), SAT(16, 30)] },
      { seat: cast.kabir.seat, place: PLACES.hsr, budget: 90_000, window: [SAT(14, 30), SAT(18, 0)] },
    ]
    for (const a of answers) {
      const pid = seatOf(plan, a.seat)
      if (!pid) {
        note(`no participant seat for ${a.seat} on the dinner plan`)
        continue
      }
      await signal(pid, { kind: 'rsvp', in: true })
      await signal(pid, { kind: 'location', place: a.place })
      await signal(pid, { kind: 'availability', windows: [{ start: a.window[0], end: a.window[1] }], anytime: false })
      await signal(pid, { kind: 'budget', ceiling_minor: a.budget, currency: 'INR' })
    }
    await signal(seatOf(plan, cast.ananya.seat), { kind: 'constraint', text: 'one vegetarian, needs more than a salad' })
    made.plans.push({ title: plan.title, id: plan.plan_id })
  }
  dinnerPlan = await ensurePlanCategory(dinnerPlan, 'restaurant')

  const BRUNCH_TEXT = 'Sunday brunch with Meera and Dev somewhere in Koramangala, Bangalore, under 700 each'
  let brunchPlan = null
  if (existingIntents.has(BRUNCH_TEXT)) {
    console.log('   brunch plan already exists — skipped')
    brunchPlan = (await myPlans(ME)).find((p) => p.intent_text === BRUNCH_TEXT)
  } else {
    const { plan, understood } = await planFromSentence(ME, {
      text: BRUNCH_TEXT,
      ask: ['rsvp', 'availability', 'location', 'budget'],
      category: 'cafe',
      participants: [
        { name: ME.seat, user_id: ME.id, role: 'organizer' },
        { name: cast.meera.seat, user_id: cast.meera.id },
        { name: cast.dev.seat, user_id: cast.dev.id },
      ],
    })
    brunchPlan = plan
    console.log(`   ${plan.plan_id} "${plan.title}" — anchor ${understood.slots.where?.label ?? 'none'}, ${plan.option_count} option(s)`)
    // Meera and Dev answer. Soham does not — so this plan is the second thing
    // the dashboard asks him for.
    for (const a of [
      { seat: cast.meera.seat, place: PLACES.koramangala, budget: 70_000, window: [SUN(5, 30), SUN(8, 0)] },
      { seat: cast.dev.seat, place: PLACES.jayanagar, budget: 60_000, window: [SUN(6, 0), SUN(9, 0)] },
    ]) {
      const pid = seatOf(plan, a.seat)
      if (!pid) {
        note(`no participant seat for ${a.seat} on the brunch plan`)
        continue
      }
      await signal(pid, { kind: 'rsvp', in: true })
      await signal(pid, { kind: 'location', place: a.place })
      await signal(pid, { kind: 'availability', windows: [{ start: a.window[0], end: a.window[1] }], anytime: false })
      await signal(pid, { kind: 'budget', ceiling_minor: a.budget, currency: 'INR' })
    }
    made.plans.push({ title: plan.title, id: plan.plan_id })
  }
  brunchPlan = await ensurePlanCategory(brunchPlan, 'cafe')

  // --- 8. threads ----------------------------------------------------------
  console.log('\n8/8  threads')

  if (birthdayId) {
    await thread('groups', birthdayId, [
      { by: cast.ananya, text: "Table's booked for 8pm. The fondant is on my line — that one's my shout, don't split it." },
      { by: cast.rohit, text: 'In, and mine is accepted. Can somebody bring the candles, I forgot them last year too.' },
      { by: ME, text: "@sutra who's approved so far?" },
      { by: cast.kabir, text: 'Stuck on ORR. I have looked at mine, will accept the second I stop moving.' },
    ])
    console.log(`   birthday dinner thread posted (${birthdayId})`)
  }

  if (speakerId) {
    await thread('groups', speakerId, [
      { by: ME, text: 'Found it — 160W, two mics, and it survives a balcony. Three ways it is about ₹4,167 each.' },
      { by: cast.dev, text: "@sutra what's in the cart?" },
      { by: cast.meera, text: 'Fine, but it lives in the living room this time. Accepting once I am off the call.' },
    ])
    console.log(`   speaker thread posted (${speakerId})`)
  }

  if (giftId) {
    await thread('groups', giftId, [
      { by: ME, text: 'Gift for Ananya, three ways. Keep it off the dinner thread — she reads that one.' },
      { by: cast.rohit, text: 'Done, mine is in. Get the black strap, not the orange one.' },
      { by: cast.kabir, text: "@sutra when's the deadline on this?" },
    ])
    console.log(`   birthday gift thread posted (${giftId})`)
  }

  if (dinnerPlan?.plan_id) {
    await thread('plans', dinnerPlan.plan_id, [
      { by: ME, text: 'Dropped my location and what I can spend. Somewhere walkable from 100 Feet Road ideally.' },
      { by: cast.ananya, text: 'Answered. Anything after 7:30 works for me, and one of us is vegetarian.' },
      { by: cast.rohit, text: '@sutra when works for everyone?' },
      { by: cast.kabir, text: '@sutra what are the options?' },
    ])
    console.log(`   dinner plan thread posted (${dinnerPlan.plan_id})`)
  }

  // --- optional: tidy ------------------------------------------------------
  //
  // Opt-in (`--tidy`) and deliberately narrow. It calls off plans this account
  // organised that have NOTHING on the board and that nobody else answered —
  // abandoned drafts left over from testing, which otherwise sit on the
  // dashboard forever as "0 options, 1 of 3 answered" with a deadline that
  // quietly slides into the past. Cancelling is the organiser's own action and
  // the timeline records it as such; nothing is deleted or rewritten.
  if (process.argv.includes('--tidy')) {
    console.log('\n+    tidy: calling off abandoned empty plans')
    for (const p of await myPlans(ME)) {
      if (p.terminal) continue
      if (p.created_by !== ME.id) continue
      if (p.option_count > 0) continue
      if (p.responded_count >= p.participants.length) continue
      await http(ME, 'POST', `/v1/plans/${p.plan_id}/cancel`)
      console.log(`   cancelled "${p.title}" (${p.plan_id}) — 0 options, ${p.responded_count}/${p.participants.length} answered`)
    }
  }

  // --- summary -------------------------------------------------------------
  console.log('\n──────────────────────────────────────────────')
  const dash = await http(ME, 'GET', '/v1/my/dashboard')
  const d = dash.body
  console.log(`needs you:        ${d.needs_you.length} approval(s), ${d.plans_needing_you.length} plan(s)`)
  console.log(`waiting on:       ${d.waiting_on_others.length} group(s), ${d.live_plans.length} live plan(s)`)
  console.log(`completed:        ${d.recent.length} record(s)`)
  console.log(`exposure:         ${JSON.stringify(d.exposure)}`)
  console.log(`friends:          ${(await friendsOf(ME)).map((f) => f.name).join(', ')}`)
  console.log('')
  for (const g of made.groups) console.log(`  group  ${APP}/app/groups/${g.id}  ${g.state}  ${g.title}`)
  for (const r of made.receipts) console.log(`  receipt ${APP}/app/receipts/${r.group_id}  ${r.title}`)
  for (const p of made.plans) console.log(`  plan   ${APP}/app/plans/${p.id}  ${p.title}`)
  console.log('')
  if (notes.length === 0) console.log('No problems.')
  else {
    console.log('Notes:')
    for (const n of notes) console.log(`  - ${n}`)
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message)
  process.exit(1)
})
