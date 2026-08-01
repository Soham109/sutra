import { minorUnits, parseMoney } from '../catalog/parse.js'

// Receipt text → an itemised, allocatable bill.
//
// Deterministic on purpose. This is the "split anything, anywhere" path: it has
// to work at a restaurant table with no signal and no API key, so no model is
// in the loop. The rules below are the whole parser. The optional vision layer
// in ./index.ts only turns pixels into text and then feeds this same code.
//
// The load-bearing promise is reconciliation, not extraction. Every input line
// lands in exactly one bucket — item, fee, subtotal, total, or unparsed_lines —
// and the arithmetic is checked against what the bill actually printed. A
// parser that silently drops a line and still shows a confident total is worse
// than no parser at all when the output allocates real money. So: nothing is
// ever invented to force a match, and a mismatch is said out loud.

export type FeeKind = 'tax' | 'service' | 'tip' | 'delivery' | 'discount' | 'other'

export interface ParsedItem {
  name: string
  qty: number
  /** minor units; unit_amount * qty === line_amount whenever the line divides evenly */
  unit_amount: number
  /** minor units, exactly as the bill charged for this line */
  line_amount: number
  /** 0..1 — how sure we are this line is an item and not junk that looked like one */
  confidence: number
  source_line: string
}

export interface ParsedFee {
  name: string
  /** minor units; NEGATIVE for discounts */
  amount: number
  kind: FeeKind
}

export interface Reconciliation {
  items_sum: number
  fees_sum: number
  computed_total: number
  printed_total: number | null
  /** computed - printed, minor units */
  delta: number
  balanced: boolean
  note: string
}

export interface ParsedBill {
  items: ParsedItem[]
  fees: ParsedFee[]
  currency: string
  /** as printed, if found */
  subtotal: number | null
  /** as printed, if found */
  total: number | null
  reconciliation: Reconciliation
  warnings: string[]
  /** every line we chose to ignore, so nothing is silently lost */
  unparsed_lines: string[]
}

export interface ParseBillTextOpts {
  /** ISO 4217 override; otherwise inferred from the symbols on the bill */
  currency?: string
  /** how far computed may drift from printed and still count as balanced.
   *  Default 1 minor unit: tax lines are routinely printed half-rounded. */
  tolerance_minor?: number
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

// Ordered by specificity: S$/C$/A$ must be seen before a bare $.
const CURRENCY_HINTS: [RegExp, string][] = [
  [/S\$|\bSGD\b/g, 'SGD'],
  [/C\$|\bCAD\b/g, 'CAD'],
  [/A\$|\bAUD\b/g, 'AUD'],
  [/HK\$|\bHKD\b/g, 'HKD'],
  [/R\$|\bBRL\b/g, 'BRL'],
  [/₹|\bRs\.?(?=\s|\d|$)|\bINR\b/gi, 'INR'],
  [/£|\bGBP\b/g, 'GBP'],
  [/€|\bEUR\b/g, 'EUR'],
  [/¥|\bJPY\b/g, 'JPY'],
  [/₩|\bKRW\b/g, 'KRW'],
  [/د\.إ|\bAED\b/g, 'AED'],
  [/\$|\bUSD\b/g, 'USD'],
]

/** Symbols/codes that may sit next to a number. Kept in one place so the token
 *  scanner and the name cleaner agree on what is decoration and what is text.
 *  Alphabetic codes need the word boundary or "Covers" ends in a rupee mark. */
const SYM_GLYPH = 'S\\$|C\\$|A\\$|HK\\$|R\\$|₹|£|€|¥|₩|\\$|د\\.إ'
const SYM_CODE = 'Rs\\.?|INR|USD|GBP|EUR|AED|SGD|CAD|AUD|JPY|KRW'
const SYMBOL_SRC = `(?:${SYM_GLYPH}|\\b(?:${SYM_CODE}))`
const SYM_BEFORE = new RegExp(`(?:${SYMBOL_SRC})\\s*[-–—]?\\s*$`, 'i')
const SYM_AFTER = new RegExp(`^\\s*(?:${SYMBOL_SRC})`, 'i')
const SYM_TRAILING = new RegExp(`[\\s]*(?:${SYMBOL_SRC})[\\s.:-]*$`, 'i')

function detectCurrency(text: string): { currency: string; mixed: string[] } {
  // Count each candidate, longest symbols first, blanking what we consume so a
  // "S$" is never also counted as a "$".
  let probe = text
  const counts: [string, number][] = []
  for (const [re, code] of CURRENCY_HINTS) {
    const matches = probe.match(re)
    if (matches?.length) {
      counts.push([code, matches.length])
      probe = probe.replace(re, ' ')
    }
  }
  if (counts.length === 0) return { currency: 'USD', mixed: [] }
  counts.sort((a, b) => b[1] - a[1])
  return { currency: counts[0]![0], mixed: counts.map((c) => c[0]) }
}

// ---------------------------------------------------------------------------
// Money tokens
// ---------------------------------------------------------------------------

interface Tok {
  start: number
  end: number
  /** digits and separators only, e.g. "1.234,56" */
  core: string
  minor: number
  negative: boolean
  hasSymbol: boolean
  /** symbol currency if it disagreed with the bill currency */
  foreign: string | null
  hasDecimals: boolean
  /** a rate ("12.5%"), never an amount */
  percent: boolean
  /** whitespace run immediately before the number — column alignment is signal */
  gap: number
}

const NUM_RE = /\d[\d.,]*\d|\d/g

/** Every number on the line, annotated with the context that tells us whether
 *  it is money, a rate, a quantity or part of a postcode. */
function moneyTokens(line: string, currency: string): Tok[] {
  const out: Tok[] = []
  NUM_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NUM_RE.exec(line))) {
    const core = m[0]
    const start = m.index
    const end = start + core.length
    const before = line.slice(0, start)
    const after = line.slice(end)

    // Dates, times and phone runs: a digit joined to another digit group by
    // : / or - is never a price.
    if (/[\d]\s*[:/]\s*$/.test(before) || /^\s*[:/]\s*\d/.test(after)) continue
    if (/\d-$/.test(before) || /^-\d/.test(after)) continue

    const percent = /^\s*%/.test(after)
    const symBefore = SYM_BEFORE.test(before)
    const symAfter = SYM_AFTER.test(after)
    const money = parseMoney(core, currency)
    if (!money) continue

    let foreign: string | null = null
    if (symBefore || symAfter) {
      const raw = symBefore ? SYM_BEFORE.exec(before)?.[0] : SYM_AFTER.exec(after)?.[0]
      const probe = parseMoney(`${(raw ?? '').trim()}1`, currency)
      if (probe && probe.currency !== currency) foreign = probe.currency
    }

    // Negative: "-12.00", "₹ -12.00", "12.00-" (POS trailing minus), "(12.00)".
    const negative =
      /(?:^|[\s(])[-–—]\s*(?:S\$|C\$|A\$|HK\$|R\$|₹|£|€|¥|₩|\$|Rs\.?)?\s*$/i.test(before) ||
      new RegExp(`(?:${SYMBOL_SRC})\\s*[-–—]\\s*$`, 'i').test(before) ||
      /^\s*[-–—](?!\d)/.test(after) ||
      (/\(\s*(?:S\$|C\$|A\$|₹|£|€|¥|\$|Rs\.?)?\s*$/i.test(before) && /^\s*\)/.test(after))

    const gapMatch = /\s+$/.exec(before)
    out.push({
      start,
      end,
      core,
      minor: money.amount_minor,
      negative,
      hasSymbol: symBefore || symAfter,
      foreign,
      hasDecimals: /[.,]\d{1,2}$/.test(core),
      percent,
      gap: gapMatch ? gapMatch[0].length : 0,
    })
  }
  return out
}

/** What may follow the amount and still leave it looking like the end of a
 *  line: padding, a currency mark, a POS trailing minus, a single tax-class
 *  flag ("5.25 T"). */
const TRIVIAL_TAIL = new RegExp(`^[\\s*+\\-–—]*(?:${SYMBOL_SRC})?[\\s*+\\-–—]*[A-Za-z]?[\\s*+.\\-–—]*$`, 'i')

/** Street words veto the weakest amount shape (single space, no symbol, no
 *  decimals) so "14 MG Road, Bengaluru 560001" never becomes a ₹5,600.01 item. */
const ADDRESS_RE =
  /\b(road|rd|street|st|lane|ln|nagar|marg|avenue|ave|blvd|boulevard|sector|block|floor|opp|near|behind|suite|apt|pin|pincode|zip|po\s*box|highway|colony|cross|main)\b/i

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/** Identity, contact, tender and header lines. Everything here is discarded to
 *  unparsed_lines — recorded, never counted. */
const JUNK_RE: RegExp[] = [
  /^\s*[-=*_~.#]{3,}\s*$/,
  /\b(gstin|gst\s*(?:no|reg)|vat\s*(?:no|reg)|tin|pan\s*no|fssai|cin|ust-?idnr|tax\s*id|ein|abn)\b/i,
  /\b(tel|phone|ph|mob|mobile|fax|email|e-mail|contact)\b\s*[:.]/i,
  /\(\d{3}\)\s*\d{3}[-\s]?\d{4}|\b\d{3}-\d{4}\b|\+\d[\d\s-]{8,}/,
  /(?:www\.|https?:\/\/|[a-z0-9._%-]+@[a-z0-9-]+\.[a-z]{2,})/i,
  /\b(thank\s*you|thanks|visit\s*again|come\s*again|welcome\s*to|have\s*a\s*(?:nice|great|good)|see\s*you|enjoy\s*your)\b/i,
  // Note: no bare "gst" here — "GST 45" is a charge, and GSTIN/GST No are
  // already caught above.
  /^\s*(?:bill|invoice|order|receipt|check|chk|token|table|tbl|kot|counter|cashier|server|steward|waiter|covers?|pax|guests?|terminal|till|store|branch|date|time|dine[\s-]?in|take[\s-]?away|delivery\s*address|address|customer)\b\s*(?:no\.?|#|:)?\s*[-#]?\s*[\w/-]*\s*$/i,
  // "Table 12        Covers 4", "POS TERMINAL 4" — service metadata that reads
  // as a priced line.
  /^\s*(?:table|tbl|counter|terminal|till|token|kot|covers?|pax|guests?|seats?)\b\s*[:#]?\s*\d/i,
  /\b(?:table|tbl|counter|terminal|till|token|kot|covers?|pax|guests?|persons?|seats?)\b\s*(?:no\.?|#|:)?\s*\d{1,4}\s*$/i,
  /\b(?:bill|invoice|order|receipt|check|token|table|tbl|kot|counter|cashier|server|steward|waiter|covers?|pax|guests?|date|time|customer)\s*(?:no\.?|#|:)/i,
  /^\s*(?:cash|card|visa|mastercard|master\s*card|amex|debit|credit|upi|paytm|gpay|phonepe|razorpay|swipe|tendered|cash\s*tendered|change|payment\s*mode|paid\s*(?:by|via)|auth\s*code|approval)\b/i,
  /\b(?:total\s*(?:qty|quantity|items?|nos?|covers|savings?|discounts?)|no\.?\s*of\s*(?:items?|persons?|covers)|item\s*count|qty\s*total)\b/i,
  /\b(?:e\s*&\s*o\s*e|terms\s*(?:and|&)\s*conditions|prices?\s+(?:are\s+)?incl|save\s*the\s*earth|scan\s*(?:the|to)|follow\s*us|feedback|rate\s*us|survey|wi-?fi|password|gift\s*card\s*balance)\b/i,
]

type Role = 'subtotal' | 'total' | FeeKind

const CHARGE_RULES: { re: RegExp; role: Role }[] = [
  // Subtotal spellings first — "Item Total" is a subtotal, not the total.
  { re: /\b(?:sub[\s-]*total|subtotal|items?[\s-]*total|food[\s-]*total|goods[\s-]*total|gross[\s-]*amount|zwischensumme)\b/i, role: 'subtotal' },
  { re: /\b(?:grand[\s-]*total|total[\s-]*(?:amount|payable|due|bill|inc(?:l)?\.?)?|net[\s-]*(?:payable|total|amount)|amount[\s-]*(?:payable|due)|balance[\s-]*due|bill[\s-]*total|to[\s-]*pay|you[\s-]*pay)\b/i, role: 'total' },
  { re: /\b(?:c\s?gst|s\s?gst|i\s?gst|ut\s?gst|gst|vat(?!\s*(?:no|reg))|sales\s*tax|service\s*tax|tax|cess|hst|pst|qst|mwst|tva|iva)\b/i, role: 'tax' },
  { re: /\b(?:service\s*(?:charge|chg|fee)?|svc\s*chg|restaurant\s*levy)\b/i, role: 'service' },
  { re: /\b(?:tip|gratuity|gratuities)\b/i, role: 'tip' },
  { re: /\b(?:delivery|shipping|freight|courier|rider)\b/i, role: 'delivery' },
  // "Less" only counts with its colon — "Less Sugar Tea" is a drink, not a rebate.
  { re: /\b(?:discount|promo(?:tion)?|coupon|voucher|loyalty|complimentary|rebate|cashback|savings)\b|(?:^|\s)less\s*[:.]/i, role: 'discount' },
  // Generic nouns need an explicit charge word — "Catering Package" is a line
  // item, "Packaging Charges" is not.
  { re: /\b(?:packaging|packing|corkage|surcharge|rounding)\b|\bround[\s-]*(?:off|up|down)\b|\b(?:package|container|convenience|platform|handling|booking|card|processing|transaction|cover|entertainment|environment(?:al)?)\s*(?:charges?|chg|fees?|levy)\b/i, role: 'other' },
]

/** A charge label is short by nature ("Add: Service Charge"). Requiring that
 *  keeps a dish called "Tandoori Tax Collector's Special" out of the fees. */
const MAX_LABEL_WORDS = 6

/** "Total Qty 5" and "Total Savings" are tallies, not the amount payable. */
const NOT_SUMMARY_RE = /\btotal\s*(?:qty|quantity|items?|nos?|covers|persons?|count|savings?|discounts?)\b|\b(?:no\.?|number|count)\s*of\b/i

function classifyCharge(label: string): Role | null {
  const clean = label.replace(/^\s*(?:add|plus|incl\.?|including)\s*[:.]?\s*/i, '').trim()
  if (!clean) return null
  if (clean.split(/\s+/).length > MAX_LABEL_WORDS) return null
  const tally = NOT_SUMMARY_RE.test(clean)
  for (const rule of CHARGE_RULES) {
    if (tally && (rule.role === 'subtotal' || rule.role === 'total')) continue
    if (rule.re.test(clean)) return rule.role
  }
  return null
}

/** Tax already inside the prices. Adding it as a fee would charge the group
 *  twice, so it is recorded and warned about instead of counted. */
const INCLUSIVE_RE = /\b(?:incl(?:usive|uded|\.)?|included|inclusive\s*of|within)\b/i

function cleanName(raw: string): string {
  return raw
    .replace(SYM_TRAILING, '')
    .replace(/[\s.·•_\-–—=]{2,}$/, '') // dot leaders
    .replace(/\s+[x×*@=]\s*$/i, '')
    .replace(/[\s.:,;\-–—•·_@]+$/, '')
    .replace(/^[\s*•·_\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function letterCount(s: string): number {
  return (s.match(/[A-Za-zÀ-ɏऀ-ॿ]/g) ?? []).length
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

interface QtySplit { qty: number; name: string; explicit: boolean }

function splitQty(rest: string): QtySplit {
  const name0 = cleanName(rest)
  const patterns: [RegExp, 'lead' | 'trail'][] = [
    [/^\s*(\d{1,3})\s*[xX×*]\s*(?=\S)/, 'lead'],   // "2x Naan", "2 x Naan"
    [/^\s*(\d{1,3})\s+(?=[A-Za-z(])/, 'lead'],      // "1  Paneer Tikka"
    [/[\s(]?[xX×]\s*(\d{1,3})\)?\s*$/, 'trail'],    // "Cold Brew x2", "Pizza (x2)"
    [/[\s(](\d{1,3})\s*[xX×]\)?\s*$/, 'trail'],     // "House Red Wine 2x"
  ]
  for (const [re, where] of patterns) {
    const m = re.exec(name0)
    if (!m?.[1]) continue
    const qty = Number(m[1])
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) continue
    const name = cleanName(where === 'lead' ? name0.slice(m[0].length) : name0.slice(0, m.index))
    // A qty strip that eats the name means we misread it ("7 Up" is a drink).
    if (name.length < 3 || letterCount(name) < 2) continue
    return { qty, name, explicit: true }
  }
  return { qty: 1, name: name0, explicit: false }
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseBillText(text: string, opts: ParseBillTextOpts = {}): ParsedBill {
  const detected = detectCurrency(text)
  const currency = (opts.currency ?? detected.currency).toUpperCase()
  const tolerance = opts.tolerance_minor ?? 1

  const items: ParsedItem[] = []
  const fees: ParsedFee[] = []
  const warnings: string[] = []
  const unparsed: string[] = []
  let subtotal: number | null = null
  let total: number | null = null
  const foreignSeen = new Set<string>()

  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ').replace(/ /g, ' ').trimEnd()
    if (!line.trim()) continue // blank lines carry nothing; not "ignored" content

    const toks = moneyTokens(line, currency).filter((t) => !t.percent)
    for (const t of toks) if (t.foreign) foreignSeen.add(t.foreign)

    const amount = toks[toks.length - 1]
    const hasAmount = amount !== undefined && TRIVIAL_TAIL.test(line.slice(amount.end))
    const label = amount ? line.slice(0, amount.start) : line
    const role = classifyCharge(cleanName(label) || line)

    // --- summary lines: parsed, but never counted as charges ----------------
    if (role === 'subtotal' || role === 'total') {
      if (!hasAmount || !amount) {
        unparsed.push(line)
        warnings.push(`"${cleanName(line)}" looked like a ${role} line but carried no amount`)
        continue
      }
      const value = amount.negative ? -amount.minor : amount.minor
      if (role === 'subtotal') subtotal = value
      else total = value // last total wins: receipts print the payable last
      continue
    }

    if (JUNK_RE.some((re) => re.test(line))) {
      unparsed.push(line)
      continue
    }

    // --- fees ---------------------------------------------------------------
    if (role !== null) {
      if (!hasAmount || !amount) {
        unparsed.push(line)
        warnings.push(`"${cleanName(line)}" looked like a charge line but carried no amount`)
        continue
      }
      const name = cleanName(label) || role
      if (INCLUSIVE_RE.test(label)) {
        unparsed.push(line)
        warnings.push(`"${name}" is marked as already included in the prices — not added as a fee`)
        continue
      }
      // Discounts reduce the bill whether or not the printer bothered with a
      // minus sign, so the keyword decides the sign, not the glyph.
      const magnitude = amount.minor
      const value = role === 'discount' ? -magnitude : amount.negative ? -magnitude : magnitude
      fees.push({ name, amount: value, kind: role })
      continue
    }

    // --- items --------------------------------------------------------------
    const item = amount && hasAmount ? parseItem(line, toks, amount, currency, warnings) : null
    if (!item) {
      unparsed.push(line)
    } else if (item.line_amount < 0) {
      // A voided/refunded line. It is money coming off the bill, so it belongs
      // in fees where the sign survives — a Cart item can never be negative.
      fees.push({ name: item.name, amount: item.line_amount, kind: 'discount' })
      warnings.push(`"${item.name}" is a negative line — treated as a credit against the bill, not as an item`)
    } else {
      items.push(item)
    }
  }

  // --- reconciliation -------------------------------------------------------

  const items_sum = items.reduce((s, i) => s + i.line_amount, 0)
  const fees_sum = fees.reduce((s, f) => s + f.amount, 0)
  const computed_total = items_sum + fees_sum
  const delta = total === null ? 0 : computed_total - total
  const balanced = total !== null && Math.abs(delta) <= tolerance

  if (foreignSeen.size > 0) {
    warnings.push(
      `mixed currency marks on this bill (${[...foreignSeen].join(', ')}) — every amount was read as ${currency}, no conversion was applied`,
    )
  }
  if (items.length === 0) warnings.push('no item lines were recognised on this bill')
  if (subtotal !== null && items_sum !== subtotal) {
    warnings.push(
      `items add up to ${fmt(items_sum, currency)} but the bill prints a subtotal of ${fmt(subtotal, currency)} (off by ${fmt(items_sum - subtotal, currency)}) — a line is probably missing or misread`,
    )
  }
  if (total === null) {
    warnings.push('no total line found — the itemisation could not be checked against the bill')
  } else if (!balanced) {
    warnings.push(
      `items + fees = ${fmt(computed_total, currency)} but the bill prints ${fmt(total, currency)} (off by ${fmt(delta, currency)}) — do not charge anyone until this is resolved`,
    )
  }

  const note =
    total === null
      ? `No printed total to check against. ${items.length} item(s) came to ${fmt(items_sum, currency)} and ${fees.length} charge(s) to ${fmt(fees_sum, currency)}, so this bill computes to ${fmt(computed_total, currency)} — unverified.`
      : balanced
        ? `${items.length} item(s) ${fmt(items_sum, currency)} + ${fees.length} charge(s) ${fmt(fees_sum, currency)} = ${fmt(computed_total, currency)}, matching the printed total.`
        : `${items.length} item(s) ${fmt(items_sum, currency)} + ${fees.length} charge(s) ${fmt(fees_sum, currency)} = ${fmt(computed_total, currency)}, but the bill prints ${fmt(total, currency)} — off by ${fmt(delta, currency)}. ${
            delta < 0 ? 'Something on the bill was not read' : 'Something was read twice or read wrong'
          }; nothing was invented to force a match.`

  return {
    items,
    fees,
    currency,
    subtotal,
    total,
    reconciliation: { items_sum, fees_sum, computed_total, printed_total: total, delta, balanced, note },
    warnings,
    unparsed_lines: unparsed,
  }
}

/**
 * One item line. The printed line amount is authoritative — it is what the
 * merchant charged — and qty/unit only ever explain it.
 */
function parseItem(line: string, toks: Tok[], amount: Tok, currency: string, warnings: string[]): ParsedItem | null {
  const before = line.slice(0, amount.start)
  const div = minorUnits(currency)

  // Weakest shape — no symbol, no decimals, one space of separation — is where
  // postcodes and phone fragments live. Demand the line look nothing like an
  // address and the number look nothing like an ID.
  const dotLeader = /[.·•_]{2,}\s*$/.test(before)
  const aligned = amount.gap >= 2 || dotLeader
  if (!amount.hasSymbol && !amount.hasDecimals && !aligned) {
    if (amount.gap < 1) return null
    if (ADDRESS_RE.test(line)) return null
    if (amount.core.replace(/\D/g, '').length > 5) return null
    if (cleanName(before).split(/\s+/).length > 5) return null
  }

  // Column shapes: "Butter Chicken  2  320.00  640.00" or "Beers @ 5.00  15.00".
  // Only numbers separated from the amount by pure padding/operators count —
  // "Chicken 65 Dry  180.00" keeps its 65 in the name where it belongs.
  const idx = toks.indexOf(amount)
  const extras: Tok[] = []
  for (let i = idx - 1; i >= 0 && extras.length < 2; i--) {
    const t = toks[i]!
    const next = extras.length === 0 ? amount : extras[extras.length - 1]!
    if (!/^[\s@xX×*+=-]*$/.test(line.slice(t.end, next.start))) break
    extras.push(t)
  }
  extras.reverse() // document order

  const lineAmount = amount.negative ? -amount.minor : amount.minor
  let consumedFrom = amount.start
  let qty = 0
  let unit = 0
  let columnsChecked = false

  // A bare integer in a column is a count, not a price: "2" means two, not 2.00.
  const isCount = (t: Tok) => !/[.,]/.test(t.core) && t.minor % div === 0 && t.minor / div >= 1 && t.minor / div <= 99

  if (extras.length === 2) {
    const [a, b] = [extras[0]!, extras[1]!]
    if (isCount(a) && Math.abs((a.minor / div) * b.minor - lineAmount) <= 2) {
      qty = a.minor / div
      unit = b.minor
      columnsChecked = true
      consumedFrom = a.start
    }
  }
  if (qty === 0 && extras.length >= 1) {
    const a = extras[extras.length - 1]!
    const pre = splitQty(line.slice(0, a.start))
    if (pre.explicit && Math.abs(pre.qty * a.minor - lineAmount) <= 2) {
      qty = pre.qty
      unit = a.minor
      columnsChecked = true
      consumedFrom = a.start
    } else if (!pre.explicit && isCount(a)) {
      qty = a.minor / div
      unit = Math.round(lineAmount / qty)
      consumedFrom = a.start
    } else if (!pre.explicit && a.hasDecimals && a.minor > 0 && lineAmount % a.minor === 0) {
      const q = lineAmount / a.minor
      if (q >= 2 && q <= 99) {
        qty = q
        unit = a.minor
        columnsChecked = true
        consumedFrom = a.start
      }
    }
  }

  const split = splitQty(line.slice(0, consumedFrom))
  if (qty === 0) {
    qty = split.qty
    unit = Math.round(lineAmount / qty)
  }
  const name = split.name

  if (!name || letterCount(name) < 2) return null

  if (unit * qty !== lineAmount) {
    warnings.push(
      `"${name}": ${qty} × ${unit} does not equal the printed line amount ${lineAmount} (minor units) — the printed amount is what will be charged`,
    )
  }

  let confidence = 0.55
  if (amount.hasSymbol) confidence += 0.15
  if (amount.hasDecimals) confidence += 0.15
  if (aligned) confidence += 0.1
  if (split.explicit || columnsChecked) confidence += 0.05
  if (columnsChecked) confidence += 0.05
  if (name.length < 4) confidence -= 0.15
  if (/\d/.test(name)) confidence -= 0.05
  confidence = Math.round(Math.min(1, Math.max(0.05, confidence)) * 100) / 100

  return { name, qty, unit_amount: unit, line_amount: lineAmount, confidence, source_line: line.trim() }
}

/** Money for humans, in the bill's own currency and exponent. */
export function fmt(minor: number, currency: string): string {
  const div = minorUnits(currency)
  const digits = String(div).length - 1
  return `${currency} ${(minor / div).toFixed(digits)}`
}
