import { CartSchema, type Cart, type CartItem } from '../types.js'
import { distribute } from '../protocol/money.js'
import { parseBillText, type ParseBillTextOpts, type ParsedBill } from './parse.js'

export * from './parse.js'

// Bill → Cart, plus the optional pixels → text hop.
//
// Order matters here: the deterministic parser is the foundation and the model
// is a peripheral. Vision never produces a number the engine trusts — it only
// transcribes the receipt back into text, which then goes through exactly the
// same rules as a paste. If the transcription is wrong, reconciliation catches
// it, which is the whole reason the numbers are not the model's to give.

export class BillParseError extends Error {
  constructor(
    message: string,
    readonly code: 'empty_input' | 'no_vision_key' | 'vision_failed',
  ) {
    super(message)
    this.name = 'BillParseError'
  }
}

// ---------------------------------------------------------------------------
// Cart mapping
// ---------------------------------------------------------------------------

export interface BillToCartOpts {
  /** claimants per item, positionally; anything missing defaults to everyone */
  claimantsByItemIndex?: string[][]
}

/**
 * Produce the engine Cart.
 *
 * Two schema decisions, both forced by engine/src/types.ts:
 *
 * 1. CartItem.unit_amount * qty is the only thing computeShares sees, so a line
 *    whose printed amount does not divide evenly by its quantity is emitted as
 *    qty 1 with the multiplicity moved into the name. The printed amount is
 *    preserved to the minor unit; only the display of "×3" moves. Allocation is
 *    unaffected — claimants split the whole line either way.
 *
 * 2. Cart fee `amount` is z.number().int().nonnegative(), so a discount cannot
 *    ride along as a negative fee. Dropping it would overcharge the group, so
 *    it is applied against the item lines pro-rata (largest remainder). That is
 *    not a fudge: computeShares already allocates fees pro-rata on item
 *    subtotals, so a negative fee and a pro-rata reduction of the same item
 *    lines produce the same per-member number. If you would rather see the
 *    discount as its own line, relax the schema to z.number().int() and this
 *    function can pass it straight through.
 */
export function billToCart(bill: ParsedBill, opts: BillToCartOpts = {}): Cart {
  if (bill.items.length === 0) {
    throw new Error('billToCart: no items were parsed from this bill — nothing to allocate')
  }

  const lines = bill.items.map((i) => i.line_amount)
  const itemsSum = lines.reduce((a, b) => a + b, 0)
  const credits = bill.fees.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0)
  // Cannot take more off than the goods are worth; the residue stays visible in
  // the bill's own reconciliation rather than being buried here.
  const applied = Math.min(credits, itemsSum)
  const reductions = applied > 0 ? distribute(applied, lines) : lines.map(() => 0)

  const items: CartItem[] = bill.items.map((item, i) => {
    const line = Math.max(0, (lines[i] ?? 0) - (reductions[i] ?? 0))
    const divides = item.qty > 0 && line % item.qty === 0
    return {
      sku: `bill-${i}`,
      name: divides || item.qty === 1 ? item.name : `${item.name} ×${item.qty}`,
      unit_amount: divides ? line / item.qty : line,
      qty: divides ? item.qty : 1,
      tier: 'core',
      claimants: pickClaimants(opts.claimantsByItemIndex?.[i]),
      contested: false,
    }
  })

  const fees = bill.fees
    .filter((f) => f.amount > 0)
    .map((f) => ({ name: f.name, amount: f.amount }))

  return CartSchema.parse({ items, fees, currency: bill.currency })
}

function pickClaimants(given: string[] | undefined): string[] {
  const cleaned = (given ?? []).map((c) => c.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : ['mi_all']
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ParseBillInput {
  text?: string
  /** raw base64 or a full data: URL */
  image_base64?: string
}

export interface ParseBillResult extends ParsedBill {
  source: 'text' | 'vision'
  /** what the model read off the image, so a human can audit our numbers */
  transcript?: string
}

export async function parseBill(input: ParseBillInput, opts: ParseBillTextOpts = {}): Promise<ParseBillResult> {
  if (input.text?.trim()) {
    return { ...parseBillText(input.text, opts), source: 'text' }
  }
  if (!input.image_base64?.trim()) {
    throw new BillParseError('parseBill: give me either `text` or `image_base64`', 'empty_input')
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new BillParseError(
      'Reading a photo of a bill needs OPENAI_API_KEY on the engine. Without it, type or paste the bill as text and it will be parsed offline — the text path needs no key.',
      'no_vision_key',
    )
  }

  const transcript = await transcribeReceipt(key, input.image_base64.trim())
  const bill = parseBillText(transcript, opts)
  if (bill.items.length === 0) {
    bill.warnings.push('the photo transcribed but no item lines came out of it — check the transcript')
  }
  return { ...bill, source: 'vision', transcript }
}

/** Pixels → text, and nothing else. The model is explicitly forbidden from
 *  doing arithmetic; every number it emits is re-parsed and re-reconciled. */
async function transcribeReceipt(key: string, image: string): Promise<string> {
  const url = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You transcribe receipts. Output the receipt as plain text, one source line per output line, ' +
              'preserving the original order, wording, quantities, currency symbols and amounts exactly as printed. ' +
              'Keep the column spacing between a description and its amount. ' +
              'Do NOT compute, correct, convert, total or omit anything, including lines you think are junk. ' +
              'No commentary, no markdown, no code fences.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this receipt verbatim.' },
              { type: 'image_url', image_url: { url, detail: 'high' } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (err) {
    throw new BillParseError(
      `Could not reach the vision service (${(err as Error).message}). Paste the bill as text instead — that path works offline.`,
      'vision_failed',
    )
  }
  if (!res.ok) {
    throw new BillParseError(
      `Vision service refused the image (HTTP ${res.status}). Paste the bill as text instead — that path works offline.`,
      'vision_failed',
    )
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) {
    throw new BillParseError('Vision service returned an empty transcript.', 'vision_failed')
  }
  return text.replace(/^```[a-z]*\n?|\n?```$/g, '')
}
