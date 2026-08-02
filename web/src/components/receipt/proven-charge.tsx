import Link from 'next/link'

/**
 * A pointer to one completed card-rail charge.
 *
 * Most receipts on any given account end at zero charged, because most rails
 * do not charge a card: a restaurant bill is settled at the table, a shared
 * cart finishes at the merchant's own checkout. That is honest, but it means
 * someone browsing an account can scroll a whole list without ever seeing the
 * mechanism the product is actually about.
 *
 * So this names the one group where money moved through the card network and
 * links straight to it. The receipt is public and verifies offline, so it is a
 * claim anyone can check rather than one they have to take on trust.
 */
const GROUP = process.env.NEXT_PUBLIC_PROVEN_CHARGE_GROUP ?? 'gs_01KZ1SW0EXN2V3N4Y1V0K5E4H4'
const AMOUNT = process.env.NEXT_PUBLIC_PROVEN_CHARGE_LABEL ?? '₹18,600 across two people'

export function ProvenChargeNote() {
  if (!GROUP) return null
  return (
    <div
      className="card card-pad"
      style={{ borderColor: 'var(--brand)', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}
    >
      <div className="grow" style={{ minWidth: 240 }}>
        <span className="eyebrow">Card rail · completed</span>
        <p className="small" style={{ marginTop: 6, marginBottom: 0 }}>
          Most receipts here settle without a card being charged, because most rails do not touch one.{' '}
          <b>{AMOUNT}</b> did — two capped Prava mandates, two cards, charged in turn on the sandbox.
        </p>
      </div>
      <Link className="btn btn-secondary" href={`/app/receipts/${GROUP}`}>
        See that receipt
      </Link>
    </div>
  )
}
