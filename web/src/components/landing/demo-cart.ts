/**
 * The one worked example the whole landing page tells.
 *
 * The hero, the replay and the before/after diagrams all read from here, so a
 * visitor scrolling the page sees one continuous story with one set of numbers
 * — and the page cannot drift into showing two currencies or two carts again.
 *
 * Amounts are whole rupees. They are presentational only; the engine itself
 * works in integer minor units (see `money()` in lib/format).
 */

export const CART = {
  title: 'Dune: Messiah',
  detail: '4 seats · IMAX · PVR Phoenix',
  merchant: 'PVR Phoenix',
  when: 'Friday at 8:40',
  total: 3240,
  /** Each person's own share of the booking. */
  share: 810,
  /** What Ada's card reads once she absorbs Cleo's share. */
  covered: 1620,
  /** The most Ada offered to cover, agreed before anyone approved. */
  coverCap: 900,
}

export interface CastMember {
  name: string
  first: string
  color: string
}

// Deliberately off the ok/bad hues: green and red carry state on this page.
export const CAST: CastMember[] = [
  { name: 'Ada Okonkwo', first: 'Ada', color: '#2E2AD8' },
  { name: 'Ben Farrow', first: 'Ben', color: '#0F6C8C' },
  { name: 'Cleo Marsh', first: 'Cleo', color: '#7A2E8E' },
  { name: 'Dev Raman', first: 'Dev', color: '#8A6D0B' },
]

/** Whole rupees, Indian digit grouping — the format the hero card uses. */
export function inr(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`
}
