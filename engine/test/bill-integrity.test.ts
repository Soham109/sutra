import { describe, expect, it } from 'vitest'
import { parseBillText } from '../src/bill/parse.js'
import { checkOcrIntegrity } from '../src/bill/integrity.js'

// The one way a balanced reconciliation can lie.
//
// The fixture below is not invented: it is the verbatim output of tesseract.js
// reading a rendered receipt under page-segmentation mode 4, which treats the
// names and the amounts as two columns. Every amount lost its decimals to the
// run of loose digits at the bottom. The parser then reconciles 2587.00 against
// a printed 2587.00 and reports, truthfully, that everything adds up — while
// every single number is short its cents.

const FRACTURED = `TOIT BREWPUB
100 Feet Road, Indiranagar
GSTIN 29AABCT1234M1Z5

2x Margherita Pizza 760.
1 Paneer Tikka 380.
3 Basmati Blonde 870.
Garlic Bread 240.
Subtotal 2250.
CGST 2.5% 56.
SGST 2.5% 56.
Service Charge 225.

TOTAL 2587.

00
00
00
00

00
25
25
00
50`

/** The same receipt read correctly (segmentation mode 6). */
const CLEAN = `TOIT BREWPUB
GSTIN 29AABCT1234M1Z5

2x Margherita Pizza 760.00
1 Paneer Tikka 380.00
3 Basmati Blonde 870.00
Garlic Bread 240.00
Subtotal 2250.00
CGST 2.5% 56.25
SGST 2.5% 56.25
Service Charge 225.00
TOTAL 2587.50`

describe('OCR integrity', () => {
  it('the fractured read DOES reconcile — which is exactly the danger', () => {
    const bill = parseBillText(FRACTURED, { currency: 'INR' })
    // Both sides lost their cents together, so the arithmetic is self-consistent.
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.reconciliation.delta).toBe(0)
    // And yet the tax line is wrong by 25 paise, and the total by 50.
    expect(bill.fees.find((f) => /CGST/i.test(f.name))?.amount).toBe(5600) // should be 5625
    expect(bill.reconciliation.printed_total).toBe(258700) // should be 258750
  })

  it('is caught anyway, by the shape of what was left over', () => {
    const bill = parseBillText(FRACTURED, { currency: 'INR' })
    const check = checkOcrIntegrity(bill)
    expect(check.suspect).toBe(true)
    expect(check.orphan_lines).toBeGreaterThanOrEqual(3)
    expect(check.warning).toMatch(/decimals/i)
  })

  it('does not cry wolf on a correctly read receipt', () => {
    const bill = parseBillText(CLEAN, { currency: 'INR' })
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.fees.find((f) => /CGST/i.test(f.name))?.amount).toBe(5625)
    expect(checkOcrIntegrity(bill).suspect).toBe(false)
  })

  /**
   * The corroboration matters: loose digits alone are not enough, or a receipt
   * that happens to print a table number on its own line would be rejected.
   */
  it('does not fire when the amounts still carry real cents', () => {
    const bill = parseBillText(
      `Table 12
7
Coffee 3.50
Cake 4.25
TOTAL 7.75`,
      { currency: 'USD' },
    )
    expect(checkOcrIntegrity(bill).suspect).toBe(false)
  })
})
