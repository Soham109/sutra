'use client'

/** Just the part of a cart line this needs: who claimed it. */
interface Claimed {
  claimants: string[]
}

// The question this product kept dodging: after everyone pays, who receives the
// order?
//
// A Prava charge mints ONE single-use card per person, locked to that merchant
// and capped at that person's own amount. Four people means four card numbers.
// A normal online checkout has one card field. So a single shared cart paid by
// four cards does not complete anywhere that cannot take more than one card for
// one order — and almost no online checkout can.
//
// That is not a reason to hide the limit. It is a reason to detect which of the
// two situations somebody is actually in, because they are genuinely different:
//
//   - Everyone is buying their own item. Four tickets, four orders, four cards,
//     each covering exactly its owner's line. This completes today, unassisted,
//     and nobody fronts anything. It is the case the protocol was built for.
//
//   - One shared thing, split N ways. The money reaches the merchant as N real
//     charges, but their order system has no idea the four belong together.
//     Completing it needs the merchant to accept more than one card for one
//     order — split tender — which is routine at a physical till and rare
//     online.
//
// Every charge in a group already carries a shared reference
// (`gmp:{groupId}:{memberId}:share:N`), which is exactly the hook a
// Prava-aware merchant would reconcile on. That is what GMP/1 proposes. It is
// a proposal, and saying so is cheaper than being caught.

export type Completion = 'own-item' | 'shared-cart' | 'at-venue'

/**
 * Which of the two card-rail situations this cart is, decided from the claims
 * people actually made rather than from anything inferred.
 */
export function completionOf(items: Claimed[], charges: boolean): Completion {
  if (!charges) return 'at-venue'
  const shared = items.some(
    (i) => i.claimants.includes('mi_all') || i.claimants.length > 1,
  )
  return shared ? 'shared-cart' : 'own-item'
}

export function HowItCompletes({
  items,
  charges,
  merchant,
  people,
}: {
  items: Claimed[]
  charges: boolean
  merchant: string
  people: number
}) {
  const kind = completionOf(items, charges)

  if (kind === 'at-venue') {
    return (
      <div className="completes is-ok">
        <b>Everyone pays {merchant} directly.</b>
        <p>
          No card is charged through sutra here. You get the arithmetic, everyone’s explicit
          agreement, and a signed record of who owed what — then {people} of you hand over{' '}
          {people} cards at the till, which every card machine has always been able to do.
        </p>
      </div>
    )
  }

  if (kind === 'own-item') {
    return (
      <div className="completes is-ok">
        <b>Each person’s card covers their own line.</b>
        <p>
          Because nobody is sharing an item, each person ends up with a single-use card that
          covers exactly what they picked — so {people} separate orders at {merchant} each go
          through on their own card. Nobody fronts anything and there is nothing to settle up
          afterwards.
        </p>
      </div>
    )
  }

  return (
    <div className="completes is-warn">
      <b>This is one cart, and it will be paid by {people} different cards.</b>
      <p>
        Everyone’s share is charged to their own card and reaches {merchant} — nobody fronts
        anything. But {merchant}’s checkout has one card field, so <b>sutra cannot place this
        order for you</b> unless they accept more than one card for a single order. That is
        routine at a till and rare online.
      </p>
      <p>
        Every charge in this group carries the same reference, which is exactly what a
        merchant would reconcile them on — that is the part of GMP/1 that is a proposal
        rather than a shipped feature, and no merchant has adopted it yet.
      </p>
      <p className="completes-fix">
        If each of you is buying a separate thing, give each line its own claimant instead —
        then every card covers one whole item and the orders go through by themselves.
      </p>
    </div>
  )
}
