// Cheapest-across-stores.
//
// The easy half is fetching prices; the catalog already federates that. The
// half that decides whether this feature is honest or embarrassing is: are
// these two listings the SAME THING? Calling a 250g bag cheaper than a 1kg bag
// is not a saving, it is a lie with a number attached, and a group about to
// split money on the strength of it deserves better.
//
// So this module refuses to say "cheapest" unless it can say why:
//
//   1. Two offers are only comparable if they normalise to the same product —
//      measured on rare words, not common ones. "Merino Wool Runner" matching
//      "Wool Runner Merino" is signal; both containing "the" is not.
//   2. Where a size is stated, comparison is per unit — per 100g, per litre,
//      per item in a pack. A cheaper sticker on a smaller bag loses.
//   3. Currencies are never mixed silently. Offers in different currencies are
//      reported side by side and explicitly NOT ranked against each other.
//   4. Every group carries its own confidence and its own caveats, and the UI
//      is expected to print them. A `loose` match is shown as "these look
//      similar", never as "you are overpaying".

import type { Product } from './types.js'

export type MatchConfidence = 'exact' | 'likely' | 'loose'
export type Basis = 'unit' | 'sticker'

export interface Offer {
  product: Product
  /** price per base unit (per gram / per ml / per item), when a size was read */
  unit_price_minor: number | null
  size: Size | null
  /** how much more this costs than the cheapest comparable offer, in minor units */
  premium_minor: number | null
}

export interface OfferGroup {
  /** the normalised name these offers agree on, for display */
  title: string
  offers: Offer[]
  /** cheapest first, and only ever within one currency */
  currency: string
  best: Offer
  /** what the ranking actually compared */
  basis: Basis
  confidence: MatchConfidence
  /** biggest gap in the group, minor units — 0 when there is nothing to save */
  spread_minor: number
  /** everything a person should read before trusting the number */
  caveats: string[]
}

export interface CompareResult {
  groups: OfferGroup[]
  /** offers that matched nothing else; shown, never silently dropped */
  ungrouped: Product[]
  /** currencies present, so the UI can say why some things were not ranked */
  currencies: string[]
}

// -- size parsing -----------------------------------------------------------

export interface Size {
  /** normalised to grams, millilitres, or a bare count */
  base: number
  dimension: 'mass' | 'volume' | 'count'
  /** what the merchant actually wrote, for display */
  label: string
}

const MASS: Record<string, number> = { mg: 0.001, g: 1, gm: 1, gram: 1, grams: 1, kg: 1000, kilo: 1000, kgs: 1000, lb: 453.592, lbs: 453.592, oz: 28.3495 }
const VOLUME: Record<string, number> = { ml: 1, millilitre: 1, milliliter: 1, cl: 10, l: 1000, litre: 1000, liter: 1000, ltr: 1000 }

/**
 * Read a size out of a product title. Deliberately conservative: an
 * unrecognised or ambiguous title returns null and the group falls back to
 * sticker price with a caveat, which is honest. Guessing here would silently
 * corrupt every comparison downstream.
 */
export function extractSize(title: string): Size | null {
  const t = title.toLowerCase()

  // "12 x 330ml", "6-pack", "pack of 4" — multipacks first, since they also
  // contain a unit size and the total is what matters.
  const multi = /(\d+)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(ml|l|litre|liter|ltr|g|gm|kg|mg|oz|lb|lbs)\b/.exec(t)
  if (multi) {
    const count = Number(multi[1])
    const each = Number(multi[2])
    const unit = multi[3]!
    const mass = MASS[unit]
    const vol = VOLUME[unit]
    if (mass) return { base: count * each * mass, dimension: 'mass', label: `${count} × ${each}${unit}` }
    if (vol) return { base: count * each * vol, dimension: 'volume', label: `${count} × ${each}${unit}` }
  }

  // Both orders occur in the wild: "6-pack" and "pack of 6".
  const packAfter = /(?:^|\s)(\d+)[\s-]*(?:pack|pk|count|ct|pcs|pieces)\b/.exec(t)
  const packBefore = /\b(?:pack|set|box|case) of (\d+)\b/.exec(t)
  const packN = packAfter?.[1] ?? packBefore?.[1]
  if (packN) return { base: Number(packN), dimension: 'count', label: `${packN}-pack` }

  const single = /(\d+(?:\.\d+)?)\s*(ml|l|litre|liter|ltr|kg|kilo|g|gm|gram|grams|mg|oz|lbs?)\b/.exec(t)
  if (single) {
    const n = Number(single[1])
    const unit = single[2]!
    // A bare "1 l" or "2 g" on a garment title is far more likely to be noise
    // than a size. Require a plausible magnitude.
    const mass = MASS[unit]
    if (mass) {
      const grams = n * mass
      return grams >= 1 ? { base: grams, dimension: 'mass', label: `${n}${unit}` } : null
    }
    const vol = VOLUME[unit]
    if (vol) return { base: n * vol, dimension: 'volume', label: `${n}${unit}` }
  }
  return null
}

// -- title matching ---------------------------------------------------------

/** Words that carry no identifying signal and would inflate every score. */
const NOISE = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'to', 'by', 'on',
  'new', 'sale', 'best', 'buy', 'shop', 'official', 'free', 'shipping', 'off',
  'size', 'color', 'colour', 'pack', 'set', 'edition', 'original', 'premium',
])

export function tokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+(\.\d+)?$/.test(w))
}

/**
 * Similarity weighted so that words appearing in every candidate count for
 * almost nothing and rare words count for a lot. Without this, searching
 * "running shoes" makes every shoe on every store look like the same product,
 * because they all contain both words.
 */
export function weightedSimilarity(a: string[], b: string[], df: Map<string, number>, total: number): number {
  const setA = new Set(a)
  const setB = new Set(b)
  if (!setA.size || !setB.size) return 0
  const idf = (w: string) => Math.log((total + 1) / ((df.get(w) ?? 0) + 1)) + 1

  let shared = 0
  let union = 0
  for (const w of new Set([...setA, ...setB])) {
    const weight = idf(w)
    union += weight
    if (setA.has(w) && setB.has(w)) shared += weight
  }
  return union === 0 ? 0 : shared / union
}

function confidenceFor(score: number, sameBrand: boolean): MatchConfidence | null {
  if (score >= 0.82 || (score >= 0.7 && sameBrand)) return 'exact'
  if (score >= 0.55) return 'likely'
  if (score >= 0.38) return 'loose'
  return null
}

const RANK: Record<MatchConfidence, number> = { exact: 3, likely: 2, loose: 1 }

// -- grouping ---------------------------------------------------------------

/**
 * Cluster a flat list of products into comparable offers.
 *
 * Greedy single-link clustering against each cluster's seed. Not the most
 * sophisticated approach available, but it is explainable — every member of a
 * group scored against one named product — and explainability is worth more
 * here than a marginal accuracy gain nobody can audit.
 */
export function compareOffers(products: Product[], opts: { minGroup?: number } = {}): CompareResult {
  const minGroup = opts.minGroup ?? 2
  const usable = products.filter((p) => p.price.amount_minor > 0)

  // Document frequency across the candidate set, for the IDF weighting.
  const df = new Map<string, number>()
  const toks = new Map<string, string[]>()
  for (const p of usable) {
    const t = tokens(p.title)
    toks.set(p.id, t)
    for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1)
  }

  type Cluster = { seed: Product; members: Product[]; confidence: MatchConfidence }
  const clusters: Cluster[] = []

  for (const p of usable) {
    let bestCluster: Cluster | null = null
    let bestConf: MatchConfidence | null = null
    let bestScore = 0

    for (const c of clusters) {
      // Only ever compare like currency with like — a cluster that mixes them
      // could not be ranked anyway.
      if (c.seed.price.currency !== p.price.currency) continue
      const score = weightedSimilarity(toks.get(c.seed.id) ?? [], toks.get(p.id) ?? [], df, usable.length)
      const sameBrand = !!p.brand && !!c.seed.brand && p.brand.toLowerCase() === c.seed.brand.toLowerCase()
      const conf = confidenceFor(score, sameBrand)
      if (conf && score > bestScore) {
        bestScore = score
        bestCluster = c
        bestConf = conf
      }
    }

    if (bestCluster && bestConf) {
      bestCluster.members.push(p)
      // A cluster is only as trustworthy as its weakest link.
      if (RANK[bestConf] < RANK[bestCluster.confidence]) bestCluster.confidence = bestConf
    } else {
      clusters.push({ seed: p, members: [p], confidence: 'exact' })
    }
  }

  const groups: OfferGroup[] = []
  const ungrouped: Product[] = []

  for (const c of clusters) {
    if (c.members.length < minGroup) {
      ungrouped.push(...c.members)
      continue
    }
    groups.push(buildGroup(c.seed, c.members, c.confidence))
  }

  // Biggest genuine saving first — that is the question being asked.
  groups.sort((a, b) => b.spread_minor - a.spread_minor)

  return {
    groups,
    ungrouped,
    currencies: [...new Set(usable.map((p) => p.price.currency))].sort(),
  }
}

function buildGroup(seed: Product, members: Product[], confidence: MatchConfidence): OfferGroup {
  const caveats: string[] = []
  const sizes = members.map((p) => extractSize(p.title))
  const dims = new Set(sizes.filter(Boolean).map((s) => s!.dimension))

  // Per-unit comparison is only meaningful when EVERY offer states a size and
  // they are all measuring the same kind of thing. One missing size and the
  // comparison silently becomes sticker-vs-unit, which is the exact error this
  // module exists to prevent.
  const everySized = sizes.every(Boolean)
  const basis: Basis = everySized && dims.size === 1 ? 'unit' : 'sticker'

  if (!everySized && sizes.some(Boolean)) {
    caveats.push('Some listings state a size and others do not, so these are compared on sticker price, not per unit.')
  } else if (dims.size > 1) {
    caveats.push('These listings measure size differently, so they are compared on sticker price.')
  }

  const offers: Offer[] = members.map((product, i) => {
    const size = sizes[i] ?? null
    const unit = size && size.base > 0 ? product.price.amount_minor / size.base : null
    return { product, size, unit_price_minor: unit, premium_minor: null }
  })

  const key = (o: Offer) =>
    basis === 'unit' && o.unit_price_minor !== null ? o.unit_price_minor : o.product.price.amount_minor
  offers.sort((a, b) => key(a) - key(b))

  const best = offers[0]!
  for (const o of offers) {
    o.premium_minor = o.product.price.amount_minor - best.product.price.amount_minor
  }

  const dearest = offers[offers.length - 1]!
  const spread = dearest.product.price.amount_minor - best.product.price.amount_minor

  if (confidence === 'loose') {
    caveats.push('These only loosely resemble each other. Check they are the same thing before trusting the saving.')
  } else if (confidence === 'likely') {
    caveats.push('Matched on title, not on a shared product code. Worth a glance before committing.')
  }
  if (members.some((p) => !p.in_stock)) {
    caveats.push('At least one of these is out of stock at the moment.')
  }
  if (basis === 'unit') {
    caveats.push(`Ranked per ${dims.has('count') ? 'item' : dims.has('mass') ? 'gram' : 'millilitre'}, not by the price on the label.`)
  }

  return {
    title: seed.title,
    offers,
    currency: seed.price.currency,
    best,
    basis,
    confidence,
    spread_minor: spread,
    caveats,
  }
}
