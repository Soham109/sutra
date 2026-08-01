import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { evaluatePolicy, type Participant } from '../src/protocol/policy.js'
import type { Policy } from '../src/types.js'

const NOW = new Date('2026-08-01T12:00:00Z')
const P = (id: string, decision: Participant['decision'], weight = 1): Participant => ({
  id,
  name: id,
  decision,
  weight,
})

describe('policy semantics', () => {
  it('all_of: satisfied only when everyone approved', () => {
    expect(evaluatePolicy({ type: 'all_of' }, [P('a', 'approved'), P('b', 'approved')], NOW).status).toBe('satisfied')
    expect(evaluatePolicy({ type: 'all_of' }, [P('a', 'approved'), P('b', 'pending')], NOW).status).toBe('open')
    expect(evaluatePolicy({ type: 'all_of' }, [P('a', 'approved'), P('b', 'declined')], NOW).status).toBe('unsatisfiable')
  })

  it('quorum: counts approvals, detects unreachability', () => {
    const members = [P('a', 'approved'), P('b', 'declined'), P('c', 'pending')]
    expect(evaluatePolicy({ type: 'quorum', m: 2 }, members, NOW).status).toBe('open')
    expect(evaluatePolicy({ type: 'quorum', m: 3 }, members, NOW).status).toBe('unsatisfiable')
    const sat = evaluatePolicy({ type: 'quorum', m: 1 }, members, NOW)
    expect(sat.status).toBe('satisfied')
    expect(sat.locked).toEqual(['a'])
  })

  it('weighted: sums approver weights', () => {
    const members = [P('a', 'approved', 3), P('b', 'pending', 2), P('c', 'declined', 5)]
    expect(evaluatePolicy({ type: 'weighted', threshold: 3 }, members, NOW).status).toBe('satisfied')
    expect(evaluatePolicy({ type: 'weighted', threshold: 5 }, members, NOW).status).toBe('open')
    expect(evaluatePolicy({ type: 'weighted', threshold: 6 }, members, NOW).status).toBe('unsatisfiable')
  })

  it('veto: a veto kills an otherwise satisfied inner policy', () => {
    const members = [P('a', 'approved'), P('b', 'approved'), P('parent', 'declined')]
    expect(evaluatePolicy({ type: 'veto', member: 'parent', inner: { type: 'quorum', m: 2 } }, members, NOW).status).toBe('unsatisfiable')
  })

  it('required: inner satisfied but required member pending stays open', () => {
    const members = [P('a', 'approved'), P('b', 'approved'), P('treasurer', 'pending')]
    const res = evaluatePolicy({ type: 'required', member: 'treasurer', inner: { type: 'quorum', m: 2 } }, members, NOW)
    expect(res.status).toBe('open')
    const approved = [P('a', 'approved'), P('b', 'approved'), P('treasurer', 'approved')]
    const res2 = evaluatePolicy({ type: 'required', member: 'treasurer', inner: { type: 'quorum', m: 2 } }, approved, NOW)
    expect(res2.status).toBe('satisfied')
    expect(res2.locked).toContain('treasurer')
  })

  it('deadline: primary before, fallback after', () => {
    const policy: Policy = {
      type: 'deadline',
      at: '2026-08-01T13:00:00Z',
      primary: { type: 'all_of' },
      fallback: { type: 'quorum', m: 2 },
    }
    const members = [P('a', 'approved'), P('b', 'approved'), P('c', 'pending')]
    expect(evaluatePolicy(policy, members, NOW).status).toBe('open')
    expect(evaluatePolicy(policy, members, new Date('2026-08-01T13:00:01Z')).status).toBe('satisfied')
  })

  it('deadline: dead primary + live fallback stays open before the deadline', () => {
    const policy: Policy = {
      type: 'deadline',
      at: '2026-08-01T13:00:00Z',
      primary: { type: 'all_of' },
      fallback: { type: 'quorum', m: 2 },
    }
    const members = [P('a', 'approved'), P('b', 'declined'), P('c', 'pending')]
    expect(evaluatePolicy(policy, members, NOW).status).toBe('open')
  })
})

// ---------------------------------------------------------------------------
// Property: approvals are monotone — flipping pending → approved never breaks
// a satisfied policy (spec §3 invariant).
// ---------------------------------------------------------------------------

const policyArb: fc.Arbitrary<Policy> = fc.letrec<{ policy: Policy }>((tie) => ({
  policy: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    fc.constant<Policy>({ type: 'all_of' }),
    fc.integer({ min: 1, max: 6 }).map((m): Policy => ({ type: 'quorum', m })),
    fc.integer({ min: 1, max: 12 }).map((t): Policy => ({ type: 'weighted', threshold: t })),
    fc
      .tuple(fc.integer({ min: 0, max: 5 }), tie('policy'))
      .map(([i, inner]): Policy => ({ type: 'veto', member: `m${i}`, inner: inner as Policy })),
    fc
      .tuple(fc.integer({ min: 0, max: 5 }), tie('policy'))
      .map(([i, inner]): Policy => ({ type: 'required', member: `m${i}`, inner: inner as Policy })),
    fc
      .tuple(fc.boolean(), tie('policy'), tie('policy'))
      .map(([past, p, f]): Policy => ({
        type: 'deadline',
        at: past ? '2026-08-01T11:00:00Z' : '2026-08-01T13:00:00Z',
        primary: p as Policy,
        fallback: f as Policy,
      })),
  ),
})).policy

describe('policy monotonicity (property)', () => {
  it('adding an approval never flips satisfied → not satisfied', () => {
    fc.assert(
      fc.property(
        policyArb,
        fc.array(fc.constantFrom<'approved' | 'declined' | 'pending'>('approved', 'declined', 'pending'), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.nat(),
        (policy, decisions, flipSeed) => {
          const members = decisions.map((d, i) => P(`m${i}`, d, (i % 3) + 1))
          const before = evaluatePolicy(policy, members, NOW)
          const pendingIdx = members.map((m, i) => (m.decision === 'pending' ? i : -1)).filter((i) => i >= 0)
          if (pendingIdx.length === 0) return
          const flip = pendingIdx[flipSeed % pendingIdx.length]!
          const flipped = members.map((m, i) => (i === flip ? { ...m, decision: 'approved' as const } : m))
          const after = evaluatePolicy(policy, flipped, NOW)
          if (before.status === 'satisfied') expect(after.status).toBe('satisfied')
        },
      ),
      { numRuns: 500 },
    )
  })
})
