import { describe, expect, it } from 'vitest'
import { Db } from '../src/db.js'
import { EventHub } from '../src/events.js'
import { ReceiptSigner } from '../src/receipt.js'
import { GroupService } from '../src/service.js'
import { MockPrava } from '../src/prava/mock.js'
import { Social, installSocialSchema } from '../src/social.js'
import { Catalog } from '../src/catalog/index.js'
import { Places } from '../src/places/index.js'
import { PlanStore, installPlanSchema } from '../src/plan/store.js'
import { PlanService } from '../src/plan/service.js'

// submitSignal() must not just silently reorder the board — it must tell the
// group WHAT moved and WHY, the same way a stranger clicking through the app
// would expect after answering a poll and watching an option jump the queue.
// This pins the wiring end to end: a real PlanService, a real signal, a real
// `options.reranked` event on the plan's own timeline.

const NOW = new Date('2026-08-01T12:00:00Z')

function world() {
  const db = new Db(':memory:')
  installSocialSchema(db)
  installPlanSchema(db)
  const hub = new EventHub(db, 'test-secret')
  const groups = new GroupService(db, new MockPrava('http://test.local'), hub, new ReceiptSigner(), {
    appBaseUrl: 'http://test.local',
  })
  const social = new Social(db)
  const catalog = new Catalog({ shopifyDomains: [] })
  const places = new Places()
  const store = new PlanStore(db)
  const plans = new PlanService({ store, groups, places, catalog, social, now: () => NOW })
  return { plans, store }
}

describe('submitSignal: telling the group what changed and why', () => {
  it('emits options.reranked with a checkable from/to/reason when a vote flips the board', async () => {
    const w = world()
    const { plan } = w.plans.createPlan({
      intent_text: 'drinks after work',
      kind: 'venue',
      slots: {},
      ask: ['vote'],
      participants: [{ name: 'Xena', role: 'guest' }, { name: 'Yusuf', role: 'guest' }],
      deadline_minutes: 60,
    })
    const [xena] = w.store.participants(plan.id)

    // Both options carry the SAME already-under-way window, so freshness
    // scores an identical, non-null 0.5 for each from the very start — the
    // point is to keep both options genuinely ranked (never null) so the
    // move under test is a real re-rank, not "unranked becomes ranked".
    const when = { start: '2026-08-01T10:00:00.000Z', end: '2026-08-01T14:00:00.000Z' }
    const row = (id: string, title: string) => ({
      id,
      plan_id: plan.id,
      source: 'manual' as const,
      title,
      subtitle: null,
      place_json: null,
      when_json: JSON.stringify(when),
      price_json: null,
      url: null,
      image_url: null,
      raw_json: '{}',
    })
    w.store.insertOption(row('po_alpha', 'Alpha'))
    w.store.insertOption(row('po_beta', 'Beta'))

    // Before anything else happens, Alpha and Beta tie exactly (both score
    // 0.5 from freshness alone) and the tie-break is insertion order: Alpha
    // first. Confirm that starting point so the assertions below are about
    // the MOVE, not an accident of setup.
    const initial = w.plans.ranked(plan.id)
    expect(initial.options.map((o) => o.option.title)).toEqual(['Alpha', 'Beta'])
    expect(initial.near_ties.length).toBe(2) // a genuine tie, not a coin flip

    await w.plans.submitSignal(xena!.id, { kind: 'vote', option_id: 'po_beta', score: 1 })

    // The board itself must actually have moved.
    const after = w.plans.ranked(plan.id)
    expect(after.options.map((o) => o.option.title)).toEqual(['Beta', 'Alpha'])

    // Alpha also moved (1st -> 2nd) as a side effect, and legitimately gets
    // its own event too — find Beta's specifically rather than assuming
    // emission order.
    const events = w.store.eventsAfter(plan.id, 0)
    const rerank = events.find(
      (e) => e.type === 'options.reranked' && (JSON.parse(e.payload_json) as { option_id: string }).option_id === 'po_beta',
    )
    expect(rerank).toBeDefined()
    const payload = JSON.parse(rerank!.payload_json) as {
      option_id: string
      title: string
      from_rank: number
      to_rank: number
      reason: string
      summary: string
    }
    expect(payload).toMatchObject({ option_id: 'po_beta', title: 'Beta', from_rank: 2, to_rank: 1 })
    expect(payload.reason).toContain('Xena')
    expect(payload.reason).toContain('voted for it')
    expect(payload.summary).toBe('Beta moved from 2nd to 1st — Xena voted for it.')
    // The event is attributed to the participant who caused it.
    expect(rerank!.participant_id).toBe(xena!.id)
  })

  it('emits nothing when a signal does not change the order', async () => {
    const w = world()
    const { plan } = w.plans.createPlan({
      intent_text: 'coffee tomorrow',
      kind: 'venue',
      slots: {},
      ask: ['rsvp'],
      participants: [{ name: 'Priya', role: 'guest' }],
      deadline_minutes: 60,
    })
    const [priya] = w.store.participants(plan.id)
    w.store.insertOption({
      id: 'po_only',
      plan_id: plan.id,
      source: 'manual',
      title: 'The Only Option',
      subtitle: null,
      place_json: null,
      when_json: null,
      price_json: null,
      url: null,
      image_url: null,
      raw_json: '{}',
    })

    await w.plans.submitSignal(priya!.id, { kind: 'rsvp', in: true })

    const events = w.store.eventsAfter(plan.id, 0)
    expect(events.some((e) => e.type === 'options.reranked')).toBe(false)
  })

  it('emits nothing on the very first signal against an empty board', async () => {
    const w = world()
    const { plan } = w.plans.createPlan({
      intent_text: 'lunch',
      kind: 'venue',
      slots: {},
      ask: ['rsvp'],
      participants: [{ name: 'Dev', role: 'guest' }],
      deadline_minutes: 60,
    })
    const [dev] = w.store.participants(plan.id)
    // No options at all yet — nothing to have moved.
    await w.plans.submitSignal(dev!.id, { kind: 'rsvp', in: true })
    const events = w.store.eventsAfter(plan.id, 0)
    expect(events.some((e) => e.type === 'options.reranked')).toBe(false)
  })
})
