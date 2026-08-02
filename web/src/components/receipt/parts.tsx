'use client'

import type { GroupStatus } from '@/lib/api'
import { Badge, Money, PolicyChip } from '@/components/ui'
import { money } from '@/lib/format'
import { asPolicy, statusTone, statusLine, type Receipt } from './model'

export function GroupStatusBadge({ status }: { status: GroupStatus | string }) {
  const tone =
    status === 'committed'
      ? 'ok'
      : status === 'partial'
        ? 'warn'
        : status === 'aborted' || status === 'expired'
          ? 'bad'
          : status === 'draft'
            ? 'plain'
            : 'brand'
  return <Badge tone={tone}>{status}</Badge>
}

/** What happened, in the engine's words and then in plain English. */
export function StatusBanner({ receipt }: { receipt: Receipt }) {
  const tone = statusTone(receipt.status)
  const cls = tone === 'ok' ? 'banner banner-ok' : tone === 'bad' ? 'banner banner-bad' : 'banner'

  return (
    <section className={cls}>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="banner-title">{receipt.status.toUpperCase()}</span>
        <Badge>{receipt.gmp_version}</Badge>
      </div>
      <p className="small" style={{ marginTop: 8, color: 'var(--ink-2)' }}>
        {statusLine(receipt)}
      </p>
      <p className="tiny faint" style={{ marginTop: 8 }}>{receipt.settlement_disclosure}</p>
      <p style={{ marginTop: 10 }}>{receipt.decision_narrative}</p>
    </section>
  )
}

export function Totals({ receipt }: { receipt: Receipt }) {
  const cur = receipt.currency
  const gap = receipt.totals.quoted - receipt.totals.charged
  const policy = asPolicy(receipt.policy)

  return (
    <section className="card card-pad">
      <div className="rc-totals">
        <span className="small muted">Quoted total</span>
        <span className="amount muted">{money(receipt.totals.quoted, cur)}</span>

        <span className="small" style={{ fontWeight: 550 }}>
          Charged total
        </span>
        <Money minor={receipt.totals.charged} currency={cur} size="lg" />

        {!receipt.totals.charged && receipt.totals.owed > 0 ? (
          <>
            <span className="small" style={{ fontWeight: 550 }}>Agreed, not charged</span>
            <Money minor={receipt.totals.owed} currency={cur} size="lg" />
          </>
        ) : null}
      </div>

      {receipt.totals.charged > 0 && gap !== 0 && (
        <p className="tiny faint" style={{ marginTop: 8 }}>
          {gap > 0
            ? `${money(gap, cur)} of the quote was never collected — those mandates were cancelled instead.`
            : `${money(-gap, cur)} more than quoted was collected, inside the caps each member set.`}
        </p>
      )}

      <hr className="divider" style={{ margin: '14px 0' }} />

      <div className="col" style={{ gap: 10 }}>
        <div className="row-between wrap" style={{ gap: 10 }}>
          <span className="small muted">Merchant</span>
          <span className="small" style={{ fontWeight: 550 }}>
            {receipt.merchant?.name ?? 'unknown merchant'}
          </span>
        </div>
        <div className="row-between wrap" style={{ gap: 10 }}>
          <span className="small muted">Cart hash</span>
          <span className="mono tiny" style={{ overflowWrap: 'anywhere' }}>
            {receipt.cart_hash}
          </span>
        </div>
        <div className="row-between wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="small muted">Policy</span>
          {policy ? <PolicyChip policy={policy} /> : <span className="small">—</span>}
        </div>
      </div>
    </section>
  )
}
