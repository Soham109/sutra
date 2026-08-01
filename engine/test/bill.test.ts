import { describe, expect, it, vi } from 'vitest'
import { billToCart, parseBill, parseBillText } from '../src/bill/index.js'
import { computeShares } from '../src/protocol/money.js'
import { cartTotal, type MemberInput } from '../src/types.js'

// Real-shaped receipts, written out in full. Every one of these is a shape a
// human actually pastes or OCRs: the junk lines are load-bearing test data,
// not decoration — a parser that quietly eats one is the failure mode.

const INDIAN_RESTAURANT = `              SPICE ROUTE KITCHEN
        14 MG Road, Bengaluru 560001
        GSTIN: 29AABCS1429B1ZQ
        Ph: +91 80 4123 9900
------------------------------------
Bill No: 2291        Table: 7
Date: 12/03/2026 20:14
------------------------------------
Item                Qty   Amount
------------------------------------
1  Paneer Tikka           ₹  380
2x Garlic Naan            ₹  120
1  Dal Makhani            ₹  340
3  Masala Chai            ₹  150
------------------------------------
Sub Total                 ₹ 990
CGST @ 2.5%               ₹ 24.75
SGST @ 2.5%               ₹ 24.75
Round Off                 ₹ -0.50
Grand Total               ₹ 1,039.00
------------------------------------
        Thank you, visit again!`

const US_DINER = `        THE BLUE PLATE DINER
     1122 Mission St, San Francisco
          (415) 555-0132

Server: Marta        Check #4417
--------------------------------
2x Buttermilk Pancakes     18.00
1x Denver Omelette         14.50
Cold Brew x2                9.00
Side Bacon                  5.25
--------------------------------
Subtotal                   46.75
Sales Tax 8.625%            4.03
Tip (20%)                   9.35
--------------------------------
TOTAL                      60.13
        Thank you!`

const UK_PUB = `The Crown & Anchor
23 Fleet Street, London EC4Y 1AA
VAT Reg No: GB 234 5678 91

Table 12                Covers 4
================================
2 x Pint Camden Hells     £11.60
1 x Pint Guinness          £5.90
1 x Gin & Tonic            £9.20
2 x Fish and Chips        £33.00
1 x Sticky Toffee Pudding  £7.50
================================
Subtotal                  £67.20
Service Charge (12.5%)     £8.40
--------------------------------
TOTAL DUE                 £75.60`

const DOT_LEADERS = `CORNER CAFE
Coke .................. 3.50
Espresso .............. 2.80
Croissant ............. 4.20
Blueberry Muffin ...... 3.95
Subtotal .............. 14.45
Tax ................... 1.16
TOTAL ................. 15.61`

const WITH_DISCOUNT = `GREEN GROCER & DELI
Order 88213

Sourdough Loaf x1        6.50
Aged Cheddar 250g       11.20
Kalamata Olives          4.75
2x Cold Pressed Juice   12.00
------------------------------
Subtotal                34.45
Member Discount         -5.00
Delivery                 3.99
VAT                      2.87
------------------------------
Total                   36.31`

// A line was lost between the printer and us — items + fees cannot reach the
// printed total. The parser must say so rather than invent the difference.
const UNBALANCED = `HARBOUR GRILL
Grilled Salmon             22.00
Steak Frites               28.00
House Red Wine 2x          18.00
Sparkling Water             4.00
Subtotal                   72.00
Service 10%                 7.20
TOTAL                      94.20`

// European decimal convention: 1.350,00 is one thousand three hundred fifty.
const EURO_HOTEL = `GRAND HOTEL AMSTERDAM
Prinsengracht 100, Amsterdam

3x Conference Day Pass   € 1.350,00
1x AV Equipment Hire     €   425,50
2x Catering Package      € 1.100,00
-------------------------------
Subtotal                 € 2.875,50
VAT 21%                  €   603,86
Service Charge           €    75,00
-------------------------------
Total Due                € 3.554,36`

// The four-column shape every POS prints: description, qty, rate, amount.
const COLUMNAR = `TANDOOR HOUSE
Description        Qty    Rate     Amount
Butter Chicken       2   320.00    640.00
Jeera Rice           3    90.00    270.00
Beers @ 5.00                        15.00
Total                               925.00`

const ALL_FIXTURES: [string, string][] = [
  ['indian restaurant', INDIAN_RESTAURANT],
  ['us diner', US_DINER],
  ['uk pub', UK_PUB],
  ['dot leaders', DOT_LEADERS],
  ['discount', WITH_DISCOUNT],
  ['unbalanced', UNBALANCED],
  ['euro hotel', EURO_HOTEL],
  ['columnar', COLUMNAR],
]

const lineOf = (b: ReturnType<typeof parseBillText>, name: string) =>
  b.items.find((i) => i.name === name)

describe('parseBillText — Indian restaurant bill (₹, CGST/SGST, round off)', () => {
  const bill = parseBillText(INDIAN_RESTAURANT)

  it('reads the currency off the bill', () => {
    expect(bill.currency).toBe('INR')
  })

  it('itemises leading-qty and "2x" lines in paise', () => {
    expect(bill.items.map((i) => [i.name, i.qty, i.unit_amount, i.line_amount])).toEqual([
      ['Paneer Tikka', 1, 38_000, 38_000],
      ['Garlic Naan', 2, 6_000, 12_000],
      ['Dal Makhani', 1, 34_000, 34_000],
      ['Masala Chai', 3, 5_000, 15_000],
    ])
    expect(bill.items.every((i) => i.confidence >= 0.7)).toBe(true)
  })

  it('splits CGST/SGST into taxes and keeps the round-off negative', () => {
    expect(bill.fees).toEqual([
      { name: 'CGST @ 2.5%', amount: 2_475, kind: 'tax' },
      { name: 'SGST @ 2.5%', amount: 2_475, kind: 'tax' },
      { name: 'Round Off', amount: -50, kind: 'other' },
    ])
  })

  it('reconciles exactly against the printed grand total', () => {
    expect(bill.subtotal).toBe(99_000)
    expect(bill.total).toBe(103_900)
    expect(bill.reconciliation).toEqual({
      items_sum: 99_000,
      fees_sum: 4_900,
      computed_total: 103_900,
      printed_total: 103_900,
      delta: 0,
      balanced: true,
      note: expect.stringContaining('matching the printed total'),
    })
    expect(bill.warnings).toEqual([])
  })

  it('keeps the address, GSTIN, phone, table and thank-you lines out of the money', () => {
    const junk = bill.unparsed_lines.join('\n')
    expect(junk).toContain('14 MG Road, Bengaluru 560001')
    expect(junk).toContain('GSTIN: 29AABCS1429B1ZQ')
    expect(junk).toContain('Ph: +91 80 4123 9900')
    expect(junk).toContain('Bill No: 2291        Table: 7')
    expect(junk).toContain('Date: 12/03/2026 20:14')
    expect(junk).toContain('Item                Qty   Amount')
    expect(junk).toContain('Thank you, visit again!')
    expect(bill.unparsed_lines).toContain('------------------------------------')
    // The 560001 pincode must never have become a ₹5,600.01 line.
    expect(bill.items.some((i) => i.line_amount === 560_001 * 100)).toBe(false)
  })
})

describe('parseBillText — US diner check (tax and tip)', () => {
  const bill = parseBillText(US_DINER)

  it('handles leading 2x, trailing x2 and bare lines', () => {
    expect(bill.currency).toBe('USD')
    expect(bill.items.map((i) => [i.name, i.qty, i.unit_amount, i.line_amount])).toEqual([
      ['Buttermilk Pancakes', 2, 900, 1_800],
      ['Denver Omelette', 1, 1_450, 1_450],
      ['Cold Brew', 2, 450, 900],
      ['Side Bacon', 1, 525, 525],
    ])
  })

  it('reads the rate percentages as rates, not as amounts', () => {
    expect(bill.fees).toEqual([
      { name: 'Sales Tax 8.625%', amount: 403, kind: 'tax' },
      { name: 'Tip (20%)', amount: 935, kind: 'tip' },
    ])
  })

  it('balances at 60.13', () => {
    expect(bill.subtotal).toBe(4_675)
    expect(bill.total).toBe(6_013)
    expect(bill.reconciliation.computed_total).toBe(6_013)
    expect(bill.reconciliation.delta).toBe(0)
    expect(bill.reconciliation.balanced).toBe(true)
  })

  it('discards the phone number and the check header', () => {
    const junk = bill.unparsed_lines.join('\n')
    expect(junk).toContain('(415) 555-0132')
    expect(junk).toContain('1122 Mission St, San Francisco')
    expect(junk).toContain('Server: Marta        Check #4417')
    expect(junk).toContain('THE BLUE PLATE DINER')
  })
})

describe('parseBillText — UK pub bill (£ and service charge)', () => {
  const bill = parseBillText(UK_PUB)

  it('itemises "2 x Name  £amount"', () => {
    expect(bill.currency).toBe('GBP')
    expect(bill.items.map((i) => [i.name, i.qty, i.unit_amount, i.line_amount])).toEqual([
      ['Pint Camden Hells', 2, 580, 1_160],
      ['Pint Guinness', 1, 590, 590],
      ['Gin & Tonic', 1, 920, 920],
      ['Fish and Chips', 2, 1_650, 3_300],
      ['Sticky Toffee Pudding', 1, 750, 750],
    ])
  })

  it('books the service charge as a service fee', () => {
    expect(bill.fees).toEqual([{ name: 'Service Charge (12.5%)', amount: 840, kind: 'service' }])
    expect(bill.reconciliation.computed_total).toBe(7_560)
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.warnings).toEqual([])
  })

  it('never lets the VAT registration number or the postcode become money', () => {
    const junk = bill.unparsed_lines.join('\n')
    expect(junk).toContain('VAT Reg No: GB 234 5678 91')
    expect(junk).toContain('23 Fleet Street, London EC4Y 1AA')
    expect(junk).toContain('Table 12                Covers 4')
    expect(bill.fees.some((f) => f.name.includes('Reg'))).toBe(false)
  })
})

describe('parseBillText — dot-leader receipt', () => {
  const bill = parseBillText(DOT_LEADERS)

  it('strips the leaders off the name', () => {
    expect(bill.items.map((i) => [i.name, i.line_amount])).toEqual([
      ['Coke', 350],
      ['Espresso', 280],
      ['Croissant', 420],
      ['Blueberry Muffin', 395],
    ])
    expect(bill.items.every((i) => i.qty === 1)).toBe(true)
  })

  it('reads dotted subtotal/tax/total lines as charges, not items', () => {
    expect(bill.subtotal).toBe(1_445)
    expect(bill.total).toBe(1_561)
    expect(bill.fees).toEqual([{ name: 'Tax', amount: 116, kind: 'tax' }])
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.unparsed_lines).toEqual(['CORNER CAFE'])
  })
})

describe('parseBillText — bill with a discount line', () => {
  const bill = parseBillText(WITH_DISCOUNT)

  it('keeps the discount negative and the other charges positive', () => {
    expect(bill.fees).toEqual([
      { name: 'Member Discount', amount: -500, kind: 'discount' },
      { name: 'Delivery', amount: 399, kind: 'delivery' },
      { name: 'VAT', amount: 287, kind: 'tax' },
    ])
    expect(bill.reconciliation.fees_sum).toBe(186)
  })

  it('does not mistake "250g" or "x1" for a price', () => {
    expect(lineOf(bill, 'Aged Cheddar 250g')?.line_amount).toBe(1_120)
    expect(lineOf(bill, 'Sourdough Loaf')?.qty).toBe(1)
    expect(lineOf(bill, 'Cold Pressed Juice')).toMatchObject({ qty: 2, unit_amount: 600, line_amount: 1_200 })
  })

  it('balances at 36.31 with the discount subtracted', () => {
    expect(bill.reconciliation).toMatchObject({
      items_sum: 3_445,
      fees_sum: 186,
      computed_total: 3_631,
      printed_total: 3_631,
      delta: 0,
      balanced: true,
    })
    expect(bill.unparsed_lines.join('\n')).toContain('Order 88213')
  })
})

describe('parseBillText — deliberately unbalanced bill', () => {
  const bill = parseBillText(UNBALANCED)

  it('reports balanced:false and the exact shortfall', () => {
    expect(bill.reconciliation.items_sum).toBe(7_200)
    expect(bill.reconciliation.fees_sum).toBe(720)
    expect(bill.reconciliation.computed_total).toBe(7_920)
    expect(bill.reconciliation.printed_total).toBe(9_420)
    expect(bill.reconciliation.delta).toBe(-1_500)
    expect(bill.reconciliation.balanced).toBe(false)
  })

  it('says so in the note and in the warnings, and invents nothing', () => {
    expect(bill.reconciliation.note).toContain('USD 94.20')
    expect(bill.reconciliation.note).toContain('nothing was invented to force a match')
    expect(bill.warnings.some((w) => w.includes('do not charge anyone until this is resolved'))).toBe(true)
    // the fix must never be a phantom line
    expect(bill.items).toHaveLength(4)
    expect(bill.items.reduce((s, i) => s + i.line_amount, 0)).toBe(7_200)
  })

  it('still reads the trailing-qty item', () => {
    expect(lineOf(bill, 'House Red Wine')).toMatchObject({ qty: 2, unit_amount: 900, line_amount: 1_800 })
  })
})

describe('parseBillText — European decimal convention', () => {
  const bill = parseBillText(EURO_HOTEL)

  it('reads 1.350,00 as one thousand three hundred fifty', () => {
    expect(bill.currency).toBe('EUR')
    expect(bill.items.map((i) => [i.name, i.qty, i.unit_amount, i.line_amount])).toEqual([
      ['Conference Day Pass', 3, 45_000, 135_000],
      ['AV Equipment Hire', 1, 42_550, 42_550],
      ['Catering Package', 2, 55_000, 110_000],
    ])
    expect(bill.subtotal).toBe(287_550)
    expect(bill.total).toBe(355_436)
  })

  it('balances and warns about nothing', () => {
    expect(bill.reconciliation.computed_total).toBe(355_436)
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.warnings).toEqual([])
    expect(bill.unparsed_lines.join('\n')).toContain('Prinsengracht 100, Amsterdam')
  })
})

describe('parseBillText — columnar qty/rate/amount', () => {
  const bill = parseBillText(COLUMNAR)

  it('uses the qty and rate columns and checks them against the amount', () => {
    expect(bill.items.map((i) => [i.name, i.qty, i.unit_amount, i.line_amount])).toEqual([
      ['Butter Chicken', 2, 32_000, 64_000],
      ['Jeera Rice', 3, 9_000, 27_000],
      ['Beers', 3, 500, 1_500],
    ])
    expect(bill.total).toBe(92_500)
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.unparsed_lines).toContain('Description        Qty    Rate     Amount')
  })
})

describe('reconciliation invariants', () => {
  it.each(ALL_FIXTURES)('%s: every non-blank line is accounted for exactly once', (_name, text) => {
    const bill = parseBillText(text)
    const inputLines = text.split('\n').filter((l) => l.trim()).length
    const accounted =
      bill.items.length +
      bill.fees.length +
      (bill.subtotal === null ? 0 : 1) +
      (bill.total === null ? 0 : 1) +
      bill.unparsed_lines.length
    expect(accounted).toBe(inputLines)
  })

  it.each(ALL_FIXTURES)('%s: computed_total is exactly items_sum + fees_sum', (_name, text) => {
    const r = parseBillText(text).reconciliation
    expect(r.computed_total).toBe(r.items_sum + r.fees_sum)
    expect(r.delta).toBe(r.printed_total === null ? 0 : r.computed_total - r.printed_total)
  })

  it.each(ALL_FIXTURES)('%s: every item line survives as unit × qty or is warned about', (_name, text) => {
    const bill = parseBillText(text)
    for (const item of bill.items) {
      expect(item.line_amount).toBeGreaterThan(0)
      expect(Number.isInteger(item.unit_amount)).toBe(true)
      if (item.unit_amount * item.qty !== item.line_amount) {
        expect(bill.warnings.some((w) => w.includes(item.name))).toBe(true)
      }
    }
  })

  it('warns when the items do not add up to the printed subtotal', () => {
    const bill = parseBillText(`SHOP
Widget            10.00
Gadget            15.00
Subtotal          30.00
Total             30.00`)
    expect(bill.reconciliation.items_sum).toBe(2_500)
    expect(bill.warnings.some((w) => w.includes('prints a subtotal'))).toBe(true)
    expect(bill.reconciliation.balanced).toBe(false)
  })

  it('refuses to claim balance when there is no printed total to check', () => {
    const bill = parseBillText(`Kirana Store
Rice 5kg      450.00
Dal 1kg       180.00`)
    expect(bill.total).toBeNull()
    expect(bill.reconciliation.computed_total).toBe(63_000)
    expect(bill.reconciliation.balanced).toBe(false)
    expect(bill.reconciliation.note).toContain('unverified')
    expect(bill.warnings.some((w) => w.includes('no total line found'))).toBe(true)
  })

  it('does not double-charge a tax that is already inside the prices', () => {
    const bill = parseBillText(`Chai Point
Masala Chai              80.00
Samosa Plate            120.00
Incl. GST @ 5%            9.52
Total                   200.00`)
    expect(bill.fees).toEqual([])
    expect(bill.reconciliation.balanced).toBe(true)
    expect(bill.unparsed_lines.join('\n')).toContain('Incl. GST @ 5%')
    expect(bill.warnings.some((w) => w.includes('already included'))).toBe(true)
  })

  it('turns a voided line into a credit rather than a negative item', () => {
    const bill = parseBillText(`POS TERMINAL 4
Cheeseburger          9.50
Fries                 3.25
VOID Cheeseburger    -9.50
Total                 3.25`)
    expect(bill.items.map((i) => i.line_amount)).toEqual([950, 325])
    expect(bill.fees).toEqual([{ name: 'VOID Cheeseburger', amount: -950, kind: 'discount' }])
    expect(bill.reconciliation.balanced).toBe(true)
  })

  it('reads a POS trailing minus as negative', () => {
    const bill = parseBillText(`Shop
Widget            25.00
Promo Code        5.00-
Total             20.00`)
    expect(bill.fees).toEqual([{ name: 'Promo Code', amount: -500, kind: 'discount' }])
    expect(bill.reconciliation.balanced).toBe(true)
  })

  it('honours an explicit currency override', () => {
    const bill = parseBillText(`Cafe
Latte     4,50
Cake      5,25
Total     9,75`, { currency: 'EUR' })
    expect(bill.currency).toBe('EUR')
    expect(bill.items.map((i) => i.line_amount)).toEqual([450, 525])
    expect(bill.total).toBe(975)
  })
})

// ---------------------------------------------------------------------------
// Cart mapping
// ---------------------------------------------------------------------------

const member = (name: string): MemberInput => ({ name, role: 'payer', weight: 1 })

describe('billToCart', () => {
  it('emits stable skus, mi_all claimants and the fees as printed', () => {
    const cart = billToCart(parseBillText(UK_PUB))
    expect(cart.currency).toBe('GBP')
    expect(cart.items.map((i) => i.sku)).toEqual(['bill-0', 'bill-1', 'bill-2', 'bill-3', 'bill-4'])
    expect(cart.items.every((i) => i.claimants.length === 1 && i.claimants[0] === 'mi_all')).toBe(true)
    expect(cart.items[0]).toMatchObject({ name: 'Pint Camden Hells', qty: 2, unit_amount: 580 })
    expect(cart.fees).toEqual([{ name: 'Service Charge (12.5%)', amount: 840 }])
    expect(cartTotal(cart)).toBe(7_560)
  })

  it('takes per-item claimants positionally and falls back to everyone', () => {
    const cart = billToCart(parseBillText(UK_PUB), { claimantsByItemIndex: [['Ana'], [], ['Bo', 'Cy']] })
    expect(cart.items[0]?.claimants).toEqual(['Ana'])
    expect(cart.items[1]?.claimants).toEqual(['mi_all'])
    expect(cart.items[2]?.claimants).toEqual(['Bo', 'Cy'])
    expect(cart.items[4]?.claimants).toEqual(['mi_all'])
  })

  // Cart fee amounts are nonnegative by schema, so a discount is applied
  // pro-rata against the item lines instead of being dropped. The total must
  // survive that to the minor unit.
  it('folds a negative discount into the item lines without losing a penny', () => {
    const bill = parseBillText(WITH_DISCOUNT)
    const cart = billToCart(bill)
    expect(cart.fees).toEqual([
      { name: 'Delivery', amount: 399 },
      { name: 'VAT', amount: 287 },
    ])
    expect(cart.fees.every((f) => f.amount >= 0)).toBe(true)
    expect(cart.items.map((i) => i.unit_amount * i.qty)).toEqual([556, 957, 406, 1_026])
    expect(cartTotal(cart)).toBe(bill.reconciliation.computed_total)
    expect(cartTotal(cart)).toBe(3_631)
  })

  it('a folded discount allocates exactly like a negative fee would', () => {
    const cart = billToCart(parseBillText(WITH_DISCOUNT))
    const { shares, total } = computeShares(cart, [member('Ana'), member('Bo'), member('Cy')])
    expect(total).toBe(3_631)
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(cartTotal(cart))
  })

  it('moves the multiplicity into the name when the line does not divide evenly', () => {
    const bill = parseBillText(`Diner
3x Taco Special      10.00
Total                10.00`)
    expect(bill.items[0]).toMatchObject({ qty: 3, unit_amount: 333, line_amount: 1_000 })
    const cart = billToCart(bill)
    expect(cart.items[0]).toMatchObject({ name: 'Taco Special ×3', qty: 1, unit_amount: 1_000 })
    expect(cartTotal(cart)).toBe(1_000)
  })

  it.each(ALL_FIXTURES)('%s: cartTotal equals the reconciled computed total', (_name, text) => {
    const bill = parseBillText(text)
    expect(cartTotal(billToCart(bill))).toBe(bill.reconciliation.computed_total)
  })

  it('refuses to build a cart out of nothing', () => {
    const empty = parseBillText('Thank you for visiting!')
    expect(empty.items).toHaveLength(0)
    expect(() => billToCart(empty)).toThrow(/nothing to allocate/)
  })
})

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

describe('parseBill', () => {
  it('takes the deterministic text path with no key present', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const bill = await parseBill({ text: DOT_LEADERS })
    expect(bill.source).toBe('text')
    expect(bill.transcript).toBeUndefined()
    expect(bill.reconciliation.balanced).toBe(true)
    vi.unstubAllEnvs()
  })

  it('gives an actionable error for an image with no API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    await expect(parseBill({ image_base64: 'aGVsbG8=' })).rejects.toMatchObject({
      code: 'no_vision_key',
      message: expect.stringContaining('paste the bill as text'),
    })
    vi.unstubAllEnvs()
  })

  it('rejects empty input', async () => {
    await expect(parseBill({})).rejects.toMatchObject({ code: 'empty_input' })
    await expect(parseBill({ text: '   ' })).rejects.toMatchObject({ code: 'empty_input' })
  })
})
