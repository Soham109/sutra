// The terminal artifact of a group session (GMP/1 §7): an ordered chain of
// consent objects, hash-linked and Ed25519-signed by the engine, so a judge —
// or any member — can verify who consented to what, capped at what, and what
// was actually charged, without trusting our UI.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto'
import { canonicalJson } from './types.js'
import { capabilityOf } from './rails.js'

// PKCS#8 DER prefix for a raw Ed25519 seed (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
// SPKI DER prefix for a raw Ed25519 public key.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface ReceiptEntry {
  kind: 'consent' | 'backstop'
  member_id: string
  name: string
  role: string
  cart_hash: string
  cap_amount: number
  quoted_share: number
  /** Money actually moved by the engine. Always 0 on a rail that cannot charge. */
  charged_amount: number
  /** What this person agreed to pay. On at_venue this is the whole obligation. */
  owed_amount: number
  mandate_id: string | null
  charge_txn_id: string | null
  outcome: string
  prev_hash: string
  hash?: string
}

export interface Receipt {
  gmp_version: 'GMP/1'
  group_id: string
  title: string
  merchant: unknown
  currency: string
  cart_hash: string
  policy: unknown
  decision_narrative: string
  status: string
  /** Which rail carried this, and therefore what `charged` can possibly mean. */
  rail: string
  /**
   * Stated in the artifact itself so a receipt read in isolation — printed,
   * emailed, handed to a judge — cannot be mistaken for proof of a payment it
   * never claimed to make.
   */
  settlement_disclosure: string
  totals: { quoted: number; charged: number; owed: number }
  entries: ReceiptEntry[]
  chain_head: string
  issued_at: string
  public_key: string // hex, raw 32 bytes
  signature?: string // hex Ed25519 over canonical receipt minus signature
}

export class ReceiptSigner {
  private readonly privateKey
  readonly publicKeyHex: string

  constructor(seedHex?: string) {
    const seed = seedHex ? Buffer.from(seedHex, 'hex') : randomBytes(32)
    if (seed.length !== 32) throw new Error('ENGINE_SIGNING_SEED must be 32 bytes of hex')
    this.privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    })
    const spki = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' }) as Buffer
    this.publicKeyHex = spki.subarray(SPKI_ED25519_PREFIX.length).toString('hex')
  }

  chain(entries: Omit<ReceiptEntry, 'prev_hash' | 'hash'>[]): { entries: ReceiptEntry[]; head: string } {
    let prev = 'GENESIS'
    const chained: ReceiptEntry[] = []
    for (const e of entries) {
      const withPrev: ReceiptEntry = { ...e, prev_hash: prev }
      const { hash: _drop, ...hashable } = withPrev
      const hash = sha256(canonicalJson(hashable))
      chained.push({ ...withPrev, hash })
      prev = hash
    }
    return { entries: chained, head: prev }
  }

  sign(receipt: Omit<Receipt, 'signature' | 'public_key'>): Receipt {
    const unsigned: Omit<Receipt, 'signature'> = { ...receipt, public_key: this.publicKeyHex }
    const signature = edSign(null, Buffer.from(canonicalJson(unsigned)), this.privateKey).toString('hex')
    return { ...unsigned, signature }
  }
}

/** Standalone verification — mirrored by `gmp verify` in the CLI. */
export function verifyReceipt(
  receipt: Receipt,
  opts?: { expectedPublicKey?: string },
): { ok: boolean; errors: string[] } {
  const errors: string[] = []

  let prev = 'GENESIS'
  for (const [i, entry] of receipt.entries.entries()) {
    if (entry.prev_hash !== prev) errors.push(`entry ${i}: prev_hash broken`)
    const { hash, ...hashable } = entry
    const recomputed = sha256(canonicalJson(hashable))
    if (hash !== recomputed) errors.push(`entry ${i}: hash mismatch`)
    prev = hash ?? ''
  }
  if (receipt.chain_head !== prev) errors.push('chain_head does not match final entry hash')

  const charged = receipt.entries.reduce((s, e) => s + e.charged_amount, 0)
  if (charged !== receipt.totals.charged) errors.push('totals.charged does not equal sum of entries')

  const owed = receipt.entries.reduce((s, e) => s + (e.owed_amount ?? 0), 0)
  if (owed !== receipt.totals.owed) errors.push('totals.owed does not equal sum of entries')

  // The rail is not decoration: a receipt from a non-charging rail that claims
  // money moved is exactly the forgery this chain exists to make detectable.
  if (!capabilityOf(receipt.rail).charges && charged !== 0) {
    errors.push(`${receipt.rail} receipt reports a charged amount — no card is charged on this rail`)
  }

  // Pinning the key matters: without it, an attacker signs with their own
  // keypair, embeds that public_key, and verify("ok") against the file alone.
  if (opts?.expectedPublicKey && receipt.public_key !== opts.expectedPublicKey) {
    errors.push('public_key does not match the known engine signing key')
  }

  const { signature, ...unsigned } = receipt
  if (!signature) {
    errors.push('missing signature')
  } else {
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(receipt.public_key, 'hex')]),
        format: 'der',
        type: 'spki',
      })
      const ok = edVerify(null, Buffer.from(canonicalJson(unsigned)), publicKey, Buffer.from(signature, 'hex'))
      if (!ok) errors.push('Ed25519 signature invalid')
    } catch (e) {
      errors.push(`signature check failed: ${(e as Error).message}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
