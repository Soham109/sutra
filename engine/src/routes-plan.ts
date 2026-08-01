// Coordination routes: the phase before a cart exists.
//
// Kept separate from /v1/groups on purpose. /v1/groups is the frozen GMP/1
// contract other apps and agents integrate against; this is the product layer
// that decides what a group is even buying, and it hands off to that contract
// rather than extending it.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currencyForCountry, extractIntent, locationPhrase, statedCurrency } from './agent/extract.js'
import { minorUnits } from './catalog/parse.js'
import { UserError, type GroupService } from './service.js'
import type { PlanService } from './plan/service.js'
import { viewOption } from './plan/service.js'
import type { PlanStore } from './plan/store.js'
import type { Places } from './places/index.js'
import { spendLimit } from './rate-limit.js'
import type { Social, User } from './social.js'
import {
  CreatePlanSchema,
  SignalPayloadSchema,
  SlotsSchema,
  type PlanRow,
  type SignalPayload,
} from './plan/types.js'

export interface PlanRoutesDeps {
  plans: PlanService
  store: PlanStore
  groups: GroupService
  places: Places
  social: Social
  currentUser: (req: { headers: Record<string, unknown> }) => User | undefined
  /**
   * Same server-to-server credential /v1/groups accepts. A caller that holds
   * it is trusted the way our own deployed frontend is — see viewerFor().
   */
  apiToken: string
  notifier?: {
    notify: (userId: string, input: { kind: string; title: string; body?: string; url?: string }) => unknown
  }
}

// ---------------------------------------------------------------------------
// Who is looking, and how much of a plan they may see.
//
// A participant_id is not just a label: /v1/participants/:id accepts it with
// no further proof by design — that is the whole "pass the phone, no
// account" pitch. That makes it exactly as sensitive as the budget signal it
// can read and forge (see summarySignal in plan/service.ts, "never the
// number"), and it must NOT be broadcast to everyone who can read a plan the
// way /v1/groups/:id/joinable deliberately broadcasts member_id — a group
// member has nothing private tied to their id the way a plan participant's
// budget is. A live audit read another participant's id straight out of
// planView(), POSTed a forged budget signal as them, then read it back —
// zero auth, because nothing here checked who was asking.
//
// `full` is earned the same way it already is on /v1/groups/:id/cancel: the
// plan's own organiser, proven by session when one exists, or the engine's
// bearer token (server-to-server callers, e.g. the CLI/demo scripts).
// `selfParticipantId`, when set, keeps a caller able to see the one row that
// is unambiguously theirs — their own link already told them that id, and
// the participant page renders "everyone else" by excluding it.
// ---------------------------------------------------------------------------

interface Viewer {
  full: boolean
  selfParticipantId?: string
}

function viewerFor(d: PlanRoutesDeps, req: { headers: Record<string, unknown> }, plan: PlanRow): Viewer {
  const holdsToken = req.headers.authorization === `Bearer ${d.apiToken}`
  const me = d.currentUser(req)
  const isOrganiser = !!plan.created_by && me?.id === plan.created_by
  const selfParticipantId = me ? d.store.participantForUser(plan.id, me.id)?.id : undefined
  return { full: holdsToken || isOrganiser, selfParticipantId }
}

/** Mutations that change what the group is buying need an organiser (or operator). */
function requirePlanOrganiser(
  d: PlanRoutesDeps,
  req: { headers: Record<string, unknown> },
  plan: PlanRow,
): void {
  if (!viewerFor(d, req, plan).full) {
    throw new UserError('only the person who started this plan can do that', 403)
  }
}

export function registerPlanRoutes(app: FastifyInstance, d: PlanRoutesDeps): void {
  const requireUser = (req: { headers: Record<string, unknown> }): User => {
    const u = d.currentUser(req)
    if (!u) throw new UserError('sign in to continue', 401)
    return u
  }

  // ---- plans -------------------------------------------------------------

  app.post('/v1/plans', async (req, reply) => {
    const me = d.currentUser(req)
    const input = CreatePlanSchema.parse(req.body)
    const seatingAccounts =
      !!input.circle_id || (input.participants ?? []).some((p) => p.user_id)
    if (seatingAccounts && !me) {
      throw new UserError('sign in to invite people with accounts', 401)
    }
    const { plan } = d.plans.createPlan(input, me?.id)
    // Options are best-effort at creation: a plan with nobody's location yet
    // has nowhere to search, and that is a normal state, not an error.
    await d.plans.generateOptions(plan.id).catch(() => undefined)
    if (me) {
      for (const p of d.store.participants(plan.id)) {
        if (!p.user_id || p.user_id === me.id) continue
        d.notifier?.notify(p.user_id, {
          kind: 'plan.invited',
          title: `${me.name} invited you to a plan`,
          body: plan.title,
          url: `/app/plans/${plan.id}`,
        })
      }
    }
    // The creator's own response is the one moment an organiser without an
    // account can grab every participant link at once — see viewerFor().
    return reply.status(201).send(planView(d, d.plans.mustPlan(plan.id), { full: true }))
  })

  app.get('/v1/plans/:id', async (req) => {
    const { id } = req.params as { id: string }
    const plan = d.plans.mustPlan(id)
    return planView(d, plan, viewerFor(d, req, plan))
  })

  app.get('/v1/my/plans', async (req) => {
    const me = requireUser(req)
    return { plans: d.store.plansFor(me.id).map((p) => planView(d, p, viewerFor(d, req, p))) }
  })

  app.post('/v1/plans/:id/participants', async (req) => {
    const { id } = req.params as { id: string }
    const plan0 = d.plans.mustPlan(id)
    requirePlanOrganiser(d, req, plan0)
    const me = requireUser(req)
    const body = z
      .object({
        name: z.string().min(1).max(60),
        user_id: z.string().optional(),
        contact: z.string().max(200).optional(),
      })
      .parse(req.body)
    d.social.assertLinkedFriends(me.id, [body])
    d.plans.addParticipant(id, body)
    if (body.user_id && body.user_id !== me.id) {
      d.notifier?.notify(body.user_id, {
        kind: 'plan.invited',
        title: `${me.name} added you to a plan`,
        body: plan0.title,
        url: `/app/plans/${id}`,
      })
    }
    const plan = d.plans.mustPlan(id)
    return planView(d, plan, viewerFor(d, req, plan))
  })

  app.post('/v1/plans/:id/cancel', async (req) => {
    const { id } = req.params as { id: string }
    const plan0 = d.plans.mustPlan(id)
    requirePlanOrganiser(d, req, plan0)
    d.plans.cancelPlan(id)
    const plan = d.plans.mustPlan(id)
    return planView(d, plan, viewerFor(d, req, plan))
  })

  // ---- signals -----------------------------------------------------------

  app.get('/v1/participants/:id', async (req) => {
    const { id } = req.params as { id: string }
    const p = d.store.participant(id)
    if (!p) throw new UserError('no such participant', 404)
    const plan = d.plans.mustPlan(p.plan_id)
    const mine = d.store
      .currentSignals(plan.id)
      .filter((s) => s.participant_id === p.id)
      .map((s) => JSON.parse(s.payload_json) as SignalPayload)
    // Whoever holds this link is entitled to see at least their own seat in
    // the embedded plan — the same id already got them here — but not their
    // fellow participants' ids, same as everywhere else planView() renders.
    const viewer = viewerFor(d, req, plan)
    return {
      participant_id: p.id,
      name: p.display_name,
      role: p.role,
      responded_at: p.responded_at,
      /** what this plan still wants from them, so the UI renders one form */
      asked: (JSON.parse(plan.ask_json) as string[]).filter(
        (kind) => !mine.some((s) => s.kind === kind),
      ),
      my_signals: mine,
      plan: planView(d, plan, { full: viewer.full, selfParticipantId: id }),
    }
  })

  app.post('/v1/participants/:id/signal', async (req) => {
    const { id } = req.params as { id: string }
    const payload = SignalPayloadSchema.parse(req.body)
    await d.plans.submitSignal(id, payload)
    const p = d.store.participant(id)!
    const plan = d.plans.mustPlan(p.plan_id)
    const viewer = viewerFor(d, req, plan)
    return planView(d, plan, { full: viewer.full, selfParticipantId: id })
  })

  // ---- options -----------------------------------------------------------

  app.get('/v1/plans/:id/options', async (req) => {
    const { id } = req.params as { id: string }
    const plan = d.plans.mustPlan(id)
    const r = redactRanked(d.plans.ranked(id), viewerFor(d, req, plan))
    const note = lastOptionsNote(d, id)
    return {
      plan_id: id,
      best_windows: r.best_windows,
      options: r.options,
      note,
    }
  })

  /** Re-run discovery. Explicit, because it spends someone else's rate limit. */
  app.post('/v1/plans/:id/options/refresh', spendLimit(20), async (req) => {
    const { id } = req.params as { id: string }
    const planGate = d.plans.mustPlan(id)
    requirePlanOrganiser(d, req, planGate)
    const body = z.object({ slots: SlotsSchema.partial().optional() }).parse(req.body ?? {})
    if (body.slots) {
      const plan0 = d.plans.mustPlan(id)
      const merged = SlotsSchema.parse({ ...JSON.parse(plan0.slots_json), ...body.slots })
      d.store.casPlan(plan0.id, plan0.version, { slots_json: JSON.stringify(merged) })
    }
    await d.plans.generateOptions(id)
    const plan = d.plans.mustPlan(id)
    const r = redactRanked(d.plans.ranked(id), viewerFor(d, req, plan))
    return { plan_id: id, best_windows: r.best_windows, options: r.options, note: lastOptionsNote(d, id) }
  })

  app.post('/v1/plans/:id/choose', async (req) => {
    const { id } = req.params as { id: string }
    const planGate = d.plans.mustPlan(id)
    requirePlanOrganiser(d, req, planGate)
    const body = z.object({ option_id: z.string().min(1) }).parse(req.body)
    d.plans.chooseOption(id, body.option_id)
    const plan = d.plans.mustPlan(id)
    return planView(d, plan, viewerFor(d, req, plan))
  })

  /** The handover: coordination becomes a GMP/1 group with real mandates. */
  app.post('/v1/plans/:id/convert', async (req, reply) => {
    const { id } = req.params as { id: string }
    const planGate = d.plans.mustPlan(id)
    requirePlanOrganiser(d, req, planGate)
    const body = z
      .object({
        unit_amount: z.number().int().nonnegative().optional(),
        qty: z.number().int().positive().optional(),
        currency: z.string().length(3).optional(),
        policy: z.unknown().optional(),
        deadline_minutes: z.number().int().positive().optional(),
        tolerance_bps: z.number().int().min(0).max(5000).optional(),
        no_blame: z.boolean().optional(),
        title: z.string().max(140).optional(),
      })
      .parse(req.body ?? {})
    const { group, members } = await d.plans.convertToGroup(id, body)
    return reply.status(201).send({
      group_id: group.id,
      rail: group.rail,
      members: members.map((m) => ({
        member_id: m.id,
        name: m.display_name,
        share_amount: m.share_amount,
      })),
    })
  })

  // ---- plan timeline (SSE) -----------------------------------------------

  app.get('/v1/plans/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }
    const after = Number((req.query as { after?: string }).after ?? 0)
    const plan = d.plans.mustPlan(id)
    // The timeline names WHO did something ("signal.budget"), so it leaks
    // participant_id exactly the way planView() used to — computed once at
    // connect time, same as the rest of this route's setup.
    const viewer = viewerFor(d, req, plan)
    // A chat message's payload (messages/routes.ts) carries author_user_id —
    // the one payload field on this whole stream shaped exactly like the
    // participant_id this route already redacts, and for the same reason:
    // it names which sutra account said something. Reuse the same rule,
    // with "is this MY OWN message" (by account, not by seat) as the second
    // way to earn it back, since posting a message requires an account.
    const me = d.currentUser(req)

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    let cursor = after
    const flush = () => {
      for (const e of d.store.eventsAfter(id, cursor)) {
        cursor = e.seq
        const participant_id =
          viewer.full || e.participant_id === viewer.selfParticipantId ? e.participant_id : null
        const payload = JSON.parse(e.payload_json) as Record<string, unknown>
        if (e.type === 'message.posted' && !viewer.full && payload.author_user_id !== me?.id) {
          payload.author_user_id = null
        }
        reply.raw.write(
          `id: ${e.seq}\nevent: plan\ndata: ${JSON.stringify({
            seq: e.seq,
            plan_id: e.plan_id,
            participant_id,
            type: e.type,
            payload,
            at: e.created_at,
          })}\n\n`,
        )
      }
    }
    flush()
    // The plan store has no in-process hub: coordination events are human-paced
    // (seconds to hours), so a short poll costs nothing and keeps the plan
    // layer free of the protocol's fan-out machinery.
    const timer = setInterval(flush, 1000)
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    req.raw.on('close', () => {
      clearInterval(timer)
      clearInterval(keepalive)
      reply.raw.end()
    })
  })

  // ---- the organiser agent ------------------------------------------------
  // One sentence in, a real coordinated plan out. The model only fills slots;
  // the geocoder supplies coordinates, OpenStreetMap supplies venues, and
  // rank.ts supplies the ordering. Nothing on the board is invented.

  // Spends an LLM call plus a real geocode/places lookup on the caller's
  // behalf every time it runs — the same "someone else's rate limit" this
  // file already calls out on options/refresh.
  app.post('/v1/agent/plan', spendLimit(20), async (req, reply) => {
    const me = d.currentUser(req)
    const body = z
      .object({
        text: z.string().min(3).max(2000),
        /** organiser can pre-attach people instead of relying on name parsing */
        participants: z
          .array(z.object({ name: z.string().min(1).max(60), user_id: z.string().optional() }))
          .max(50)
          .optional(),
        circle_id: z.string().optional(),
        /** the browser's own coordinate, when the user allowed it */
        here: z.object({ lat: z.number(), lng: z.number() }).optional(),
        /** preview only — show me what you understood, create nothing */
        dry_run: z.boolean().default(false),
      })
      .parse(req.body)

    const now = new Date()
    const read = await extractIntent(body.text, now)

    // The extractor reports a place NAME; only a real geocoder may turn that
    // into a coordinate. If it names nowhere, the browser's location is used,
    // and failing that the plan simply asks everyone where they are.
    const phrase = locationPhrase(body.text)
    let where = null as Awaited<ReturnType<Places['geocode']>>['places'][number] | null
    let geocodeNote = ''
    if (phrase) {
      const g = await d.places.geocode(phrase).catch(() => null)
      where = g?.places[0] ?? null
      geocodeNote = where
        ? `"${phrase}" resolved to ${where.label}`
        : `"${phrase}" could not be found — asking everyone for their location instead`
    } else if (body.here) {
      where = { label: 'your location', lat: body.here.lat, lng: body.here.lng, source: 'device' }
    }

    // A bare "under 800" carries no currency. Once a real geocoder tells us the
    // number was spoken in India, INR is the honest reading — the schema
    // default of USD is not evidence of anything.
    const inferred = statedCurrency(body.text) ? null : currencyForCountry(where?.country_code)
    const currency = inferred ?? read.slots.currency
    // The extractor scaled the budget before it knew the currency. Yen has no
    // minor unit, so "3000 each" is 3000, not 300000 — rescale rather than
    // carry a number that is wrong by two orders of magnitude.
    const budget = rescaleMinor(read.slots.budget_ceiling_minor, read.slots.currency, currency)
    const slots = SlotsSchema.parse({
      ...read.slots,
      where,
      currency,
      budget_ceiling_minor: budget,
    })
    if (inferred && inferred !== read.slots.currency) {
      read.uncertainties.push(
        `Amounts read as ${inferred} because ${where?.label} is in ${where?.country_code}. Change it if that is wrong.`,
      )
    }
    const preview = {
      understood: {
        title: read.title,
        kind: read.kind,
        slots,
        people: read.people,
        ask: read.ask,
        solo: read.solo,
      },
      extractor: read.source,
      uncertainties: [...read.uncertainties, geocodeNote].filter(Boolean),
    }
    if (body.dry_run) return preview

    const named = body.participants ?? read.people.map((name) => ({ name }))
    if (!me && (named.some((p) => 'user_id' in p && p.user_id) || body.circle_id)) {
      throw new UserError('sign in to invite people with accounts', 401)
    }
    const { plan } = d.plans.createPlan(
      {
        title: read.title,
        intent_text: body.text,
        kind: read.kind,
        slots,
        ask: read.ask,
        participants: named.map((p) => ({ ...p, role: 'guest' as const })),
        circle_id: body.circle_id ?? read.slots.url ? undefined : body.circle_id,
        deadline_minutes: 1440,
      },
      me?.id,
    )
    await d.plans.generateOptions(plan.id).catch(() => undefined)
    // Creation response, same as POST /v1/plans — the actual creator's one
    // chance to see every link at once.
    return reply.status(201).send({ ...preview, plan: planView(d, d.plans.mustPlan(plan.id), { full: true }) })
  })

  // ---- places ------------------------------------------------------------
  // Both spend a real geocoder/OpenStreetMap lookup per call — see the note
  // on /v1/agent/plan above.

  app.get('/v1/places/geocode', spendLimit(40), async (req) => {
    const { q } = req.query as { q?: string }
    if (!q?.trim()) return { places: [], reason: 'no query', cached: false, took_ms: 0 }
    return d.places.geocode(q.trim())
  })

  app.get('/v1/places/search', spendLimit(40), async (req) => {
    const q = req.query as { lat?: string; lng?: string; category?: string; radius_m?: string; limit?: string }
    const lat = Number(q.lat)
    const lng = Number(q.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new UserError('lat and lng are required')
    }
    return d.places.search({
      near: { lat, lng },
      category: q.category ?? 'restaurant',
      radius_m: q.radius_m ? Number(q.radius_m) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    })
  })

  app.get('/v1/places/status', async () => ({ sources: d.places.status() }))
}

/**
 * Move an amount between currencies that disagree about how many minor units
 * a unit has. This is a rescale, NOT a conversion — no exchange rate is
 * applied and none is implied. 3000 in a 2-decimal read becomes 3000 in a
 * 0-decimal one, because the human said "three thousand" either way.
 */
function rescaleMinor(
  amount: number | undefined,
  from: string,
  to: string,
): number | undefined {
  if (amount === undefined) return undefined
  const a = minorUnits(from)
  const b = minorUnits(to)
  if (a === b) return amount
  return Math.round((amount / a) * b)
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export function planView(d: PlanRoutesDeps, p: PlanRow, viewer: Viewer) {
  const participants = d.store.participants(p.id)
  const signals = d.store.currentSignals(p.id)
  const options = d.store.options(p.id)
  const lastEvent = d.store.eventsAfter(p.id, 0).at(-1)

  const byParticipant = new Map<string, SignalPayload[]>()
  for (const s of signals) {
    const list = byParticipant.get(s.participant_id) ?? []
    list.push(JSON.parse(s.payload_json) as SignalPayload)
    byParticipant.set(s.participant_id, list)
  }

  return {
    plan_id: p.id,
    title: p.title,
    intent_text: p.intent_text,
    kind: p.kind,
    status: p.status,
    slots: JSON.parse(p.slots_json),
    ask: JSON.parse(p.ask_json) as string[],
    rail: p.rail,
    chosen_option_id: p.chosen_option_id,
    group_id: p.group_id,
    deadline_at: p.deadline_at,
    created_by: p.created_by,
    circle_id: p.circle_id,
    terminal: ['converted', 'cancelled', 'expired'].includes(p.status),
    event_cursor: lastEvent?.seq ?? 0,
    participants: participants.map((x) => {
      const mine = byParticipant.get(x.id) ?? []
      const rsvp = mine.find((s) => s.kind === 'rsvp')
      // The organiser (or the engine token) sees every id, to distribute
      // links; anyone else sees only the row that is unambiguously theirs.
      // See the Viewer doc comment above for why this id is sensitive at all.
      const revealed = viewer.full || x.id === viewer.selfParticipantId
      return {
        participant_id: revealed ? x.id : null,
        name: x.display_name,
        user_id: revealed ? x.user_id : null,
        role: x.role,
        responded_at: x.responded_at,
        // Which questions they have answered — never the answers themselves,
        // so a budget ceiling stays between the member and the ranker.
        answered: mine.map((s) => s.kind),
        rsvp: rsvp && rsvp.kind === 'rsvp' ? rsvp.in : null,
        location_label:
          mine.find((s) => s.kind === 'location')?.kind === 'location'
            ? (mine.find((s) => s.kind === 'location') as { place: { label: string } }).place.label
            : null,
      }
    }),
    options: options.map(viewOption),
    option_count: options.length,
    responded_count: participants.filter((x) => x.responded_at).length,
  }
}

/**
 * The ranked board leaks participant_id two more ways, both reachable with
 * zero auth via GET /v1/plans/:id/options: the per-option fit table
 * (`per_participant`), and who a common meeting window counts as available.
 * Same treatment as planView() — everyone's numbers stay, only the raw id
 * that would let a stranger act as that person gets redacted.
 */
function redactRanked(r: ReturnType<PlanService['ranked']>, viewer: Viewer) {
  if (viewer.full) return r
  return {
    ...r,
    best_windows: r.best_windows.map((w) => ({
      ...w,
      available: w.available.filter((id) => id === viewer.selfParticipantId),
      unavailable: w.unavailable.filter((id) => id === viewer.selfParticipantId),
    })),
    options: r.options.map((o) => ({
      ...o,
      score: {
        ...o.score,
        per_participant: o.score.per_participant.map((pp) => ({
          ...pp,
          participant_id: pp.participant_id === viewer.selfParticipantId ? pp.participant_id : null,
        })),
      },
    })),
  }
}

/** Last search note from options.generated / options.refresh_empty events. */
function lastOptionsNote(d: PlanRoutesDeps, planId: string): string | null {
  const events = d.store.eventsAfter(planId, 0)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.type !== 'options.generated' && e.type !== 'options.refresh_empty') continue
    try {
      const payload = JSON.parse(e.payload_json) as { note?: string }
      if (payload.note) return payload.note
    } catch {
      /* ignore */
    }
  }
  return null
}
