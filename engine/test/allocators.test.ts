import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { allocateBackstops } from '../src/protocol/backstop.js'
import { allocateAuction } from '../src/protocol/auction.js'

describe('allocateBackstops', () => {
  it('null when capacity is short', () => {
    expect(allocateBackstops(1000, [{ memberId: 'a', cap: 400 }, { memberId: 'b', cap: 500 }])).toBeNull()
  })

  it('property: covers exactly, never exceeds any cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.record({ cap: fc.integer({ min: 0, max: 500_000 }) }), { minLength: 1, maxLength: 8 }),
        (shortfall, offers) => {
          const withIds = offers.map((o, i) => ({ memberId: `b${i}`, cap: o.cap }))
          const capacity = withIds.reduce((s, o) => s + o.cap, 0)
          const result = allocateBackstops(shortfall, withIds)
          if (capacity < shortfall) {
            expect(result).toBeNull()
          } else {
            expect(result).not.toBeNull()
            const total = result!.reduce((s, a) => s + a.amount, 0)
            expect(total).toBe(shortfall)
            for (const a of result!) {
              const cap = withIds.find((o) => o.memberId === a.memberId)!.cap
              expect(a.amount).toBeLessThanOrEqual(cap)
              expect(a.amount).toBeGreaterThan(0)
            }
          }
        },
      ),
    )
  })
})

describe('allocateAuction', () => {
  it('highest bids win, ties broken by earlier submission', () => {
    const r = allocateAuction(2, ['a', 'b', 'c'], [
      { memberId: 'a', amount: 500, seq: 1 },
      { memberId: 'b', amount: 500, seq: 2 },
      { memberId: 'c', amount: 900, seq: 3 },
    ])
    expect(r.winners).toEqual(['c', 'a'])
    expect(r.losers).toEqual(['b'])
  })

  it('non-bidders rank below every bidder', () => {
    const r = allocateAuction(1, ['a', 'b'], [{ memberId: 'b', amount: 1, seq: 1 }])
    expect(r.winners).toEqual(['b'])
  })

  it('a revised bid replaces the earlier one', () => {
    const r = allocateAuction(1, ['a', 'b'], [
      { memberId: 'a', amount: 900, seq: 1 },
      { memberId: 'b', amount: 500, seq: 2 },
      { memberId: 'a', amount: 100, seq: 3 }, // a lowers their bid
    ])
    expect(r.winners).toEqual(['b'])
  })

  it('property: winners+losers partition claimants; winner count = min(slots, claimants)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 10 }),
        fc.array(fc.record({ who: fc.nat({ max: 9 }), amount: fc.nat({ max: 10_000 }) }), { maxLength: 20 }),
        (slots, claimantCount, rawBids) => {
          const claimants = Array.from({ length: claimantCount }, (_, i) => `c${i}`)
          const bids = rawBids
            .filter((b) => b.who < claimantCount)
            .map((b, i) => ({ memberId: `c${b.who}`, amount: b.amount, seq: i }))
          const r = allocateAuction(slots, claimants, bids)
          expect(r.winners.length).toBe(Math.min(slots, claimantCount))
          expect([...r.winners, ...r.losers].sort()).toEqual([...claimants].sort())
          expect(new Set(r.winners).size).toBe(r.winners.length)
        },
      ),
    )
  })
})
