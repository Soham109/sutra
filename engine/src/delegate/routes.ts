// Delegate routes: the surface any agent — MCP tool, browser extension,
// another A2A agent — uses to act as a coordination delegate for one human.
//
// Kept separate from routes-plan.ts on purpose, same reasoning that keeps
// routes-plan.ts separate from routes.ts: this is a client built ON TOP of
// the plan layer's own contract (`PlanService.submitSignal`, the signal
// event log), not an extension of it. A delegate is just a caller that
// happens to be a standing rule instead of a human typing into a form.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUserFrom } from '../routes-v2.js'
import type { PlanService } from '../plan/service.js'
import type { PlanStore } from '../plan/store.js'
import { SlotsSchema, type SignalKind } from '../plan/types.js'
import { UserError } from '../service.js'
import type { Social, User } from '../social.js'
import { decideSignals, StandingRulesSchema } from './rules.js'
import type { DelegateStore } from './store.js'

export interface DelegateRoutesDeps {
  store: DelegateStore
  plans: PlanService
  planStore: PlanStore
  social: Social
}

export function registerDelegateRoutes(app: FastifyInstance, d: DelegateRoutesDeps): void {
  const currentUser = (req: { headers: Record<string, unknown> }): User | undefined => currentUserFrom(d.social, req)
  const requireUser = (req: { headers: Record<string, unknown> }): User => {
    const u = currentUser(req)
    if (!u) throw new UserError('sign in to continue', 401)
    return u
  }

  // ---- standing rules ------------------------------------------------------
  // Setting or reading YOUR OWN rules requires being signed in as yourself —
  // this is the one place in the whole delegate surface that does, because
  // it is the one place that writes down what your money and your calendar
  // will and will not be committed to.

  app.put('/v1/delegate/rules', async (req) => {
    const me = requireUser(req)
    const rules = StandingRulesSchema.parse(req.body)
    d.store.setRules(me.id, rules)
    return { user_id: me.id, rules }
  })

  app.get('/v1/delegate/rules', async (req) => {
    const me = requireUser(req)
    return { user_id: me.id, rules: d.store.getRules(me.id) ?? null }
  })

  // ---- what a participant still owes an answer to --------------------------
  // Machine-readable on purpose: an agent should be able to act on this
  // without parsing the human-facing plan view routes-plan.ts returns.

  app.get('/v1/plans/:planId/questions', async (req) => {
    const { planId } = req.params as { planId: string }
    const { participant_id } = req.query as { participant_id?: string }
    if (!participant_id) throw new UserError('participant_id is required')

    const plan = d.plans.mustPlan(planId)
    const participant = d.planStore.participant(participant_id)
    if (!participant || participant.plan_id !== planId) {
      throw new UserError('no such participant on this plan', 404)
    }

    const answered = new Set(
      d.planStore
        .currentSignals(planId)
        .filter((s) => s.participant_id === participant_id)
        .map((s) => s.kind),
    )
    const ask = JSON.parse(plan.ask_json) as SignalKind[]
    return {
      plan_id: planId,
      participant_id,
      open_questions: ask.filter((k) => !answered.has(k)),
      answered: [...answered],
      deadline_at: plan.deadline_at,
    }
  })

  // ---- act as a delegate ----------------------------------------------------
  // The one route that actually writes signals on a human's behalf. It never
  // touches money: submitSignal only ever produces rsvp / availability /
  // location / budget / vote / constraint rows, and there is no payment
  // approval path anywhere in the plan layer for it to call into.

  app.post('/v1/participants/:id/delegate-answer', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ rules: StandingRulesSchema.optional() }).parse(req.body ?? {})

    const participant = d.planStore.participant(id)
    if (!participant) throw new UserError('no such participant', 404)
    const plan = d.plans.mustPlan(participant.plan_id)

    const answeredKinds = d.planStore
      .currentSignals(plan.id)
      .filter((s) => s.participant_id === id)
      .map((s) => s.kind)
    const open = (JSON.parse(plan.ask_json) as SignalKind[]).filter((k) => !answeredKinds.includes(k))

    // Explicit rules in the request body override whatever is on file — that
    // is how the same route serves an MCP agent that keeps its own rules
    // in-process (e2e/agent-mesh.ts does this) as well as one that only knows
    // a participant id and expects the engine to already have rules for the
    // human behind it.
    const rules = body.rules ?? (participant.user_id ? d.store.getRules(participant.user_id) : undefined)

    if (!rules) {
      const why = participant.user_id
        ? "no standing rules are on file for this participant's human — nothing was assumed"
        : 'this participant is not linked to a signed-in human, so there are no standing rules to apply'
      return {
        participant_id: id,
        plan_id: plan.id,
        via: 'delegate' as const,
        answered: [],
        skipped: open.map((kind) => ({ kind, why })),
      }
    }

    const slots = SlotsSchema.parse(JSON.parse(plan.slots_json))
    const { signals, skipped } = decideSignals(rules, { ask: open, slots })

    for (const signal of signals) {
      await d.plans.submitSignal(id, signal)
      // submitSignal already wrote a generic `signal.<kind>` event. This
      // second event is the whole point of this endpoint: it tags that same
      // answer as having come from a DELEGATE rather than the human typing
      // into a form, so the plan timeline and board can say so rather than
      // silently attributing a standing rule's decision to a person who
      // never touched the page.
      d.planStore.appendEvent(plan.id, id, 'delegate.answered', { kind: signal.kind, via: 'delegate' })
    }
    for (const s of skipped) {
      d.planStore.appendEvent(plan.id, id, 'delegate.skipped', { kind: s.kind, why: s.why, via: 'delegate' })
    }

    return {
      participant_id: id,
      plan_id: plan.id,
      via: 'delegate' as const,
      answered: signals,
      skipped,
    }
  })
}
