import type { Cart, MemberInput, Minor } from '../types.js'

/**
 * Distribute `total` across recipients proportionally to `weights` using the
 * largest-remainder method. The result always sums exactly to `total`.
 * Zero-weight recipients receive 0 unless every weight is zero, in which case
 * the split is equal.
 */
export function distribute(total: Minor, weights: number[]): Minor[] {
  if (weights.length === 0) return []
  if (total === 0) return weights.map(() => 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  const effective = sum === 0 ? weights.map(() => 1) : weights
  const effSum = sum === 0 ? weights.length : sum

  const exact = effective.map((w) => (total * w) / effSum)
  const floors = exact.map(Math.floor)
  let leftover = total - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)

  const out = [...floors]
  for (const { i } of order) {
    if (leftover <= 0) break
    out[i] = (out[i] ?? 0) + 1
    leftover--
  }
  return out
}

export interface ShareBreakdown {
  /** minor units per member name (payers/backstops/sponsors only) */
  shares: Map<string, Minor>
  /** item-subtotal portion per member, pre-fees (for display) */
  subtotals: Map<string, Minor>
  total: Minor
}

/**
 * computeShares (GMP/1 §12).
 *  - per-person items go to their claimants, split equally (largest remainder)
 *  - 'mi_all' claims mean "all paying members"
 *  - fees pro-rata on item subtotals (equal split if all subtotals are zero)
 *  - sponsors absorb their sponsored member's share
 * Invariant: sum of shares === cartTotal(cart).
 */
export function computeShares(cart: Cart, members: MemberInput[]): ShareBreakdown {
  const paying = members.filter((m) => m.role !== 'observer')
  if (paying.length === 0) throw new Error('computeShares: no paying members')
  const names = paying.map((m) => m.name)
  const subtotals = new Map<string, Minor>(names.map((n) => [n, 0]))

  for (const item of cart.items) {
    const line = item.unit_amount * item.qty
    const claimants = item.claimants.includes('mi_all')
      ? names
      : item.claimants.filter((c) => subtotals.has(c))
    if (claimants.length === 0) {
      throw new Error(`computeShares: item "${item.name}" has no valid claimants`)
    }
    const parts = distribute(line, claimants.map(() => 1))
    claimants.forEach((c, idx) => subtotals.set(c, (subtotals.get(c) ?? 0) + (parts[idx] ?? 0)))
  }

  const feeTotal = cart.fees.reduce((s, f) => s + f.amount, 0)
  const feeParts = distribute(feeTotal, names.map((n) => subtotals.get(n) ?? 0))

  const shares = new Map<string, Minor>()
  names.forEach((n, idx) => shares.set(n, (subtotals.get(n) ?? 0) + (feeParts[idx] ?? 0)))

  // Sponsors: fold the sponsored member's share into the sponsor's.
  for (const m of paying) {
    if (m.role === 'sponsor' && m.sponsor_for && shares.has(m.sponsor_for)) {
      const absorbed = shares.get(m.sponsor_for) ?? 0
      shares.set(m.name, (shares.get(m.name) ?? 0) + absorbed)
      shares.set(m.sponsor_for, 0)
    }
  }

  const total = [...shares.values()].reduce((a, b) => a + b, 0)
  return { shares, subtotals, total }
}

/** Cap = share * (1 + tolerance_bps/10000), rounded up so the cap always covers drift. */
export function capFor(share: Minor, toleranceBps: number): Minor {
  return Math.ceil((share * (10000 + toleranceBps)) / 10000)
}
