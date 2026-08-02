// The signed receipt, as the engine emits it (GMP/1 §7). Typed here so the
// page can render a financial artifact rather than a JSON dump.

import type { Policy, Rail } from '@/lib/api'

export interface ReceiptEntry {
  kind: 'consent' | 'backstop'
  member_id: string
  name: string
  role: string
  cart_hash: string
  cap_amount: number
  quoted_share: number
  charged_amount: number
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
  merchant: { name: string; url?: string; country_code_iso2?: string } | null
  currency: string
  cart_hash: string
  policy: unknown
  decision_narrative: string
  status: string
  rail: Rail
  settlement_disclosure: string
  totals: { quoted: number; charged: number; owed: number }
  entries: ReceiptEntry[]
  chain_head: string
  issued_at: string
  public_key: string
  signature?: string
}

const POLICY_TYPES = ['all_of', 'quorum', 'weighted', 'veto', 'required', 'deadline']

/** The receipt stores the policy as opaque JSON; only render it if we know it. */
export function asPolicy(value: unknown): Policy | null {
  if (!value || typeof value !== 'object') return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && POLICY_TYPES.includes(type) ? (value as Policy) : null
}

export function statusTone(status: string): 'ok' | 'bad' | 'warn' | 'plain' {
  if (status === 'committed') return 'ok'
  if (status === 'partial') return 'warn'
  if (status === 'aborted' || status === 'expired') return 'bad'
  return 'plain'
}

const STATUS_LINE: Record<string, string> = {
  committed: 'Everyone the policy required approved, and every share was charged.',
  partial: 'The policy passed, but not every share settled. Only the entries marked charged moved money.',
  aborted: 'The group was called off. Every mandate was cancelled and nothing was charged.',
  expired: 'The deadline passed before the policy could be satisfied. Nothing was charged.',
}

export function statusLine(receipt: Receipt): string {
  if (receipt.status === 'committed' && receipt.rail === 'shopify_pos') {
    return 'Everyone confirmed an exact share. The group is ready for the cashier; this is not proof of POS payment.'
  }
  if (receipt.status === 'committed' && receipt.rail === 'checkout_handoff') {
    return 'Everyone confirmed the proposed split. Merchant checkout, fulfilment and payment are still pending.'
  }
  if (receipt.status === 'committed' && receipt.rail === 'at_venue') {
    return 'Everyone confirmed what they owe. They still pay the venue directly.'
  }
  return STATUS_LINE[receipt.status] ?? 'This group reached a terminal state and the receipt was issued.'
}

export function shortHash(hash: string | undefined, head = 10, tail = 6): string {
  if (!hash) return '—'
  if (hash === 'GENESIS') return 'GENESIS'
  if (hash.length <= head + tail + 1) return hash
  return tail > 0 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : `${hash.slice(0, head)}…`
}

export function outcomeTone(entry: ReceiptEntry): 'ok' | 'bad' | 'plain' {
  if (entry.charged_amount > 0) return 'ok'
  if (['declined', 'failed', 'dropped', 'expired', 'cancelled'].some((s) => entry.outcome.includes(s))) return 'bad'
  return 'plain'
}
