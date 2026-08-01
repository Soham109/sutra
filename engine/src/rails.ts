import { z } from 'zod'

// ---------------------------------------------------------------------------
// Settlement rails.
//
// GMP/1's charging path requires a merchant Prava can reach: consent becomes a
// mandate, the mandate becomes a one-time card credential, the credential pays
// the merchant. That is the real rail and it is the default.
//
// A physical restaurant bill has no such merchant. The honest response is not
// to invent one — a receipt claiming a card charge that never happened is the
// single worst thing this system could produce. So there is a second rail that
// does everything except move money: exact itemised allocation, explicit
// per-person acceptance recorded before the card machine arrives, and a signed
// record of who owed what. Each person then pays the venue on their own card,
// which every card terminal on earth already supports.
//
// The rail is carried in the receipt and rendered on every surface. The verb
// changes with it: `charged` on the mandate rail, `accepted` and `settled at
// venue` on the other. Neither surface is ever allowed to borrow the other's
// language.
// ---------------------------------------------------------------------------

export const RailSchema = z.enum(['prava_mandates', 'at_venue'])
export type Rail = z.infer<typeof RailSchema>

export interface RailCapability {
  rail: Rail
  label: string
  /** Does the engine move money on this rail? */
  charges: boolean
  /** Does a member's approval mint a Prava mandate on their own card? */
  mandates: boolean
  /** Requires a merchant Prava can charge. */
  needs_merchant: boolean
  /** The verb every surface must use for a settled member on this rail. */
  settled_verb: string
  /** One sentence, shown to members before they accept. Judges read this too. */
  disclosure: string
}

export const RAILS: Record<Rail, RailCapability> = {
  prava_mandates: {
    rail: 'prava_mandates',
    label: 'Card mandates',
    charges: true,
    mandates: true,
    needs_merchant: true,
    settled_verb: 'charged',
    disclosure:
      'Your card is charged directly by the merchant, up to the cap you approve and no further. ' +
      'The cap is enforced by the card network, not by this app. Nobody fronts money and no funds are pooled.',
  },
  at_venue: {
    rail: 'at_venue',
    label: 'Settled at the venue',
    charges: false,
    mandates: false,
    needs_merchant: false,
    settled_verb: 'settled at the venue',
    disclosure:
      'No card is charged through sutra on this split. Everyone agrees their exact amount here, ' +
      'then pays the venue directly on their own card. What you get is the arithmetic, the agreement, ' +
      'and a signed record of who owed what — not a payment.',
  },
}

/**
 * Which rail can carry this purchase. The presence of a real, reachable
 * merchant is the whole question; everything else follows from it.
 */
export function railFor(opts: { merchantUrl?: string | null; requested?: Rail }): Rail {
  if (opts.requested) return opts.requested
  const url = opts.merchantUrl?.trim()
  if (!url) return 'at_venue'
  try {
    const host = new URL(url).hostname
    // The placeholder the schema defaults to is not a merchant.
    if (!host || host.endsWith('.test') || host === 'localhost') return 'at_venue'
    return 'prava_mandates'
  } catch {
    return 'at_venue'
  }
}

export function capabilityOf(rail: string): RailCapability {
  return RAILS[(rail as Rail) in RAILS ? (rail as Rail) : 'prava_mandates']
}
