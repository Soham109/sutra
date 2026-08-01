import type { ParsedBill } from './parse.js'

// A reconciliation that balances is normally the strongest signal we have that
// a bill was read correctly. There is exactly one way it lies, and it comes
// from OCR.
//
// Some page-segmentation modes read a receipt as two COLUMNS — the names on the
// left, the amounts on the right — and emit them as separate blocks. The result
// is that every amount loses its decimals to a run of orphaned lines:
//
//     CGST 2.5% 56.        ...later...     25
//     TOTAL   2587.                        50
//
// The parser then computes 2587.00 and compares it against a printed 2587.00
// and says, truthfully, that everything adds up. Both sides lost their cents
// together, so the check passes while every number is wrong.
//
// We fix the cause in the client (segmentation mode 6 keeps lines intact), but
// a different receipt, font or camera angle could reproduce it, and a false
// "the maths checks out" is the single most dangerous output this system can
// produce. So the shape is detected here, on the server, where it protects the
// API as well as our own UI.

/** A line that is nothing but a short bare number — the fracture signature. */
const ORPHAN_NUMBER = /^\s*\d{1,3}\s*$/

/** How many orphans before we stop believing the reconciliation. */
const ORPHAN_THRESHOLD = 3

export interface IntegrityCheck {
  /** true when the bill shows the fractured-decimal signature */
  suspect: boolean
  orphan_lines: number
  /** a sentence for a human; empty when nothing is wrong */
  warning: string
}

export function checkOcrIntegrity(bill: ParsedBill): IntegrityCheck {
  const orphans = bill.unparsed_lines.filter((l) => ORPHAN_NUMBER.test(l))
  if (orphans.length < ORPHAN_THRESHOLD) {
    return { suspect: false, orphan_lines: orphans.length, warning: '' }
  }

  // Corroboration: if the decimals were torn off, what is left is a set of
  // amounts that are all exact whole units. Real bills have odd cents; a bill
  // where nothing has a fractional part AND there are loose digits lying around
  // is almost certainly a fractured read rather than a very round evening.
  const amounts = [...bill.items.map((i) => i.line_amount), ...bill.fees.map((f) => f.amount)]
  const allWhole = amounts.length > 0 && amounts.every((a) => a % 100 === 0)
  if (!allWhole) {
    return {
      suspect: false,
      orphan_lines: orphans.length,
      warning: '',
    }
  }

  return {
    suspect: true,
    orphan_lines: orphans.length,
    warning:
      `The decimals may have been read as a separate column: ${orphans.length} loose number(s) were left over ` +
      `and every amount came out as a whole unit. The totals can appear to add up while each one is short its ` +
      `cents. Check the amounts against the paper before anyone agrees to them, or type the lines in by hand.`,
  }
}
