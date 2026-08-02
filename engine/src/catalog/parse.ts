import type { Money } from './types.js'

// Generic structured-data parsers. No merchant-specific code lives here: these
// read the same markup that Google Shopping, Facebook and Pinterest consume,
// which is why they work across marketplaces nobody wrote an adapter for.

// Currencies whose minor unit is not 1/100.
const EXPONENT: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, IDR: 0, HUF: 0, TWD: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
}

const SYMBOL_CURRENCY: Record<string, string> = {
  '$': 'USD', '₹': 'INR', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW',
  'A$': 'AUD', 'C$': 'CAD', 'S$': 'SGD', 'HK$': 'HKD', '₺': 'TRY', 'R$': 'BRL',
  '₫': 'VND', '฿': 'THB', '₱': 'PHP', 'RM': 'MYR', '₪': 'ILS', 'د.إ': 'AED',
}

export function minorUnits(currency: string): number {
  return 10 ** (EXPONENT[currency.toUpperCase()] ?? 2)
}

/**
 * Parse a price that a merchant published in any of the shapes seen in the
 * wild: 45, "45.00", "$1,234.56", "1.234,56 €", "USD 45", "₹1,299".
 * Returns null rather than guessing when the string carries no number.
 */
export function parseMoney(raw: unknown, fallbackCurrency = 'USD'): Money | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return toMinor(raw, fallbackCurrency)
  }
  const s = String(raw).trim()
  if (!s) return null

  let currency = fallbackCurrency
  const iso = /\b([A-Z]{3})\b/.exec(s)
  if (iso && EXPONENT[iso[1]!] !== undefined) currency = iso[1]!
  else if (iso && /^(USD|EUR|GBP|INR|CAD|AUD|SGD|AED|CHF|SEK|NOK|DKK|PLN|MXN|BRL|ZAR|NZD|CNY|HKD|THB|PHP|MYR|SAR|QAR|NGN|KES|PKR|BDT|LKR|NPR|CZK|ILS)$/.test(iso[1]!)) {
    currency = iso[1]!
  } else {
    for (const [sym, code] of Object.entries(SYMBOL_CURRENCY)) {
      if (s.includes(sym)) { currency = code; break }
    }
  }

  // Strip everything except digits and separators, then work out which
  // separator is the decimal mark.
  const numeric = s.replace(/[^\d.,\-]/g, '')
  if (!/\d/.test(numeric)) return null
  return toMinor(disambiguateSeparators(numeric, currency), currency)
}

/**
 * A thousands separator is grammatically forced to group digits in 3s —
 * "1,234", "1.234.567" — there is no other valid width. So the LAST
 * separator is a decimal point whenever what follows it is not exactly 3
 * digits, no matter how many digits that is: this is what a currency's own
 * precision (2, 3, or 0) is for. Getting this wrong is not cosmetic —
 * a real Magento feed publishes JSON-LD prices zero-padded to six places
 * ("21.710000" for $21.71); reading that trailing run as a thousands group
 * priced the item at $217,100,000.00. And a three-decimal currency (KWD,
 * BHD, OMR, JOD, TND) writing its native "12.345" must not be mistaken for
 * "12345" just because the tail happens to be 3 digits — the old fixed
 * "1 or 2 digits means decimal" cutoff got that one wrong in the other
 * direction. The only genuinely ambiguous shape is a lone separator
 * followed by exactly 3 digits on a currency that does NOT use 3-decimal
 * minor units — "$1,234" — and that stays thousands, as it always has.
 */
function disambiguateSeparators(numeric: string, currency: string): number {
  const lastDot = numeric.lastIndexOf('.')
  const lastComma = numeric.lastIndexOf(',')
  if (lastDot === -1 && lastComma === -1) return Number(numeric)

  const decIdx = Math.max(lastDot, lastComma)
  const decimals = numeric.length - decIdx - 1
  const currencyDecimals = EXPONENT[currency.toUpperCase()] ?? 2
  const isThousandsGroup = decimals === 3 && currencyDecimals !== 3

  const normalized = isThousandsGroup
    ? numeric.replace(/[.,]/g, '')
    : numeric.slice(0, decIdx).replace(/[.,]/g, '') + '.' + numeric.slice(decIdx + 1)
  return Number(normalized)
}

/**
 * Parse a price from a STRUCTURED field: a JSON-LD Offer.price, a microdata
 * content="" attribute, an OpenGraph product:price:amount tag. These are
 * machine-generated, not prose — schema.org and Open Graph both spec them as
 * plain decimal literals (optional '-', digits, optional single '.', digits),
 * never a locale-formatted thousands separator or comma decimal. Running one
 * through parseMoney's "guess which separator is the decimal" heuristic is
 * unnecessary at best; at worst a merchant's own well-formed number gets
 * misread the way a scraped fragment of prose might. When the value does not
 * actually match that clean shape — some feeds still emit "1,234.00" —
 * this falls back to the tolerant parser rather than refuse a real price.
 */
export function parseStructuredMoney(raw: unknown, fallbackCurrency = 'USD'): Money | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? toMinor(raw, fallbackCurrency) : null
  const s = String(raw).trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) return parseMoney(s, fallbackCurrency)
  return toMinor(Number(s), fallbackCurrency)
}

/**
 * schema.org AggregateOffer collapses a whole size/variant run into
 * lowPrice/highPrice, sometimes with no per-variant offers underneath at
 * all. When low === high there is really only one price, and returning it is
 * exactly as safe as a plain Offer. When it is a genuine range, presenting
 * either end as "the" price is a guess dressed as a fact: a group can be
 * quoted $99.99 for something that costs up to $199.99. This function only
 * tells the caller which situation it is in — deciding whether a "from"
 * price is honest enough to show, or whether to refuse, is a product
 * decision for whoever is assembling the cart line, not this file.
 */
export function aggregateOfferRange(
  low: unknown,
  high: unknown,
  currency: string,
): { kind: 'single'; price: Money } | { kind: 'range'; low: Money; high: Money } | { kind: 'unpriced' } {
  const lo = parseStructuredMoney(low, currency)
  const hi = parseStructuredMoney(high, currency)
  if (lo && hi) {
    return lo.amount_minor === hi.amount_minor ? { kind: 'single', price: lo } : { kind: 'range', low: lo, high: hi }
  }
  const only = lo ?? hi
  return only ? { kind: 'single', price: only } : { kind: 'unpriced' }
}

/**
 * A real price is never zero or negative. Zero is what falls out of a
 * heuristic that found a heading and no number; a negative is a "you saved
 * $5" fragment mis-read as the price itself. Refusing here — at the source,
 * not just in whoever calls this — costs one honest null; accepting either
 * puts a fabricated number in front of a group about to split a bill.
 */
function toMinor(value: number, currency: string): Money | null {
  const c = currency.toUpperCase()
  const amount_minor = Math.round(value * minorUnits(c))
  return amount_minor > 0 ? { amount_minor, currency: c } : null
}

export function formatMinor(m: Money): string {
  const div = minorUnits(m.currency)
  return (m.amount_minor / div).toFixed(EXPONENT[m.currency] ?? 2)
}

// ---------------------------------------------------------------------------
// HTML extraction — regex-based on purpose: no DOM dependency, tolerant of the
// malformed markup real storefronts ship, and immune to script execution.
// ---------------------------------------------------------------------------

export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? '').trim().replace(/^<!--/, '').replace(/-->$/, '')
    try {
      out.push(JSON.parse(raw))
    } catch {
      // Some stores emit several concatenated objects or trailing commas.
      const salvaged = raw.replace(/,\s*([}\]])/g, '$1')
      try {
        out.push(JSON.parse(salvaged))
      } catch {
        /* unparseable block — skip it, other strategies may still win */
      }
    }
  }
  return out
}

/** Walk JSON-LD (arrays, @graph, nested) collecting nodes of the given types. */
export function collectNodes(value: unknown, types: string[], acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, types, acc)
    return acc
  }
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    const t = node['@type']
    const typeList = Array.isArray(t) ? t.map(String) : t ? [String(t)] : []
    if (typeList.some((x) => types.includes(x))) acc.push(node)
    for (const key of ['@graph', 'mainEntity', 'itemListElement', 'hasVariant', 'isSimilarTo']) {
      if (node[key]) collectNodes(node[key], types, acc)
    }
  }
  return acc
}

export function metaContent(html: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${esc}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${esc}["']`, 'i'),
    ]
    for (const p of patterns) {
      const m = p.exec(html)
      if (m?.[1]) return decodeEntities(m[1].trim())
    }
  }
  return undefined
}

export function microdata(html: string, prop: string): string | undefined {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const contentAttr = new RegExp(`itemprop=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
  if (contentAttr?.[1]) return decodeEntities(contentAttr[1].trim())
  const inner = new RegExp(`itemprop=["']${esc}["'][^>]*>([^<]{1,120})<`, 'i').exec(html)
  if (inner?.[1]?.trim()) return decodeEntities(inner[1].trim())
  return undefined
}

export function titleTag(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html)
  return m?.[1] ? decodeEntities(m[1].trim().replace(/\s+/g, ' ')) : undefined
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
}

export function stripTags(s: string, max = 600): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max)
}

export function absoluteUrl(candidate: string | undefined, base: string): string | undefined {
  if (!candidate) return undefined
  try {
    return new URL(candidate, base).toString()
  } catch {
    return undefined
  }
}

/**
 * Whether the merchant said anything about stock at all.
 *
 * `parseAvailability` has to return a boolean because a cart line needs one,
 * and it defaults an absent field to "available" — which is the only workable
 * default but is still a guess. This lets the UI distinguish "the merchant
 * says it is in stock" from "the merchant said nothing and we assumed", so a
 * group is never shown an inferred fact as a stated one.
 */
export function availabilityStated(raw: unknown): boolean {
  return raw !== undefined && raw !== null && String(raw).trim() !== ''
}

/** schema.org availability → boolean, tolerant of the many spellings used. */
export function parseAvailability(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  const s = String(raw).toLowerCase()
  if (s.includes('outofstock') || s.includes('soldout') || s.includes('discontinued')) return false
  if (s === 'false') return false
  return true
}
