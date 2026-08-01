import { describe, expect, it } from 'vitest'
import { decideSignals, type PlanSituation, type StandingRules } from '../src/delegate/rules.js'
import type { Slots } from '../src/plan/types.js'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Minimal, schema-valid Slots. Individual tests override what they need. */
function slots(over: Partial<Slots> = {}): Slots {
  return {
    when: {},
    radius_m: 8_000,
    currency: 'INR',
    ...over,
  }
}

function situation(ask: PlanSituation['ask'], slotsOver: Partial<Slots> = {}): PlanSituation {
  return { ask, slots: slots(slotsOver) }
}

const kindsOf = (r: ReturnType<typeof decideSignals>) => r.signals.map((s) => s.kind)
const skippedKindsOf = (r: ReturnType<typeof decideSignals>) => r.skipped.map((s) => s.kind)

/** 2026-08-08 is a Saturday, UTC. */
const SATURDAY = '2026-08-08T19:00:00.000Z'
/** 2026-08-10 is a Monday, UTC. */
const MONDAY = '2026-08-10T19:00:00.000Z'

// ---------------------------------------------------------------------------
// Refusing to answer what the rules do not cover
// ---------------------------------------------------------------------------

describe('decideSignals — refusing what the rules do not cover', () => {
  it('returns everything as skipped when the rules are entirely empty', () => {
    const rules: StandingRules = {}
    const r = decideSignals(rules, situation(['rsvp', 'availability', 'location', 'budget', 'constraint', 'vote']))
    expect(r.signals).toEqual([])
    expect(skippedKindsOf(r).sort()).toEqual(
      ['availability', 'budget', 'constraint', 'location', 'rsvp', 'vote'].sort(),
    )
    for (const s of r.skipped) expect(s.why.length).toBeGreaterThan(0)
  })

  it('only ever answers kinds that were actually asked', () => {
    const rules: StandingRules = { home: { label: 'Home', lat: 1, lng: 1, source: 'manual' } }
    const r = decideSignals(rules, situation(['rsvp']))
    expect(r.signals).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]!.kind).toBe('rsvp')
  })

  it('a vote is always skipped — standing rules cannot anticipate a specific option', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 100_000 }, currency: 'INR' }
    const r = decideSignals(rules, situation(['vote']))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.kind).toBe('vote')
    expect(r.skipped[0]!.why).toMatch(/specific option/)
  })

  it('skips rsvp when the plan has not stated a category the rule can check', () => {
    const rules: StandingRules = { auto_rsvp: { categories: ['restaurant'] } }
    const r = decideSignals(rules, situation(['rsvp'], { category: undefined }))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.why).toMatch(/has not stated a category/)
  })

  it('skips rsvp when the plan has no budget yet but the rule caps spending', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 50_000 }, currency: 'INR' }
    const r = decideSignals(rules, situation(['rsvp'], { budget_ceiling_minor: undefined }))
    expect(r.skipped[0]!.why).toMatch(/has not stated a per-person budget/)
  })

  it('skips rsvp on a currency mismatch rather than guessing an exchange rate', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 50_000 }, currency: 'USD' }
    const r = decideSignals(rules, situation(['rsvp'], { budget_ceiling_minor: 40_000, currency: 'INR' }))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.why).toMatch(/exchange rate/)
  })

  it('skips rsvp not_on when the plan has no date to check the day against', () => {
    const rules: StandingRules = { auto_rsvp: { not_on: ['monday'] } }
    const r = decideSignals(rules, situation(['rsvp'], { when: {} }))
    expect(r.skipped[0]!.why).toMatch(/no concrete date/)
  })

  it('skips availability when the plan has no date', () => {
    const rules: StandingRules = { availability: { weekday_evenings: true } }
    const r = decideSignals(rules, situation(['availability'], { when: {} }))
    expect(r.skipped[0]!.why).toMatch(/no concrete date/)
  })

  it('skips availability when no recurring window covers that weekday', () => {
    const rules: StandingRules = { availability: { weekday_evenings: true } } // mon-fri only
    const r = decideSignals(rules, situation(['availability'], { when: { earliest: SATURDAY } }))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.why).toMatch(/no standing availability covers Saturday/)
  })
})

// ---------------------------------------------------------------------------
// Never inventing a location or a budget
// ---------------------------------------------------------------------------

describe('decideSignals — never inventing what was not set', () => {
  it('skips location rather than invent a home when none is set', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 100_000 }, currency: 'INR' }
    const r = decideSignals(rules, situation(['location']))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.why).toMatch(/refusing to invent one/)
  })

  it('emits the exact home place when one is set, unmodified', () => {
    const home = { label: 'Indiranagar', lat: 12.97, lng: 77.64, source: 'manual' as const }
    const rules: StandingRules = { home }
    const r = decideSignals(rules, situation(['location']))
    expect(r.signals).toEqual([{ kind: 'location', place: home }])
  })

  it('skips budget rather than invent a ceiling when none is set', () => {
    const rules: StandingRules = { home: { label: 'H', lat: 0, lng: 0, source: 'manual' } }
    const r = decideSignals(rules, situation(['budget']))
    expect(r.signals).toEqual([])
    expect(r.skipped[0]!.kind).toBe('budget')
  })

  it('skips budget when a ceiling is set but no currency', () => {
    const rules: StandingRules = { budget_ceiling_minor: 50_000 }
    const r = decideSignals(rules, situation(['budget']))
    expect(r.signals).toEqual([])
  })

  it('emits the exact budget signal when both ceiling and currency are set', () => {
    const rules: StandingRules = { budget_ceiling_minor: 60_000, currency: 'INR' }
    const r = decideSignals(rules, situation(['budget']))
    expect(r.signals).toEqual([{ kind: 'budget', ceiling_minor: 60_000, currency: 'INR' }])
  })
})

// ---------------------------------------------------------------------------
// not_on vs the plan's actual time window
// ---------------------------------------------------------------------------

describe('decideSignals — not_on respects the plan\'s actual window', () => {
  it('declines when the plan falls on a blacked-out day', () => {
    const rules: StandingRules = { auto_rsvp: { not_on: ['saturday', 'sunday'] } }
    const r = decideSignals(rules, situation(['rsvp'], { when: { earliest: SATURDAY } }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: false }])
    expect(r.skipped).toEqual([])
  })

  it('accepts when the plan falls on a day that is not blacked out', () => {
    const rules: StandingRules = { auto_rsvp: { not_on: ['saturday', 'sunday'] } }
    const r = decideSignals(rules, situation(['rsvp'], { when: { earliest: MONDAY } }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: true }])
  })

  it('does not black out a day just because it is not in the list', () => {
    const rules: StandingRules = { auto_rsvp: { not_on: ['monday'] } }
    const r = decideSignals(rules, situation(['rsvp'], { when: { earliest: SATURDAY } }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: true }])
  })
})

// ---------------------------------------------------------------------------
// Declining on category or cost, and saying why
// ---------------------------------------------------------------------------

describe('decideSignals — declining on category or cost', () => {
  it('declines when the category is not on the standing list', () => {
    const rules: StandingRules = { auto_rsvp: { categories: ['restaurant', 'cinema'] } }
    const r = decideSignals(rules, situation(['rsvp'], { category: 'bowling' }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: false }])
    expect(r.skipped).toEqual([])
  })

  it('accepts when the category is on the standing list (case-insensitive)', () => {
    const rules: StandingRules = { auto_rsvp: { categories: ['Restaurant'] } }
    const r = decideSignals(rules, situation(['rsvp'], { category: 'restaurant' }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: true }])
  })

  it('declines when the per-person cost exceeds the standing limit', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 60_000 }, currency: 'INR' }
    const r = decideSignals(rules, situation(['rsvp'], { budget_ceiling_minor: 90_000, currency: 'INR' }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: false }])
  })

  it('accepts when the per-person cost is within the standing limit', () => {
    const rules: StandingRules = { auto_rsvp: { max_share_minor: 60_000 }, currency: 'INR' }
    const r = decideSignals(rules, situation(['rsvp'], { budget_ceiling_minor: 50_000, currency: 'INR' }))
    expect(r.signals).toEqual([{ kind: 'rsvp', in: true }])
  })

  it('combines multiple decline reasons into one signal, not two', () => {
    const rules: StandingRules = {
      auto_rsvp: { categories: ['restaurant'], max_share_minor: 10_000, not_on: ['saturday'] },
      currency: 'INR',
    }
    const r = decideSignals(
      rules,
      situation(['rsvp'], { category: 'bowling', budget_ceiling_minor: 90_000, currency: 'INR', when: { earliest: SATURDAY } }),
    )
    expect(r.signals).toEqual([{ kind: 'rsvp', in: false }])
    expect(r.skipped).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// availability: producing a concrete window from a recurring pattern
// ---------------------------------------------------------------------------

describe('decideSignals — availability', () => {
  it('produces a concrete window on the plan\'s date from a matching recurring pattern', () => {
    const rules: StandingRules = { availability: { weekday_evenings: true } }
    const r = decideSignals(rules, situation(['availability'], { when: { earliest: MONDAY } }))
    expect(r.signals).toHaveLength(1)
    const sig = r.signals[0]!
    expect(sig.kind).toBe('availability')
    if (sig.kind === 'availability') {
      expect(sig.anytime).toBe(false)
      expect(sig.windows).toHaveLength(1)
      expect(sig.windows[0]!.start).toBe('2026-08-10T18:00:00.000Z')
      expect(sig.windows[0]!.end).toBe('2026-08-10T23:00:00.000Z')
    }
  })

  it('uses an explicit recurring window over the weekday_evenings shorthand when it covers the day', () => {
    const rules: StandingRules = {
      availability: { windows: [{ days: ['saturday', 'sunday'], from: '12:00', to: '23:00' }] },
    }
    const r = decideSignals(rules, situation(['availability'], { when: { earliest: SATURDAY } }))
    expect(r.signals).toHaveLength(1)
    const sig = r.signals[0]!
    if (sig.kind === 'availability') {
      expect(sig.windows[0]!.start).toBe('2026-08-08T12:00:00.000Z')
      expect(sig.windows[0]!.end).toBe('2026-08-08T23:00:00.000Z')
    }
  })
})

// ---------------------------------------------------------------------------
// constraints
// ---------------------------------------------------------------------------

describe('decideSignals — constraints', () => {
  it('emits one constraint signal per standing constraint', () => {
    const rules: StandingRules = { constraints: ['vegetarian', 'no alcohol'] }
    const r = decideSignals(rules, situation(['constraint']))
    expect(r.signals).toEqual([
      { kind: 'constraint', text: 'vegetarian' },
      { kind: 'constraint', text: 'no alcohol' },
    ])
  })

  it('skips constraint when none are set', () => {
    const rules: StandingRules = { home: { label: 'H', lat: 0, lng: 0, source: 'manual' } }
    const r = decideSignals(rules, situation(['constraint']))
    expect(r.signals).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The three-delegate scenario from e2e/agent-mesh.ts, as a regression test.
// ---------------------------------------------------------------------------

describe('decideSignals — the demo mesh (budget / weekday-restricted / vegetarian)', () => {
  const ask: PlanSituation['ask'] = ['rsvp', 'availability', 'location', 'budget', 'constraint']
  const plan = situation(ask, {
    category: 'restaurant',
    currency: 'INR',
    budget_ceiling_minor: 70_000,
    when: { earliest: SATURDAY },
  })

  it('the budget-constrained delegate declines on cost alone', () => {
    const rules: StandingRules = {
      auto_rsvp: { max_share_minor: 60_000, categories: ['restaurant'] },
      availability: { weekday_evenings: true },
      home: { label: 'HSR Layout', lat: 12.9116, lng: 77.6412, source: 'manual' },
      budget_ceiling_minor: 60_000,
      currency: 'INR',
    }
    const r = decideSignals(rules, plan)
    const rsvp = r.signals.find((s) => s.kind === 'rsvp')
    expect(rsvp).toEqual({ kind: 'rsvp', in: false })
  })

  it('the weekday-restricted delegate declines because the plan is on a blacked-out day', () => {
    const rules: StandingRules = {
      auto_rsvp: { max_share_minor: 200_000, categories: ['restaurant'], not_on: ['saturday', 'sunday'] },
      availability: { weekday_evenings: true },
      home: { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, source: 'manual' },
      budget_ceiling_minor: 200_000,
      currency: 'INR',
    }
    const r = decideSignals(rules, plan)
    const rsvp = r.signals.find((s) => s.kind === 'rsvp')
    expect(rsvp).toEqual({ kind: 'rsvp', in: false })
  })

  it('the vegetarian delegate accepts, answers everything covered, and correctly refuses location', () => {
    const rules: StandingRules = {
      auto_rsvp: { max_share_minor: 150_000, categories: ['restaurant'] },
      availability: { windows: [{ days: ['saturday', 'sunday'], from: '12:00', to: '23:00' }] },
      budget_ceiling_minor: 150_000,
      currency: 'INR',
      constraints: ['vegetarian'],
      // deliberately no `home` — this is the refusal case
    }
    const r = decideSignals(rules, plan)
    expect(kindsOf(r).sort()).toEqual(['availability', 'budget', 'constraint', 'rsvp'].sort())
    expect(r.signals.find((s) => s.kind === 'rsvp')).toEqual({ kind: 'rsvp', in: true })
    expect(skippedKindsOf(r)).toEqual(['location'])
    expect(r.skipped[0]!.why).toMatch(/refusing to invent one/)
  })
})
