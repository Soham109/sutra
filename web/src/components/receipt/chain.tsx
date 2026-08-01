'use client'

import { Avatar, Badge } from '@/components/ui'
import { money } from '@/lib/format'
import { outcomeTone, shortHash, type Receipt, type ReceiptEntry } from './model'

/**
 * The consent chain, drawn as a chain.
 *
 * Each entry is one person's own authorization: what they were quoted, the cap
 * they set, what actually moved, and the hash that ties them to the entry
 * before. Read top to bottom it is a complete account of who agreed to what —
 * which is the only claim this product makes that matters.
 */
export function ConsentChain({ receipt }: { receipt: Receipt }) {
  const cur = receipt.currency
  const entries = receipt.entries

  return (
    <section className="card card-pad">
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>The consent chain</h3>
          <p className="small muted" style={{ maxWidth: '52ch', marginTop: 4 }}>
            One entry per authorization, in the order they were made. Every entry is hashed together with the
            hash of the entry before it, so removing or editing one breaks every entry after it.
          </p>
        </div>
        <Badge>{entries.length} entries</Badge>
      </div>

      <ol className="rc-chain" style={{ marginTop: 18 }}>
        {entries.map((e, i) => (
          <Entry
            key={`${e.member_id}-${e.kind}-${i}`}
            entry={e}
            index={i}
            currency={cur}
            linked={i === 0 ? e.prev_hash === 'GENESIS' : e.prev_hash === entries[i - 1]!.hash}
          />
        ))}
      </ol>

      <div className="row wrap" style={{ gap: 10, marginTop: 4 }}>
        <span className="eyebrow">Chain head</span>
        <span className="rc-head">
          <span aria-hidden>⛓</span>
          <span className="rc-short">{shortHash(receipt.chain_head, 16, 10)}</span>
          <span className="rc-full">{receipt.chain_head}</span>
        </span>
      </div>
      <p className="tiny faint" style={{ marginTop: 8 }}>
        The chain head is the hash of the final entry. It is covered by the signature below, so it fixes the
        whole chain: change any number anywhere and this value stops matching.
      </p>
    </section>
  )
}

function Entry({
  entry,
  index,
  currency,
  linked,
}: {
  entry: ReceiptEntry
  index: number
  currency: string
  linked: boolean
}) {
  const charged = entry.charged_amount > 0
  const tone = outcomeTone(entry)

  return (
    <li className="rc-entry" data-kind={entry.kind} data-charged={charged ? 'yes' : 'no'}>
      <span className="rc-node" aria-hidden />

      <div className="rc-card">
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <Avatar name={entry.name} size="sm" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 550 }}>
                <span className="faint mono tiny">#{index + 1}</span> {entry.name}
              </div>
              <div className="tiny faint">
                {entry.role}
                {entry.kind === 'backstop' && ' · backstop absorption'}
              </div>
            </div>
          </div>
          <Badge tone={tone === 'plain' ? 'plain' : tone}>{entry.outcome}</Badge>
        </div>

        <dl className="rc-grid">
          <dt>Quoted share</dt>
          <dd className="amount">{money(entry.quoted_share, currency)}</dd>

          <dt>Their cap</dt>
          <dd className="amount muted">{money(entry.cap_amount, currency)}</dd>

          <dt>Charged</dt>
          <dd className="amount" style={{ color: charged ? 'var(--ok)' : 'var(--ink-3)' }}>
            {money(entry.charged_amount, currency)}
          </dd>

          <dt>Mandate</dt>
          <dd className="mono tiny">{entry.mandate_id ?? '—'}</dd>

          <dt>Charge txn</dt>
          <dd className="mono tiny">{entry.charge_txn_id ?? '—'}</dd>

          <dt>Cart hash</dt>
          <dd className="mono tiny">
            <span className="rc-short">{shortHash(entry.cart_hash)}</span>
            <span className="rc-full">{entry.cart_hash}</span>
          </dd>
        </dl>

        <div className="rc-link">
          <span className="lbl">prev_hash</span>
          <span className="rc-short">{shortHash(entry.prev_hash)}</span>
          <span className="rc-full">{entry.prev_hash}</span>
          <span className="arrow" aria-label="is carried into">
            ←
          </span>
          <span className="lbl">hash</span>
          <span className="rc-short">{shortHash(entry.hash)}</span>
          <span className="rc-full">{entry.hash}</span>
          {linked ? (
            <span className="tiny" style={{ color: 'var(--ok)' }}>
              {index === 0 ? 'starts the chain' : `links to #${index}`}
            </span>
          ) : (
            <span className="tiny" style={{ color: 'var(--bad)' }}>
              chain break — this entry does not follow the one above
            </span>
          )}
        </div>
      </div>
    </li>
  )
}
