import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { capFor, computeShares, distribute } from '../src/protocol/money.js'
import type { Cart, MemberInput } from '../src/types.js'

const member = (name: string, over: Partial<MemberInput> = {}): MemberInput => ({
  name,
  role: 'payer',
  weight: 1,
  ...over,
})

describe('distribute', () => {
  it('sums exactly to the total for arbitrary weights (largest remainder)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = distribute(total, weights)
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
          expect(parts.every((p) => p >= 0)).toBe(true)
        },
      ),
    )
  })

  it('splits equally when all weights are zero', () => {
    expect(distribute(10, [0, 0, 0])).toEqual([4, 3, 3])
  })

  it('is proportional within one unit', () => {
    const parts = distribute(100, [1, 1, 2])
    expect(parts).toEqual([25, 25, 50])
  })
})

describe('computeShares', () => {
  const cart: Cart = {
    items: [
      { sku: 'ga', name: 'GA', unit_amount: 4500, qty: 4, tier: 'core', claimants: ['mi_all'], contested: false },
    ],
    fees: [{ name: 'fees', amount: 600 }],
    currency: 'USD',
  }

  it('splits the demo cart 4 ways with fees pro-rata', () => {
    const { shares, total } = computeShares(cart, ['A', 'B', 'C', 'D'].map((n) => member(n)))
    expect(total).toBe(18600)
    expect([...shares.values()]).toEqual([4650, 4650, 4650, 4650])
  })

  it('per-person items go to their claimant alone', () => {
    const c: Cart = {
      items: [
        { sku: 'x', name: 'X', unit_amount: 1000, qty: 1, tier: 'core', claimants: ['A'], contested: false },
        { sku: 'y', name: 'Y', unit_amount: 3000, qty: 1, tier: 'core', claimants: ['mi_all'], contested: false },
      ],
      fees: [],
      currency: 'USD',
    }
    const { shares } = computeShares(c, [member('A'), member('B')])
    expect(shares.get('A')).toBe(1000 + 1500)
    expect(shares.get('B')).toBe(1500)
  })

  it('sponsor absorbs the sponsored member share', () => {
    const { shares } = computeShares(cart, [
      member('A', { role: 'sponsor', sponsor_for: 'B' }),
      member('B'),
      member('C'),
      member('D'),
    ])
    expect(shares.get('A')).toBe(9300)
    expect(shares.get('B')).toBe(0)
  })

  it('property: shares always sum to the cart total', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            unit: fc.integer({ min: 0, max: 100_000 }),
            qty: fc.integer({ min: 1, max: 8 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 9 }),
        (items, fee, memberCount) => {
          const names = Array.from({ length: memberCount }, (_, i) => `M${i}`)
          const c: Cart = {
            items: items.map((it, i) => ({
              sku: `s${i}`,
              name: `I${i}`,
              unit_amount: it.unit,
              qty: it.qty,
              tier: 'core' as const,
              claimants: ['mi_all'],
              contested: false,
            })),
            fees: fee ? [{ name: 'f', amount: fee }] : [],
            currency: 'USD',
          }
          const cartTotal = items.reduce((s, it) => s + it.unit * it.qty, 0) + fee
          const { shares } = computeShares(c, names.map((n) => member(n)))
          expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(cartTotal)
        },
      ),
    )
  })
})

describe('capFor', () => {
  it('cap always covers the share and the tolerance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 5000 }),
        (share, bps) => {
          const cap = capFor(share, bps)
          expect(cap).toBeGreaterThanOrEqual(share)
          expect(cap * 10000).toBeGreaterThanOrEqual(share * (10000 + bps))
        },
      ),
    )
  })
})
