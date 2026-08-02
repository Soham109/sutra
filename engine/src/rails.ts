import { z } from 'zod'

// ---------------------------------------------------------------------------
// Settlement rails.
//
// A merchant URL proves where an item came from; it does not prove payment
// capability. Charging is therefore an explicit trusted-server choice. Every
// other merchant flow names its real boundary: cashier-operated Shopify POS,
// ordinary checkout handoff, or direct settlement at a venue.
//
// The rail is carried in the receipt and rendered on every surface. Only
// `prava_mandates` may use `charged`; the other rails record exact agreement
// and the next merchant-owned action. A receipt claiming money moved on a
// non-charging rail is rejected by the verifier.
// ---------------------------------------------------------------------------

export const RailSchema = z.enum([
  'prava_mandates',
  'shopify_pos',
  'checkout_handoff',
  'at_venue',
])
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
  shopify_pos: {
    rail: 'shopify_pos',
    label: 'Shopify POS split tender',
    charges: false,
    mandates: false,
    needs_merchant: true,
    settled_verb: 'ready for Shopify POS',
    disclosure:
      'No card is charged through sutra. Everyone confirms their exact share here, then the cashier uses ' +
      'Shopify POS split payment and charges each person directly. This receipt proves the agreement, not the POS payment.',
  },
  checkout_handoff: {
    rail: 'checkout_handoff',
    label: 'Merchant checkout handoff',
    charges: false,
    mandates: false,
    needs_merchant: true,
    settled_verb: 'approved for checkout',
    disclosure:
      'No card is charged and no merchant order is placed through sutra. Everyone confirms the proposed split, ' +
      'then the group returns to the merchant checkout. A one-card checkout still needs a merchant adapter before ' +
      'several people can pay one order without somebody fronting it.',
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
    // A valid merchant URL proves where a product came from. It does not prove
    // that merchant installed a Sutra/Prava adapter. Charging is therefore
    // opt-in from trusted server-side capability data; generic URLs stop at
    // merchant checkout.
    return 'checkout_handoff'
  } catch {
    return 'at_venue'
  }
}

export function capabilityOf(rail: string): RailCapability {
  return RAILS[(rail as Rail) in RAILS ? (rail as Rail) : 'checkout_handoff']
}
