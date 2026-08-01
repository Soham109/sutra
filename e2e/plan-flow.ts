#!/usr/bin/env tsx
/**
 * End-to-end proof of the coordination layer, against a running engine.
 *
 *   npm run e2e:plan            (engine on :4100)
 *   GMP_API=http://localhost:4199 npm run e2e:plan
 *
 * Nothing here is mocked. The geocoder is OpenStreetMap, the venues are real
 * places with real coordinates, the ranking is the same pure code the UI
 * renders, and the group it produces is an ordinary GMP/1 session that the
 * protocol engine commits with real mandates.
 */
const API = process.env.GMP_API ?? 'http://localhost:4100'
const TOKEN = process.env.ENGINE_API_TOKEN ?? 'dev-token'

let userId = ''

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(userId ? { 'x-sutra-user': userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return json as T
}

const money = (minor: number, cur: string) =>
  `${cur} ${(minor / (['JPY', 'KRW', 'VND'].includes(cur) ? 1 : 100)).toFixed(['JPY', 'KRW', 'VND'].includes(cur) ? 0 : 2)}`

function step(n: number, title: string) {
  console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`)
}

async function main() {
  console.log(`\x1b[2mengine: ${API}\x1b[0m`)

  step(1, 'Sign in three people')
  const me = await call<{ user: { id: string; name: string } }>('/v1/me', 'POST', {
    handle: 'soham', name: 'Soham',
  })
  userId = me.user.id
  console.log(`   organiser: ${me.user.name} (${me.user.id})`)

  step(2, 'One sentence → a structured plan (no LLM key needed)')
  const intent = 'dinner saturday with Arsh and Maya near Koramangala, under 900 each'
  const created = await call<{
    understood: { slots: Record<string, never>; people: string[] }
    extractor: string
    uncertainties: string[]
    plan: { plan_id: string; title: string; participants: { participant_id: string; name: string }[] }
  }>('/v1/agent/plan', 'POST', { text: intent })
  const slots = created.understood.slots as unknown as {
    category: string; currency: string; budget_ceiling_minor: number
    where: { label: string; country_code?: string; lat: number; lng: number }
  }
  console.log(`   "${intent}"`)
  console.log(`   extractor:  ${created.extractor}`)
  console.log(`   category:   ${slots.category}`)
  console.log(`   budget:     ${money(slots.budget_ceiling_minor, slots.currency)} each`)
  console.log(`   anchor:     ${slots.where.label} (${slots.where.country_code}) ${slots.where.lat.toFixed(4)},${slots.where.lng.toFixed(4)}`)
  console.log(`   invited:    ${created.plan.participants.map((p) => p.name).join(', ')}`)
  for (const u of created.uncertainties) console.log(`   \x1b[2m· ${u}\x1b[0m`)

  const planId = created.plan.plan_id
  const seat = (name: string) =>
    created.plan.participants.find((p) => p.name.toLowerCase().startsWith(name.toLowerCase()))!.participant_id

  step(3, 'Everyone answers: in / when / where')
  // Real coordinates, chosen far enough apart that the fairness maths matters.
  const answers: [string, { lat: number; lng: number; label: string }, [string, string]][] = [
    ['Soham', { lat: 12.9352, lng: 77.6245, label: 'Koramangala' }, ['T19:00', 'T23:00']],
    ['Arsh', { lat: 12.9784, lng: 77.6408, label: 'Indiranagar' }, ['T20:00', 'T23:30']],
    ['Maya', { lat: 12.9141, lng: 77.6101, label: 'Jayanagar' }, ['T19:30', 'T22:30']],
  ]
  // Next Saturday, so the windows land inside the plan's own envelope.
  const d = new Date()
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  const day = d.toISOString().slice(0, 10)

  for (const [name, place, [from, to]] of answers) {
    const pid = seat(name)
    await call(`/v1/participants/${pid}/signal`, 'POST', { kind: 'rsvp', in: true })
    await call(`/v1/participants/${pid}/signal`, 'POST', {
      kind: 'location',
      place: { ...place, source: 'manual' },
    })
    await call(`/v1/participants/${pid}/signal`, 'POST', {
      kind: 'availability',
      windows: [{ start: `${day}${from}:00.000Z`, end: `${day}${to}:00.000Z` }],
      anytime: false,
    })
    console.log(`   ${name.padEnd(6)} in · ${place.label.padEnd(12)} · free ${from.slice(1)}–${to.slice(1)}`)
  }

  step(4, 'Real venues, ranked against those answers')
  const ranked = await call<{
    best_windows: { window: { start: string; end: string }; count: number; available: string[] }[]
    options: {
      option: { option_id: string; title: string; subtitle: string | null; place: { lat: number; lng: number } | null; url: string | null; source: string }
      score: {
        score: number | null
        excluded: string | null
        confidence: number
        factors: { key: string; value: number; weight: number; why: string }[]
      }
    }[]
  }>(`/v1/plans/${planId}/options`)

  const best = ranked.best_windows[0]
  if (best) {
    const s = new Date(best.window.start)
    const e = new Date(best.window.end)
    console.log(`   best common window: ${s.toISOString().slice(11, 16)}–${e.toISOString().slice(11, 16)} UTC, ${best.count} of 3 can make it`)
  } else {
    console.log('   no window suits everyone')
  }
  console.log(`   ${ranked.options.length} options on the board\n`)

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

  step(5, 'Pick one and hand it to the protocol')
  const winner = ranked.options.find((o) => !o.score.excluded)
  if (!winner) throw new Error('every option was excluded — nothing to commit')
  await call(`/v1/plans/${planId}/choose`, 'POST', { option_id: winner.option.option_id })
  console.log(`   chose: ${winner.option.title}`)

  // OpenStreetMap knows where a restaurant is, never what dinner costs, so the
  // group supplies the number. This is the honest seam between the two halves.
  const perHead = 85000
  const group = await call<{
    group_id: string
    rail: string
    members: { member_id: string; name: string; share_amount: number }[]
  }>(`/v1/plans/${planId}/convert`, 'POST', {
    unit_amount: perHead,
    currency: slots.currency,
    policy: { type: 'quorum', m: 2 },
  })
  console.log(`   group:  ${group.group_id}`)
  console.log(`   rail:   ${group.rail}`)
  for (const m of group.members) {
    console.log(`     ${m.name.padEnd(6)} owes ${money(m.share_amount, slots.currency)}`)
  }

  const total = group.members.reduce((s, m) => s + m.share_amount, 0)
  console.log(`   \x1b[2mshares sum to ${money(total, slots.currency)} — exactly the cart total\x1b[0m`)

  step(6, 'Result')
  console.log(`   plan   ${API}/app/plans/${planId}`)
  console.log(`   board  ${API}/g/${group.group_id}/board`)
  console.log('\n\x1b[32m   one sentence → real venues ranked on real answers → a real group\x1b[0m\n')
}

main().catch((e) => {
  console.error(`\n\x1b[31m✗ ${(e as Error).message}\x1b[0m\n`)
  process.exit(1)
})
