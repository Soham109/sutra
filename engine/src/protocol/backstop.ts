import type { Minor } from '../types.js'
import { distribute } from './money.js'

export interface BackstopOffer {
  memberId: string
  /** remaining backstop capacity in minor units */
  cap: Minor
}

export interface BackstopAllocation {
  memberId: string
  amount: Minor
}

/**
 * Allocate a shortfall across willing backstops proportionally to their caps
 * (GMP/1 §4). Returns null when the combined caps cannot cover the shortfall.
 * Largest-remainder rounding can nudge an allocation past its cap by a unit;
 * the clamp loop redistributes any excess, which always terminates because
 * total capacity >= shortfall.
 */
export function allocateBackstops(
  shortfall: Minor,
  offers: BackstopOffer[],
): BackstopAllocation[] | null {
  if (shortfall <= 0) return []
  const willing = offers.filter((o) => o.cap > 0)
  const capacity = willing.reduce((s, o) => s + o.cap, 0)
  if (capacity < shortfall) return null

  const amounts = distribute(shortfall, willing.map((o) => o.cap))

  // Clamp to caps and redistribute overflow to backstops with headroom.
  let excess = 0
  const clamped = willing.map((o, i) => {
    const a = Math.min(amounts[i] ?? 0, o.cap)
    excess += (amounts[i] ?? 0) - a
    return a
  })
  while (excess > 0) {
    let moved = false
    for (let i = 0; i < willing.length && excess > 0; i++) {
      const offer = willing[i]!
      const current = clamped[i] ?? 0
      if (current < offer.cap) {
        clamped[i] = current + 1
        excess--
        moved = true
      }
    }
    if (!moved) return null // cannot happen when capacity >= shortfall
  }

  return willing
    .map((o, i) => ({ memberId: o.memberId, amount: clamped[i] ?? 0 }))
    .filter((a) => a.amount > 0)
}
