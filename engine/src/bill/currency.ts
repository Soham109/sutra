// What currency is this bill in, when nobody wrote a symbol?
//
// Most printed receipts state amounts bare — the shop knows what country it is
// in. Defaulting those to USD is not a neutral choice: it renders a ₹2,588
// dinner as $2,588 and quietly makes every share thirty times too big on the
// page people are asked to agree to.
//
// So we read the tax regime instead, which receipts almost always print and
// which is far less ambiguous than a symbol. GSTIN and CGST/SGST are India and
// nothing else. TVA is France. MwSt is Germany. Each rule below is a token
// that only one jurisdiction uses; anything merely suggestive is left out,
// because a wrong guess here is worse than no guess.

interface Rule {
  currency: string
  /** must be unambiguous — a token used by exactly one tax regime */
  pattern: RegExp
  why: string
}

const RULES: Rule[] = [
  { currency: 'INR', pattern: /\b(?:GSTIN|CGST|SGST|IGST|UTGST)\b/i, why: 'Indian GST identifiers' },
  { currency: 'GBP', pattern: /\bVAT\s*(?:Reg(?:\.|istration)?)?\s*(?:No\.?|Number)?\s*:?\s*GB\d/i, why: 'a UK VAT number' },
  { currency: 'EUR', pattern: /\b(?:MwSt|USt-IdNr|TVA|IVA\s+intracom)\b/i, why: 'a eurozone VAT label' },
  { currency: 'AED', pattern: /\bTRN\s*:?\s*\d{15}\b/i, why: 'a UAE tax registration number' },
  { currency: 'SGD', pattern: /\bGST\s+Reg(?:\.|istration)?\s*(?:No\.?)?\s*:?\s*M\d/i, why: 'a Singapore GST number' },
  { currency: 'AUD', pattern: /\bABN\b\s*:?\s*\d{2}\s?\d{3}\s?\d{3}\s?\d{3}/i, why: 'an Australian Business Number' },
  { currency: 'ZAR', pattern: /\bVAT\s*(?:No\.?|Number)?\s*:?\s*4\d{9}\b/i, why: 'a South African VAT number' },
]

/** Currency symbols and codes, which always win over a tax-regime guess. */
const EXPLICIT: [RegExp, string][] = [
  [/₹|\bINR\b|\bRs\.?\s*\d/i, 'INR'],
  [/£|\bGBP\b/i, 'GBP'],
  [/€|\bEUR\b/i, 'EUR'],
  [/\$|\bUSD\b/i, 'USD'],
  [/¥|\bJPY\b/i, 'JPY'],
  [/₩|\bKRW\b/i, 'KRW'],
  [/\bAED\b|د\.إ/i, 'AED'],
  [/\bSGD\b|\bS\$/i, 'SGD'],
  [/\bAUD\b|\bA\$/i, 'AUD'],
  [/\bCAD\b|\bC\$/i, 'CAD'],
  [/\bZAR\b|\bR\s*\d+[.,]\d{2}\b/i, 'ZAR'],
  [/\bTHB\b|฿/i, 'THB'],
  [/\bIDR\b|\bRp\b/i, 'IDR'],
  [/\bPHP\b|₱/i, 'PHP'],
  [/\bVND\b|₫/i, 'VND'],
  [/\bTRY\b|₺/i, 'TRY'],
  [/\bBRL\b|\bR\$/i, 'BRL'],
]

export interface CurrencyGuess {
  currency: string | null
  /** 'symbol' is certain; 'tax_regime' is inferred and worth telling the user */
  basis: 'symbol' | 'tax_regime' | null
  why: string | null
}

/**
 * Null means "nothing in this text says". The caller decides what to do with
 * that — which is deliberately not the same as being told it is dollars.
 */
export function inferBillCurrency(text: string): CurrencyGuess {
  for (const [pattern, currency] of EXPLICIT) {
    if (pattern.test(text)) {
      return { currency, basis: 'symbol', why: `the receipt prints ${currency} amounts` }
    }
  }
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return {
        currency: rule.currency,
        basis: 'tax_regime',
        why: `read as ${rule.currency} because the receipt shows ${rule.why}`,
      }
    }
  }
  return { currency: null, basis: null, why: null }
}
