// Priority auctions (spec §21.1): allocation-only sealed bids.
// Bids NEVER move money — they only decide who gets a scarce slot. Every
// winner still pays the merchant price for their share through their own
// mandate. That is what keeps this legal on Prava: no P2P, no side payments.

export interface SealedBid {
  memberId: string
  /** priority signal in minor units — bounded by the member's own max, never charged */
  amount: number
  /** submission order; earlier bid wins ties (recorded in the event log) */
  seq: number
}

export interface AuctionResult {
  winners: string[]
  losers: string[]
  /** full reveal, sorted by rank — transparency after sealing is what makes
   *  this a mechanism instead of a dark pattern */
  ranking: { memberId: string; amount: number; seq: number; won: boolean }[]
}

/**
 * Allocate `slots` among sealed bids: highest amount wins, ties broken by
 * earliest submission (deterministic, auditable — no hidden coin flips).
 * Claimants who never bid rank below every bidder at amount 0.
 */
export function allocateAuction(slots: number, claimants: string[], bids: SealedBid[]): AuctionResult {
  const bidByMember = new Map<string, SealedBid>()
  for (const b of bids) {
    const prev = bidByMember.get(b.memberId)
    if (!prev || b.seq > prev.seq) bidByMember.set(b.memberId, b) // last sealed bid counts
  }

  const ranked = claimants
    .map((id, i) => bidByMember.get(id) ?? { memberId: id, amount: 0, seq: Number.MAX_SAFE_INTEGER - claimants.length + i })
    .sort((a, b) => b.amount - a.amount || a.seq - b.seq)

  const winners = ranked.slice(0, slots).map((b) => b.memberId)
  const losers = ranked.slice(slots).map((b) => b.memberId)
  return {
    winners,
    losers,
    ranking: ranked.map((b) => ({ ...b, won: winners.includes(b.memberId) })),
  }
}
